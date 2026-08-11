# OpenMAIC Chatterbox Voice-Cloning Service

This service is intentionally separate from the Next.js app. OpenMAIC talks to it
through the voice-cloning provider interface and never imports Chatterbox,
PyTorch, or CUDA libraries.

## Start

```bash
cd services/voice-cloning
python -m venv .venv
source .venv/bin/activate
pip install fastapi uvicorn torch torchaudio chatterbox-tts
VOICE_CLONING_SERVICE_PORT=8765 python chatterbox_service.py
```

Set the Next.js app environment:

```bash
NEXT_PUBLIC_FEATURE_VOICE_CLONING=true
VOICE_CLONING_PROVIDER=chatterbox
VOICE_CLONING_BASE_URL=http://127.0.0.1:8765
```

Check health:

```bash
curl http://127.0.0.1:8765/health
```

Monitor GPU memory separately with `nvidia-smi` during enrollment and synthesis.

