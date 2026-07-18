export const MIN_CUSTOM_CONTEXT_WINDOW = 1_000
export const MAX_CUSTOM_CONTEXT_WINDOW = 10_000_000

export type ContextWindowInputResult =
  | { ok: true; value: number | undefined }
  | { ok: false; error: string }

const CONTEXT_WINDOW_PATTERN = /^(\d+(?:\.\d+)?)\s*([km])?$/i

/**
 * Parse a user-entered model context window.
 *
 * Supports plain and comma-separated numbers plus case-insensitive K/M suffixes.
 * Returns integer tokens; an empty input removes the override and restores automatic resolution.
 */
export function parseContextWindowInput(input: string): ContextWindowInputResult {
  const normalized = input.trim().replace(/,/g, '')
  if (!normalized) return { ok: true, value: undefined }

  const match = normalized.match(CONTEXT_WINDOW_PATTERN)
  if (!match) {
    return { ok: false, error: '请输入数字，或使用 K/M 单位，例如 256K、1.05M' }
  }

  const numericValue = Number(match[1])
  const unit = match[2]?.toLowerCase()
  const multiplier = unit === 'm' ? 1_000_000 : unit === 'k' ? 1_000 : 1
  const value = Math.round(numericValue * multiplier)

  if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
    return { ok: false, error: '上下文大小不是有效的整数 token' }
  }
  if (value < MIN_CUSTOM_CONTEXT_WINDOW) {
    return { ok: false, error: '上下文大小不能小于 1K' }
  }
  if (value > MAX_CUSTOM_CONTEXT_WINDOW) {
    return { ok: false, error: '上下文大小不能超过 10M' }
  }

  return { ok: true, value }
}

/** Format integer tokens for display in the model configuration input. */
export function formatContextWindowInput(value: number | undefined): string {
  if (value === undefined) return ''

  if (value >= 1_000_000) {
    const millions = value / 1_000_000
    const rounded = Number(millions.toFixed(2))
    if (Math.round(rounded * 1_000_000) === value) return `${rounded}M`
  }

  if (value % 1_000 === 0) return `${value / 1_000}K`
  return value.toLocaleString('en-US')
}
