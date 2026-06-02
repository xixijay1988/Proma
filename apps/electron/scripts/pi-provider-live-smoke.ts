#!/usr/bin/env bun
/**
 * Pi provider live smoke
 *
 * 在有真实 API Key 的机器上，逐 provider 启动 Pi RPC 并发送最小 prompt，
 * 用于验证 Proma 的 provider 映射不仅能被 Pi 进程看见，也能完成真实模型调用。
 *
 * 默认会跳过缺少 API Key 的 provider，避免常规 CI 被外部账号依赖卡住。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Channel, ProviderType } from '@proma/shared'

import { startPiRpcSession, type PiRpcEvent } from '../src/main/lib/adapters/pi-process.ts'
import {
  getPiRuntimeProviderContractsForTest,
  preparePiRuntimeConfig,
} from '../src/main/lib/adapters/pi-runtime-config.ts'

interface ProviderLiveSmokeTarget {
  provider: ProviderType
  displayName: string
  model: string
  baseUrl?: string
  apiKeyEnv: string
}

interface ProviderLiveSmokeResult {
  provider: ProviderType
  status: 'passed' | 'skipped' | 'failed'
  reason?: string
  model?: string
  piProvider?: string
}

interface ProviderLiveSmokeOptions {
  providers: ProviderType[]
  prompt: string
  timeoutMs: number
  keepTemp: boolean
}

interface PiRpcResponseEvent extends PiRpcEvent {
  type: 'response'
  command: string
  success: boolean
  error?: string
}

const DEFAULT_TIMEOUT_MS = 90_000
const DEFAULT_PROMPT = 'Reply with exactly: PROMA_PI_PROVIDER_OK'

const PROVIDER_TARGETS: Record<ProviderType, ProviderLiveSmokeTarget> = {
  anthropic: {
    provider: 'anthropic',
    displayName: 'Anthropic',
    model: process.env.PROMA_PI_LIVE_ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
  },
  openai: {
    provider: 'openai',
    displayName: 'OpenAI',
    model: process.env.PROMA_PI_LIVE_OPENAI_MODEL ?? 'gpt-4.1-mini',
    apiKeyEnv: 'OPENAI_API_KEY',
  },
  deepseek: {
    provider: 'deepseek',
    displayName: 'DeepSeek',
    model: process.env.PROMA_PI_LIVE_DEEPSEEK_MODEL ?? 'deepseek-v4-flash',
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
  },
  google: {
    provider: 'google',
    displayName: 'Google Gemini',
    model: process.env.PROMA_PI_LIVE_GOOGLE_MODEL ?? 'gemini-2.5-flash',
    apiKeyEnv: 'GEMINI_API_KEY',
  },
  'kimi-api': {
    provider: 'kimi-api',
    displayName: 'Kimi API',
    model: process.env.PROMA_PI_LIVE_KIMI_API_MODEL ?? 'kimi-k2-0711-preview',
    baseUrl: process.env.PROMA_PI_LIVE_KIMI_API_BASE_URL ?? 'https://api.moonshot.cn/v1',
    apiKeyEnv: 'MOONSHOT_API_KEY',
  },
  'kimi-coding': {
    provider: 'kimi-coding',
    displayName: 'Kimi Coding',
    model: process.env.PROMA_PI_LIVE_KIMI_CODING_MODEL ?? 'kimi-coding',
    apiKeyEnv: 'KIMI_API_KEY',
  },
  zhipu: {
    provider: 'zhipu',
    displayName: 'Zhipu',
    model: process.env.PROMA_PI_LIVE_ZHIPU_MODEL ?? 'glm-4.5-flash',
    baseUrl: process.env.PROMA_PI_LIVE_ZHIPU_BASE_URL ?? 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyEnv: 'OPENAI_API_KEY',
  },
  minimax: {
    provider: 'minimax',
    displayName: 'MiniMax',
    model: process.env.PROMA_PI_LIVE_MINIMAX_MODEL ?? 'MiniMax-M1',
    apiKeyEnv: 'MINIMAX_API_KEY',
  },
  doubao: {
    provider: 'doubao',
    displayName: 'Doubao',
    model: process.env.PROMA_PI_LIVE_DOUBAO_MODEL ?? 'doubao-seed-1-6-flash-250715',
    baseUrl: process.env.PROMA_PI_LIVE_DOUBAO_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/v3',
    apiKeyEnv: 'OPENAI_API_KEY',
  },
  qwen: {
    provider: 'qwen',
    displayName: 'Qwen',
    model: process.env.PROMA_PI_LIVE_QWEN_MODEL ?? 'qwen-plus',
    baseUrl: process.env.PROMA_PI_LIVE_QWEN_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
  },
  custom: {
    provider: 'custom',
    displayName: 'Custom OpenAI Compatible',
    model: process.env.PROMA_PI_LIVE_CUSTOM_MODEL ?? 'proma-custom-model',
    baseUrl: process.env.PROMA_PI_LIVE_CUSTOM_BASE_URL,
    apiKeyEnv: 'OPENAI_API_KEY',
  },
}

function parseProviders(value: string | undefined): ProviderType[] {
  const supported = getPiRuntimeProviderContractsForTest().map((contract) => contract.providerType)
  if (!value || value.trim() === 'all') return supported

  const requested = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean) as ProviderType[]
  const unknown = requested.filter((provider) => !supported.includes(provider))
  if (unknown.length > 0) {
    throw new Error(`不支持的 provider: ${unknown.join(', ')}`)
  }

  return requested
}

function parseArgs(argv = process.argv.slice(2)): ProviderLiveSmokeOptions {
  const providerIndex = argv.indexOf('--providers')
  const promptIndex = argv.indexOf('--prompt')
  const timeoutIndex = argv.indexOf('--timeout-ms')

  return {
    providers: parseProviders(providerIndex >= 0 ? argv[providerIndex + 1] : undefined),
    prompt: promptIndex >= 0 && argv[promptIndex + 1] ? argv[promptIndex + 1]! : DEFAULT_PROMPT,
    timeoutMs: timeoutIndex >= 0 && argv[timeoutIndex + 1]
      ? Number(argv[timeoutIndex + 1])
      : DEFAULT_TIMEOUT_MS,
    keepTemp: argv.includes('--keep-temp'),
  }
}

function buildChannel(target: ProviderLiveSmokeTarget): Channel {
  return {
    id: `pi-live-${target.provider}`,
    name: target.displayName,
    provider: target.provider,
    baseUrl: target.baseUrl ?? '',
    apiKey: '',
    models: [{ id: target.model, name: target.model }],
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
  }
}

function createTimeout(ms: number, label: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`${label} 超时 (${ms}ms)`))
    }, ms).unref()
  })
}

async function waitForPromptResponse(input: {
  events: AsyncIterable<PiRpcEvent>
  commandId: string
  timeoutMs: number
}): Promise<PiRpcResponseEvent> {
  const responsePromise = (async (): Promise<PiRpcResponseEvent> => {
    for await (const event of input.events) {
      if (event.type === 'response' && event.id === input.commandId) {
        return event as PiRpcResponseEvent
      }
      if (event.type === 'protocol_error') {
        throw new Error(typeof event.error === 'string' ? event.error : 'Pi RPC 协议错误')
      }
    }
    throw new Error('Pi RPC 在 prompt response 前结束')
  })()

  return Promise.race([
    responsePromise,
    createTimeout(input.timeoutMs, `等待 ${input.commandId}`),
  ])
}

function sanitizeErrorMessage(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value)
  return message
    .replace(/sk-[a-zA-Z0-9_-]{8,}/g, 'sk-***')
    .replace(/Bearer\s+[a-zA-Z0-9._-]+/g, 'Bearer ***')
}

async function runProviderLiveSmoke(target: ProviderLiveSmokeTarget, options: ProviderLiveSmokeOptions): Promise<ProviderLiveSmokeResult> {
  const apiKey = process.env[target.apiKeyEnv]?.trim()
  if (!apiKey) {
    return {
      provider: target.provider,
      status: 'skipped',
      reason: `缺少 ${target.apiKeyEnv}`,
      model: target.model,
    }
  }

  if (target.provider === 'custom' && !target.baseUrl?.trim()) {
    return {
      provider: target.provider,
      status: 'skipped',
      reason: '缺少 PROMA_PI_LIVE_CUSTOM_BASE_URL',
      model: target.model,
    }
  }

  const homeDir = mkdtempSync(join(tmpdir(), `proma-pi-provider-live-${target.provider}-`))
  let rpc: ReturnType<typeof startPiRpcSession> | null = null

  try {
    const runtimeConfig = preparePiRuntimeConfig({
      promaConfigDir: homeDir,
      sessionId: `live-${target.provider}`,
      channel: buildChannel(target),
      apiKey,
      model: target.model,
    })
    const commandId = `live-${target.provider}-${Date.now()}`
    rpc = startPiRpcSession({
      cwd: homeDir,
      provider: runtimeConfig.provider,
      model: target.model,
      sessionId: `live-${target.provider}`,
      sessionDir: runtimeConfig.sessionDir,
      runtimeEnv: runtimeConfig.runtimeEnv,
    })
    rpc.send({
      id: commandId,
      type: 'prompt',
      message: options.prompt,
    })

    const response = await waitForPromptResponse({
      events: rpc.events,
      commandId,
      timeoutMs: options.timeoutMs,
    })
    if (response.success === false) {
      throw new Error(response.error ?? `${target.provider} prompt failed`)
    }

    return {
      provider: target.provider,
      status: 'passed',
      model: target.model,
      piProvider: runtimeConfig.provider,
    }
  } catch (error) {
    return {
      provider: target.provider,
      status: 'failed',
      reason: sanitizeErrorMessage(error),
      model: target.model,
    }
  } finally {
    rpc?.kill()
    if (rpc) await rpc.done
    if (!options.keepTemp) {
      rmSync(homeDir, { recursive: true, force: true })
    }
  }
}

export function getProviderLiveSmokeTargetsForTest(): Record<ProviderType, ProviderLiveSmokeTarget> {
  return PROVIDER_TARGETS
}

export { parseArgs as parsePiProviderLiveSmokeArgsForTest }

export async function runPiProviderLiveSmoke(options: ProviderLiveSmokeOptions): Promise<ProviderLiveSmokeResult[]> {
  const results: ProviderLiveSmokeResult[] = []
  for (const provider of options.providers) {
    results.push(await runProviderLiveSmoke(PROVIDER_TARGETS[provider], options))
  }
  return results
}

async function main(): Promise<void> {
  const options = parseArgs()
  const results = await runPiProviderLiveSmoke(options)
  for (const result of results) {
    const suffix = [
      result.piProvider ? `pi=${result.piProvider}` : null,
      result.model ? `model=${result.model}` : null,
      result.reason ? `reason=${result.reason}` : null,
    ].filter(Boolean).join(' ')
    console.log(`[${result.status}] ${result.provider}${suffix ? ` ${suffix}` : ''}`)
  }

  if (results.some((result) => result.status === 'failed')) {
    process.exitCode = 1
  }
}

if (import.meta.main) {
  await main()
}
