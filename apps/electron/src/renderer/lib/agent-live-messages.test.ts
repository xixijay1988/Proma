import { describe, expect, test } from 'bun:test'
import { appendLiveAgentMessage, shouldStoreLiveAgentMessage } from './agent-live-messages'
import type { SDKMessage } from '@proma/shared'

const textDelta = (text: string): SDKMessage => ({
  type: 'assistant',
  message: { content: [{ type: 'text', text }] },
  parent_tool_use_id: null,
  _promaTransient: true,
  _promaTextDelta: true,
} as SDKMessage)

const thinkingDelta = (thinking: string): SDKMessage => ({
  type: 'assistant',
  message: { content: [{ type: 'thinking', thinking }] },
  parent_tool_use_id: null,
  _promaTransient: true,
  _promaThinkingDelta: true,
} as SDKMessage)

const finalAssistant = (): SDKMessage => ({
  type: 'assistant',
  message: {
    content: [
      { type: 'thinking', thinking: '先分析' },
      { type: 'text', text: '最终回答' },
    ],
  },
  parent_tool_use_id: null,
})

const toolProgress = (text: string): SDKMessage => ({
  type: 'user',
  message: {
    content: [{ type: 'tool_result', tool_use_id: 'call-1', content: [{ type: 'text', text }], is_error: false }],
  },
  parent_tool_use_id: null,
  _promaTransient: true,
  _promaToolProgress: true,
} as SDKMessage)

const finalToolResult = (text: string): SDKMessage => ({
  type: 'user',
  message: {
    content: [{ type: 'tool_result', tool_use_id: 'call-1', content: [{ type: 'text', text }], is_error: false }],
  },
  parent_tool_use_id: null,
})

describe('Agent live messages', () => {
  test('Given Pi streaming deltas When deciding live storage Then keeps only renderable deltas', () => {
    expect(shouldStoreLiveAgentMessage(textDelta('你'))).toBe(true)
    expect(shouldStoreLiveAgentMessage(thinkingDelta('先'))).toBe(true)
    expect(shouldStoreLiveAgentMessage(toolProgress('partial'))).toBe(true)
    expect(shouldStoreLiveAgentMessage({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'ignored' }] },
      parent_tool_use_id: null,
      _promaTransient: true,
    } as SDKMessage)).toBe(false)
  })

  test('Given transient Pi deltas When final assistant arrives Then replaces deltas with final content', () => {
    const current = [
      textDelta('最'),
      textDelta('终'),
      thinkingDelta('先'),
      thinkingDelta('分析'),
    ]

    const next = appendLiveAgentMessage(current, finalAssistant())

    expect(next).toHaveLength(1)
    expect((next[0] as { message: { content: unknown[] } }).message.content).toEqual([
      { type: 'thinking', thinking: '先分析' },
      { type: 'text', text: '最终回答' },
    ])
  })

  test('Given tool use arrives before message end When appending Then keeps streaming deltas visible', () => {
    const toolUse: SDKMessage = {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'call-1', name: 'bash', input: { command: 'pwd' } }] },
      parent_tool_use_id: null,
    }

    const next = appendLiveAgentMessage([thinkingDelta('分析中')], toolUse)

    expect(next).toHaveLength(2)
    expect((next[0] as Record<string, unknown>)._promaThinkingDelta).toBe(true)
    expect((next[1] as { message: { content: Array<{ type: string }> } }).message.content[0]?.type).toBe('tool_use')
  })

  test('Given repeated Pi tool progress When appending Then keeps only latest progress for the tool', () => {
    const next = appendLiveAgentMessage([toolProgress('hel')], toolProgress('hello'))

    expect(next).toHaveLength(1)
    expect((next[0] as { message: { content: Array<{ content: Array<{ text: string }> }> } }).message.content[0]?.content[0]?.text).toBe('hello')
  })

  test('Given Pi final tool result When appending Then replaces transient progress for the tool', () => {
    const next = appendLiveAgentMessage([toolProgress('hel')], finalToolResult('hello'))

    expect(next).toHaveLength(1)
    expect((next[0] as Record<string, unknown>)._promaToolProgress).toBeUndefined()
    expect((next[0] as { message: { content: Array<{ content: Array<{ text: string }> }> } }).message.content[0]?.content[0]?.text).toBe('hello')
  })
})
