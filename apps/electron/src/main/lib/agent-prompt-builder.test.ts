import { describe, expect, test } from 'bun:test'

import { buildSystemPrompt } from './agent-prompt-builder'

describe('agent prompt builder', () => {
  test('Given workspace context When system prompt is built Then skills guidance mentions global Agent Skills without claiming they are ignored', () => {
    const prompt = buildSystemPrompt({
      workspaceName: '默认工作区',
      workspaceSlug: 'default',
      sessionId: 'session-1',
      permissionMode: 'auto',
      memoryEnabled: false,
      claudeAvailable: false,
    })

    expect(prompt).toContain('~/.agents/skills/')
    expect(prompt).toContain('支持原生 Agent Skills 的 runtime')
    expect(prompt).not.toContain('外部命令安装到 .agents/skills/ 不会被加载')
  })
})
