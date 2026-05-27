import { describe, expect, test } from 'bun:test'
import type { AgentSessionMeta, AgentWorkspace } from '@proma/shared'
import { resolveAgentEngine } from './agent-engine'

describe('Agent engine routing', () => {
  test('Given pi session When workspace is claude Then session still routes to pi', () => {
    const session = { id: 's1', title: 'Pi 会话', agentEngine: 'pi', workspaceId: 'w1', createdAt: 1, updatedAt: 1 } satisfies AgentSessionMeta
    const workspace = { id: 'w1', name: '默认', slug: 'default', agentEngine: 'claude-sdk', createdAt: 1, updatedAt: 1 } satisfies AgentWorkspace

    expect(resolveAgentEngine({ session, workspace })).toBe('pi')
  })
})
