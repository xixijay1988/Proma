import { describe, expect, test } from 'bun:test'
import { resolveAgentRuntimeForProvider } from './agent-runtime-selection'

describe('Agent runtime provider 路由', () => {
  test.each(['custom', 'openai', 'openai-responses', 'openai-codex', 'google'] as const)(
    'Given Claude runtime 和 %s provider When 解析 Then 自动切换到 Pi',
    (provider) => {
      expect(resolveAgentRuntimeForProvider('claude', provider)).toBe('pi')
    },
  )

  test.each(['anthropic-compatible', 'deepseek'] as const)(
    'Given Claude runtime 和 %s provider When 解析 Then 保持 Claude',
    (provider) => {
      expect(resolveAgentRuntimeForProvider('claude', provider)).toBe('claude')
    },
  )

  test.each(['custom', 'anthropic'] as const)(
    'Given Pi runtime 和 %s provider When 解析 Then 不自动降级',
    (provider) => {
      expect(resolveAgentRuntimeForProvider('pi', provider)).toBe('pi')
    },
  )
})
