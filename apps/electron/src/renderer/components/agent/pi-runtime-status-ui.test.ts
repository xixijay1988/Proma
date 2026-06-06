import { describe, expect, test } from 'bun:test'
import type { AgentRuntimeStateResult } from '@proma/shared'
import {
  getPiRuntimeCommandGroups,
  getPiRuntimeStatusRows,
} from './pi-runtime-status-ui.ts'

describe('Pi runtime status UI helpers', () => {
  test('Given active runtime state When status rows are built Then retry compaction session and usage diagnostics are visible', () => {
    const state: AgentRuntimeStateResult = {
      provider: 'deepseek',
      modelId: 'deepseek-v4-flash',
      modelName: 'DeepSeek V4 Flash',
      thinkingLevel: 'high',
      isStreaming: true,
      isCompacting: false,
      steeringMode: 'queue',
      followUpMode: 'append',
      nativeSessionId: 'pi-session-001',
      nativeSessionName: '实现 Pi runtime status',
      nativeSessionFile: '/tmp/proma/pi-session-001.jsonl',
      autoCompactionEnabled: true,
      autoRetryEnabled: true,
      isRetrying: true,
      messageCount: 12,
      pendingMessageCount: 2,
      stats: {
        userMessages: 4,
        assistantMessages: 5,
        toolCalls: 3,
        toolResults: 3,
        totalMessages: 15,
        tokens: {
          input: 2048,
          output: 1024,
          cacheRead: 512,
          cacheWrite: 256,
          total: 3840,
        },
        costUsd: 0.0123,
        contextUsage: {
          tokens: 3840,
          maxTokens: 200000,
          percent: 1.92,
        },
      },
    }

    expect(getPiRuntimeStatusRows(state)).toEqual([
      { label: '运行状态', value: '流式输出中' },
      { label: '自动重试', value: '重试中' },
      { label: '自动压缩', value: '已启用' },
      { label: '模型', value: 'DeepSeek V4 Flash (deepseek-v4-flash)' },
      { label: 'Provider', value: 'deepseek' },
      { label: 'Thinking', value: 'high' },
      { label: '队列', value: 'steering queue / follow-up append' },
      { label: '原生会话', value: '实现 Pi runtime status' },
      { label: 'Session ID', value: 'pi-session-001' },
      { label: '消息', value: '12 条 / 待处理 2 条' },
      { label: '统计', value: '用户 4 · 助手 5 · 工具 3/3' },
      { label: 'Tokens', value: '3.8k total · 输入 2.0k · 输出 1.0k · 缓存读 512 · 缓存写 256' },
      { label: '上下文', value: '3.8k / 200.0k (1.9%)' },
      { label: '成本', value: '$0.0123' },
      { label: 'Session 文件', value: '/tmp/proma/pi-session-001.jsonl' },
    ])
  })

  test('Given runtime commands When grouped Then extension prompt skill and unknown commands are counted separately', () => {
    const state: AgentRuntimeStateResult = {
      isStreaming: true,
      isCompacting: false,
      commands: [
        { name: 'proma:mcp_bridge_status', source: 'extension', description: 'MCP bridge status', sourceInfo: { name: 'proma-mcp' } },
        { name: 'skill:using-superpowers', source: 'skill', description: '使用指南', sourceInfo: { path: '/skills/using-superpowers' } },
        { name: 'prompt:plan', source: 'prompt', description: 'Plan prompt' },
        { name: 'runtime:unknown', source: 'unknown' },
      ],
    }

    expect(getPiRuntimeCommandGroups(state.commands)).toEqual([
      {
        source: 'extension',
        label: 'Extensions',
        commands: [
          { name: 'proma:mcp_bridge_status', source: 'extension', description: 'MCP bridge status', sourceInfo: { name: 'proma-mcp' } },
        ],
      },
      {
        source: 'skill',
        label: 'Skills',
        commands: [
          { name: 'skill:using-superpowers', source: 'skill', description: '使用指南', sourceInfo: { path: '/skills/using-superpowers' } },
        ],
      },
      {
        source: 'prompt',
        label: 'Prompts',
        commands: [
          { name: 'prompt:plan', source: 'prompt', description: 'Plan prompt' },
        ],
      },
      {
        source: 'unknown',
        label: 'Other',
        commands: [
          { name: 'runtime:unknown', source: 'unknown' },
        ],
      },
    ])
  })

  test('Given many extension commands When grouped Then Proma AskUser bridge status is prioritized before the visible cutoff', () => {
    const commands: NonNullable<AgentRuntimeStateResult['commands']> = [
      { name: 'extension:one', source: 'extension' },
      { name: 'extension:two', source: 'extension' },
      { name: 'extension:three', source: 'extension' },
      { name: 'extension:four', source: 'extension' },
      { name: 'extension:five', source: 'extension' },
      { name: 'extension:six', source: 'extension' },
      { name: 'extension:seven', source: 'extension' },
      { name: 'extension:eight', source: 'extension' },
      { name: 'extension:nine', source: 'extension' },
      {
        name: 'proma:ask_user_bridge_status',
        source: 'extension',
        description: 'Proma AskUserQuestion bridge status',
      },
    ]

    const groups = getPiRuntimeCommandGroups(commands)
    const extensionGroup = groups.find((group) => group.source === 'extension')

    expect(extensionGroup?.commands.slice(0, 8).map((command) => command.name)).toContain('proma:ask_user_bridge_status')
    expect(extensionGroup?.commands[0]?.name).toBe('proma:ask_user_bridge_status')
  })
})
