import { afterEach, describe, expect, it, vi } from 'vitest';

const FLAG_KEY = 'NEXT_PUBLIC_FEATURE_GENERATED_CLASSROOM_AGENTS';
const originalValue = process.env[FLAG_KEY];

async function loadAgentMode() {
  vi.resetModules();
  return import('@/lib/generation/agent-mode');
}

afterEach(() => {
  if (originalValue === undefined) {
    delete process.env[FLAG_KEY];
  } else {
    process.env[FLAG_KEY] = originalValue;
  }
  vi.resetModules();
});

describe('standard generation agent mode', () => {
  it('keeps the standard flow teacher-only even when persisted settings say auto', async () => {
    delete process.env[FLAG_KEY];
    const { shouldGenerateClassroomAgents, teacherOnlyAgentIds } = await loadAgentMode();

    expect(shouldGenerateClassroomAgents('auto')).toBe(false);
    expect(teacherOnlyAgentIds()).toEqual(['default-1']);
  });

  it('allows generated classroom agents only behind the explicit flag and auto mode', async () => {
    process.env[FLAG_KEY] = 'true';
    const { shouldGenerateClassroomAgents } = await loadAgentMode();

    expect(shouldGenerateClassroomAgents('auto')).toBe(true);
    expect(shouldGenerateClassroomAgents('preset')).toBe(false);
  });

  it('builds a single visible AI Teacher info record', async () => {
    const { teacherOnlyAgentInfo } = await loadAgentMode();

    expect(
      teacherOnlyAgentInfo((id) =>
        id === 'default-1'
          ? { id, name: 'AI Teacher', role: 'teacher', persona: 'Lead teacher' }
          : undefined,
      ),
    ).toEqual([{ id: 'default-1', name: 'AI Teacher', role: 'teacher', persona: 'Lead teacher' }]);
  });
});
