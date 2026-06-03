import * as React from 'react'
import type { AgentRuntimeStateResult } from '@proma/shared'
import { Activity, AlertCircle, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  getPiRuntimeCommandGroups,
  getPiRuntimeStatusRows,
} from './pi-runtime-status-ui.ts'

interface PiRuntimeStatusPopoverProps {
  sessionId: string
  streaming: boolean
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function StatusRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-foreground/90">{value}</span>
    </div>
  )
}

function CommandSourceBadge({ source }: { source: string }): React.ReactElement {
  const className = source === 'skill'
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    : source === 'extension'
      ? 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300'
      : source === 'prompt'
        ? 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300'
        : 'border-muted-foreground/20 bg-muted text-muted-foreground'

  return (
    <Badge variant="outline" className={cn('h-5 shrink-0 px-1.5 text-[10px] font-medium', className)}>
      {source}
    </Badge>
  )
}

export function PiRuntimeStatusPopover({ sessionId, streaming }: PiRuntimeStatusPopoverProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [state, setState] = React.useState<AgentRuntimeStateResult | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const loadRuntimeState = React.useCallback(async (): Promise<void> => {
    if (!streaming) {
      setState(null)
      setError('Pi runtime 仅在会话运行中提供实时状态')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const nextState = await window.electronAPI.getRuntimeState({ sessionId })
      setState(nextState)
    } catch (loadError) {
      console.error('[PiRuntimeStatusPopover] 获取 Pi runtime 状态失败:', loadError)
      setError(getErrorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [sessionId, streaming])

  const handleOpenChange = React.useCallback((nextOpen: boolean): void => {
    setOpen(nextOpen)
    if (nextOpen) {
      void loadRuntimeState()
    }
  }, [loadRuntimeState])

  const rows = React.useMemo(() => state ? getPiRuntimeStatusRows(state) : [], [state])
  const commandGroups = React.useMemo(() => getPiRuntimeCommandGroups(state?.commands), [state?.commands])
  const commandCount = state?.commands?.length ?? 0

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-[36px] shrink-0 rounded-full text-cyan-700 hover:bg-cyan-500/10 hover:text-cyan-800 dark:text-cyan-300 dark:hover:text-cyan-200"
            >
              <Activity className="size-4" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>Pi runtime 状态</p>
        </TooltipContent>
      </Tooltip>

      <PopoverContent
        side="top"
        align="start"
        className="w-[380px] max-w-[calc(100vw-2rem)] p-2.5"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-medium text-foreground">Pi runtime 状态</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              实时读取 Pi RPC get_state / get_commands
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 rounded-full"
            onClick={() => void loadRuntimeState()}
            disabled={loading}
          >
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          </Button>
        </div>

        <div className="mt-3 max-h-[360px] overflow-y-auto pr-1">
          {loading && !state ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              正在读取 runtime 状态...
            </div>
          ) : error ? (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0 break-words">{error}</span>
            </div>
          ) : state ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                {rows.map((row) => (
                  <StatusRow key={row.label} label={row.label} value={row.value} />
                ))}
              </div>

              <div className="h-px bg-border" />

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-foreground">命令 / Skills / Extensions</span>
                  <span className="text-[11px] text-muted-foreground">{commandCount} 个</span>
                </div>

                {commandGroups.length === 0 ? (
                  <div className="rounded-md bg-muted/60 px-2 py-3 text-center text-xs text-muted-foreground">
                    当前 runtime 未返回命令
                  </div>
                ) : (
                  <div className="space-y-2">
                    {commandGroups.map((group) => (
                      <div key={group.source} className="space-y-1">
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>{group.label}</span>
                          <span>{group.commands.length}</span>
                        </div>
                        <div className="space-y-1">
                          {group.commands.slice(0, 8).map((command) => (
                            <div
                              key={`${group.source}:${command.name}`}
                              className="rounded-md bg-muted/50 px-2 py-1.5"
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                <CommandSourceBadge source={command.source} />
                                <span className="min-w-0 truncate font-mono text-[11px] text-foreground">
                                  {command.name}
                                </span>
                              </div>
                              {command.description && (
                                <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                                  {command.description}
                                </div>
                              )}
                            </div>
                          ))}
                          {group.commands.length > 8 && (
                            <div className="px-2 text-[11px] text-muted-foreground">
                              还有 {group.commands.length - 8} 个未展开
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-muted-foreground">打开后读取 runtime 状态</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
