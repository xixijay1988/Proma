import { describe, expect, test } from 'bun:test'
import type { SDKAssistantMessage, SDKResultMessage } from '@proma/shared'
import {
  pickResultContextWindow,
  resolveAssistantContextWindow,
} from './agent-session-usage'

describe('Automation 会话上下文窗口解析', () => {
  test('Given assistant 带 256K 用户快照 When 模型自动推断为 1M Then 用户快照优先', () => {
    const message = {
      type: 'assistant',
      message: {
        content: [],
        model: 'glm-5.2',
        usage: { input_tokens: 10_000 },
      },
      parent_tool_use_id: null,
      _channelProvider: 'zhipu-coding',
      _channelContextWindow: 256_000,
    } satisfies SDKAssistantMessage

    expect(resolveAssistantContextWindow(message)).toBe(256_000)
  })

  test('Given result 带 1.05M 用户快照 When Runtime 回报 200K Then 用户快照优先', () => {
    const message = {
      type: 'result',
      subtype: 'success',
      usage: { input_tokens: 10_000, output_tokens: 100 },
      modelUsage: { 'gpt-5.6-sol': { contextWindow: 200_000 } },
      _channelModelId: 'gpt-5.6-sol',
      _channelProvider: 'custom',
      _channelContextWindow: 1_050_000,
    } satisfies SDKResultMessage

    expect(pickResultContextWindow(message)).toBe(1_050_000)
  })

  test('Given 未配置覆盖 When result 有多个模型窗口 Then 保持取最大值策略', () => {
    const message = {
      type: 'result',
      subtype: 'success',
      usage: { input_tokens: 10_000, output_tokens: 100 },
      modelUsage: {
        main: { contextWindow: 200_000 },
        child: { contextWindow: 1_000_000 },
      },
    } satisfies SDKResultMessage

    expect(pickResultContextWindow(message)).toBe(1_000_000)
  })
})
