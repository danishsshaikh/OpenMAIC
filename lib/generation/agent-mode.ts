import { isGeneratedClassroomAgentsEnabled } from '@/lib/config/feature-flags';
import type { AgentInfo } from '@openmaic/generation';

export const STANDARD_TEACHER_AGENT_ID = 'default-1';

export function shouldGenerateClassroomAgents(agentMode: 'preset' | 'auto'): boolean {
  return agentMode === 'auto' && isGeneratedClassroomAgentsEnabled();
}

export function teacherOnlyAgentIds(): string[] {
  return [STANDARD_TEACHER_AGENT_ID];
}

export function teacherOnlyAgentInfo(
  getAgent: (
    id: string,
  ) => { id: string; name: string; role: string; persona?: string } | undefined,
): AgentInfo[] {
  const teacher = getAgent(STANDARD_TEACHER_AGENT_ID);
  if (!teacher) {
    return [
      {
        id: STANDARD_TEACHER_AGENT_ID,
        name: 'AI Teacher',
        role: 'teacher',
      },
    ];
  }
  return [
    {
      id: teacher.id,
      name: teacher.name,
      role: teacher.role,
      persona: teacher.persona,
    },
  ];
}
