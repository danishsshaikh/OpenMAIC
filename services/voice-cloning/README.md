# OpenMAIC Chatterbox Voice-Cloning Service

This service is intentionally separate from the Next.js app. OpenMAIC talks to it
through the voice-cloning provider interface and never imports Chatterbox,
PyTorch, or CUDA libraries.

## Start

```bash
cd services/voice-cloning
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
CHATTERBOX_T3_MODEL=v3 VOICE_CLONING_SERVICE_PORT=8765 python chatterbox_service.py
```

`setuptools<81` is required for the Perth/pkg_resources compatibility path used
by Chatterbox 0.1.7 in the tested HPC environment. Do not remove it unless the
installed Chatterbox/Perth versions are upgraded and startup is revalidated.

`CHATTERBOX_T3_MODEL` controls only the service default. Persisted OpenMAIC voice
profiles send their selected `v2` or `v3` model variant with each trusted
server-to-service request, so per-profile choice overrides the service default.

The installed `chatterbox-tts==0.1.7` package verified during development exposes
`ChatterboxMultilingualTTS.from_pretrained(device)` and hardcodes the V2 T3
checkpoint. Newer Chatterbox sources expose `from_pretrained(device,
t3_model="v3")`. The service uses that API when available and otherwise uses a
bounded compatibility loader for V3.

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
