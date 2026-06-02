import type { PiNativeSessionSummary } from '@proma/shared'

const TITLE_MAX_LENGTH = 42

export function getPiNativeSessionDisplayTitle(summary: PiNativeSessionSummary): string {
  const normalized = (summary.sessionName ?? summary.firstUserMessage)?.replace(/\s+/g, ' ').trim()
  if (normalized) {
    return normalized.length > TITLE_MAX_LENGTH
      ? `${normalized.slice(0, TITLE_MAX_LENGTH)}...`
      : normalized
  }

  return `Pi session ${summary.id.slice(0, 8)}`
}

export function formatPiNativeSessionCwd(cwd: string | undefined): string {
  if (!cwd) return '未知目录'
  const normalized = cwd.replace(/\/+$/, '')
  const parts = normalized.split('/').filter(Boolean)
  return parts.at(-1) ?? cwd
}

export function formatPiNativeSessionTime(updatedAt: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(updatedAt))
}
