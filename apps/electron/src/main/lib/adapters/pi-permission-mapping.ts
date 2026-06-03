import type { PiMcpPermissionRiskHint, PromaPermissionMode } from '@proma/shared'

export type PiPermissionMode = 'safe' | 'ask' | 'allow-all'
export type PiPermissionDangerLevel = 'low' | 'medium' | 'high'

export interface PiPermissionInput {
  mode: PiPermissionMode
  toolName: string
  toolDescription?: string
  mcpRiskHint?: PiMcpPermissionRiskHint
}

export type PiPermissionDecision =
  | { behavior: 'allow' }
  | { behavior: 'ask'; dangerLevel: PiPermissionDangerLevel }

const WORKSPACE_SCOPED_READ_TOOLS = new Set([
  'glob',
  'grep',
  'ls',
  'read',
])

const REMOTE_READ_TOOLS = new Set([
  'webfetch',
  'websearch',
])

const PROGRESS_TOOLS = new Set([
  'taskcreate',
  'taskupdate',
  'taskget',
  'tasklist',
  'taskoutput',
  'todowrite',
])

const WRITE_TOOLS = new Set([
  'edit',
  'multiedit',
  'notebookedit',
  'write',
])

const SHELL_TOOLS = new Set([
  'bash',
  'shell',
])

const MCP_READ_VERBS = new Set([
  'fetch',
  'find',
  'get',
  'inspect',
  'list',
  'lookup',
  'query',
  'read',
  'search',
])

const MCP_MUTATION_WORDS = [
  'append',
  'create',
  'delete',
  'edit',
  'execute',
  'insert',
  'modify',
  'mutate',
  'patch',
  'remove',
  'replace',
  'run',
  'send',
  'update',
  'upload',
  'write',
]

export function mapPiToolPermission(input: PiPermissionInput): PiPermissionDecision {
  const mode = input.mode
  const toolName = normalizeToolName(input.toolName)
  const rawToolName = input.toolName.trim().toLowerCase()

  if (mode === 'allow-all') {
    return { behavior: 'allow' }
  }

  if (rawToolName.startsWith('mcp__') && rawToolName.endsWith('__list_tools')) {
    return { behavior: 'allow' }
  }

  if (input.mcpRiskHint?.risk === 'read') {
    return { behavior: 'allow' }
  }

  if (input.mcpRiskHint?.risk === 'write') {
    return { behavior: 'ask', dangerLevel: 'medium' }
  }

  if (isReadLikeMcpRemoteTool(rawToolName, input.toolDescription)) {
    return { behavior: 'allow' }
  }

  if (WORKSPACE_SCOPED_READ_TOOLS.has(toolName) || REMOTE_READ_TOOLS.has(toolName)) {
    return { behavior: 'allow' }
  }

  if (PROGRESS_TOOLS.has(toolName)) {
    return { behavior: 'allow' }
  }

  if (SHELL_TOOLS.has(toolName)) {
    return { behavior: 'ask', dangerLevel: 'high' }
  }

  if (WRITE_TOOLS.has(toolName)) {
    return { behavior: 'ask', dangerLevel: 'medium' }
  }

  return { behavior: 'ask', dangerLevel: 'medium' }
}

function isReadLikeMcpRemoteTool(toolName: string, description: string | undefined): boolean {
  const parts = toolName.split('__')
  if (parts.length < 3 || parts[0] !== 'mcp') return false
  const mcpToolSegment = parts.slice(2).join('_')
  if (mcpToolSegment === 'call_tool' || mcpToolSegment === 'list_tools') return false

  const firstSegment = mcpToolSegment.split('_')[0] ?? ''
  if (!MCP_READ_VERBS.has(firstSegment)) return false
  if (!description?.trim()) return false

  const descriptionText = description.toLowerCase()
  return !MCP_MUTATION_WORDS.some((word) => descriptionText.includes(word))
}

export function mapPromaPermissionModeToPiMode(mode: PromaPermissionMode): PiPermissionMode {
  switch (mode) {
    case 'bypassPermissions':
      return 'allow-all'
    case 'auto':
      return 'ask'
    case 'plan':
      return 'safe'
    default: {
      const exhaustiveMode: never = mode
      throw new Error(`未映射的 Proma 权限模式：${exhaustiveMode}`)
    }
  }
}

function normalizeToolName(toolName: string): string {
  return toolName.replace(/[\s_-]/g, '').toLowerCase()
}
