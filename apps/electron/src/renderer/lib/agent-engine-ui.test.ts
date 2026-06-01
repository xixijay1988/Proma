import { describe, expect, test } from 'bun:test'
import { getAgentEngineBadge, getAgentEngineLabel, getAgentEngineRuntimeProof } from './agent-engine-ui'

describe('Agent engine UI helpers', () => {
  test('Given claude-sdk When rendering label Then returns Claude SDK', () => {
    expect(getAgentEngineLabel('claude-sdk')).toBe('Claude SDK')
  })

  test('Given pi When rendering label Then returns Pi Agent RPC', () => {
    expect(getAgentEngineLabel('pi')).toBe('Pi Agent RPC')
  })

  test('Given pi When rendering badge Then returns Pi Agent RPC', () => {
    expect(getAgentEngineBadge('pi')).toEqual({ label: 'Pi Agent RPC', tone: 'warning' })
  })

  test('Given pi When rendering runtime proof Then explains the actual runtime', () => {
    expect(getAgentEngineRuntimeProof('pi')).toEqual({
      label: 'Pi Agent RPC',
      description: '@earendil-works/pi-coding-agent RPC runtime，不是 Claude Agent SDK',
      tone: 'warning',
    })
  })
})
