import { describe, expect, test } from 'bun:test'
import type { AgentWorkspace } from '@proma/shared'
import { normalizeAgentWorkspaceForTest } from './agent-workspace-manager'

describe('Agent 工作区引擎持久化', () => {
  test('Given old workspace without agentEngine When normalized Then uses claude-sdk', () => {
    const workspace = { id: 'w1', name: '旧工作区', slug: 'old', createdAt: 1, updatedAt: 1 } satisfies AgentWorkspace

    expect(normalizeAgentWorkspaceForTest(workspace).agentEngine).toBe('claude-sdk')
  })

  test('Given pi workspace When normalized Then preserves pi engine', () => {
    const workspace = { id: 'w1', name: 'Pi', slug: 'pi', agentEngine: 'pi', createdAt: 1, updatedAt: 1 } satisfies AgentWorkspace

    expect(normalizeAgentWorkspaceForTest(workspace).agentEngine).toBe('pi')
  })
})
