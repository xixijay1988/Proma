import { existsSync, mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { PI_AGENT_COMPATIBLE_PROVIDERS } from '@proma/shared'
import type { Channel, ProviderType } from '@proma/shared'

import {
  ensurePiProviderDiagnosticExtensionForTest,
  getPiRuntimeMappedProvidersForTest,
  getPiRuntimeProviderContractsForTest,
  preparePiRuntimeConfig,
  resolvePiProviderMappingForTest,
} from './pi-runtime-config'
import { startPiRpcSession, type PiRpcEvent } from './pi-process'

interface ModelsJsonShape {
  providers?: Record<string, { baseUrl?: string; models?: Array<{ id?: string; name?: string }> }>
}

function buildChannel(provider: ProviderType): Channel {
  return {
    id: `channel-${provider}`,
    name: provider,
    provider,
    baseUrl: `https://example.com/${provider}/v1`,
    apiKey: '',
    models: [],
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
  }
}

function readModelsJson(configDir: string): ModelsJsonShape | null {
  const modelsPath = join(configDir, 'models.json')
  if (!existsSync(modelsPath)) return null
  return JSON.parse(readFileSync(modelsPath, 'utf-8')) as ModelsJsonShape
}

interface PiRpcResponseEvent extends PiRpcEvent {
  type: 'response'
  command: string
  success: boolean
  data?: unknown
}

async function waitForPiRpcResponse(input: {
  events: AsyncIterable<PiRpcEvent>
  id: string
  timeoutMs?: number
}): Promise<PiRpcResponseEvent> {
  const timeoutMs = input.timeoutMs ?? 10_000
  const startedAt = Date.now()

  for await (const event of input.events) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`等待 Pi RPC response 超时: ${input.id}`)
    }
    if (event.type === 'response' && event.id === input.id) {
      return event as PiRpcResponseEvent
    }
  }

  throw new Error(`Pi RPC 已结束但未返回 response: ${input.id}`)
}

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

  test('Given Pi compatible providers When comparing UI contract with runtime mapping Then they stay in sync', () => {
    expect(getPiRuntimeMappedProvidersForTest().toSorted()).toEqual([...PI_AGENT_COMPATIBLE_PROVIDERS].toSorted())
  })

  test('Given each Pi compatible provider When preparing runtime config Then provider env and model registration follow the runtime contract', () => {
    for (const contract of getPiRuntimeProviderContractsForTest()) {
      const homeDir = mkdtempSync(join(tmpdir(), 'proma-pi-runtime-matrix-'))
      try {
        const config = preparePiRuntimeConfig({
          promaConfigDir: homeDir,
          sessionId: `session-${contract.providerType}`,
          channel: buildChannel(contract.providerType),
          apiKey: `sk-${contract.providerType}`,
          model: `${contract.providerType}/demo-model`,
        })
        const modelsJson = readModelsJson(config.configDir)
        const providerConfig = modelsJson?.providers?.[contract.piProvider]

        expect(config.provider).toBe(contract.piProvider)
        expect(config.runtimeEnv[contract.apiKeyEnv]).toBe(`sk-${contract.providerType}`)
        expect(providerConfig?.baseUrl).toBe(`https://example.com/${contract.providerType}/v1`)
        if (contract.registerModel) {
          expect(providerConfig?.models?.[0]).toEqual({ id: 'demo-model', name: 'demo-model' })
        } else {
          expect(providerConfig?.models).toBeUndefined()
        }
      } finally {
        rmSync(homeDir, { recursive: true, force: true })
      }
    }
  })

  test('Given qwen provider config When real Pi RPC process starts Then diagnostic command description proves env and models config are visible', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'proma-pi-provider-rpc-'))
    let rpc: ReturnType<typeof startPiRpcSession> | null = null
    try {
      const config = preparePiRuntimeConfig({
        promaConfigDir: homeDir,
        sessionId: 'session-provider-rpc',
        channel: {
          ...buildChannel('qwen'),
          baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        },
        apiKey: 'sk-qwen-smoke',
        model: 'qwen/qwen-plus',
      })
      const extensionPath = ensurePiProviderDiagnosticExtensionForTest({
        configDir: config.configDir,
        apiKeyEnv: 'OPENAI_API_KEY',
        providerName: 'openai',
      })

      rpc = startPiRpcSession({
        cwd: homeDir,
        provider: config.provider,
        model: 'qwen-plus',
        sessionId: 'session-provider-rpc',
        sessionDir: config.sessionDir,
        extensionPaths: [extensionPath],
        runtimeEnv: config.runtimeEnv,
      })
      rpc.send({ id: 'provider-status-1', type: 'get_commands' })

      const commandsResponse = await waitForPiRpcResponse({
        events: rpc.events,
        id: 'provider-status-1',
      })
      expect(commandsResponse.success).toBe(true)
      const commandsData = commandsResponse.data as { commands?: Array<{ name?: string; description?: string; source?: string }> }
      const statusCommand = commandsData.commands?.find((command) => command.name === 'proma:provider_config_status')
      expect(statusCommand?.source).toBe('extension')
      expect(statusCommand?.description).toContain('provider: openai')
      expect(statusCommand?.description).toContain('api key env: OPENAI_API_KEY present')
      expect(statusCommand?.description).toContain('baseUrl: https://dashscope.aliyuncs.com/compatible-mode/v1')
      expect(statusCommand?.description).toContain('models: qwen-plus')
    } finally {
      rpc?.kill()
      if (rpc) {
        await rpc.done
      }
      rmSync(homeDir, { recursive: true, force: true })
    }
  })
})
