import { describe, expect, test } from 'bun:test'
import type { AgentSessionMeta, AgentWorkspace } from '@proma/shared'
import { getAgentEngine, resolveAgentEngine } from './agent-engine'

describe('Agent engine resolution', () => {
  test('Given old workspace without engine When normalized Then defaults to claude-sdk', () => {
    const workspace = { id: 'w1', name: '默认', slug: 'default', createdAt: 1, updatedAt: 1 } satisfies AgentWorkspace

    expect(getAgentEngine(workspace)).toBe('claude-sdk')
  })

  test('Given session engine and workspace engine When resolving Then session engine wins', () => {
    const session = { id: 's1', title: '会话', agentEngine: 'pi', createdAt: 1, updatedAt: 1 } satisfies AgentSessionMeta
    const workspace = { id: 'w1', name: '默认', slug: 'default', agentEngine: 'claude-sdk', createdAt: 1, updatedAt: 1 } satisfies AgentWorkspace

    expect(resolveAgentEngine({ session, workspace })).toBe('pi')
  })

  test('Given no session engine and pi workspace When resolving Then workspace engine is used', () => {
    const session = { id: 's1', title: '会话', createdAt: 1, updatedAt: 1 } satisfies AgentSessionMeta
    const workspace = { id: 'w1', name: 'Pi', slug: 'pi', agentEngine: 'pi', createdAt: 1, updatedAt: 1 } satisfies AgentWorkspace

    expect(resolveAgentEngine({ session, workspace })).toBe('pi')
  })
})
