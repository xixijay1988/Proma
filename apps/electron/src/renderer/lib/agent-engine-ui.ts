import type { AgentEngine } from '@proma/shared'

export interface AgentEngineBadge {
  label: string
  tone: 'neutral' | 'warning'
}

export function getAgentEngineLabel(engine: AgentEngine): string {
  return engine === 'pi' ? 'pi' : 'Claude SDK'
}

export function getAgentEngineBadge(engine: AgentEngine): AgentEngineBadge {
  if (engine === 'pi') return { label: 'pi experimental', tone: 'warning' }
  return { label: 'Claude SDK', tone: 'neutral' }
}
