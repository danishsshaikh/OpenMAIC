from __future__ import annotations

import io
import logging
import os
import re
import threading
import traceback
from pathlib import Path
from typing import Dict, List

import torch
import torchaudio
import uvicorn
from fastapi import FastAPI, HTTPException, Response
from pydantic import BaseModel, Field

try:
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS
except Exception as exc:  # pragma: no cover - surfaced by health/model load
    ChatterboxMultilingualTTS = None
    CHATTERBOX_IMPORT_ERROR = exc
else:
    CHATTERBOX_IMPORT_ERROR = None


DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
MAX_CONCURRENCY = max(1, int(os.getenv("VOICE_CLONING_MAX_CONCURRENCY", "1")))
SAMPLE_RATE = int(os.getenv("VOICE_CLONING_SAMPLE_RATE", "24000"))
EXAGGERATION = float(os.getenv("CHATTERBOX_EXAGGERATION", "0.50"))
CFG_WEIGHT = float(os.getenv("CHATTERBOX_CFG_WEIGHT", "0.30"))
TEMPERATURE = float(os.getenv("CHATTERBOX_TEMPERATURE", "0.85"))
TOP_P = float(os.getenv("CHATTERBOX_TOP_P", "0.95"))
MIN_P = float(os.getenv("CHATTERBOX_MIN_P", "0.05"))
REPETITION_PENALTY = float(os.getenv("CHATTERBOX_REPETITION_PENALTY", "2.0"))
PAUSE_SECONDS = float(os.getenv("CHATTERBOX_CHUNK_PAUSE_SECONDS", "0.25"))
SUPPORTED_LANGUAGE_IDS = {
    "ar",
    "da",
    "de",
    "el",
    "en",
    "es",
    "fi",
    "fr",
    "he",
    "hi",
    "it",
    "ja",
    "ko",
    "ms",
    "nl",
    "no",
    "pl",
    "pt",
    "ru",
    "sv",
    "sw",
    "tr",
    "zh",
}

app = FastAPI(title="OpenMAIC Chatterbox Voice Cloning")
generation_lock = threading.Semaphore(MAX_CONCURRENCY)
profiles: Dict[str, Path] = {}
model = None
model_error: str | None = None
log = logging.getLogger("openmaic.voice_cloning")


class ProfileCreateRequest(BaseModel):
    profileId: str = Field(min_length=1)
    referenceAudioPath: str = Field(min_length=1)
    language: str = "en"


class SynthesizeRequest(BaseModel):
    profileId: str = Field(min_length=1)
    text: str = Field(min_length=1)
    language: str = "en"


@app.on_event("startup")
def load_model() -> None:
    global model, model_error
    if ChatterboxMultilingualTTS is None:
        model_error = f"chatterbox.mtl_tts could not be imported: {CHATTERBOX_IMPORT_ERROR}"
        log.error("Chatterbox multilingual import failed", exc_info=CHATTERBOX_IMPORT_ERROR)
        return
    try:
        model = ChatterboxMultilingualTTS.from_pretrained(device=DEVICE)
        model_error = None
    except Exception as exc:  # pragma: no cover - depends on GPU/model install
        model_error = str(exc)
        log.error("Chatterbox model load failed:\n%s", traceback.format_exc())


@app.get("/health")
def health() -> dict:
    return {
        "ok": model is not None,
        "provider": "chatterbox",
        "modelLoaded": model is not None,
        "device": DEVICE,
        "maxConcurrency": MAX_CONCURRENCY,
        "error": model_error,
    }


@app.post("/profiles")
def create_profile(req: ProfileCreateRequest) -> dict:
    ref = Path(req.referenceAudioPath)
    if not ref.is_file():
        raise HTTPException(status_code=400, detail="reference audio not found")
    profiles[req.profileId] = ref
    return {"providerReferenceId": req.profileId}


@app.delete("/profiles/{profile_id}")
def delete_profile(profile_id: str) -> dict:
    profiles.pop(profile_id, None)
    return {"ok": True}


@app.post("/synthesize")
def synthesize(req: SynthesizeRequest) -> Response:
    if model is None:
        raise HTTPException(status_code=503, detail=model_error or "model not loaded")
    try:
        language = normalize_language_id(req.language)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    reference = profiles.get(req.profileId)
    if reference is None or not reference.is_file():
        raise HTTPException(status_code=404, detail="voice profile not found")
    if not generation_lock.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="voice cloning service is busy")
    try:
        wav = generate_long_text(req.text, reference, language)
        buffer = io.BytesIO()
        torchaudio.save(buffer, wav, SAMPLE_RATE, format="wav")
        return Response(content=buffer.getvalue(), media_type="audio/wav")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        log.error(
            "Chatterbox synthesis failed profileId=%s language=%s textLen=%s:\n%s",
            req.profileId,
            language,
            len(req.text),
            traceback.format_exc(),
        )
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        generation_lock.release()


def split_text(text: str) -> List[str]:
    normalized = re.sub(r"\s+", " ", text).strip()
    if not normalized:
        return []
    chunks: List[str] = []
    for paragraph in re.split(r"\n+", normalized):
        start = 0
        parts = re.split(r"(?<=[.!?;:。！？；：])\s+", paragraph)
        for part in parts:
            part = part.strip()
            if not part:
                continue
            if len(part) <= 420:
                chunks.append(part)
                continue
            while start < len(part):
                end = min(len(part), start + 420)
                if end < len(part):
                    space = part.rfind(" ", start, end)
                    if space > start + 80:
                        end = space
                chunks.append(part[start:end].strip())
                start = end
            start = 0
    return chunks


def ensure_wave_tensor(wav: torch.Tensor) -> torch.Tensor:
    if wav.dim() == 1:
        return wav.unsqueeze(0)
    if wav.dim() == 2:
        return wav
    return wav.reshape(1, -1)


def completed_audio_tensor(wav: torch.Tensor) -> torch.Tensor:
    return ensure_wave_tensor(wav).detach().cpu()


def normalize_language_id(language: str | None) -> str:
    normalized = (language or "en").strip().lower().replace("_", "-")
    base = normalized.split("-")[0]
    if base not in SUPPORTED_LANGUAGE_IDS:
        raise ValueError(f"Unsupported language_id '{language}'")
    return base


def generate_long_text(text: str, reference: Path, language: str) -> torch.Tensor:
    chunks = split_text(text)
    if not chunks:
        raise ValueError("text is empty")
    outputs = []
    silence = torch.zeros((1, int(SAMPLE_RATE * PAUSE_SECONDS)), dtype=torch.float32)
    language_id = normalize_language_id(language)
    for index, chunk in enumerate(chunks):
        wav = model.generate(
            chunk,
            audio_prompt_path=str(reference),
            language_id=language_id,
            exaggeration=EXAGGERATION,
            cfg_weight=CFG_WEIGHT,
            temperature=TEMPERATURE,
            top_p=TOP_P,
            min_p=MIN_P,
            repetition_penalty=REPETITION_PENALTY,
        )
        outputs.append(completed_audio_tensor(wav))
        if index < len(chunks) - 1:
            outputs.append(silence)
    return torch.cat(outputs, dim=-1)


if __name__ == "__main__":
    port = int(os.getenv("VOICE_CLONING_SERVICE_PORT", "8765"))
    uvicorn.run(app, host=os.getenv("VOICE_CLONING_SERVICE_HOST", "127.0.0.1"), port=port)
