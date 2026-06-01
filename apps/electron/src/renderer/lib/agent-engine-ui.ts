import type { AgentEngine } from '@proma/shared'

export interface AgentEngineBadge {
  label: string
  tone: 'neutral' | 'warning'
}

export interface AgentEngineRuntimeProof extends AgentEngineBadge {
  description: string
}

export function getAgentEngineLabel(engine: AgentEngine): string {
  return engine === 'pi' ? 'Pi Agent RPC' : 'Claude SDK'
}

export function getAgentEngineBadge(engine: AgentEngine): AgentEngineBadge {
  if (engine === 'pi') return { label: 'Pi Agent RPC', tone: 'warning' }
  return { label: 'Claude SDK', tone: 'neutral' }
}

export function getAgentEngineRuntimeProof(engine: AgentEngine): AgentEngineRuntimeProof {
  if (engine === 'pi') {
    return {
      label: 'Pi Agent RPC',
      description: '@earendil-works/pi-coding-agent RPC runtime，不是 Claude Agent SDK',
      tone: 'warning',
    }
  }

  return {
    label: 'Claude SDK',
    description: '@anthropic-ai/claude-agent-sdk runtime',
    tone: 'neutral',
  }
}
