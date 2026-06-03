import type { PiMcpPermissionRiskHint } from '@proma/shared'

export interface PermissionRiskBadge {
  label: string
  description?: string
  className: string
}

const RISK_BADGE_STYLES: Record<PiMcpPermissionRiskHint['risk'], string> = {
  read: 'bg-green-500/10 text-green-700 dark:text-green-300',
  write: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  unknown: 'bg-muted text-muted-foreground',
}

const RISK_BADGE_LABELS: Record<PiMcpPermissionRiskHint['risk'], string> = {
  read: '只读 MCP',
  write: '可能修改远端',
  unknown: '风险未知',
}

function getRiskBadgeDescription(hint: PiMcpPermissionRiskHint): string | undefined {
  if (hint.server && hint.toolName) return `${hint.server} / ${hint.toolName}`
  return hint.description
}

export function getPermissionRiskBadge(hint: PiMcpPermissionRiskHint | undefined): PermissionRiskBadge | undefined {
  if (!hint) return undefined
  return {
    label: RISK_BADGE_LABELS[hint.risk],
    description: getRiskBadgeDescription(hint),
    className: RISK_BADGE_STYLES[hint.risk],
  }
}
