import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { MemoryConfig } from '@proma/shared'

export interface PiMemoryExtensionConfig {
  configDir: string
  memoryConfig: MemoryConfig
}

export interface PiMemoryExtensionResult {
  extensionPath: string
  toolNames: string[]
  env: Record<string, string>
}

const MEMORY_TOOL_NAMES = [
  'mcp__mem__recall_memory',
  'mcp__mem__add_memory',
]

function serializeExtensionValue(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function resolveImportUrl(specifier: string): string {
  const moduleAnchor = typeof __filename === 'string'
    ? __filename
    : join(process.cwd(), 'package.json')
  const cjsRequire = createRequire(moduleAnchor)
  return pathToFileURL(cjsRequire.resolve(specifier)).href
}

function buildPiMemoryExtensionSource(input: {
  userId: string
  baseUrl?: string
}): string {
  return `import { Type } from ${serializeExtensionValue(resolveImportUrl('typebox'))}

const MEMOS_USER_ID = ${serializeExtensionValue(input.userId)}
const MEMOS_BASE_URL = ${serializeExtensionValue(input.baseUrl ?? 'https://memos.memtensor.cn/api/openmem/v1')}
const MEMOS_API_KEY_ENV = 'PROMA_MEMOS_API_KEY'
const MEMORY_TOOL_HINTS = {
  mcp__mem__recall_memory: {
    risk: 'read',
    server: 'mem',
    toolName: 'recall_memory',
    description: 'Search user memories from MemOS Cloud.',
  },
  mcp__mem__add_memory: {
    risk: 'write',
    server: 'mem',
    toolName: 'add_memory',
    description: 'Store a conversation message pair into MemOS Cloud.',
  },
}

function getApiKey() {
  return String(process.env.PROMA_MEMOS_API_KEY || '').trim()
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

async function callMemosApi(path, body) {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error(MEMOS_API_KEY_ENV + ' 未设置')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(MEMOS_BASE_URL + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Token ' + apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error('HTTP ' + response.status + ': ' + await response.text())
    }
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

function extractData(result) {
  if (!result || typeof result !== 'object') return null
  const data = result.data
  return data && typeof data === 'object' ? data : null
}

function formatSearchResult(result) {
  const data = extractData(result)
  if (!data) return 'No memories found.'
  const memories = Array.isArray(data.memory_detail_list) ? data.memory_detail_list : []
  const preferences = Array.isArray(data.preference_detail_list) ? data.preference_detail_list : []
  const lines = []

  const facts = memories
    .map((item) => ({
      text: String(item?.memory_value || item?.memory_key || ''),
      createTime: item?.create_time ? String(item.create_time) : '',
    }))
    .filter((item) => item.text)
  if (facts.length > 0) {
    lines.push('## Facts')
    for (const item of facts) {
      lines.push(item.createTime ? '- [' + new Date(item.createTime).toLocaleString() + '] ' + item.text : '- ' + item.text)
    }
  }

  const prefs = preferences
    .map((item) => ({
      text: String(item?.preference || ''),
      type: item?.preference_type ? String(item.preference_type) : '',
    }))
    .filter((item) => item.text)
  if (prefs.length > 0) {
    lines.push(lines.length > 0 ? '\\n## Preferences' : '## Preferences')
    for (const item of prefs) {
      lines.push(item.type ? '- (' + item.type + ') ' + item.text : '- ' + item.text)
    }
  }

  return lines.length > 0 ? lines.join('\\n') : 'No memories found.'
}

function publishMemoryRiskHints() {
  const currentHints = globalThis.__PROMA_PI_MCP_TOOL_RISK_HINTS__
  const hints = currentHints && typeof currentHints === 'object' ? currentHints : {}
  Object.assign(hints, MEMORY_TOOL_HINTS)
  globalThis.__PROMA_PI_MCP_TOOL_RISK_HINTS__ = hints
}

function createRecallMemoryTool() {
  return {
    name: 'mcp__mem__recall_memory',
    label: 'Memory / recall',
    description: 'Search user memories from MemOS Cloud. Use this to recall relevant facts and preferences about the user.',
    promptSnippet: 'mcp__mem__recall_memory: search Proma memory by query.',
    parameters: Type.Object({
      query: Type.String({ description: 'Search query for memory retrieval' }),
      limit: Type.Optional(Type.Number({ description: 'Max results, default 6' })),
    }),
    async execute(_toolCallId, params) {
      try {
        const result = await callMemosApi('/search/memory', {
          user_id: MEMOS_USER_ID,
          query: params.query,
          source: 'proma',
          memory_limit_number: params.limit ?? 6,
          include_preference: true,
          preference_limit_number: params.limit ?? 6,
        })
        return {
          content: [{ type: 'text', text: formatSearchResult(result) }],
          details: { server: 'mem', toolName: 'recall_memory' },
        }
      } catch (error) {
        return {
          content: [{ type: 'text', text: 'Proma Pi memory recall 调用失败: ' + getErrorMessage(error) }],
          details: { server: 'mem', toolName: 'recall_memory', error: getErrorMessage(error) },
          isError: true,
        }
      }
    },
  }
}

function createAddMemoryTool() {
  return {
    name: 'mcp__mem__add_memory',
    label: 'Memory / add',
    description: 'Store a conversation message pair into MemOS Cloud for long-term memory.',
    promptSnippet: 'mcp__mem__add_memory: store a useful exchange into Proma memory.',
    parameters: Type.Object({
      userMessage: Type.String({ description: 'The user message to store' }),
      assistantMessage: Type.Optional(Type.String({ description: 'The assistant response to store' })),
      conversationId: Type.Optional(Type.String({ description: 'Conversation ID for grouping' })),
      tags: Type.Optional(Type.Array(Type.String(), { description: 'Tags for categorization' })),
    }),
    async execute(_toolCallId, params) {
      try {
        const messages = [{ role: 'user', content: params.userMessage }]
        if (params.assistantMessage) {
          messages.push({ role: 'assistant', content: params.assistantMessage })
        }
        await callMemosApi('/add/message', {
          user_id: MEMOS_USER_ID,
          conversation_id: params.conversationId || 'proma-' + Date.now(),
          messages,
          source: 'proma',
          tags: params.tags ?? ['proma'],
          async_mode: true,
          info: { source: 'proma-pi-builtin-memory' },
        })
        return {
          content: [{ type: 'text', text: 'Memory stored successfully.' }],
          details: { server: 'mem', toolName: 'add_memory' },
        }
      } catch (error) {
        return {
          content: [{ type: 'text', text: 'Proma Pi memory add 调用失败: ' + getErrorMessage(error) }],
          details: { server: 'mem', toolName: 'add_memory', error: getErrorMessage(error) },
          isError: true,
        }
      }
    },
  }
}

export default async function (pi) {
  publishMemoryRiskHints()
  pi.registerTool(createRecallMemoryTool())
  pi.registerTool(createAddMemoryTool())
}
`
}

export function ensurePiMemoryExtension(config: PiMemoryExtensionConfig): PiMemoryExtensionResult | null {
  const memoryConfig = config.memoryConfig
  const apiKey = memoryConfig.apiKey.trim()
  if (!memoryConfig.enabled || !apiKey) return null

  const extensionDir = join(config.configDir, 'proma-extensions')
  mkdirSync(extensionDir, { recursive: true })

  const extensionPath = join(extensionDir, 'proma-memory-bridge.mjs')
  writeFileSync(
    extensionPath,
    buildPiMemoryExtensionSource({
      userId: memoryConfig.userId?.trim() || 'proma-user',
      baseUrl: memoryConfig.baseUrl?.trim() || undefined,
    }),
    'utf-8',
  )

  return {
    extensionPath,
    toolNames: [...MEMORY_TOOL_NAMES],
    env: {
      PROMA_MEMOS_API_KEY: apiKey,
    },
  }
}

export function buildPiMemoryExtensionSourceForTest(input: {
  userId: string
  baseUrl?: string
}): string {
  return buildPiMemoryExtensionSource(input)
}
