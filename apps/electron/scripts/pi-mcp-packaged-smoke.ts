#!/usr/bin/env bun
/**
 * Pi MCP packaged smoke
 *
 * 验证打包后的 Proma.app 中，Pi RPC 子进程能加载 Proma MCP bridge
 * 所需的 unpacked 依赖，并通过真实 stdio MCP server 暴露远端 MCP tool。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  defaultPackagedAppPath,
  type PackagedSmokePlatform,
  resolvePackagedSmokePaths,
} from './pi-mcp-packaged-paths.ts'

interface SmokeOptions {
  appPath: string
  keepTemp: boolean
  platform: PackagedSmokePlatform
}

interface SmokeCheck {
  label: string
  path: string
}

function parseArgs(): SmokeOptions {
  const args = process.argv.slice(2)
  const appArgIndex = args.indexOf('--app')
  const platformArgIndex = args.indexOf('--platform')
  const platform = parsePlatformArg(platformArgIndex >= 0 ? args[platformArgIndex + 1] : undefined)

  return {
    appPath: appArgIndex >= 0 && args[appArgIndex + 1]
      ? args[appArgIndex + 1]
      : defaultPackagedAppPath({ cwd: process.cwd(), platform, arch: process.arch }),
    keepTemp: args.includes('--keep-temp'),
    platform,
  }
}

function parsePlatformArg(value: string | undefined): PackagedSmokePlatform {
  if (!value) return process.platform
  if (value === 'darwin' || value === 'mac' || value === 'macos') return 'darwin'
  if (value === 'win32' || value === 'win' || value === 'windows') return 'win32'
  if (value === 'linux') return 'linux'
  throw new Error(`不支持的 --platform 参数: ${value}`)
}

function assertRequiredPaths(checks: SmokeCheck[]): void {
  const missing = checks.filter((check) => !existsSync(check.path))
  if (missing.length === 0) return

  const details = missing.map((check) => `- ${check.label}: ${check.path}`).join('\n')
  throw new Error(`打包产物缺少 Pi MCP smoke 必需文件：\n${details}`)
}

export function buildRunnerSource(): string {
  return `import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

function resolveResourcesPath() {
  if (process.platform === 'darwin') {
    return join(dirname(dirname(process.execPath)), 'Resources')
  }
  return join(dirname(process.execPath), 'resources')
}

const resourcesPath = resolveResourcesPath()
const appAsarPath = join(resourcesPath, 'app.asar')
const appUnpackedPath = join(resourcesPath, 'app.asar.unpacked')
const packageRequire = createRequire(join(appAsarPath, 'dist', 'main.cjs'))

function resolveImportUrl(specifier) {
  return pathToFileURL(packageRequire.resolve(specifier)).href
}

function assertExists(label, filePath) {
  if (!existsSync(filePath)) {
    throw new Error(label + ' 不存在: ' + filePath)
  }
}

function writeFixtureServer(serverPath) {
  writeFileSync(serverPath, \`import { Server } from \${JSON.stringify(resolveImportUrl('@modelcontextprotocol/sdk/server/index.js'))}
import { StdioServerTransport } from \${JSON.stringify(resolveImportUrl('@modelcontextprotocol/sdk/server/stdio.js'))}
import { CallToolRequestSchema, ListToolsRequestSchema } from \${JSON.stringify(resolveImportUrl('@modelcontextprotocol/sdk/types.js'))}

const server = new Server(
  { name: 'proma-packaged-mcp-fixture', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'inspect-result',
    description: 'Packaged Pi MCP bridge smoke tool',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string' },
      },
      required: ['topic'],
    },
  }],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => ({
  content: [{ type: 'text', text: 'packaged-topic=' + (request.params.arguments?.topic ?? 'missing') }],
  structuredContent: { ok: true, packaged: true },
}))

await server.connect(new StdioServerTransport())
\`, 'utf-8')
}

function writeBridgeExtension(extensionPath, serverPath) {
  writeFileSync(extensionPath, \`import { Client } from \${JSON.stringify(resolveImportUrl('@modelcontextprotocol/sdk/client/index.js'))}
import { StdioClientTransport } from \${JSON.stringify(resolveImportUrl('@modelcontextprotocol/sdk/client/stdio.js'))}
import { Type } from \${JSON.stringify(resolveImportUrl('typebox'))}

const SERVER_PATH = \${JSON.stringify(serverPath)}
let client

async function getClient() {
  if (client) return client
  client = new Client({ name: 'proma-packaged-pi-mcp-smoke', version: '1.0.0' })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
    },
    stderr: 'pipe',
  })
  await client.connect(transport)
  return client
}

export default async function (pi) {
  const activeClient = await getClient()
  const result = await activeClient.listTools()
  const tools = Array.isArray(result.tools) ? result.tools : []
  const hasInspectTool = tools.some((tool) => tool.name === 'inspect-result')
  if (!hasInspectTool) {
    throw new Error('MCP fixture did not expose inspect-result')
  }

  pi.registerTool({
    name: 'mcp__docs__inspect_result',
    label: 'MCP docs / inspect-result',
    description: 'Packaged smoke MCP tool',
    parameters: Type.Object({
      topic: Type.String({ description: 'smoke topic' }),
    }),
    async execute(_toolCallId, params) {
      const toolResult = await activeClient.callTool({
        name: 'inspect-result',
        arguments: params ?? {},
      })
      return {
        content: toolResult.content,
        structuredContent: toolResult.structuredContent,
        details: {
          server: 'docs',
          toolName: 'inspect-result',
          nativeToolName: 'mcp__docs__inspect_result',
          structuredContent: toolResult.structuredContent,
        },
      }
    },
  })

  pi.registerCommand('proma:mcp_bridge_status', {
    description: 'Proma Pi MCP bridge 已加载。\\\\n- docs: remote tools: 1\\\\n  - mcp__docs__inspect_result -> inspect-result',
    async handler(_args, ctx) {
      ctx.sendMessage({
        customType: 'proma_mcp_bridge_status',
        content: 'mcp__docs__inspect_result',
        display: 'mcp__docs__inspect_result',
      })
    },
  })

  pi.on('session_shutdown', async () => {
    if (!client) return
    await client.close()
    client = undefined
  })
}
\`, 'utf-8')
}

function readJsonLines(stream, onEvent) {
  let buffer = ''
  stream.on('data', (chunk) => {
    buffer += chunk.toString('utf8')
    let index = buffer.indexOf('\\n')
    while (index !== -1) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      index = buffer.indexOf('\\n')
      if (!line) continue
      try {
        onEvent(JSON.parse(line))
      } catch (error) {
        onEvent({ type: 'protocol_error', raw: line, error: error instanceof Error ? error.message : String(error) })
      }
    }
  })
}

async function waitForCommandResponse(child, commandId) {
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('等待 Pi RPC get_commands 响应超时。stderr=' + stderr))
    }, 15_000)

    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
    })

    readJsonLines(child.stdout, (event) => {
      if (event.type === 'response' && event.id === commandId) {
        clearTimeout(timeout)
        resolve({ event, stderr })
      }
      if (event.type === 'protocol_error') {
        clearTimeout(timeout)
        reject(new Error('Pi RPC 协议输出异常: ' + event.raw))
      }
    })

    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      if (code === null && signal === 'SIGTERM') return
      clearTimeout(timeout)
      reject(new Error('Pi RPC 提前退出: code=' + code + ', signal=' + signal + ', stderr=' + stderr))
    })
  })
}

async function main() {
  const piCliPath = join(appUnpackedPath, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js')
  assertExists('Pi CLI', piCliPath)
  assertExists('MCP SDK package', join(appUnpackedPath, 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json'))
  assertExists('typebox package', join(appUnpackedPath, 'node_modules', 'typebox', 'package.json'))

  const tempDir = mkdtempSync(join(tmpdir(), 'proma-packaged-pi-mcp-'))
  try {
    const serverPath = join(tempDir, 'fixture-mcp-server.mjs')
    const extensionPath = join(tempDir, 'proma-packaged-mcp-bridge.mjs')
    writeFixtureServer(serverPath)
    writeBridgeExtension(extensionPath, serverPath)

    const child = spawn(process.execPath, [piCliPath, '--mode', 'rpc', '--no-session', '--extension', extensionPath], {
      cwd: tempDir,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        HOME: tempDir,
        PI_AGENT_HOME: join(tempDir, '.pi'),
        PI_TELEMETRY: '0',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    child.stdin.write(JSON.stringify({ id: 'commands-1', type: 'get_commands' }) + '\\n')
    const { event, stderr } = await waitForCommandResponse(child, 'commands-1')
    child.kill('SIGTERM')

    if (!event.success) {
      throw new Error('get_commands 返回失败: ' + JSON.stringify(event) + '\\nstderr=' + stderr)
    }

    const commands = Array.isArray(event.data?.commands) ? event.data.commands : []
    const statusCommand = commands.find((command) => command.name === 'proma:mcp_bridge_status')
    if (!statusCommand) {
      throw new Error('未发现 proma:mcp_bridge_status command: ' + JSON.stringify(commands))
    }
    if (!String(statusCommand.description ?? '').includes('mcp__docs__inspect_result')) {
      throw new Error('status command 未包含 MCP remote tool: ' + JSON.stringify(statusCommand))
    }

    console.log(JSON.stringify({
      ok: true,
      command: statusCommand.name,
      tool: 'mcp__docs__inspect_result',
      resourcesPath,
    }))
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

await main()
`
}

async function main(): Promise<void> {
  const options = parseArgs()
  const paths = resolvePackagedSmokePaths({
    appPath: options.appPath,
    platform: options.platform,
  })

  assertRequiredPaths([
    { label: 'Proma packaged app', path: paths.appPath },
    { label: 'Proma executable', path: paths.executablePath },
    { label: 'app.asar', path: paths.appAsarPath },
    {
      label: 'Pi CLI',
      path: join(paths.appUnpackedPath, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js'),
    },
    {
      label: 'MCP SDK package',
      path: join(paths.appUnpackedPath, 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json'),
    },
    {
      label: 'typebox package',
      path: join(paths.appUnpackedPath, 'node_modules', 'typebox', 'package.json'),
    },
  ])

  const tempDir = mkdtempSync(join(tmpdir(), 'proma-packaged-smoke-runner-'))
  try {
    const runnerPath = join(tempDir, 'runner.mjs')
    writeFileSync(runnerPath, buildRunnerSource(), 'utf-8')

    const result = spawnSync(paths.executablePath, [runnerPath], {
      cwd: tempDir,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        PI_TELEMETRY: '0',
      },
      encoding: 'utf-8',
      timeout: 30_000,
    })

    if (result.status !== 0) {
      throw new Error([
        'Pi MCP packaged smoke 失败。',
        `status=${result.status}`,
        `signal=${result.signal ?? ''}`,
        `stdout=${result.stdout}`,
        `stderr=${result.stderr}`,
      ].join('\n'))
    }

    console.log(result.stdout.trim())
  } finally {
    if (!options.keepTemp) {
      rmSync(tempDir, { recursive: true, force: true })
    } else {
      console.log(`保留 smoke 临时目录: ${tempDir}`)
    }
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
