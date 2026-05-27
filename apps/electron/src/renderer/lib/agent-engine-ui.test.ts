import { describe, expect, test } from 'bun:test'
import { getAgentEngineBadge, getAgentEngineLabel } from './agent-engine-ui'

describe('Agent engine UI helpers', () => {
  test('Given claude-sdk When rendering label Then returns Claude SDK', () => {
    expect(getAgentEngineLabel('claude-sdk')).toBe('Claude SDK')
  })

  test('Given pi When rendering badge Then marks experimental', () => {
    expect(getAgentEngineBadge('pi')).toEqual({ label: 'pi experimental', tone: 'warning' })
  })
})
