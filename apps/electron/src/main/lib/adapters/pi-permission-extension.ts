import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PromaPermissionMode } from '@proma/shared'
import { mapPromaPermissionModeToPiMode } from './pi-permission-mapping'

export interface PiPermissionExtensionConfig {
  configDir: string
  permissionMode: PromaPermissionMode
  allowedDirectories: string[]
}

function normalizeDirectoryPath(dir: string): string {
  return dir.replace(/\\/g, '/').replace(/\/+$/, '')
}

function serializeExtensionValue(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function buildPiPermissionExtensionSource(input: {
  piMode: string
  allowedDirectories: string[]
}): string {
  return `let currentPermissionMode = ${serializeExtensionValue(input.piMode)}
const ALLOWED_DIRECTORIES = ${serializeExtensionValue(input.allowedDirectories)}
const VALID_PERMISSION_MODES = new Set(['safe', 'ask', 'allow-all'])

function normalizeToolName(toolName) {
  return String(toolName || '').replace(/[\\s_-]/g, '').toLowerCase()
}

function normalizePathLike(value) {
  return typeof value === 'string' ? value.replace(/\\\\/g, '/').replace(/\\/+$/, '') : ''
}

function getToolPath(toolName, input) {
  const normalized = normalizeToolName(toolName)
  if (normalized === 'bash' || normalized === 'shell') return ''
  if (typeof input?.path === 'string') return input.path
  if (typeof input?.file_path === 'string') return input.file_path
  if (typeof input?.notebook_path === 'string') return input.notebook_path
  return ''
}

function isPathAllowed(pathValue) {
  const path = normalizePathLike(pathValue)
  if (!path || !path.startsWith('/')) return true
  return ALLOWED_DIRECTORIES.some((dir) => {
    const allowedDir = normalizePathLike(dir)
    return path === allowedDir || path.startsWith(allowedDir + '/')
  })
}

const MCP_READ_VERBS = new Set(['fetch', 'find', 'get', 'inspect', 'list', 'lookup', 'query', 'read', 'search'])
const MCP_MUTATION_WORDS = ['append', 'create', 'delete', 'edit', 'execute', 'insert', 'modify', 'mutate', 'patch', 'remove', 'replace', 'run', 'send', 'update', 'upload', 'write']

function isReadLikeMcpRemoteTool(toolName, description) {
  const rawTool = String(toolName || '').trim().toLowerCase()
  const parts = rawTool.split('__')
  if (parts.length < 3 || parts[0] !== 'mcp') return false
  const mcpToolSegment = parts.slice(2).join('_')
  if (mcpToolSegment === 'call_tool' || mcpToolSegment === 'list_tools') return false

  const firstSegment = mcpToolSegment.split('_')[0] || ''
  if (!MCP_READ_VERBS.has(firstSegment)) return false
  if (typeof description !== 'string' || !description.trim()) return false

  const descriptionText = description.toLowerCase()
  return !MCP_MUTATION_WORDS.some((word) => descriptionText.includes(word))
}

function getToolDescription(input) {
  if (typeof input?.description === 'string') return input.description
  if (typeof input?.toolDescription === 'string') return input.toolDescription
  return ''
}

function getGlobalMcpToolRiskHint(toolName, input) {
  const hints = globalThis.__PROMA_PI_MCP_TOOL_RISK_HINTS__
  if (!hints || typeof hints !== 'object') return undefined
  const rawTool = String(toolName || '').trim().toLowerCase()
  const directHint = hints[rawTool]
  if (directHint) return directHint
  if (!rawTool.endsWith('__call_tool')) return undefined

  const parts = rawTool.split('__')
  const serverName = parts[1] || ''
  const requestedToolName = typeof input?.toolName === 'string' ? input.toolName : ''
  if (!serverName || !requestedToolName) return undefined

  for (const hint of Object.values(hints)) {
    if (hint?.server === serverName && hint?.toolName === requestedToolName) return hint
  }
  return undefined
}

function mapToolPermission(toolName, input) {
  const tool = normalizeToolName(toolName)
  const rawTool = String(toolName || '').trim().toLowerCase()
  const readTools = new Set(['glob', 'grep', 'find', 'ls', 'read', 'webfetch', 'websearch'])
  const progressTools = new Set(['taskcreate', 'taskupdate', 'taskget', 'tasklist', 'taskoutput', 'todowrite'])
  const writeTools = new Set(['edit', 'multiedit', 'notebookedit', 'write'])
  const shellTools = new Set(['bash', 'shell'])

  if (currentPermissionMode === 'allow-all') return { behavior: 'allow', dangerLevel: 'normal' }
  if (rawTool.startsWith('mcp__') && rawTool.endsWith('__list_tools')) return { behavior: 'allow', dangerLevel: 'safe' }
  const mcpRiskHint = getGlobalMcpToolRiskHint(rawTool, input)
  if (mcpRiskHint?.risk === 'read') return { behavior: 'allow', dangerLevel: 'safe' }
  if (mcpRiskHint?.risk === 'write') return { behavior: 'ask', dangerLevel: 'normal' }
  if (isReadLikeMcpRemoteTool(rawTool, getToolDescription(input))) return { behavior: 'allow', dangerLevel: 'safe' }
  if (readTools.has(tool)) return { behavior: 'allow', dangerLevel: 'safe' }
  if (progressTools.has(tool)) return { behavior: 'allow', dangerLevel: 'safe' }
  if (shellTools.has(tool)) return { behavior: 'ask', dangerLevel: 'dangerous' }
  if (writeTools.has(tool)) return { behavior: 'ask', dangerLevel: 'normal' }
  return { behavior: 'ask', dangerLevel: 'normal' }
}

function formatMcpToolDescription(toolName) {
  const parts = String(toolName || '').split('__')
  const serverName = parts[1] || 'unknown'
  const mcpToolName = parts.slice(2).join('__') || 'unknown'
  return '调用 MCP 工具: ' + serverName + ' / ' + mcpToolName
}

function formatDescription(toolName, input) {
  const tool = normalizeToolName(toolName)
  if (String(toolName || '').trim().toLowerCase().startsWith('mcp__')) return formatMcpToolDescription(toolName)
  if (tool === 'bash' && typeof input?.command === 'string') return '执行命令: ' + input.command.slice(0, 200)
  const path = getToolPath(toolName, input)
  if (path && (tool === 'write' || tool === 'edit' || tool === 'notebookedit')) return '修改文件: ' + path
  if (path) return '访问路径: ' + path
  return '使用 Pi 工具: ' + toolName
}

function formatPermissionDescription(toolName, input, decision) {
  const baseDescription = formatDescription(toolName, input)
  const rawTool = String(toolName || '').trim().toLowerCase()
  const mcpRiskHint = getGlobalMcpToolRiskHint(rawTool, input)
  if (mcpRiskHint?.risk === 'read') return baseDescription + '\\n风险提示: MCP 工具看起来是只读查询。'
  if (mcpRiskHint?.risk === 'write') return baseDescription + '\\n风险提示: MCP 工具可能修改远端状态。'
  if (rawTool.startsWith('mcp__') && decision?.dangerLevel === 'normal') return baseDescription + '\\n风险提示: MCP 工具风险未知，请确认远端工具行为。'
  return baseDescription
}

export default function (pi) {
  pi.registerCommand('proma-permission-mode', {
    description: 'Internal Proma command: update Pi permission mode for this runtime.',
    handler: async (args, ctx) => {
      const requestedMode = String(args || '').trim()
      if (!VALID_PERMISSION_MODES.has(requestedMode)) {
        ctx.ui.notify('Proma Pi 权限模式无效: ' + requestedMode, 'error')
        return
      }
      currentPermissionMode = requestedMode
      ctx.ui.notify('Proma Pi 权限模式已切换: ' + currentPermissionMode, 'info')
    },
  })

  pi.on('tool_call', async (event, ctx) => {
    const input = event.input && typeof event.input === 'object' ? event.input : {}
    const toolName = String(event.toolName || '')
    const pathValue = getToolPath(toolName, input)

    if (currentPermissionMode === 'allow-all') return undefined

    if (pathValue && !isPathAllowed(pathValue)) {
      return { block: true, reason: 'Proma 已阻止 Pi 访问工作区允许范围之外的路径: ' + pathValue }
    }

    const decision = mapToolPermission(toolName, input)
    if (decision.behavior === 'allow') return undefined

    if (!ctx.hasUI) {
      return { block: true, reason: 'Proma 权限确认不可用，已阻止 Pi 工具调用: ' + toolName }
    }

    const payload = JSON.stringify({
      promaPermissionRequest: true,
      toolName,
      toolInput: input,
      description: formatPermissionDescription(toolName, input, decision),
      command: typeof input.command === 'string' ? input.command : undefined,
      dangerLevel: decision.dangerLevel,
      piPermissionMode: currentPermissionMode,
      toolCallId: event.toolCallId,
    })
    const confirmed = await ctx.ui.confirm('Proma Pi 权限确认', payload)
    if (!confirmed) {
      return { block: true, reason: '用户拒绝了此操作' }
    }

    return undefined
  })
}
`
}

export function ensurePiPermissionExtension(config: PiPermissionExtensionConfig): string {
  const extensionDir = join(config.configDir, 'proma-extensions')
  mkdirSync(extensionDir, { recursive: true })

  const extensionPath = join(extensionDir, 'proma-permission-bridge.mjs')
  const source = buildPiPermissionExtensionSource({
    piMode: mapPromaPermissionModeToPiMode(config.permissionMode),
    allowedDirectories: config.allowedDirectories.map(normalizeDirectoryPath),
  })
  writeFileSync(extensionPath, source, 'utf-8')
  return extensionPath
}

export function buildPiPermissionExtensionSourceForTest(input: {
  piMode: string
  allowedDirectories: string[]
}): string {
  return buildPiPermissionExtensionSource(input)
}
