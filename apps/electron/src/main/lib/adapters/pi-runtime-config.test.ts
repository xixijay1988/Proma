import { existsSync, mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

import { preparePiRuntimeConfig, resolvePiProviderMappingForTest } from './pi-runtime-config'

describe('pi runtime config', () => {
  test('Given anthropic channel When preparing runtime config Then writes isolated models override and api key env', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'proma-pi-runtime-'))
    try {
      const config = preparePiRuntimeConfig({
        promaConfigDir: homeDir,
        sessionId: 'session-pi-runtime',
        channel: {
          id: 'channel-1',
          name: 'Anthropic',
          provider: 'anthropic',
          baseUrl: 'https://proxy.example.com/v1',
          apiKey: '',
          models: [],
          enabled: true,
          createdAt: 0,
          updatedAt: 0,
        },
        apiKey: 'sk-ant-runtime',
        model: 'claude-sonnet-4-6',
      })

      const modelsJson = JSON.parse(readFileSync(join(config.configDir, 'models.json'), 'utf-8')) as {
        providers?: Record<string, { baseUrl?: string; models?: Array<{ id?: string; name?: string }> }>
      }

      expect(config.provider).toBe('anthropic')
      expect(config.runtimeEnv.PI_CODING_AGENT_DIR).toBe(join(homeDir, 'pi-agent', 'session-pi-runtime'))
      expect(config.runtimeEnv.PI_CODING_AGENT_SESSION_DIR).toBe(join(homeDir, 'pi-agent-sessions'))
      expect(config.runtimeEnv.ANTHROPIC_API_KEY).toBe('sk-ant-runtime')
      expect(modelsJson.providers?.anthropic?.baseUrl).toBe('https://proxy.example.com/v1')
      expect(modelsJson.providers?.anthropic?.models).toBeUndefined()
    } finally {
      rmSync(homeDir, { recursive: true, force: true })
    }
  })

  test('Given custom provider When preparing runtime config Then registers normalized custom model id', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'proma-pi-runtime-'))
    try {
      const config = preparePiRuntimeConfig({
        promaConfigDir: homeDir,
        sessionId: 'session-pi-runtime-custom',
        channel: {
          id: 'channel-2',
          name: 'Qwen',
          provider: 'qwen',
          baseUrl: 'https://example.com/v1',
          apiKey: '',
          models: [],
          enabled: true,
          createdAt: 0,
          updatedAt: 0,
        },
        apiKey: 'sk-openai',
        model: 'qwen/qwen-plus',
      })

      const modelsJson = JSON.parse(readFileSync(join(config.configDir, 'models.json'), 'utf-8')) as {
        providers?: Record<string, { baseUrl?: string; models?: Array<{ id?: string; name?: string }> }>
      }

      expect(config.provider).toBe('openai')
      expect(config.runtimeEnv.OPENAI_API_KEY).toBe('sk-openai')
      expect(modelsJson.providers?.openai?.baseUrl).toBe('https://example.com/v1')
      expect(modelsJson.providers?.openai?.models?.[0]).toEqual({
        id: 'qwen-plus',
        name: 'qwen-plus',
      })
    } finally {
      rmSync(homeDir, { recursive: true, force: true })
    }
  })

  test('Given DeepSeek Anthropic-compatible channel When preparing runtime config Then keeps Pi built-in base url', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'proma-pi-runtime-'))
    try {
      const configDir = join(homeDir, 'pi-agent', 'session-pi-runtime-deepseek')
      mkdirSync(configDir, { recursive: true })
      writeFileSync(
        join(configDir, 'models.json'),
        JSON.stringify({ providers: { deepseek: { baseUrl: 'https://api.deepseek.com/anthropic' } } }),
        'utf-8',
      )

      const config = preparePiRuntimeConfig({
        promaConfigDir: homeDir,
        sessionId: 'session-pi-runtime-deepseek',
        channel: {
          id: 'channel-3',
          name: 'DeepSeek',
          provider: 'deepseek',
          baseUrl: 'https://api.deepseek.com/anthropic',
          apiKey: '',
          models: [],
          enabled: true,
          createdAt: 0,
          updatedAt: 0,
        },
        apiKey: 'sk-deepseek',
        model: 'deepseek-v4-flash',
      })

      expect(config.provider).toBe('deepseek')
      expect(config.runtimeEnv.DEEPSEEK_API_KEY).toBe('sk-deepseek')
      expect(existsSync(join(config.configDir, 'models.json'))).toBe(false)
    } finally {
      rmSync(homeDir, { recursive: true, force: true })
    }
  })

  test('Given provider mapping When resolved Then uses explicit Pi provider names', () => {
    expect(resolvePiProviderMappingForTest('kimi-api')).toEqual({
      provider: 'moonshotai',
      apiKeyEnv: 'MOONSHOT_API_KEY',
      registerModel: true,
    })
  })
})
