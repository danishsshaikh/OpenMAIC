from __future__ import annotations

import io
import gc
import inspect
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
    import chatterbox.mtl_tts as chatterbox_mtl
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS
except Exception as exc:  # pragma: no cover - surfaced by health/model load
    chatterbox_mtl = None
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
DEFAULT_MODEL_VARIANT = os.getenv("CHATTERBOX_T3_MODEL", "v3").strip().lower() or "v3"
SUPPORTED_MODEL_VARIANTS = {"v2", "v3"}
T3_MODEL_FILES = {
    "v2": "t3_mtl23ls_v2.safetensors",
    "v3": "t3_mtl23ls_v3.safetensors",
}
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
GENERATION_SETTING_RANGES = {
    "exaggeration": (0.25, 2.0),
    "cfgWeight": (0.0, 1.0),
    "temperature": (0.2, 1.5),
    "topP": (0.10, 1.0),
    "minP": (0.0, 0.20),
    "repetitionPenalty": (1.0, 3.0),
}

app = FastAPI(title="OpenMAIC Chatterbox Voice Cloning")
generation_lock = threading.Semaphore(MAX_CONCURRENCY)
profiles: Dict[str, Path] = {}
model = None
model_variant: str | None = None
model_error: str | None = None
log = logging.getLogger("openmaic.voice_cloning")


class ProfileCreateRequest(BaseModel):
    profileId: str = Field(min_length=1)
    referenceAudioPath: str = Field(min_length=1)
    language: str = "en"
    modelVariant: str | None = None
    generationSettings: dict | None = None


class GenerationSettings(BaseModel):
    exaggeration: float | None = None
    cfgWeight: float | None = None
    temperature: float | None = None
    topP: float | None = None
    minP: float | None = None
    repetitionPenalty: float | None = None


class SynthesizeRequest(BaseModel):
    profileId: str = Field(min_length=1)
    text: str = Field(min_length=1)
    language: str = "en"
    modelVariant: str | None = None
    generationSettings: GenerationSettings | None = None


@app.on_event("startup")
def load_model() -> None:
    global model_error
    if ChatterboxMultilingualTTS is None:
        model_error = f"chatterbox.mtl_tts could not be imported: {CHATTERBOX_IMPORT_ERROR}"
        log.error("Chatterbox multilingual import failed", exc_info=CHATTERBOX_IMPORT_ERROR)
        return
    try:
        get_model(normalize_model_variant(DEFAULT_MODEL_VARIANT))
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
        "modelVariant": model_variant,
        "defaultModelVariant": normalize_model_variant(DEFAULT_MODEL_VARIANT),
        "device": DEVICE,
        "maxConcurrency": MAX_CONCURRENCY,
        "error": model_error,
    }


@app.post("/profiles")
def create_profile(req: ProfileCreateRequest) -> dict:
    normalize_model_variant(req.modelVariant)
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
    try:
        language = normalize_language_id(req.language)
        variant = normalize_model_variant(req.modelVariant)
        generation_settings = resolve_generation_settings(req.generationSettings)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    reference = profiles.get(req.profileId)
    if reference is None or not reference.is_file():
        raise HTTPException(status_code=404, detail="voice profile not found")
    if not generation_lock.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="voice cloning service is busy")
    try:
        active_model = get_model(variant)
        wav = generate_long_text(active_model, req.text, reference, language, generation_settings)
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


def normalize_model_variant(model_variant_value: str | None) -> str:
    variant = (model_variant_value or DEFAULT_MODEL_VARIANT).strip().lower()
    if variant not in SUPPORTED_MODEL_VARIANTS:
        raise ValueError(f"Unsupported modelVariant '{model_variant_value}'")
    return variant


def resolve_generation_settings(settings: GenerationSettings | None) -> dict:
    values = {
        "exaggeration": EXAGGERATION,
        "cfgWeight": CFG_WEIGHT,
        "temperature": TEMPERATURE,
        "topP": TOP_P,
        "minP": MIN_P,
        "repetitionPenalty": REPETITION_PENALTY,
    }
    if settings is None:
        return values

    supplied = settings.dict(exclude_none=True)
    for key, value in supplied.items():
        lower, upper = GENERATION_SETTING_RANGES[key]
        if value < lower or value > upper:
            raise ValueError(f"Invalid generationSettings.{key}")
        values[key] = value
    return values


def from_pretrained_supports_t3_model() -> bool:
    if ChatterboxMultilingualTTS is None:
        return False
    try:
        return "t3_model" in inspect.signature(ChatterboxMultilingualTTS.from_pretrained).parameters
    except (TypeError, ValueError):
        return False


def load_model_with_runtime_api(variant: str):
    if from_pretrained_supports_t3_model():
        return ChatterboxMultilingualTTS.from_pretrained(device=DEVICE, t3_model=variant)
    if variant == "v2":
        return ChatterboxMultilingualTTS.from_pretrained(device=DEVICE)
    return load_model_with_legacy_v3_loader(variant)


def load_model_with_legacy_v3_loader(variant: str):
    if chatterbox_mtl is None:
        raise RuntimeError("chatterbox.mtl_tts is not available")
    missing = [
        name
        for name in (
            "snapshot_download",
            "REPO_ID",
            "VoiceEncoder",
            "T3",
            "T3Config",
            "load_safetensors",
            "S3Gen",
            "MTLTokenizer",
            "Conditionals",
        )
        if not hasattr(chatterbox_mtl, name)
    ]
    if missing:
        raise RuntimeError(
            "Installed chatterbox-tts does not expose the APIs needed to load "
            f"multilingual {variant}: {', '.join(missing)}"
        )

    t3_model = T3_MODEL_FILES[variant]
    ckpt_dir = Path(
        chatterbox_mtl.snapshot_download(
            repo_id=chatterbox_mtl.REPO_ID,
            repo_type="model",
            revision="main",
            allow_patterns=[
                "ve.pt",
                t3_model,
                "s3gen.pt",
                "grapheme_mtl_merged_expanded_v1.json",
                "conds.pt",
                "Cangjie5_TC.json",
            ],
            token=os.getenv("HF_TOKEN"),
        )
    )
    map_location = torch.device("cpu") if DEVICE in ["cpu", "mps"] else None

    ve = chatterbox_mtl.VoiceEncoder()
    ve.load_state_dict(torch.load(ckpt_dir / "ve.pt", map_location=map_location, weights_only=True))
    ve.to(DEVICE).eval()

    t3 = chatterbox_mtl.T3(chatterbox_mtl.T3Config.multilingual())
    t3_state = chatterbox_mtl.load_safetensors(ckpt_dir / t3_model)
    if "model" in t3_state.keys():
        t3_state = t3_state["model"][0]
    t3.load_state_dict(t3_state)
    t3.to(DEVICE).eval()

    s3gen = chatterbox_mtl.S3Gen()
    s3gen.load_state_dict(
        torch.load(ckpt_dir / "s3gen.pt", map_location=map_location, weights_only=True)
    )
    s3gen.to(DEVICE).eval()

    tokenizer = chatterbox_mtl.MTLTokenizer(
        str(ckpt_dir / "grapheme_mtl_merged_expanded_v1.json")
    )

    conds = None
    builtin_voice = ckpt_dir / "conds.pt"
    if builtin_voice.exists():
        conds = chatterbox_mtl.Conditionals.load(builtin_voice, map_location=map_location).to(
            DEVICE
        )

    return ChatterboxMultilingualTTS(ve=ve, t3=t3, s3gen=s3gen, tokenizer=tokenizer, device=DEVICE, conds=conds)


def release_active_model() -> None:
    global model, model_variant
    model = None
    model_variant = None
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def get_model(variant: str):
    global model, model_variant, model_error
    variant = normalize_model_variant(variant)
    if model is not None and model_variant == variant:
        log.info("reusing chatterbox model variant=%s", variant)
        return model
    if model is not None:
        log.info("switching chatterbox model variant=%s -> %s", model_variant, variant)
        release_active_model()
    log.info("loading chatterbox model variant=%s", variant)
    loaded_model = load_model_with_runtime_api(variant)
    model = loaded_model
    model_variant = variant
    model_error = None
    log.info("model loaded variant=%s", variant)
    return model


def generate_long_text(
    active_model,
    text: str,
    reference: Path,
    language: str,
    generation_settings: dict,
) -> torch.Tensor:
    chunks = split_text(text)
    if not chunks:
        raise ValueError("text is empty")
    outputs = []
    silence = torch.zeros((1, int(SAMPLE_RATE * PAUSE_SECONDS)), dtype=torch.float32)
    language_id = normalize_language_id(language)
    for index, chunk in enumerate(chunks):
        wav = active_model.generate(
            chunk,
            audio_prompt_path=str(reference),
            language_id=language_id,
            exaggeration=generation_settings["exaggeration"],
            cfg_weight=generation_settings["cfgWeight"],
            temperature=generation_settings["temperature"],
            top_p=generation_settings["topP"],
            min_p=generation_settings["minP"],
            repetition_penalty=generation_settings["repetitionPenalty"],
        )
        outputs.append(completed_audio_tensor(wav))
        if index < len(chunks) - 1:
            outputs.append(silence)
    return torch.cat(outputs, dim=-1)


if __name__ == "__main__":
    port = int(os.getenv("VOICE_CLONING_SERVICE_PORT", "8765"))
    uvicorn.run(app, host=os.getenv("VOICE_CLONING_SERVICE_HOST", "127.0.0.1"), port=port)
