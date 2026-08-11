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
});
