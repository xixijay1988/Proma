import * as React from 'react'
import { Input } from '@/components/ui/input'
import {
  formatContextWindowInput,
  parseContextWindowInput,
} from '@proma/shared'

interface ModelContextWindowFieldProps {
  modelId: string
  value?: number
  onValidChange: (value: number | undefined) => void
  onValidityChange: (modelId: string, valid: boolean) => void
}

/** Inline context-window draft input; invalid drafts are never written to channel configuration. */
export function ModelContextWindowField({
  modelId,
  value,
  onValidChange,
  onValidityChange,
}: ModelContextWindowFieldProps): React.ReactElement {
  const [draft, setDraft] = React.useState(() => formatContextWindowInput(value))
  const [error, setError] = React.useState<string>()
  const focusedRef = React.useRef(false)

  React.useEffect(() => {
    if (!focusedRef.current) setDraft(formatContextWindowInput(value))
  }, [value])

  React.useEffect(() => {
    onValidityChange(modelId, true)
  }, [modelId, onValidityChange])

  const validate = React.useCallback((nextDraft: string): boolean => {
    const parsed = parseContextWindowInput(nextDraft)
    if (!parsed.ok) {
      setError(parsed.error)
      onValidityChange(modelId, false)
      return false
    }

    setError(undefined)
    onValidityChange(modelId, true)
    onValidChange(parsed.value)
    return true
  }, [modelId, onValidChange, onValidityChange])

  return (
    <div className="mt-2 ml-5 space-y-1.5" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center gap-2">
        <label htmlFor={`context-window-${modelId}`} className="w-24 shrink-0 text-xs text-muted-foreground">
          上下文大小
        </label>
        <Input
          id={`context-window-${modelId}`}
          value={draft}
          onFocus={() => { focusedRef.current = true }}
          onChange={(event) => {
            const nextDraft = event.target.value
            setDraft(nextDraft)
            validate(nextDraft)
          }}
          onBlur={() => {
            focusedRef.current = false
            const parsed = parseContextWindowInput(draft)
            if (parsed.ok) setDraft(formatContextWindowInput(parsed.value))
          }}
          placeholder="自动（如 256K、1.05M）"
          aria-invalid={Boolean(error)}
          className="h-7 max-w-56 text-xs"
        />
      </div>
      {error ? (
        <p className="pl-[6.5rem] text-xs text-destructive">{error}</p>
      ) : (
        <p className="pl-[6.5rem] text-[11px] leading-4 text-muted-foreground">
          留空则自动识别；不会扩大供应商真实能力
        </p>
      )}
    </div>
  )
}
