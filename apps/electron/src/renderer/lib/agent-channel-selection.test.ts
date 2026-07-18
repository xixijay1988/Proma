import { describe, expect, test } from 'bun:test'
import {
  nextAgentChannelIdsAfterModelSelect,
  resolveInitialAgentRuntimeAndChannelIds,
  resolveSelectableAgentChannelIds,
} from './agent-channel-selection'

describe('nextAgentChannelIdsAfterModelSelect', () => {
  test('adds the selected channel to the Agent enabled list', () => {
    expect(nextAgentChannelIdsAfterModelSelect(['anthropic'], 'kimi')).toEqual(['anthropic', 'kimi'])
  })

  test('keeps the list unchanged when the channel is already enabled', () => {
    const channelIds = ['anthropic', 'kimi']
    expect(nextAgentChannelIdsAfterModelSelect(channelIds, 'kimi')).toBe(channelIds)
  })

  test('adds Pi-only channels without marking them Claude-compatible', () => {
    expect(nextAgentChannelIdsAfterModelSelect(['anthropic'], 'custom')).toEqual(['anthropic', 'custom'])
  })
})

describe('resolveInitialAgentRuntimeAndChannelIds', () => {
  const channels = [
    { id: 'anthropic-channel', provider: 'anthropic' as const },
    { id: 'custom-channel', provider: 'custom' as const },
    { id: 'responses-channel', provider: 'openai-responses' as const },
  ]

  test('Given Claude + Pi-only 默认渠道 When 初始化 Then 切 Pi 并保留 Agent 使能状态', () => {
    expect(resolveInitialAgentRuntimeAndChannelIds(
      channels,
      ['custom-channel', 'anthropic-channel'],
      'custom-channel',
      'claude',
    )).toEqual({
      runtime: 'pi',
      agentChannelIds: ['custom-channel', 'anthropic-channel'],
    })
  })

  test('Given Claude + OpenAI Responses 默认渠道 When 初始化 Then 切 Pi 并补入使能列表', () => {
    expect(resolveInitialAgentRuntimeAndChannelIds(
      channels,
      [],
      'responses-channel',
      'claude',
    )).toEqual({
      runtime: 'pi',
      agentChannelIds: ['responses-channel'],
    })
  })

  test('Given 已删除渠道残留 When 初始化 Then 从 Agent 使能列表清理', () => {
    expect(resolveInitialAgentRuntimeAndChannelIds(
      channels,
      ['deleted-channel', 'anthropic-channel'],
      'anthropic-channel',
      'claude',
    )).toEqual({
      runtime: 'claude',
      agentChannelIds: ['anthropic-channel'],
    })
  })
})

describe('resolveSelectableAgentChannelIds', () => {
  const channels = [
    { id: 'anthropic-channel', provider: 'anthropic' as const },
    { id: 'custom-channel', provider: 'custom' as const },
    { id: 'openai-channel', provider: 'openai' as const },
  ]

  test('Given Agent 已使能 Claude 与 Pi-only 渠道 When 解析 Then 仅显示使能渠道', () => {
    expect(resolveSelectableAgentChannelIds(
      channels,
      ['anthropic-channel', 'custom-channel'],
    )).toEqual(['anthropic-channel', 'custom-channel'])
  })

  test('Given Pi-only 渠道未使能 When 解析 Then 不显示', () => {
    expect(resolveSelectableAgentChannelIds(channels, ['anthropic-channel'])).toEqual([
      'anthropic-channel',
    ])
  })

  test('Given 空使能列表 When 解析 Then 不显示任何渠道', () => {
    expect(resolveSelectableAgentChannelIds(channels, [])).toEqual([])
  })
})
