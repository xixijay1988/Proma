import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, test } from 'bun:test'
import {
  buildPiMcpRemoteToolManifestForTest,
  ensurePiMcpExtension,
} from './pi-mcp-extension'
import { startPiRpcSession, type PiRpcEvent } from './pi-process'

interface PiToolExecutionResult {
  content?: unknown
  details?: {
    server?: string
    toolName?: string
    nativeToolName?: string
    bridgeType?: string
    toolCount?: number
    structuredContent?: unknown
    isError?: boolean
  }
  structuredContent?: unknown
  isError?: boolean
}

interface RegisteredPiTool {
  name: string
  execute: (toolCallId: string, params: Record<string, unknown>) => Promise<PiToolExecutionResult>
}

interface RegisteredPiCommand {
  description?: string
  handler: (args: string[], ctx: { sendMessage: (message: unknown) => void }) => Promise<void>
}

interface FakePiRuntime {
  registerTool: (tool: RegisteredPiTool) => void
  registerCommand: (name: string, command: RegisteredPiCommand) => void
  on: (event: string, handler: () => Promise<void> | void) => void
}

interface McpRiskHint {
  risk?: string
  server?: string
  toolName?: string
  description?: string
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

function createFakePiRuntime(): {
  pi: FakePiRuntime
  tools: RegisteredPiTool[]
  shutdown: () => Promise<void>
} {
  const tools: RegisteredPiTool[] = []
  const shutdownHandlers: Array<() => Promise<void> | void> = []

  return {
    tools,
    pi: {
      registerTool(tool) {
        tools.push(tool)
      },
      registerCommand() {
        // 测试只关心工具注册，命令注册由源码断言覆盖。
      },
      on(event, handler) {
        if (event === 'session_shutdown') {
          shutdownHandlers.push(handler)
        }
      },
    },
    async shutdown() {
      for (const handler of shutdownHandlers) {
        await handler()
      }
    },
  }
}

function writeMcpFixtureServer(serverPath: string): void {
  const require = createRequire(import.meta.url)
  const serverUrl = pathToFileURL(require.resolve('@modelcontextprotocol/sdk/server/index.js')).href
  const stdioUrl = pathToFileURL(require.resolve('@modelcontextprotocol/sdk/server/stdio.js')).href
  const typesUrl = pathToFileURL(require.resolve('@modelcontextprotocol/sdk/types.js')).href

  writeFileSync(
    serverPath,
    `import { Server } from ${JSON.stringify(serverUrl)}
import { StdioServerTransport } from ${JSON.stringify(stdioUrl)}
import { CallToolRequestSchema, ListToolsRequestSchema } from ${JSON.stringify(typesUrl)}

const server = new Server(
  { name: 'proma-pi-mcp-fixture', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'inspect-result',
    description: 'Return every MCP result shape Proma needs to preserve',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string' },
      },
      required: ['topic'],
    },
  }],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'inspect-result') {
    return {
      content: [{ type: 'text', text: 'unknown tool: ' + request.params.name }],
      isError: true,
    }
  }

  const topic = request.params.arguments?.topic ?? 'missing'
  return {
    content: [
      { type: 'text', text: 'topic=' + topic },
      { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
      {
        type: 'resource',
        resource: {
          uri: 'file:///proma-fixture.txt',
          mimeType: 'text/plain',
          text: 'resource body for ' + topic,
        },
      },
    ],
    structuredContent: {
      topic,
      ok: true,
    },
  }
})

await server.connect(new StdioServerTransport())
`,
    'utf-8',
  )
}

async function runGeneratedBridgeTool(input: {
  extensionPath: string
  toolName: string
  params: Record<string, unknown>
}): Promise<PiToolExecutionResult> {
  const fakeRuntime = createFakePiRuntime()
  try {
    const module = await import(`${pathToFileURL(input.extensionPath).href}?t=${Date.now()}-${Math.random()}`)
    const extensionFactory = module.default as (pi: FakePiRuntime) => Promise<void>
    await extensionFactory(fakeRuntime.pi)

    const remoteTool = fakeRuntime.tools.find((tool) => tool.name === input.toolName)
    expect(remoteTool).toBeDefined()
    if (!remoteTool) throw new Error(`Expected generated remote MCP tool: ${input.toolName}`)

    return await remoteTool.execute('tool-call-1', input.params)
  } finally {
    await fakeRuntime.shutdown()
  }
}

async function runGeneratedBridgeAndCollectRiskHints(extensionPath: string): Promise<Record<string, McpRiskHint>> {
  const fakeRuntime = createFakePiRuntime()
  const previousHints = (globalThis as typeof globalThis & {
    __PROMA_PI_MCP_TOOL_RISK_HINTS__?: Record<string, McpRiskHint>
  }).__PROMA_PI_MCP_TOOL_RISK_HINTS__

  try {
    delete (globalThis as typeof globalThis & {
      __PROMA_PI_MCP_TOOL_RISK_HINTS__?: Record<string, McpRiskHint>
    }).__PROMA_PI_MCP_TOOL_RISK_HINTS__
    const module = await import(`${pathToFileURL(extensionPath).href}?t=${Date.now()}-${Math.random()}`)
    const extensionFactory = module.default as (pi: FakePiRuntime) => Promise<void>
    await extensionFactory(fakeRuntime.pi)
    return {
      ...((globalThis as typeof globalThis & {
        __PROMA_PI_MCP_TOOL_RISK_HINTS__?: Record<string, McpRiskHint>
      }).__PROMA_PI_MCP_TOOL_RISK_HINTS__ ?? {}),
    }
  } finally {
    await fakeRuntime.shutdown()
    if (previousHints) {
      ;(globalThis as typeof globalThis & {
        __PROMA_PI_MCP_TOOL_RISK_HINTS__?: Record<string, McpRiskHint>
      }).__PROMA_PI_MCP_TOOL_RISK_HINTS__ = previousHints
    } else {
      delete (globalThis as typeof globalThis & {
        __PROMA_PI_MCP_TOOL_RISK_HINTS__?: Record<string, McpRiskHint>
      }).__PROMA_PI_MCP_TOOL_RISK_HINTS__
    }
  }
}

function expectStructuredFixtureResult(result: PiToolExecutionResult, topic: string): void {
  expect(result.isError).toBe(false)
  expect(result.content).toEqual([
    { type: 'text', text: `topic=${topic}` },
    { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
    {
      type: 'text',
      text: '[MCP resource result]\n' + JSON.stringify({
        uri: 'file:///proma-fixture.txt',
        mimeType: 'text/plain',
        text: `resource body for ${topic}`,
      }, null, 2),
    },
  ])
  expect(result.details?.structuredContent).toEqual({
    topic,
    ok: true,
  })
  expect(result.structuredContent).toEqual({
    topic,
    ok: true,
  })
}

async function createHttpMcpFixtureServer(): Promise<{
  url: string
  close: () => Promise<void>
}> {
  const require = createRequire(import.meta.url)
  const { Server } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/server/index.js')).href)
  const { StreamableHTTPServerTransport } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/server/streamableHttp.js')).href)
  const { CallToolRequestSchema, ListToolsRequestSchema } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/types.js')).href)

  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/mcp') {
      res.writeHead(404).end()
      return
    }

    const mcpServer = new Server(
      { name: 'proma-pi-http-mcp-fixture', version: '1.0.0' },
      { capabilities: { tools: {} } },
    )
    mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [{
        name: 'inspect-result',
        description: 'Return every MCP result shape Proma needs to preserve',
        inputSchema: {
          type: 'object',
          properties: {
            topic: { type: 'string' },
          },
          required: ['topic'],
        },
      }],
    }))
    mcpServer.setRequestHandler(CallToolRequestSchema, async (request: { params: { name: string; arguments?: { topic?: string } } }) => {
      if (request.params.name !== 'inspect-result') {
        return {
          content: [{ type: 'text', text: `unknown tool: ${request.params.name}` }],
          isError: true,
        }
      }

      const topic = request.params.arguments?.topic ?? 'missing'
      return {
        content: [
          { type: 'text', text: `topic=${topic}` },
          { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
          {
            type: 'resource',
            resource: {
              uri: 'file:///proma-fixture.txt',
              mimeType: 'text/plain',
              text: `resource body for ${topic}`,
            },
          },
        ],
        structuredContent: {
          topic,
          ok: true,
        },
      }
    })

    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      })
      await mcpServer.connect(transport)
      await transport.handleRequest(req, res)
      res.on('close', () => {
        void transport.close()
        void mcpServer.close()
      })
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : String(error),
          },
          id: null,
        }))
      }
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    throw new Error('Expected HTTP fixture to listen on a TCP port')
  }

  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => {
        if (error) reject(error)
        else resolve()
      })
    }),
  }
}

function registerFixtureToolHandlers(
  mcpServer: {
    setRequestHandler: (schema: unknown, handler: (request: { params: { name: string; arguments?: { topic?: string } } }) => Promise<unknown>) => void
  },
  schemas: {
    CallToolRequestSchema: unknown
    ListToolsRequestSchema: unknown
  },
): void {
  mcpServer.setRequestHandler(schemas.ListToolsRequestSchema, async () => ({
    tools: [{
      name: 'inspect-result',
      description: 'Return every MCP result shape Proma needs to preserve',
      inputSchema: {
        type: 'object',
        properties: {
          topic: { type: 'string' },
        },
        required: ['topic'],
      },
    }],
  }))
  mcpServer.setRequestHandler(schemas.CallToolRequestSchema, async (request) => {
    if (request.params.name !== 'inspect-result') {
      return {
        content: [{ type: 'text', text: `unknown tool: ${request.params.name}` }],
        isError: true,
      }
    }

    const topic = request.params.arguments?.topic ?? 'missing'
    return {
      content: [
        { type: 'text', text: `topic=${topic}` },
        { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
        {
          type: 'resource',
          resource: {
            uri: 'file:///proma-fixture.txt',
            mimeType: 'text/plain',
            text: `resource body for ${topic}`,
          },
        },
      ],
      structuredContent: {
        topic,
        ok: true,
      },
    }
  })
}

async function createSseMcpFixtureServer(): Promise<{
  url: string
  close: () => Promise<void>
}> {
  const require = createRequire(import.meta.url)
  const { Server } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/server/index.js')).href)
  const { SSEServerTransport } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/server/sse.js')).href)
  const { CallToolRequestSchema, ListToolsRequestSchema } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/types.js')).href)

  const transports = new Map<string, {
    transport: {
      handlePostMessage: (req: IncomingMessage, res: ServerResponse) => Promise<void>
      close: () => Promise<void>
    }
    server: {
      close: () => Promise<void>
    }
  }>()

  const httpServer = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/mcp') {
      const mcpServer = new Server(
        { name: 'proma-pi-sse-mcp-fixture', version: '1.0.0' },
        { capabilities: { tools: {} } },
      )
      registerFixtureToolHandlers(mcpServer, { CallToolRequestSchema, ListToolsRequestSchema })

      const transport = new SSEServerTransport('/messages', res)
      transports.set(transport.sessionId, { transport, server: mcpServer })
      transport.onclose = () => {
        transports.delete(transport.sessionId)
      }
      await mcpServer.connect(transport)
      return
    }

    if (req.method === 'POST' && req.url?.startsWith('/messages')) {
      const requestUrl = new URL(req.url, 'http://127.0.0.1')
      const sessionId = requestUrl.searchParams.get('sessionId')
      const entry = sessionId ? transports.get(sessionId) : undefined
      if (!entry) {
        res.writeHead(404).end('Session not found')
        return
      }
      await entry.transport.handlePostMessage(req, res)
      return
    }

    res.writeHead(404).end()
  })

  await new Promise<void>((resolve, reject) => {
    httpServer.on('error', reject)
    httpServer.listen(0, '127.0.0.1', () => resolve())
  })

  const address = httpServer.address()
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    throw new Error('Expected SSE fixture to listen on a TCP port')
  }

  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: async () => {
      for (const entry of transports.values()) {
        await entry.transport.close()
        await entry.server.close()
      }
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error?: Error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    },
  }
}

describe('pi mcp extension', () => {
  test('Given workspace MCP config When extension is generated Then enabled servers become Pi bridge tools', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'proma-pi-mcp-extension-'))
    try {
      const extensionPath = ensurePiMcpExtension({
        configDir,
        servers: {
          docs: {
            type: 'stdio',
            command: 'node',
            args: ['server.js'],
            env: { DOCS_TOKEN: 'token-1' },
            enabled: true,
            timeout: 12,
          },
          remote: {
            type: 'http',
            url: 'https://mcp.example.test/mcp',
            headers: { Authorization: 'Bearer remote' },
            enabled: true,
          },
          off: {
            type: 'stdio',
            command: 'node',
            enabled: false,
          },
        },
      })
      expect(extensionPath).not.toBeNull()
      if (!extensionPath) throw new Error('Expected Pi MCP extension path')

      const source = readFileSync(extensionPath, 'utf-8')

      expect(extensionPath.endsWith('proma-mcp-bridge.mjs')).toBe(true)
      expect(source).toContain('mcp__docs__list_tools')
      expect(source).toContain('mcp__docs__call_tool')
      expect(source).toContain('mcp__remote__list_tools')
      expect(source).toContain('mcp__remote__call_tool')
      expect(source).not.toContain('mcp__off__list_tools')
      expect(source).not.toContain('mcp__off__call_tool')
      expect(source).toContain('"command":"node"')
      expect(source).toContain('"DOCS_TOKEN":"token-1"')
      expect(source).toContain('"PATH"')
      expect(source).toContain('"startupTimeoutMs":12000')
      expect(source).toContain('/@modelcontextprotocol/sdk/')
      expect(source).toContain('/client/index.js')
      expect(source).toContain('client.listTools')
      expect(source).toContain('client.callTool')
      expect(source).toContain('proma:mcp_bridge_status')
      expect(source).toContain('Proma Pi MCP bridge 已加载')
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('Given Pi MCP bridge imports runtime-only dependencies When app is packaged Then electron-builder keeps them beside the extension', () => {
    const builderConfig = readFileSync(join(process.cwd(), 'apps/electron/electron-builder.yml'), 'utf-8')

    expect(builderConfig).toContain('node_modules/@modelcontextprotocol/sdk/**/*')
    expect(builderConfig).toContain('node_modules/typebox/**/*')
    expect(builderConfig).toContain('"node_modules/@modelcontextprotocol/**"')
    expect(builderConfig).toContain('"node_modules/typebox/**"')
  })

  test('Given packaged Pi MCP bridge risk When release smoke is needed Then package exposes a reusable packaged smoke script', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'apps/electron/package.json'), 'utf-8')) as {
      scripts?: Record<string, string>
    }
    const smokeScriptPath = join(process.cwd(), 'apps/electron/scripts/pi-mcp-packaged-smoke.ts')

    expect(packageJson.scripts?.['smoke:pi-mcp-packaged']).toBe('bun run scripts/pi-mcp-packaged-smoke.ts')
    const smokeScript = readFileSync(smokeScriptPath, 'utf-8')
    expect(smokeScript).toContain('app.asar.unpacked')
    expect(smokeScript).toContain('--platform')
    expect(smokeScript).toContain('resolvePackagedSmokePaths')
    expect(smokeScript).toContain('@modelcontextprotocol')
    expect(smokeScript).toContain('typebox')
    expect(smokeScript).toContain('mcp__docs__inspect_result')
  })

  test('Given no enabled MCP servers When extension is generated Then no extension is created', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'proma-pi-mcp-extension-'))
    try {
      const extensionPath = ensurePiMcpExtension({
        configDir,
        servers: {
          off: {
            type: 'stdio',
            command: 'node',
            enabled: false,
          },
        },
      })

      expect(extensionPath).toBeNull()
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('Given bridge tool execution fails When extension is generated Then errors are returned as tool results', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'proma-pi-mcp-extension-'))
    try {
      const extensionPath = ensurePiMcpExtension({
        configDir,
        servers: {
          docs: {
            type: 'stdio',
            command: 'node',
            args: ['server.js'],
            enabled: true,
          },
        },
      })
      expect(extensionPath).not.toBeNull()
      if (!extensionPath) throw new Error('Expected Pi MCP extension path')

      const source = readFileSync(extensionPath, 'utf-8')

      expect(source).toContain('function formatMcpBridgeError')
      expect(source).toContain("content: [{ type: 'text', text: formatMcpBridgeError(server, 'list_tools', error) }]")
      expect(source).toContain("content: [{ type: 'text', text: formatMcpBridgeError(server, 'call_tool', error, params.toolName) }]")
      expect(source).toContain("content: [{ type: 'text', text: formatMcpBridgeError(server, 'remote_tool', error, toolName) }]")
      expect(source).toContain('isError: true')
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('Given MCP tool returns structured content When extension is generated Then bridge keeps content blocks', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'proma-pi-mcp-extension-'))
    try {
      const extensionPath = ensurePiMcpExtension({
        configDir,
        servers: {
          docs: {
            type: 'stdio',
            command: 'node',
            args: ['server.js'],
            enabled: true,
          },
        },
      })
      expect(extensionPath).not.toBeNull()
      if (!extensionPath) throw new Error('Expected Pi MCP extension path')

      const source = readFileSync(extensionPath, 'utf-8')

      expect(source).toContain('function normalizeMcpContentBlocks(content)')
      expect(source).toContain("if (item.type === 'text' && typeof item.text === 'string') return item")
      expect(source).toContain("if (item.type === 'image' && item.data && item.mimeType)")
      expect(source).toContain("text: '[MCP resource result]\\n' + JSON.stringify(item.resource ?? item, null, 2)")
      expect(source).toContain('content: normalizeMcpContentBlocks(result.content)')
      expect(source).not.toContain('content: formatMcpContent(result.content)')
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('Given real stdio MCP server When list_tools runs Then bridge result keeps provenance metadata', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'proma-pi-mcp-extension-'))
    try {
      const serverPath = join(configDir, 'fixture-mcp-server.mjs')
      writeMcpFixtureServer(serverPath)

      const extensionPath = ensurePiMcpExtension({
        configDir,
        servers: {
          docs: {
            type: 'stdio',
            command: process.execPath,
            args: [serverPath],
            enabled: true,
          },
        },
      })
      expect(extensionPath).not.toBeNull()
      if (!extensionPath) throw new Error('Expected Pi MCP extension path')

      const result = await runGeneratedBridgeTool({
        extensionPath,
        toolName: 'mcp__docs__list_tools',
        params: {},
      })

      expect(result.content).toContain('inspect-result')
      expect(result.details).toMatchObject({
        bridgeType: 'proma-pi-mcp-list-tools',
        server: 'docs',
        nativeToolName: 'mcp__docs__list_tools',
        toolCount: 1,
      })
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('Given real stdio MCP server When generated bridge runs Then remote tool preserves structured MCP results', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'proma-pi-mcp-extension-'))
    try {
      const serverPath = join(configDir, 'fixture-mcp-server.mjs')
      writeMcpFixtureServer(serverPath)

      const extensionPath = ensurePiMcpExtension({
        configDir,
        servers: {
          docs: {
            type: 'stdio',
            command: process.execPath,
            args: [serverPath],
            enabled: true,
          },
        },
      })
      expect(extensionPath).not.toBeNull()
      if (!extensionPath) throw new Error('Expected Pi MCP extension path')

      const result = await runGeneratedBridgeTool({
        extensionPath,
        toolName: 'mcp__docs__inspect_result',
        params: { topic: 'alpha' },
      })
      expectStructuredFixtureResult(result, 'alpha')
      expect(result.details).toMatchObject({
        bridgeType: 'proma-pi-mcp-remote-tool',
        server: 'docs',
        toolName: 'inspect-result',
        nativeToolName: 'mcp__docs__inspect_result',
      })
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('Given real stdio MCP server When fallback call_tool runs Then bridge result keeps provenance metadata', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'proma-pi-mcp-extension-'))
    try {
      const serverPath = join(configDir, 'fixture-mcp-server.mjs')
      writeMcpFixtureServer(serverPath)

      const extensionPath = ensurePiMcpExtension({
        configDir,
        servers: {
          docs: {
            type: 'stdio',
            command: process.execPath,
            args: [serverPath],
            enabled: true,
          },
        },
      })
      expect(extensionPath).not.toBeNull()
      if (!extensionPath) throw new Error('Expected Pi MCP extension path')

      const result = await runGeneratedBridgeTool({
        extensionPath,
        toolName: 'mcp__docs__call_tool',
        params: {
          toolName: 'inspect-result',
          arguments: { topic: 'fallback-alpha' },
        },
      })

      expectStructuredFixtureResult(result, 'fallback-alpha')
      expect(result.details).toMatchObject({
        bridgeType: 'proma-pi-mcp-call-tool',
        server: 'docs',
        toolName: 'inspect-result',
        nativeToolName: 'mcp__docs__call_tool',
      })
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('Given real stdio MCP server When generated bridge registers remote tools Then permission risk hints are published', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'proma-pi-mcp-extension-'))
    try {
      const serverPath = join(configDir, 'fixture-mcp-server.mjs')
      writeMcpFixtureServer(serverPath)

      const extensionPath = ensurePiMcpExtension({
        configDir,
        servers: {
          docs: {
            type: 'stdio',
            command: process.execPath,
            args: [serverPath],
            enabled: true,
          },
        },
      })
      expect(extensionPath).not.toBeNull()
      if (!extensionPath) throw new Error('Expected Pi MCP extension path')

      const hints = await runGeneratedBridgeAndCollectRiskHints(extensionPath)

      expect(hints.mcp__docs__inspect_result).toEqual({
        risk: 'read',
        server: 'docs',
        toolName: 'inspect-result',
        description: 'Return every MCP result shape Proma needs to preserve',
      })
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('Given real streamable HTTP MCP server When generated bridge runs Then remote tool preserves structured MCP results', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'proma-pi-mcp-extension-'))
    const httpFixture = await createHttpMcpFixtureServer()
    try {
      const extensionPath = ensurePiMcpExtension({
        configDir,
        servers: {
          docs: {
            type: 'http',
            url: httpFixture.url,
            enabled: true,
          },
        },
      })
      expect(extensionPath).not.toBeNull()
      if (!extensionPath) throw new Error('Expected Pi MCP extension path')

      const result = await runGeneratedBridgeTool({
        extensionPath,
        toolName: 'mcp__docs__inspect_result',
        params: { topic: 'beta' },
      })
      expectStructuredFixtureResult(result, 'beta')
    } finally {
      await httpFixture.close()
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('Given real SSE MCP server When generated bridge runs Then remote tool preserves structured MCP results', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'proma-pi-mcp-extension-'))
    const sseFixture = await createSseMcpFixtureServer()
    try {
      const extensionPath = ensurePiMcpExtension({
        configDir,
        servers: {
          docs: {
            type: 'sse',
            url: sseFixture.url,
            enabled: true,
          },
        },
      })
      expect(extensionPath).not.toBeNull()
      if (!extensionPath) throw new Error('Expected Pi MCP extension path')

      const result = await runGeneratedBridgeTool({
        extensionPath,
        toolName: 'mcp__docs__inspect_result',
        params: { topic: 'gamma' },
      })
      expectStructuredFixtureResult(result, 'gamma')
    } finally {
      await sseFixture.close()
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('Given real Pi RPC process loads bridge When commands are listed Then status command proves remote MCP tools are registered', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'proma-pi-mcp-extension-'))
    let rpc: ReturnType<typeof startPiRpcSession> | null = null
    try {
      const serverPath = join(configDir, 'fixture-mcp-server.mjs')
      writeMcpFixtureServer(serverPath)

      const extensionPath = ensurePiMcpExtension({
        configDir,
        servers: {
          docs: {
            type: 'stdio',
            command: process.execPath,
            args: [serverPath],
            enabled: true,
          },
        },
      })
      expect(extensionPath).not.toBeNull()
      if (!extensionPath) throw new Error('Expected Pi MCP extension path')

      rpc = startPiRpcSession({
        cwd: configDir,
        extensionPaths: [extensionPath],
        runtimeEnv: {
          HOME: configDir,
          PI_AGENT_HOME: join(configDir, '.pi'),
        },
      })
      rpc.send({ id: 'commands-1', type: 'get_commands' })

      const response = await waitForPiRpcResponse({
        events: rpc.events,
        id: 'commands-1',
      })
      expect(response.success).toBe(true)

      const data = response.data as { commands?: Array<{ name?: string; description?: string; source?: string }> }
      const statusCommand = data.commands?.find((command) => command.name === 'proma:mcp_bridge_status')
      expect(statusCommand).toBeDefined()
      expect(statusCommand?.source).toBe('extension')
      expect(statusCommand?.description).toContain('mcp__docs__inspect_result')
      expect(statusCommand?.description).toContain('remote tools: 1')
    } finally {
      rpc?.kill()
      if (rpc) {
        await rpc.done
      }
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('Given MCP tools are discovered When extension is generated Then remote tools are registered as Pi native tools', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'proma-pi-mcp-extension-'))
    try {
      const extensionPath = ensurePiMcpExtension({
        configDir,
        servers: {
          docs: {
            type: 'stdio',
            command: 'node',
            args: ['server.js'],
            enabled: true,
          },
        },
      })
      expect(extensionPath).not.toBeNull()
      if (!extensionPath) throw new Error('Expected Pi MCP extension path')

      const source = readFileSync(extensionPath, 'utf-8')

      expect(source).toContain('async function registerRemoteMcpTools(pi, server)')
      expect(source).toContain('function buildRemoteMcpToolManifest(server, tools)')
      expect(source).toContain('const manifest = buildRemoteMcpToolManifest(server, tools)')
      expect(source).toContain("operation: 'remote_tool'")
      expect(source).toContain("toolName: tool.name")
      expect(source).toContain('await registerRemoteMcpTools(pi, server)')
      expect(source).toContain('pi.registerTool(createRemoteMcpTool(server, item))')
      expect(source).toContain("lines.push('- ' + server.name + ': ' + server.listToolsToolName + ', ' + server.callToolToolName + remoteSummary)")
      expect(source).toContain('function inferMcpToolRisk')
      expect(source).toContain('globalThis.__PROMA_PI_MCP_TOOL_RISK_HINTS__')
      expect(source).toContain('risk: inferMcpToolRisk(item.tool)')
      expect(source).toContain("description: typeof item.tool.description === 'string' ? item.tool.description : ''")
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('Given remote MCP tool names sanitize to the same segment When manifest is built Then native tool names stay unique', () => {
    const manifest = buildPiMcpRemoteToolManifestForTest('docs', [
      { name: 'search-docs', description: 'hyphen' },
      { name: 'search_docs', description: 'underscore' },
      { name: 'search docs', description: 'space' },
    ])

    expect(manifest.map((tool) => tool.nativeToolName)).toEqual([
      'mcp__docs__search_docs',
      'mcp__docs__search_docs_2',
      'mcp__docs__search_docs_3',
    ])
    expect(new Set(manifest.map((tool) => tool.nativeToolName)).size).toBe(3)
    expect(manifest.map((tool) => tool.toolName)).toEqual(['search-docs', 'search_docs', 'search docs'])
  })
})
