import type { AgentRuntimeStateResult } from '@proma/shared'

export interface PiRuntimeStatusRow {
  label: string
  value: string
}

export interface PiRuntimeCommandGroup {
  source: NonNullable<AgentRuntimeStateResult['commands']>[number]['source']
  label: string
  commands: NonNullable<AgentRuntimeStateResult['commands']>
}

type PiRuntimeCommand = NonNullable<AgentRuntimeStateResult['commands']>[number]

const COMMAND_GROUP_LABELS: Record<PiRuntimeCommand['source'], string> = {
  extension: 'Extensions',
  skill: 'Skills',
  prompt: 'Prompts',
  unknown: 'Other',
}

const COMMAND_GROUP_ORDER: PiRuntimeCommand['source'][] = ['extension', 'skill', 'prompt', 'unknown']
const PRIORITY_COMMAND_NAMES = new Set(['proma:ask_user_bridge_status'])

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`
  return `${tokens}`
}

function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`
}

function pushRow(rows: PiRuntimeStatusRow[], label: string, value: string | undefined): void {
  if (!value) return
  rows.push({ label, value })
}

function getRunningLabel(state: AgentRuntimeStateResult): string {
  if (state.isCompacting) return '压缩上下文中'
  if (state.isStreaming) return '流式输出中'
  return '空闲'
}

function getRetryLabel(state: AgentRuntimeStateResult): string | undefined {
  if (state.isRetrying) return '重试中'
  if (state.autoRetryEnabled === true) return '已启用'
  if (state.autoRetryEnabled === false) return '已关闭'
  return undefined
}

function getCompactionLabel(state: AgentRuntimeStateResult): string | undefined {
  if (state.isCompacting) return '压缩中'
  if (state.autoCompactionEnabled === true) return '已启用'
  if (state.autoCompactionEnabled === false) return '已关闭'
  return undefined
}

function getModelLabel(state: AgentRuntimeStateResult): string | undefined {
  if (state.modelName && state.modelId && state.modelName !== state.modelId) {
    return `${state.modelName} (${state.modelId})`
  }
  return state.modelName ?? state.modelId
}

function getQueueLabel(state: AgentRuntimeStateResult): string | undefined {
  if (!state.steeringMode && !state.followUpMode) return undefined
  return `steering ${state.steeringMode ?? '-'} / follow-up ${state.followUpMode ?? '-'}`
}

function getMessageLabel(state: AgentRuntimeStateResult): string | undefined {
  if (state.messageCount == null && state.pendingMessageCount == null) return undefined
  const messageCount = state.messageCount != null ? `${state.messageCount} 条` : '-'
  if (state.pendingMessageCount == null) return messageCount
  return `${messageCount} / 待处理 ${state.pendingMessageCount} 条`
}

function getStatsLabel(state: AgentRuntimeStateResult): string | undefined {
  const stats = state.stats
  if (!stats) return undefined
  const toolCalls = stats.toolCalls ?? 0
  const toolResults = stats.toolResults ?? 0
  const parts = [
    stats.userMessages != null ? `用户 ${stats.userMessages}` : undefined,
    stats.assistantMessages != null ? `助手 ${stats.assistantMessages}` : undefined,
    stats.toolCalls != null || stats.toolResults != null ? `工具 ${toolCalls}/${toolResults}` : undefined,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

function getTokenLabel(state: AgentRuntimeStateResult): string | undefined {
  const tokens = state.stats?.tokens
  if (!tokens) return undefined
  const parts = [
    tokens.total != null ? `${formatTokens(tokens.total)} total` : undefined,
    tokens.input != null ? `输入 ${formatTokens(tokens.input)}` : undefined,
    tokens.output != null ? `输出 ${formatTokens(tokens.output)}` : undefined,
    tokens.cacheRead != null ? `缓存读 ${formatTokens(tokens.cacheRead)}` : undefined,
    tokens.cacheWrite != null ? `缓存写 ${formatTokens(tokens.cacheWrite)}` : undefined,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

function getContextLabel(state: AgentRuntimeStateResult): string | undefined {
  const usage = state.stats?.contextUsage
  if (!usage || usage.tokens == null || usage.maxTokens == null) return undefined
  const percent = usage.percent != null ? ` (${usage.percent.toFixed(1)}%)` : ''
  return `${formatTokens(usage.tokens)} / ${formatTokens(usage.maxTokens)}${percent}`
}

function sortRuntimeCommands(commands: PiRuntimeCommand[]): PiRuntimeCommand[] {
  return [...commands].sort((left, right) => {
    const leftPriority = PRIORITY_COMMAND_NAMES.has(left.name) ? 0 : 1
    const rightPriority = PRIORITY_COMMAND_NAMES.has(right.name) ? 0 : 1
    return leftPriority - rightPriority
  })
}

export function getPiRuntimeStatusRows(state: AgentRuntimeStateResult): PiRuntimeStatusRow[] {
  const rows: PiRuntimeStatusRow[] = []

  pushRow(rows, '运行状态', getRunningLabel(state))
  pushRow(rows, '自动重试', getRetryLabel(state))
  pushRow(rows, '自动压缩', getCompactionLabel(state))
  pushRow(rows, '模型', getModelLabel(state))
  pushRow(rows, 'Provider', state.provider)
  pushRow(rows, 'Thinking', state.thinkingLevel)
  pushRow(rows, '队列', getQueueLabel(state))
  pushRow(rows, '原生会话', state.nativeSessionName)
  pushRow(rows, 'Session ID', state.nativeSessionId)
  pushRow(rows, '消息', getMessageLabel(state))
  pushRow(rows, '统计', getStatsLabel(state))
  pushRow(rows, 'Tokens', getTokenLabel(state))
  pushRow(rows, '上下文', getContextLabel(state))
  pushRow(rows, '成本', state.stats?.costUsd != null ? formatUsd(state.stats.costUsd) : undefined)
  pushRow(rows, 'Session 文件', state.nativeSessionFile)

  return rows
}

export function getPiRuntimeCommandGroups(commands: AgentRuntimeStateResult['commands']): PiRuntimeCommandGroup[] {
  const sourceMap = new Map<PiRuntimeCommand['source'], PiRuntimeCommand[]>()
  for (const command of commands ?? []) {
    const existing = sourceMap.get(command.source) ?? []
    existing.push(command)
    sourceMap.set(command.source, existing)
  }

  return COMMAND_GROUP_ORDER.flatMap((source): PiRuntimeCommandGroup[] => {
    const groupCommands = sourceMap.get(source) ?? []
    if (groupCommands.length === 0) return []
    return [{ source, label: COMMAND_GROUP_LABELS[source], commands: sortRuntimeCommands(groupCommands) }]
  })
}
