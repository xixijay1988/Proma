import { DEFAULT_AGENT_ENGINE } from '@proma/shared'
import type { AgentEngine, AgentSessionMeta, AgentWorkspace } from '@proma/shared'

export function getAgentEngine(input?: AgentWorkspace | AgentSessionMeta | null): AgentEngine {
  return input?.agentEngine ?? DEFAULT_AGENT_ENGINE
}

export function resolveAgentEngine(input: {
  session?: AgentSessionMeta | null
  workspace?: AgentWorkspace | null
}): AgentEngine {
  return input.session?.agentEngine ?? input.workspace?.agentEngine ?? DEFAULT_AGENT_ENGINE
}

export function resolveExistingSessionAgentEngine(input: {
  session?: AgentSessionMeta | null
  workspace?: AgentWorkspace | null
}): AgentEngine {
  return input.session?.agentEngine ?? DEFAULT_AGENT_ENGINE
}

export function isPiAgentEngine(engine: AgentEngine): boolean {
  return engine === 'pi'
}
