import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Channel, ProviderType } from '@proma/shared'

interface PiProviderMapping {
  provider: string
  apiKeyEnv: string
  registerModel: boolean
}

interface PiModelsProviderConfig {
  baseUrl?: string
  models?: Array<{ id: string; name: string }>
}

interface PiModelsConfig {
  providers: Record<string, PiModelsProviderConfig>
}

interface PiRuntimeBaseUrlInput {
  providerType: ProviderType
  baseUrl?: string
}

export interface PiRuntimeConfig {
  provider?: string
  runtimeEnv: Record<string, string | undefined>
  configDir: string
  sessionDir: string
}

const PI_PROVIDER_MAPPINGS: Record<ProviderType, PiProviderMapping> = {
  anthropic: { provider: 'anthropic', apiKeyEnv: 'ANTHROPIC_API_KEY', registerModel: false },
  openai: { provider: 'openai', apiKeyEnv: 'OPENAI_API_KEY', registerModel: false },
  deepseek: { provider: 'deepseek', apiKeyEnv: 'DEEPSEEK_API_KEY', registerModel: false },
  google: { provider: 'google', apiKeyEnv: 'GEMINI_API_KEY', registerModel: false },
  'kimi-api': { provider: 'moonshotai', apiKeyEnv: 'MOONSHOT_API_KEY', registerModel: true },
  'kimi-coding': { provider: 'kimi-coding', apiKeyEnv: 'KIMI_API_KEY', registerModel: false },
  zhipu: { provider: 'openai', apiKeyEnv: 'OPENAI_API_KEY', registerModel: true },
  minimax: { provider: 'minimax', apiKeyEnv: 'MINIMAX_API_KEY', registerModel: false },
  doubao: { provider: 'openai', apiKeyEnv: 'OPENAI_API_KEY', registerModel: true },
  qwen: { provider: 'openai', apiKeyEnv: 'OPENAI_API_KEY', registerModel: true },
  custom: { provider: 'openai', apiKeyEnv: 'OPENAI_API_KEY', registerModel: true },
}

function sanitizePathSegment(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9_-]/g, '_')
  return safe.length > 0 ? safe : 'session'
}

function normalizeModelIdForProvider(model: string | undefined): string | null {
  const trimmed = model?.trim()
  if (!trimmed) return null

  const slashIndex = trimmed.indexOf('/')
  if (slashIndex !== -1) {
    return trimmed.slice(slashIndex + 1)
  }

  return trimmed
}

function resolvePiRuntimeBaseUrl(input: PiRuntimeBaseUrlInput): string | undefined {
  const baseUrl = input.baseUrl?.trim()
  if (!baseUrl) return undefined

  if (input.providerType === 'deepseek' && baseUrl.replace(/\/+$/, '') === 'https://api.deepseek.com/anthropic') {
    return undefined
  }

  return baseUrl
}

function writePiModelsConfig(input: {
  configDir: string
  provider: string
  baseUrl?: string
  model?: string
  registerModel: boolean
}): void {
  const providerConfig: PiModelsProviderConfig = {}
  const baseUrl = input.baseUrl?.trim()
  if (baseUrl) {
    providerConfig.baseUrl = baseUrl
  }

  const modelId = input.registerModel
    ? normalizeModelIdForProvider(input.model)
    : null
  if (modelId) {
    providerConfig.models = [{ id: modelId, name: modelId }]
  }

  const modelsPath = join(input.configDir, 'models.json')
  if (!providerConfig.baseUrl && !providerConfig.models) {
    rmSync(modelsPath, { force: true })
    return
  }

  const config: PiModelsConfig = {
    providers: {
      [input.provider]: providerConfig,
    },
  }
  writeFileSync(modelsPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8')
}

export function preparePiRuntimeConfig(input: {
  promaConfigDir: string
  sessionId: string
  channel?: Channel | null
  apiKey?: string
  model?: string
}): PiRuntimeConfig {
  const configDir = join(input.promaConfigDir, 'pi-agent', sanitizePathSegment(input.sessionId))
  const sessionDir = join(input.promaConfigDir, 'pi-agent-sessions')
  mkdirSync(configDir, { recursive: true })
  mkdirSync(sessionDir, { recursive: true })

  const runtimeEnv: Record<string, string | undefined> = {
    PI_CODING_AGENT_DIR: configDir,
    PI_CODING_AGENT_SESSION_DIR: sessionDir,
    PI_TELEMETRY: '0',
  }

  if (!input.channel) {
    return { runtimeEnv, configDir, sessionDir }
  }

  const mapping = PI_PROVIDER_MAPPINGS[input.channel.provider]
  if (input.apiKey?.trim()) {
    runtimeEnv[mapping.apiKeyEnv] = input.apiKey
  }

  writePiModelsConfig({
    configDir,
    provider: mapping.provider,
    baseUrl: resolvePiRuntimeBaseUrl({
      providerType: input.channel.provider,
      baseUrl: input.channel.baseUrl,
    }),
    model: input.model,
    registerModel: mapping.registerModel,
  })

  return {
    provider: mapping.provider,
    runtimeEnv,
    configDir,
    sessionDir,
  }
}

export function resolvePiProviderMappingForTest(provider: ProviderType): PiProviderMapping {
  return PI_PROVIDER_MAPPINGS[provider]
}

export function getPiRuntimeMappedProvidersForTest(): ProviderType[] {
  return Object.keys(PI_PROVIDER_MAPPINGS) as ProviderType[]
}

export function getPiRuntimeProviderContractsForTest(): Array<{
  providerType: ProviderType
  piProvider: string
  apiKeyEnv: string
  registerModel: boolean
}> {
  return Object.entries(PI_PROVIDER_MAPPINGS).map(([providerType, mapping]) => ({
    providerType: providerType as ProviderType,
    piProvider: mapping.provider,
    apiKeyEnv: mapping.apiKeyEnv,
    registerModel: mapping.registerModel,
  }))
}

export function ensurePiProviderDiagnosticExtensionForTest(input: {
  configDir: string
  providerName: string
  apiKeyEnv: string
}): string {
  const extensionDir = join(input.configDir, 'proma-extensions')
  mkdirSync(extensionDir, { recursive: true })
  const extensionPath = join(extensionDir, 'proma-provider-diagnostic.mjs')
  const source = `
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const configDir = ${JSON.stringify(input.configDir)}
const providerName = ${JSON.stringify(input.providerName)}
const apiKeyEnv = ${JSON.stringify(input.apiKeyEnv)}

function readProviderConfig() {
  try {
    const modelsPath = join(configDir, 'models.json')
    const parsed = JSON.parse(readFileSync(modelsPath, 'utf-8'))
    return parsed?.providers?.[providerName] ?? {}
  } catch {
    return {}
  }
}

function formatProviderStatus() {
  const providerConfig = readProviderConfig()
  const models = Array.isArray(providerConfig.models) ? providerConfig.models : []
  const modelIds = models.map((model) => model?.id).filter(Boolean)
  const lines = [
    'Proma Pi provider config 已加载。',
    '- provider: ' + providerName,
    '- api key env: ' + apiKeyEnv + ' ' + (process.env[apiKeyEnv] ? 'present' : 'missing'),
  ]
  if (providerConfig.baseUrl) {
    lines.push('- baseUrl: ' + providerConfig.baseUrl)
  }
  if (modelIds.length > 0) {
    lines.push('- models: ' + modelIds.join(', '))
  }
  return lines.join('\\n')
}

export default function promaProviderDiagnostic(pi) {
  pi.registerCommand('proma:provider_config_status', {
    description: formatProviderStatus(),
    async handler(args, ctx) {
      const providerConfig = readProviderConfig()
      const models = Array.isArray(providerConfig.models) ? providerConfig.models : []
      const data = {
        providerName,
        apiKeyEnv,
        apiKeyPresent: Boolean(process.env[apiKeyEnv]),
        baseUrl: providerConfig.baseUrl,
        modelIds: models.map((model) => model?.id).filter(Boolean),
      }
      ctx.sendMessage(data)
      return data
    },
  })
}
`
  writeFileSync(extensionPath, source, 'utf-8')
  return extensionPath
}
