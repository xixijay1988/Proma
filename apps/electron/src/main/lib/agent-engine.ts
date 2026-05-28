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
}): AgentEngine {
  // 已有会话的引擎只看会话自身元数据；不再继承当前 workspace，避免历史会话随工作区切换漂移。
  return input.session?.agentEngine ?? DEFAULT_AGENT_ENGINE
}

export function isPiAgentEngine(engine: AgentEngine): boolean {
  return engine === 'pi'
}
