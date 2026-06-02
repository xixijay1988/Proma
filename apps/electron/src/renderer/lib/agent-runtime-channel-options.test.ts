import { describe, expect, test } from 'bun:test'

import type { Channel } from '@proma/shared'
import {
  getAgentRuntimeSelectableChannelIds,
  hasAgentRuntimeAvailableModel,
  isAgentRuntimeSelectedModelAvailable,
} from './agent-runtime-channel-options'

function channel(input: {
  id: string
  provider: Channel['provider']
  enabled?: boolean
  modelEnabled?: boolean
}): Channel {
  return {
    id: input.id,
    name: input.id,
    provider: input.provider,
    baseUrl: 'https://example.com',
    apiKey: '',
    enabled: input.enabled ?? true,
    models: [
      { id: `${input.id}-model`, name: `${input.id} model`, enabled: input.modelEnabled ?? true },
    ],
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('agent runtime channel options', () => {
  test('Given Claude SDK runtime When Qwen is allowlisted Then it is still hidden from Agent model selector', () => {
    const channels = [
      channel({ id: 'claude', provider: 'anthropic' }),
      channel({ id: 'qwen', provider: 'qwen' }),
    ]

    expect(getAgentRuntimeSelectableChannelIds(channels, ['claude', 'qwen'], 'claude-sdk')).toEqual(['claude'])
  })

  test('Given Pi runtime When Qwen and Custom providers are allowlisted Then they are selectable', () => {
    const channels = [
      channel({ id: 'qwen', provider: 'qwen' }),
      channel({ id: 'custom', provider: 'custom' }),
    ]

    expect(getAgentRuntimeSelectableChannelIds(channels, ['qwen', 'custom'], 'pi')).toEqual(['qwen', 'custom'])
  })

  test('Given Pi runtime When no compatible allowlisted channel has an enabled model Then sending is blocked', () => {
    const channels = [
      channel({ id: 'disabled-model', provider: 'qwen', modelEnabled: false }),
      channel({ id: 'not-allowlisted', provider: 'openai' }),
    ]

    expect(hasAgentRuntimeAvailableModel(channels, ['disabled-model'], 'pi')).toBe(false)
  })

  test('Given Claude SDK runtime When selected model belongs to Pi-only provider Then it is unavailable', () => {
    const channels = [
      channel({ id: 'qwen', provider: 'qwen' }),
    ]

    expect(isAgentRuntimeSelectedModelAvailable(channels, ['qwen'], 'claude-sdk', 'qwen', 'qwen-model')).toBe(false)
  })

  test('Given Pi runtime When selected model belongs to compatible allowlisted provider Then it is available', () => {
    const channels = [
      channel({ id: 'qwen', provider: 'qwen' }),
    ]

    expect(isAgentRuntimeSelectedModelAvailable(channels, ['qwen'], 'pi', 'qwen', 'qwen-model')).toBe(true)
  })
})
