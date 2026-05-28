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

const READ_ONLY_TOOLS = new Set([
  'glob',
  'grep',
  'ls',
  'read',
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

  if (READ_ONLY_TOOLS.has(toolName)) {
    return { behavior: 'allow' }
  }

  if (mode === 'allow-all') {
    return { behavior: 'allow', requireScopeCheck: true }
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
  }
}

function normalizeToolName(toolName: string): string {
  return toolName.replace(/[\s_-]/g, '').toLowerCase()
}
