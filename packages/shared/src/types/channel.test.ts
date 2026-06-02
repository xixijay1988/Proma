import { describe, expect, test } from 'bun:test'

import {
  isAgentCompatibleProvider,
  isProviderCompatibleWithAgentEngine,
} from './channel'

describe('channel provider compatibility', () => {
  test('Given legacy Agent compatibility check When OpenAI-compatible provider is used Then it remains Claude SDK conservative', () => {
    expect(isAgentCompatibleProvider('qwen')).toBe(false)
    expect(isAgentCompatibleProvider('anthropic')).toBe(true)
  })

  test('Given Claude SDK engine When checking provider compatibility Then only Anthropic-compatible providers are allowed', () => {
    expect(isProviderCompatibleWithAgentEngine('claude-sdk', 'anthropic')).toBe(true)
    expect(isProviderCompatibleWithAgentEngine('claude-sdk', 'deepseek')).toBe(true)
    expect(isProviderCompatibleWithAgentEngine('claude-sdk', 'qwen')).toBe(false)
    expect(isProviderCompatibleWithAgentEngine('claude-sdk', 'custom')).toBe(false)
  })

  test('Given Pi engine When checking provider compatibility Then Pi mapped providers are allowed', () => {
    expect(isProviderCompatibleWithAgentEngine('pi', 'anthropic')).toBe(true)
    expect(isProviderCompatibleWithAgentEngine('pi', 'openai')).toBe(true)
    expect(isProviderCompatibleWithAgentEngine('pi', 'qwen')).toBe(true)
    expect(isProviderCompatibleWithAgentEngine('pi', 'doubao')).toBe(true)
    expect(isProviderCompatibleWithAgentEngine('pi', 'custom')).toBe(true)
  })
})
