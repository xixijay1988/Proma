import * as React from 'react'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
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
    <div className="w-44 shrink-0 space-y-1" onClick={(event) => event.stopPropagation()}>
      <Tooltip>
        <TooltipTrigger asChild>
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
            placeholder="自动（256K / 1.05M）"
            aria-label={`${modelId} 上下文大小`}
            aria-invalid={Boolean(error)}
            className="h-7 w-full text-xs"
          />
        </TooltipTrigger>
        <TooltipContent side="top">留空则自动识别；不会扩大供应商真实能力</TooltipContent>
      </Tooltip>
      {error && <p className="text-xs leading-4 text-destructive">{error}</p>}
    </div>
  )
}
