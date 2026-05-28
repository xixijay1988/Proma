import type { PromaPermissionMode } from '@proma/shared'

export type PiPermissionMode = 'safe' | 'ask' | 'allow-all'
export type PiPermissionDangerLevel = 'low' | 'medium' | 'high'

export interface PiPermissionInput {
  mode: PiPermissionMode
  toolName: string
}

export type PiPermissionDecision =
  | { behavior: 'allow'; requireScopeCheck?: true }
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

export function mapPiToolPermission(input: PiPermissionInput): PiPermissionDecision {
  const mode = input.mode
  const toolName = normalizeToolName(input.toolName)

  if (mode === 'allow-all') {
    if (REMOTE_READ_TOOLS.has(toolName)) {
      return { behavior: 'allow' }
    }

    return { behavior: 'allow', requireScopeCheck: true }
  }

  if (WORKSPACE_SCOPED_READ_TOOLS.has(toolName) || REMOTE_READ_TOOLS.has(toolName)) {
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
