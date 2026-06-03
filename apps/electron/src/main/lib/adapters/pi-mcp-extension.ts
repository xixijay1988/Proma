import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { McpServerEntry } from '@proma/shared'

export interface PiMcpExtensionConfig {
  configDir: string
  servers: Record<string, McpServerEntry>
}

interface PiMcpBridgeServerConfig {
  name: string
  listToolsToolName: string
  callToolToolName: string
  type: 'stdio' | 'http' | 'sse'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  startupTimeoutMs?: number
}

interface PiMcpRemoteToolManifestItem {
  toolName: string
  nativeToolName: string
}

export function sanitizePiMcpToolSegment(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase()

  return normalized || 'mcp'
}

export function buildPiMcpBridgeToolName(serverName: string): string {
  return `mcp__${sanitizePiMcpToolSegment(serverName)}__call_tool`
}

export function buildPiMcpBridgeListToolsToolName(serverName: string): string {
  return `mcp__${sanitizePiMcpToolSegment(serverName)}__list_tools`
}

export function buildPiMcpBridgeRemoteToolPattern(serverName: string): string {
  return `mcp__${sanitizePiMcpToolSegment(serverName)}__<tool>`
}

function buildPiMcpRemoteToolName(serverName: string, toolName: string): string {
  return `mcp__${sanitizePiMcpToolSegment(serverName)}__${sanitizePiMcpToolSegment(toolName)}`
}

function buildPiMcpRemoteToolManifest(serverName: string, tools: Array<{ name: string }>): PiMcpRemoteToolManifestItem[] {
  const usedNativeNames = new Set<string>()
  return tools
    .filter((tool) => typeof tool.name === 'string' && tool.name.trim())
    .map((tool) => {
      const toolName = String(tool.name)
      const baseNativeToolName = buildPiMcpRemoteToolName(serverName, toolName)
      let nativeToolName = baseNativeToolName
      let suffix = 2
      while (usedNativeNames.has(nativeToolName)) {
        nativeToolName = `${baseNativeToolName}_${suffix}`
        suffix += 1
      }
      usedNativeNames.add(nativeToolName)
      return { toolName, nativeToolName }
    })
}

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

function buildBridgeServerConfig(name: string, entry: McpServerEntry): PiMcpBridgeServerConfig | null {
  if (!entry.enabled) return null

  if (entry.type === 'stdio') {
    if (!entry.command?.trim()) return null

    const env: Record<string, string> = {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      ...(entry.env ?? {}),
    }

    return {
      name,
      listToolsToolName: buildPiMcpBridgeListToolsToolName(name),
      callToolToolName: buildPiMcpBridgeToolName(name),
      type: 'stdio',
      command: entry.command.trim(),
      ...(entry.args && entry.args.length > 0 ? { args: entry.args } : {}),
      ...(Object.keys(env).length > 0 ? { env } : {}),
      startupTimeoutMs: (entry.timeout ?? 30) * 1000,
    }
  }

  if ((entry.type === 'http' || entry.type === 'sse') && entry.url?.trim()) {
    return {
      name,
      listToolsToolName: buildPiMcpBridgeListToolsToolName(name),
      callToolToolName: buildPiMcpBridgeToolName(name),
      type: entry.type,
      url: entry.url.trim(),
      ...(entry.headers && Object.keys(entry.headers).length > 0 ? { headers: entry.headers } : {}),
    }
  }

  return null
}

function buildPiMcpExtensionSource(servers: PiMcpBridgeServerConfig[]): string {
  return `import { Client } from ${serializeExtensionValue(resolveImportUrl('@modelcontextprotocol/sdk/client/index.js'))}
import { StdioClientTransport } from ${serializeExtensionValue(resolveImportUrl('@modelcontextprotocol/sdk/client/stdio.js'))}
import { SSEClientTransport } from ${serializeExtensionValue(resolveImportUrl('@modelcontextprotocol/sdk/client/sse.js'))}
import { StreamableHTTPClientTransport } from ${serializeExtensionValue(resolveImportUrl('@modelcontextprotocol/sdk/client/streamableHttp.js'))}
import { Type } from ${serializeExtensionValue(resolveImportUrl('typebox'))}

const MCP_SERVERS = ${serializeExtensionValue(servers)}
const clients = new Map()
const remoteToolCounts = new Map()
const remoteToolManifests = new Map()

function normalizeMcpContentBlocks(content) {
  if (!Array.isArray(content)) {
    return [{
      type: 'text',
      text: typeof content === 'string' ? content : JSON.stringify(content ?? null, null, 2),
    }]
  }

  return content.map((item) => {
    if (!item || typeof item !== 'object') {
      return { type: 'text', text: String(item) }
    }
    if (item.type === 'text' && typeof item.text === 'string') return item
    if (item.type === 'image' && item.data && item.mimeType) return item
    if (item.type === 'resource') {
      return {
        type: 'text',
        text: '[MCP resource result]\\n' + JSON.stringify(item.resource ?? item, null, 2),
      }
    }
    return {
      type: 'text',
      text: JSON.stringify(item, null, 2),
    }
  })
}

async function createTransport(server) {
  if (server.type === 'stdio') {
    return new StdioClientTransport({
      command: server.command,
      args: server.args ?? [],
      env: server.env,
      stderr: 'pipe',
    })
  }

  if (server.type === 'sse') {
    return new SSEClientTransport(new URL(server.url), {
      requestInit: server.headers ? { headers: server.headers } : undefined,
    })
  }

  return new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: server.headers ? { headers: server.headers } : undefined,
  })
}

async function getClient(server) {
  const cached = clients.get(server.name)
  if (cached) return cached

  const client = new Client({
    name: 'proma-pi-mcp-bridge',
    version: '1.0.0',
  })
  const transport = await createTransport(server)
  await client.connect(transport, server.startupTimeoutMs ? { timeout: server.startupTimeoutMs } : undefined)
  clients.set(server.name, client)
  return client
}

function formatToolSchema(schema) {
  if (!schema || typeof schema !== 'object') return '{}'
  return JSON.stringify(schema)
}

function sanitizeToolSegment(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase()
  return normalized || 'tool'
}

function buildRemoteMcpToolName(server, toolName) {
  return 'mcp__' + sanitizeToolSegment(server.name) + '__' + sanitizeToolSegment(toolName)
}

function buildRemoteMcpToolManifest(server, tools) {
  const usedNativeNames = new Set()
  return tools
    .filter((tool) => tool && typeof tool.name === 'string' && tool.name.trim())
    .map((tool) => {
      const toolName = String(tool.name)
      const baseNativeToolName = buildRemoteMcpToolName(server, toolName)
      let nativeToolName = baseNativeToolName
      let suffix = 2
      while (usedNativeNames.has(nativeToolName)) {
        nativeToolName = baseNativeToolName + '_' + suffix
        suffix += 1
      }
      usedNativeNames.add(nativeToolName)
      return {
        tool,
        toolName,
        nativeToolName,
      }
    })
}

function toTypeboxSchema(schema) {
  if (!schema || typeof schema !== 'object') return Type.Object({})
  const schemaRecord = schema
  if (schemaRecord.type === 'object' && schemaRecord.properties && typeof schemaRecord.properties === 'object') {
    return schemaRecord
  }
  return Type.Object({
    arguments: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: 'JSON arguments for this MCP tool' })),
  })
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

const MCP_READ_VERBS = new Set(['fetch', 'find', 'get', 'inspect', 'list', 'lookup', 'query', 'read', 'search'])
const MCP_MUTATION_WORDS = ['append', 'create', 'delete', 'edit', 'execute', 'insert', 'modify', 'mutate', 'patch', 'remove', 'replace', 'run', 'send', 'update', 'upload', 'write']

function inferMcpToolRisk(tool) {
  const name = String(tool?.name || '').trim().toLowerCase()
  const description = typeof tool?.description === 'string' ? tool.description : ''
  const firstSegment = sanitizeToolSegment(name).split('_')[0] || ''
  const text = (name + ' ' + description).toLowerCase()
  if (MCP_MUTATION_WORDS.some((word) => text.includes(word))) return 'write'
  if (MCP_READ_VERBS.has(firstSegment) && description.trim()) return 'read'
  return 'unknown'
}

function publishMcpToolRiskHints(manifest) {
  const currentHints = globalThis.__PROMA_PI_MCP_TOOL_RISK_HINTS__
  const hints = currentHints && typeof currentHints === 'object' ? currentHints : {}
  for (const item of manifest) {
    hints[String(item.nativeToolName || '').trim().toLowerCase()] = {
      risk: inferMcpToolRisk(item.tool),
      server: item.serverName,
      toolName: item.toolName,
      description: typeof item.tool.description === 'string' ? item.tool.description : '',
    }
  }
  globalThis.__PROMA_PI_MCP_TOOL_RISK_HINTS__ = hints
}

function formatMcpBridgeError(server, operation, error, toolName) {
  const parts = [
    'Proma Pi MCP bridge 调用失败。',
    'server: ' + server.name,
    'operation: ' + operation,
  ]
  if (toolName) {
    parts.push('toolName: ' + toolName)
  }
  parts.push('error: ' + getErrorMessage(error))
  return parts.join('\\n')
}

function createListToolsTool(server) {
  return {
    name: server.listToolsToolName,
    label: 'MCP ' + server.name + ' tools',
    description: 'List available tools from the Proma workspace MCP server "' + server.name + '". Call this before ' + server.callToolToolName + ' when you are unsure which MCP tool to use.',
    promptSnippet: server.listToolsToolName + ': list tools from Proma MCP server "' + server.name + '".',
    parameters: Type.Object({}),
    async execute() {
      try {
        const client = await getClient(server)
        const result = await client.listTools()
        const tools = Array.isArray(result.tools) ? result.tools : []
        const text = tools.length > 0
          ? tools.map((tool) => {
              const description = typeof tool.description === 'string' && tool.description.trim()
                ? ' — ' + tool.description.trim()
                : ''
              return '- ' + tool.name + description + '\\n  inputSchema: ' + formatToolSchema(tool.inputSchema)
            }).join('\\n')
          : 'No MCP tools returned by server "' + server.name + '".'

        return {
          content: text,
          details: {
            server: server.name,
            toolCount: tools.length,
          },
        }
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatMcpBridgeError(server, 'list_tools', error) }],
          details: {
            server: server.name,
            operation: 'list_tools',
            error: getErrorMessage(error),
          },
          isError: true,
        }
      }
    },
  }
}

function createCallToolTool(server) {
  return {
    name: server.callToolToolName,
    label: 'MCP ' + server.name,
    description: 'Call a tool from the Proma workspace MCP server "' + server.name + '". Use toolName for the MCP tool name and arguments for its JSON arguments.',
    promptSnippet: server.callToolToolName + ': call Proma MCP server "' + server.name + '" tools.',
    parameters: Type.Object({
      toolName: Type.String({ description: 'MCP tool name on server "' + server.name + '"' }),
      arguments: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: 'JSON arguments for the MCP tool' })),
    }),
    async execute(_toolCallId, params) {
      try {
        const client = await getClient(server)
        const result = await client.callTool({
          name: params.toolName,
          arguments: params.arguments ?? {},
        })

        return {
          content: normalizeMcpContentBlocks(result.content),
          structuredContent: result.structuredContent,
          details: {
            server: server.name,
            toolName: params.toolName,
            structuredContent: result.structuredContent,
            isError: result.isError === true,
          },
          isError: result.isError === true,
        }
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatMcpBridgeError(server, 'call_tool', error, params.toolName) }],
          details: {
            server: server.name,
            operation: 'call_tool',
            toolName: params.toolName,
            error: getErrorMessage(error),
          },
          isError: true,
        }
      }
    },
  }
}

function createRemoteMcpTool(server, manifestItem) {
  const tool = manifestItem.tool
  const toolName = manifestItem.toolName
  const nativeToolName = manifestItem.nativeToolName
  const description = typeof tool.description === 'string' && tool.description.trim()
    ? tool.description.trim()
    : 'Call MCP tool "' + toolName + '" from Proma workspace MCP server "' + server.name + '".'

  return {
    name: nativeToolName,
    label: 'MCP ' + server.name + ' / ' + toolName,
    description,
    promptSnippet: nativeToolName + ': call MCP tool "' + toolName + '" from Proma MCP server "' + server.name + '".',
    parameters: toTypeboxSchema(tool.inputSchema),
    async execute(_toolCallId, params) {
      try {
        const client = await getClient(server)
        const result = await client.callTool({
          name: toolName,
          arguments: params ?? {},
        })

        return {
          content: normalizeMcpContentBlocks(result.content),
          structuredContent: result.structuredContent,
          details: {
            bridgeType: 'proma-pi-mcp-remote-tool',
            server: server.name,
            toolName,
            nativeToolName,
            structuredContent: result.structuredContent,
            isError: result.isError === true,
          },
          isError: result.isError === true,
        }
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatMcpBridgeError(server, 'remote_tool', error, toolName) }],
          details: {
            bridgeType: 'proma-pi-mcp-remote-tool',
            server: server.name,
            operation: 'remote_tool',
            toolName: tool.name,
            nativeToolName,
            error: getErrorMessage(error),
          },
          isError: true,
        }
      }
    },
  }
}

async function registerRemoteMcpTools(pi, server) {
  try {
    const client = await getClient(server)
    const result = await client.listTools()
    const tools = Array.isArray(result.tools) ? result.tools : []
    const manifest = buildRemoteMcpToolManifest(server, tools)
    let registeredCount = 0
    for (const item of manifest) {
      pi.registerTool(createRemoteMcpTool(server, item))
      registeredCount += 1
    }
    publishMcpToolRiskHints(manifest.map((item) => ({ ...item, serverName: server.name })))
    remoteToolManifests.set(server.name, manifest.map((item) => ({
      toolName: item.toolName,
      nativeToolName: item.nativeToolName,
    })))
    remoteToolCounts.set(server.name, registeredCount)
  } catch (error) {
    remoteToolManifests.set(server.name, [])
    remoteToolCounts.set(server.name, 0)
    console.warn(formatMcpBridgeError(server, 'register_remote_tools', error))
  }
}

function formatBridgeStatus() {
  const lines = ['Proma Pi MCP bridge 已加载。']
  for (const server of MCP_SERVERS) {
    const remoteCount = remoteToolCounts.get(server.name) ?? 0
    const remoteTools = remoteToolManifests.get(server.name) ?? []
    const remoteSummary = remoteCount > 0 ? ', remote tools: ' + remoteCount : ''
    lines.push('- ' + server.name + ': ' + server.listToolsToolName + ', ' + server.callToolToolName + remoteSummary)
    for (const tool of remoteTools) {
      lines.push('  - ' + tool.nativeToolName + ' -> ' + tool.toolName)
    }
  }
  return lines.join('\\n')
}

export default async function (pi) {
  for (const server of MCP_SERVERS) {
    pi.registerTool(createListToolsTool(server))
    pi.registerTool(createCallToolTool(server))
    await registerRemoteMcpTools(pi, server)
  }

  pi.registerCommand('proma:mcp_bridge_status', {
    description: formatBridgeStatus(),
    async handler(_args, ctx) {
      ctx.sendMessage({
        customType: 'proma_mcp_bridge_status',
        content: formatBridgeStatus(),
        display: formatBridgeStatus(),
        details: {
          servers: MCP_SERVERS.map((server) => ({
            name: server.name,
            listToolsToolName: server.listToolsToolName,
            callToolToolName: server.callToolToolName,
            remoteTools: remoteToolManifests.get(server.name) ?? [],
          })),
        },
      })
    },
  })

  pi.on('session_shutdown', async () => {
    for (const client of clients.values()) {
      try {
        await client.close()
      } catch {
        // 忽略 MCP 关闭阶段的错误，避免影响 Pi 会话退出。
      }
    }
    clients.clear()
  })
}
`
}

export function ensurePiMcpExtension(config: PiMcpExtensionConfig): string | null {
  const servers = Object.entries(config.servers)
    .map(([name, entry]) => buildBridgeServerConfig(name, entry))
    .filter((server): server is PiMcpBridgeServerConfig => server !== null)

  if (servers.length === 0) return null

  const extensionDir = join(config.configDir, 'proma-extensions')
  mkdirSync(extensionDir, { recursive: true })

  const extensionPath = join(extensionDir, 'proma-mcp-bridge.mjs')
  writeFileSync(extensionPath, buildPiMcpExtensionSource(servers), 'utf-8')
  return extensionPath
}

export function buildPiMcpExtensionSourceForTest(servers: PiMcpBridgeServerConfig[]): string {
  return buildPiMcpExtensionSource(servers)
}

export function buildPiMcpRemoteToolManifestForTest(serverName: string, tools: Array<{ name: string; description?: string }>): PiMcpRemoteToolManifestItem[] {
  return buildPiMcpRemoteToolManifest(serverName, tools)
}
