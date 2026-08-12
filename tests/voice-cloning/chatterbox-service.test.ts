import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const servicePath = join(repoRoot, 'services/voice-cloning/chatterbox_service.py');
const requirementsPath = join(repoRoot, 'services/voice-cloning/requirements.txt');

describe('Chatterbox service scaffold', () => {
  it('uses the multilingual Chatterbox module verified on HPC', () => {
    const source = readFileSync(servicePath, 'utf8');
    expect(source).toContain('from chatterbox.mtl_tts import ChatterboxMultilingualTTS');
    expect(source).not.toContain('from chatterbox.tts import ChatterboxMultilingualTTS');
  });

  it('documents the Perth/pkg_resources setuptools compatibility constraint', () => {
    const requirements = readFileSync(requirementsPath, 'utf8');
    expect(requirements).toContain('chatterbox-tts==0.1.7');
    expect(requirements).toContain('setuptools<81');
  });

  it('assembles generated chunks on CPU to avoid mixed CUDA/CPU concatenation', () => {
    const source = readFileSync(servicePath, 'utf8');
    expect(source).toContain('def completed_audio_tensor');
    expect(source).toContain('ensure_wave_tensor(wav).detach().cpu()');
    expect(source).toContain(
      'torch.zeros((1, int(SAMPLE_RATE * PAUSE_SECONDS)), dtype=torch.float32)',
    );
    expect(source).toContain('return torch.cat(outputs, dim=-1)');
  });

  it('supports explicit V2/V3 model variants with V3 as the default', () => {
    const source = readFileSync(servicePath, 'utf8');
    expect(source).toContain('DEFAULT_MODEL_VARIANT = os.getenv("CHATTERBOX_T3_MODEL", "v3")');
    expect(source).toContain('SUPPORTED_MODEL_VARIANTS = {"v2", "v3"}');
    expect(source).toContain('"v2": "t3_mtl23ls_v2.safetensors"');
    expect(source).toContain('"v3": "t3_mtl23ls_v3.safetensors"');
    expect(source).toContain('def normalize_model_variant');
    expect(source).toContain('raise ValueError(f"Unsupported modelVariant');
  });

  it('uses the runtime t3_model selector when installed and legacy V2 otherwise', () => {
    const source = readFileSync(servicePath, 'utf8');
    expect(source).toContain('def from_pretrained_supports_t3_model');
    expect(source).toContain(
      'ChatterboxMultilingualTTS.from_pretrained(device=DEVICE, t3_model=variant)',
    );
    expect(source).toContain('if variant == "v2":');
    expect(source).toContain('return ChatterboxMultilingualTTS.from_pretrained(device=DEVICE)');
  });

  it('keeps one active model variant and logs reuse/switch lifecycle', () => {
    const source = readFileSync(servicePath, 'utf8');
    expect(source).toContain('model_variant: str | None = None');
    expect(source).toContain('reusing chatterbox model variant=%s');
    expect(source).toContain('switching chatterbox model variant=%s -> %s');
    expect(source).toContain('release_active_model()');
    expect(source).toContain('torch.cuda.empty_cache()');
  });

  it('passes the selected model variant through registration and synthesis requests', () => {
    const source = readFileSync(servicePath, 'utf8');
    expect(source).toContain('modelVariant: str | None = None');
    expect(source).toContain('variant = normalize_model_variant(req.modelVariant)');
    expect(source).toContain('active_model = get_model(variant)');
  });

  it('accepts validated per-request generation settings without changing model lifecycle', () => {
    const source = readFileSync(servicePath, 'utf8');
    expect(source).toContain('class GenerationSettings(BaseModel)');
    expect(source).toContain('generationSettings: GenerationSettings | None = None');
    expect(source).toContain(
      'generation_settings = resolve_generation_settings(req.generationSettings)',
    );
    expect(source).toContain('exaggeration=generation_settings["exaggeration"]');
    expect(source).toContain('cfg_weight=generation_settings["cfgWeight"]');
    expect(source).toContain('top_p=generation_settings["topP"]');
    expect(source).toContain('repetition_penalty=generation_settings["repetitionPenalty"]');
    expect(source).not.toContain('get_model(variant, generation_settings)');
  });
});
