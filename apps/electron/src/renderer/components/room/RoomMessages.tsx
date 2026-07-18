import * as React from 'react'
import { CheckCircle2, ChevronRight, Circle, Loader2, MessageSquareText, RotateCw, XCircle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { RoomMemberConfig, RoomMessage, RoomProgressItem } from '@proma/shared'
import { cn } from '@/lib/utils'
import { getToolDisplayName, getToolIcon } from '@/components/agent/tool-utils'
import { buildRoomMessageItems } from './room-view-model'

export interface RoomMessagesProps {
  messages: RoomMessage[]
  members: RoomMemberConfig[]
}

type RoomProcessStatus = 'running' | 'completed' | 'error'

interface RoomProcessStep {
  id: string
  label: string
  detail?: string
  status: RoomProcessStatus
  icon: LucideIcon
}

function normalizeRoomToolName(name: string): string {
  const lower = name.toLowerCase()
  const map: Record<string, string> = {
    bash: 'Bash',
    read: 'Read',
    write: 'Write',
    edit: 'Edit',
    grep: 'Grep',
    glob: 'Glob',
  }
  return map[lower] ?? name
}

function getToolNameFromProgress(content: string): string | null {
  const match = content.match(/^开始使用工具：([^·\s]+)/)
  return match?.[1]?.trim() ?? null
}

function getToolDetailFromProgress(content: string): string | undefined {
  const detail = content.split('·').slice(1).join('·').trim()
  return detail || undefined
}

function buildRoomProcessSteps(progress: RoomProgressItem[], streaming: boolean): RoomProcessStep[] {
  const steps: RoomProcessStep[] = []

  for (const item of progress) {
    if (item.kind === 'tool') {
      if (item.content === '工具执行完成') {
        const lastRunningTool = [...steps].reverse().find((step) => step.status === 'running')
        if (lastRunningTool) {
          lastRunningTool.status = 'completed'
        } else {
          steps.push({
            id: item.id,
            label: '工具执行完成',
            status: 'completed',
            icon: CheckCircle2,
          })
        }
        continue
      }

      const toolName = getToolNameFromProgress(item.content)
      if (toolName) {
        const normalizedName = normalizeRoomToolName(toolName)
        const ToolIcon = getToolIcon(normalizedName)
        steps.push({
          id: item.id,
          label: getToolDisplayName(normalizedName),
          detail: getToolDetailFromProgress(item.content),
          status: 'running',
          icon: ToolIcon,
        })
        continue
      }
    }

    steps.push({
      id: item.id,
      label: item.content,
      status: item.kind === 'error' ? 'error' : streaming ? 'running' : 'completed',
      icon: item.kind === 'retry' ? RotateCw : item.kind === 'text' ? MessageSquareText : Circle,
    })
  }

  if (!streaming) {
    return steps.map((step) => step.status === 'running' ? { ...step, status: 'completed' } : step)
  }
  return steps
}

function getRoomProcessSummary(steps: RoomProcessStep[], progress: RoomProgressItem[], streaming: boolean): string {
  const toolCount = steps.filter((step) => step.icon !== MessageSquareText && step.icon !== Circle && step.icon !== RotateCw).length
  const hasError = steps.some((step) => step.status === 'error')
  if (hasError) return `执行过程：${progress.length} 条，存在错误`
  if (toolCount > 0) return `执行过程：${toolCount} 次工具调用`
  if (streaming) return '执行过程：正在思考'
  return `执行过程：${progress.length} 条消息`
}

interface RoomProcessGroupProps {
  progress: RoomProgressItem[]
  streaming: boolean
}

function RoomProcessGroup({ progress, streaming }: RoomProcessGroupProps): React.ReactElement {
  const steps = React.useMemo(() => buildRoomProcessSteps(progress, streaming), [progress, streaming])
  const [expanded, setExpanded] = React.useState(streaming)
  const userToggledRef = React.useRef(false)

  React.useEffect(() => {
    if (streaming && !userToggledRef.current) setExpanded(true)
    if (!streaming && !userToggledRef.current) setExpanded(false)
  }, [streaming])

  const summary = getRoomProcessSummary(steps, progress, streaming)
  const latest = steps.at(-1)

  return (
    <div className="mt-2 space-y-1.5 text-left">
      <button
        type="button"
        className="group flex max-w-full items-center gap-2 py-0.5 text-left transition-opacity hover:opacity-75"
        onClick={() => {
          userToggledRef.current = true
          setExpanded((prev) => !prev)
        }}
      >
        <ChevronRight
          className={cn(
            'size-3 shrink-0 text-muted-foreground/45 transition-transform duration-150',
            expanded && 'rotate-90',
          )}
        />
        {streaming ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-primary/60" />
        ) : steps.some((step) => step.status === 'error') ? (
          <XCircle className="size-3.5 shrink-0 text-destructive/70" />
        ) : (
          <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600/70" />
        )}
        <span className="min-w-0 truncate text-[13px] text-muted-foreground">{summary}</span>
        {streaming && latest && (
          <span className="hidden min-w-0 truncate text-[12px] text-muted-foreground/60 sm:inline">
            {latest.label}
          </span>
        )}
      </button>

      {expanded && (
        <div className="ml-[5px] space-y-2 border-l-2 border-border/35 pl-4">
          {steps.map((step) => {
            const StepIcon = step.icon
            const isRunning = step.status === 'running'
            return (
              <div key={step.id} className="flex min-w-0 items-start gap-2 text-[12px] leading-5 text-muted-foreground">
                {isRunning ? (
                  <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-primary/55" />
                ) : step.status === 'error' ? (
                  <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive/70" />
                ) : (
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600/65" />
                )}
                <StepIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/60" />
                <div className="min-w-0">
                  <div className={cn('truncate', step.status === 'error' && 'text-destructive')}>
                    {step.label}
                  </div>
                  {step.detail && (
                    <div className="truncate text-[11px] text-muted-foreground/55">{step.detail}</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function RoomMessages({ messages, members }: RoomMessagesProps): React.ReactElement {
  const items = React.useMemo(() => buildRoomMessageItems({ messages, members }), [messages, members])
  const bottomRef = React.useRef<HTMLDivElement | null>(null)
  const scrollKey = items.map((item) => `${item.id}:${item.status}:${item.progress?.length ?? 0}`).join('|')

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [scrollKey])

  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <div className="max-w-sm rounded-3xl bg-muted/40 px-6 py-5 shadow-sm">
          <p className="text-sm font-medium text-foreground">Room 还很安静</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            试试输入 <span className="font-medium text-foreground">@成员名</span> 直接唤起 Agent，或发一条普通消息让监听成员生成草稿。
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 px-5 py-5">
      {items.map((item) => (
        <div key={item.id} className={cn('flex gap-3', item.align === 'right' && 'flex-row-reverse')}>
          <div className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-muted text-xs font-semibold shadow-sm">
            {item.speakerAvatar}
          </div>
          <div className={cn('max-w-[72%]', item.align === 'right' && 'items-end text-right')}>
            <div className="mb-1 text-xs text-muted-foreground">{item.speakerName}</div>
            <div
              className={cn(
                'whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-6 shadow-sm',
                item.align === 'right'
                  ? 'bg-primary text-primary-foreground rounded-tr-md'
                  : 'bg-card text-card-foreground rounded-tl-md',
              )}
            >
              {item.content}
            </div>
            {item.status === 'streaming' && (
              <div className="mt-1 text-[11px] text-muted-foreground">正在思考中...</div>
            )}
            {item.progress && item.progress.length > 0 && (
              <RoomProcessGroup progress={item.progress} streaming={item.status === 'streaming'} />
            )}
            {item.status === 'error' && (
              <div className="mt-1 text-[11px] text-destructive">运行失败，请检查成员渠道或权限配置</div>
            )}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
