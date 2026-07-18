/**
 * Room 编排层
 *
 * MVP 阶段先负责 Room 消息落盘、@ 成员路由和监听草稿生成。
 * 后续会在这里接入真实 Agent runtime 与 LLM 评分。
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { DEFAULT_ROOM_CHANNEL_ID } from '@proma/shared'
import type {
  AgentSessionMeta,
  AgentSendInput,
  RoomDraft,
  RoomMemberConfig,
  RoomMessage,
  RoomProgressItem,
  RoomRoutingDecision,
  RoomSendMessageInput,
  RoomUpdateDraftInput,
  SDKAssistantMessage,
  SDKMessage,
  SDKSystemMessage,
  SDKTextBlock,
  SDKToolResultBlock,
  SDKToolUseBlock,
  SDKToolUseSummaryMessage,
  SDKUserMessage,
} from '@proma/shared'
import { readJsonFileSafe, writeJsonFileAtomic } from './safe-file'
import { getAgentSessionsDir, getAgentSessionsIndexPath, getWorkspaceFilesDir } from './config-paths'
import { resolveAgentEngine } from './agent-engine'
import { getAgentWorkspace } from './agent-workspace-manager'
import { getSettings } from './settings-service'
import {
  appendRoomMessage,
  getRoomMessages,
  getRoomSummary,
  listRoomDrafts,
  listRoomMembers,
  saveRoomDraft,
  saveRoomMessages,
} from './room-manager'
import { parseRoomDirectives } from './room-directives'

interface AgentSessionsIndexFile {
  version: number
  sessions: AgentSessionMeta[]
}

export type RoomAgentTriggerType = 'mention' | 'routing-send' | 'agent-mention'

export interface RoomAgentRunPlan {
  roomId: string
  roomChannelId: string
  memberId: string
  memberName: string
  sourceMessageId: string
  outputMessageId: string
  triggerType: RoomAgentTriggerType
  channelId?: string
  modelId?: string
  workspaceId?: string
  agentEngine?: RoomMemberConfig['agentEngine']
  permissionMode?: RoomMemberConfig['permissionMode']
  disallowedTools?: string[]
  systemPrompt: string
  prompt: string
}

const ROOM_COORDINATOR_DISALLOWED_TOOLS = [
  'Read',
  'Glob',
  'Grep',
  'Bash',
  'Write',
  'Edit',
  'MultiEdit',
] as const

export interface RoomAgentRunResult {
  outputMessageId: string
  content: string
  status?: RoomMessage['status']
  error?: string
}

export interface RoomSendMessageOptions {
  runAgent?: (plan: RoomAgentRunPlan) => RoomAgentRunResult
}

export interface RoomSendMessageResult {
  userMessage: RoomMessage
  routedMessages: RoomMessage[]
  drafts: RoomDraft[]
  runPlans: RoomAgentRunPlan[]
}

export interface RoomAgentMentionRoutingInput {
  roomId: string
  roomChannelId?: string
  sourceMessageId: string
  excludeMemberId?: string
}

export interface RoomAgentMentionRoutingResult {
  routedMessages: RoomMessage[]
  runPlans: RoomAgentRunPlan[]
}

interface RoomAgentRunSummary {
  assistantText: string
  assistantError: string
  taskSummary: string
  toolUseSummary: string
  recentToolResult: string
  toolNames: string[]
  toolUseCount: number
  resultSubtype: string
  errors: string[]
}

export interface RoomAgentCompletionContent {
  content: string
  status: RoomMessage['status']
  error?: string
}

function now(): number {
  return Date.now()
}

function createMessage(input: Omit<RoomMessage, 'id' | 'createdAt' | 'updatedAt'>): RoomMessage {
  const timestamp = now()
  return {
    id: randomUUID(),
    createdAt: timestamp,
    updatedAt: timestamp,
    ...input,
  }
}

function createDraft(input: Omit<RoomDraft, 'id' | 'createdAt' | 'updatedAt'>): RoomDraft {
  const timestamp = now()
  return {
    id: randomUUID(),
    createdAt: timestamp,
    updatedAt: timestamp,
    ...input,
  }
}

function findMentionedMembers(content: string, members: RoomMemberConfig[]): RoomMemberConfig[] {
  return members.filter((member) => {
    const name = member.name.trim()
    return name.length > 0 && content.includes(`@${name}`)
  })
}

function normalizeDirectiveTarget(value: string | undefined): string {
  return (value ?? '').trim().replace(/^@/, '')
}

function findDirectiveHandoffMembers(content: string, members: RoomMemberConfig[]): RoomMemberConfig[] {
  const directives = parseRoomDirectives(content)
  if (directives.some((directive) => directive.kind === 'room-wait-user')) return []
  const handoffTargets = directives
    .filter((directive) => directive.kind === 'room-handoff')
    .map((directive) => normalizeDirectiveTarget(directive.attrs.to))
    .filter((target) => target.length > 0)
  if (handoffTargets.length === 0) return []
  const targetSet = new Set(handoffTargets)
  return members.filter((member) => targetSet.has(member.name.trim()))
}

function hasFutureOrConditionalMention(content: string): boolean {
  return /(?:收到|等待|待).{0,12}(?:确认|回复|回答).{0,30}@|(?:确认|回复|回答).{0,20}(?:后|方案).{0,40}@|(?:交付后|完成后|之后|以后|后续|稍后).{0,30}@|(?:先|再).{0,30}@|会.{0,12}@/.test(content)
}

function isCurrentPlainHandoffSegment(segment: string): boolean {
  if (/验收通过|质量很好|感谢|谢谢|表扬|不需要|无需|不用/.test(segment)) return false
  return /(?:请|麻烦|辛苦|帮忙|进行|开始|继续|处理|执行|修复|实现|返工|测试|验收|审核|审查|检查)/.test(segment)
}

function findCompatiblePlainHandoffMembers(content: string, members: RoomMemberConfig[]): RoomMemberConfig[] {
  if (parseRoomDirectives(content).length > 0) return []
  if (hasFutureOrConditionalMention(content)) return []

  return members.filter((member) => {
    const name = member.name.trim()
    if (!name) return false
    const mention = `@${name}`
    let index = content.indexOf(mention)
    while (index >= 0) {
      const before = content.slice(Math.max(0, index - 8), index)
      const after = content.slice(index + mention.length, index + mention.length + 32).split(/[。！？!?\n]/)[0] ?? ''
      if (isCurrentPlainHandoffSegment(`${before}${after}`)) return true
      index = content.indexOf(mention, index + mention.length)
    }
    return false
  })
}

function createMentionResponse(roomId: string, roomChannelId: string, sourceMessageId: string, member: RoomMemberConfig): RoomMessage {
  const hasRuntime = Boolean(member.channelId)
  return createMessage({
    roomId,
    roomChannelId,
    role: 'agent',
    authorId: member.id,
    content: hasRuntime
      ? `${member.name} 正在思考...`
      : `${member.name} 已收到请求，但尚未配置渠道，无法运行真实 Agent。`,
    status: hasRuntime ? 'streaming' : 'final',
    sourceMessageId,
  })
}

function formatRoomMessageSpeaker(message: RoomMessage, members: RoomMemberConfig[]): string {
  if (message.role === 'human') return 'Human'
  if (message.authorId) {
    const member = members.find((item) => item.id === message.authorId)
    return member ? `Agent(@${member.name})` : `Agent(${message.authorId})`
  }
  return message.role
}

function formatRecentMessages(messages: RoomMessage[], members: RoomMemberConfig[]): string {
  return messages
    .slice(-12)
    .map((message) => `- ${formatRoomMessageSpeaker(message, members)}: ${message.content}`)
    .join('\n')
}

function isCoordinatorMember(member: RoomMemberConfig): boolean {
  const text = `${member.name}\n${member.rolePrompt}`.toLowerCase()
  return /ceo|lead|owner|负责人|主\s*agent|主理人|planner|manager|coordinator|pm|规划|计划|编排|派发|分派|协调|验收|审查|评审|产品|项目/.test(text)
}

function isPrimaryCoordinatorMember(member: RoomMemberConfig): boolean {
  const text = `${member.name}\n${member.rolePrompt}`.toLowerCase()
  return /ceo|lead|owner|负责人|主\s*agent|主理人|planner|manager|coordinator|pm|规划|计划|编排|派发|分派|产品|项目/.test(text)
}

function isReviewMember(member: RoomMemberConfig): boolean {
  const text = `${member.name}\n${member.rolePrompt}`.toLowerCase()
  return /测试|验收|审查|评审|review|qa|quality/.test(text)
}

function formatRoomMembersForPrompt(members: RoomMemberConfig[], currentMemberId: string): string {
  return members
    .filter((member) => member.enabled)
    .map((member) => {
      const selfLabel = member.id === currentMemberId ? '（你自己）' : ''
      return `- @${member.name}${selfLabel}: ${member.rolePrompt.trim()}`
    })
    .join('\n')
}

function buildRoomMemberSystemPrompt(member: RoomMemberConfig, roomMembers: RoomMemberConfig[]): string {
  const coordinatorNames = roomMembers
    .filter((item) => item.enabled && item.id !== member.id && isCoordinatorMember(item))
    .map((item) => `@${item.name}`)
  const primaryCoordinatorNames = roomMembers
    .filter((item) => item.enabled && item.id !== member.id && isPrimaryCoordinatorMember(item))
    .map((item) => `@${item.name}`)
  const executorNames = roomMembers
    .filter((item) => item.enabled && item.id !== member.id && !isCoordinatorMember(item))
    .map((item) => `@${item.name}`)

  const lines = [
    '# Proma Slock Room Agent Member',
    '',
    `你是 Room 成员「${member.name}」。`,
    '',
    '## 你的成员角色',
    member.rolePrompt.trim(),
    '',
    '## 房间成员与职责',
    formatRoomMembersForPrompt(roomMembers, member.id),
    '',
    '## 行为要求',
    '- 只代表你自己发言，不要假装其他成员或用户。',
    '- 必须遵守你的成员角色边界：只做你职责内的事情，不要越权完成其他成员负责的工作。',
    '- 回应要基于房间上下文，保持简洁、可执行。',
    '- 如果信息不足，先提出澄清问题。',
    '- 如果需要用户确认需求、范围、方案或偏好，必须调用 AskUserQuestion 工具暂停并等待用户回答；不要只在普通回复里列问题让用户手动整理。',
    '- 等待用户回答期间，不要派发执行成员或验收成员；只有用户回答后才能继续编排。',
    '- 普通正文里的 @成员 只表示提及，不会唤醒成员；Agent 回复中只有 room-handoff 指令会唤醒目标成员。',
    '- 如果需要其他 Room 成员继续协作，请使用显式指令：::room-handoff{to="成员名" reason="原因"}\n给对方的完整任务说明\n::。',
    '- 每轮回复都要自己判断协作是否应该继续：需要继续时输出 room-handoff 指令；不需要继续时直接总结给用户，不要为了流程而交接。',
    '- 给其他成员派活时，请交付完整、可执行的最终目标；不要只让对方做一个前置步骤后再回报。',
    '- 仅在需要对方继续执行任务时使用 room-handoff；总结、表扬、引用历史或验收通过时不要输出 room-handoff。',
  ]

  if (isCoordinatorMember(member)) {
    lines.push(
      '',
      '## 协调/规划/验收角色特别规则',
      '- 你的主要职责是理解目标、拆解任务、编排成员、验收结果。',
      executorNames.length > 0
        ? `- 可派发执行成员：${executorNames.join('、')}。用户要求实现/重做/修复/创建产物时，必须使用 room-handoff 派发给其中一个执行成员，并给出完整目标、上下文和验收标准。示例：::room-handoff{to="Coder" reason="实现已确认方案"}\n请实现...\n::。`
        : '- 当前没有可派发执行成员；如果用户要求实现/重做/修复/创建产物，请先说明缺少执行成员，不要自己直接实现。',
      '- 不要直接修改文件、生成代码或宣称已完成由执行成员负责的产物。',
      '- 即使你具备工具权限，也不要使用 Write/Edit/Bash 自己实现用户交给执行成员的工作；你的输出应是计划、决策、@派发或验收。',
      '- 如果实现方向、技术栈、数据来源、设计风格、内容结构、输出位置等关键决策不明确，必须先用 AskUserQuestion 向用户提问并等待回答；不要在同一轮派发执行成员。',
      '- 当用户要求实现/重做/修复时，请先给出简短计划，然后用 room-handoff 派发合适的执行成员，并把完整目标、验收标准和必要上下文交给对方。',
      isReviewMember(member) && primaryCoordinatorNames.length > 0
        ? `- 如果你完成测试/验收且验收通过，不要直接对用户做最终结论；必须使用 room-handoff 交给主 Agent ${primaryCoordinatorNames.join('、')} 做最后确认、总结和收口。`
        : '- 如果需要验收，请基于执行成员的结果做检查；验收通过时直接总结给用户，不要再次派发执行成员。',
      '- 如果验收不通过且仍需要执行成员返工，必须用 room-handoff 派发对应执行成员，并给出具体问题、目标工作目录、需要修改/验证的文件和通过标准；不要只向用户报告问题。',
    )
  } else {
    lines.push(
      '',
      '## 执行成员交付规则',
      '- 如果任务属于你的职责并且你能直接完成，请在本轮完成实际操作，不要只回复“我现在开始/稍后处理/完成后告诉你”。',
      '- 如果任务包含多个连续步骤且属于你的职责，应尽量在同一轮完成完整目标，而不是只完成第一步后等待下一轮。',
      '- 执行成员不要直接向用户确认方案、架构、范围、设计偏好或是否继续实现。',
      '- 如果关键决策不明确且房间内存在协调/规划/验收成员，请 @协调/规划/验收成员 说明阻塞点、可选方案和你的建议，由协调成员决定是否使用 AskUserQuestion 向用户确认。',
      '- 如果房间内没有协调/规划/验收成员，且确实需要用户确认，才调用 AskUserQuestion；不要用普通消息让用户手动整理答案。',
    )

    if (coordinatorNames.length > 0) {
      lines.push(
        `- 如果本轮任务来自协调/规划/验收成员（如 ${coordinatorNames.join('、')}）派发，完成实际操作并自检后，完成后需要验收时必须使用 room-handoff 显式交回原协调/验收成员；普通 @ 不会唤醒成员。示例：::room-handoff{to="${coordinatorNames[0]?.replace(/^@/, '') ?? 'Planner'}" reason="验收交付结果"}
请验收本次交付。我已完成：...；关键文件：...；验证结果：...。
::。`,
        '- 如果多个成员都需要继续时，请为每个目标成员分别输出一个完整的 room-handoff 指令；不要只在普通正文里 @多个成员。',
        '- 回传验收时要简要说明已完成内容、关键文件或验证结果；不要再把任务派给其他执行成员。',
      )
    }
  }

  return lines.join('\n')
}

function buildRoomMemberPrompt(input: {
  member: RoomMemberConfig
  roomChannelId: string
  roomMembers: RoomMemberConfig[]
  userMessage: RoomMessage
  recentMessages: RoomMessage[]
  roomSummary: string
  triggerType: RoomAgentTriggerType
}): string {
  const workspaceFilesDir = getRoomWorkspaceFilesDir(input.member.workspaceId)
  const sections = [
    '# Room 触发上下文',
    '',
    `触发方式：${formatTriggerType(input.triggerType)}`,
    `当前频道：#${input.roomChannelId}`,
    '',
    '## 触发消息',
    `发送者：${formatRoomMessageSpeaker(input.userMessage, input.roomMembers)}`,
    '',
    input.userMessage.content,
  ]

  if (input.roomSummary.trim()) {
    sections.push('', '## 房间摘要', input.roomSummary.trim())
  }

  if (input.member.privateMemorySummary?.trim()) {
    sections.push('', '## 你的私有记忆摘要', input.member.privateMemorySummary.trim())
  }

  if (workspaceFilesDir) {
    sections.push(
      '',
      '## 工作区持久文件目录',
      `- 绝对路径：${workspaceFilesDir}`,
      `- 如果用户提到 workspace-files/xxx，请使用上面的绝对路径访问，例如 Read 的 file_path 应为 ${workspaceFilesDir}/xxx。`,
      '- 不要把 workspace-files/xxx 当作相对 cwd 路径；Room Agent 的 cwd 是成员会话目录，不是工作区根目录。',
    )
  }

  const history = formatRecentMessages(input.recentMessages, input.roomMembers)
  if (history) {
    sections.push('', '## 最近房间消息', history)
  }

  sections.push('', '请以 Room 成员身份给出下一条回复。')
  return sections.join('\n')
}

function getRoomWorkspaceFilesDir(workspaceId?: string): string | null {
  const resolvedWorkspaceId = resolveRoomWorkspaceId(workspaceId)
  if (!resolvedWorkspaceId) return null
  const workspace = getAgentWorkspace(resolvedWorkspaceId)
  if (!workspace) return null
  return getWorkspaceFilesDir(workspace.slug)
}

function formatTriggerType(triggerType: RoomAgentTriggerType): string {
  if (triggerType === 'mention') return '用户 @提及'
  if (triggerType === 'agent-mention') return 'Room 成员 @提及'
  return '监听高置信自动回应'
}

function isSdkTextBlock(block: { type: string }): block is SDKTextBlock {
  return block.type === 'text' && 'text' in block && typeof block.text === 'string'
}

function isSdkToolUseBlock(block: { type: string }): block is SDKToolUseBlock {
  return block.type === 'tool_use' && 'name' in block && typeof block.name === 'string'
}

function isSdkToolResultBlock(block: { type: string }): block is SDKToolResultBlock {
  return block.type === 'tool_result' && 'tool_use_id' in block && typeof block.tool_use_id === 'string'
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function truncateRoomSummaryText(text: string, maxLength = 800): string {
  const normalized = text.trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength)}…`
}

function extractTextFromUnknownContent(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''

  return content
    .map((item) => {
      const record = toRecord(item)
      if (!record) return ''
      if (record.type === 'text' && typeof record.text === 'string') return record.text
      return ''
    })
    .filter(Boolean)
    .join('\n')
    .trim()
}

function createRoomProgressItem(kind: RoomProgressItem['kind'], content: string): RoomProgressItem {
  return {
    id: `${Date.now()}-${randomUUID()}`,
    kind,
    content,
    createdAt: Date.now(),
  }
}

function truncateRoomProgressText(content: string, maxLength = 180): string {
  const trimmed = content.trim()
  if (trimmed.length <= maxLength) return trimmed
  return `${trimmed.slice(0, maxLength)}…`
}

function getRoomToolLabel(name: string, input?: Record<string, unknown>): string {
  const displayName = typeof input?._displayName === 'string' ? input._displayName : undefined
  const intent = typeof input?._intent === 'string' ? input._intent : undefined
  const description = typeof input?.description === 'string' ? input.description : undefined
  const command = typeof input?.command === 'string' ? input.command : undefined
  const filePath = typeof input?.file_path === 'string' ? input.file_path : undefined
  const path = typeof input?.path === 'string' ? input.path : undefined
  const detail = displayName ?? intent ?? description ?? command ?? filePath ?? path
  return detail ? `${name} · ${truncateRoomProgressText(detail, 120)}` : name
}

function getRoomToolResultLabel(toolLabel: string | undefined, fallbackToolUseId: string): string {
  return toolLabel ?? `未知工具 · ${fallbackToolUseId}`
}

export function buildRoomProgressItemsFromSdkMessages(messages: SDKMessage[]): RoomProgressItem[] {
  const toolLabels = new Map<string, string>()
  const items: RoomProgressItem[] = []

  for (const message of messages) {
    if (message.type === 'assistant') {
      const assistant = message as SDKAssistantMessage
      for (const block of assistant.message.content) {
        if (isSdkToolUseBlock(block)) {
          const label = getRoomToolLabel(block.name, block.input)
          toolLabels.set(block.id, label)
          items.push(createRoomProgressItem('tool', `开始使用工具：${label}`))
        } else if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
          items.push(createRoomProgressItem('text', '正在输出回复...'))
        }
      }
      if (assistant.error?.message) {
        items.push(createRoomProgressItem('error', `运行错误：${truncateRoomProgressText(assistant.error.message)}`))
      }
      continue
    }

    if (message.type === 'user') {
      const user = message as SDKUserMessage
      const content = user.message?.content ?? []
      for (const block of content) {
        if (!isSdkToolResultBlock(block)) continue
        const label = getRoomToolResultLabel(toolLabels.get(block.tool_use_id), block.tool_use_id)
        const resultText = truncateRoomProgressText(extractTextFromUnknownContent(block.content))
        if (block.is_error) {
          const detail = resultText ? ` — ${resultText}` : ''
          items.push(createRoomProgressItem('error', `工具执行失败：${label}${detail}`))
        } else {
          items.push(createRoomProgressItem('tool', `工具执行完成：${label}`))
        }
      }
      continue
    }

    if (message.type === 'tool_use_summary') {
      const toolUseSummary = message as SDKToolUseSummaryMessage
      if (toolUseSummary.summary?.trim()) {
        items.push(createRoomProgressItem('status', truncateRoomProgressText(toolUseSummary.summary)))
      }
      continue
    }

    if (message.type === 'system') {
      const system = message as SDKSystemMessage
      if (system.subtype === 'task_progress') {
        const lastTool = typeof system.last_tool_name === 'string' ? `，最近工具：${system.last_tool_name}` : ''
        items.push(createRoomProgressItem('task', `后台任务进行中${lastTool}`))
      }
      if (system.subtype === 'task_notification' && system.summary?.trim()) {
        items.push(createRoomProgressItem('task', truncateRoomProgressText(system.summary)))
      }
    }
  }

  return items
}

function collectRoomAgentRunSummary(messages: SDKMessage[]): RoomAgentRunSummary {
  const summary: RoomAgentRunSummary = {
    assistantText: '',
    assistantError: '',
    taskSummary: '',
    toolUseSummary: '',
    recentToolResult: '',
    toolNames: [],
    toolUseCount: 0,
    resultSubtype: '',
    errors: [],
  }

  const toolNameSet = new Set<string>()
  for (const message of messages) {
    if (message.type === 'assistant') {
      const assistant = message as SDKAssistantMessage
      if (assistant.error?.message) summary.assistantError = assistant.error.message
      const text = assistant.message.content
        .filter(isSdkTextBlock)
        .map((block) => block.text)
        .join('\n')
        .trim()
      if (text) summary.assistantText = text
      for (const block of assistant.message.content) {
        if (!isSdkToolUseBlock(block)) continue
        summary.toolUseCount += 1
        toolNameSet.add(block.name)
      }
      continue
    }

    if (message.type === 'tool_use_summary') {
      const toolUseSummary = message as SDKToolUseSummaryMessage
      if (toolUseSummary.summary?.trim()) summary.toolUseSummary = toolUseSummary.summary.trim()
      continue
    }

    if (message.type === 'system') {
      const system = message as SDKSystemMessage
      if (system.subtype === 'task_notification' && system.summary?.trim()) {
        summary.taskSummary = system.summary.trim()
      }
      continue
    }

    if (message.type === 'user') {
      const user = message as SDKUserMessage
      const content = user.message?.content ?? []
      for (const block of content) {
        if (block.type !== 'tool_result') continue
        const resultText = extractTextFromUnknownContent(block.content)
        if (resultText) summary.recentToolResult = resultText
      }
      continue
    }

    if (message.type === 'result') {
      const record = message as Record<string, unknown>
      if (typeof record.subtype === 'string') summary.resultSubtype = record.subtype
      if (Array.isArray(record.errors)) {
        summary.errors = record.errors.filter((item): item is string => typeof item === 'string')
      }
    }
  }

  summary.toolNames = Array.from(toolNameSet)
  return summary
}

export function buildRoomAgentCompletionContent(messages: SDKMessage[], afterIndex: number, memberName: string): RoomAgentCompletionContent {
  const summary = collectRoomAgentRunSummary(messages.slice(afterIndex))
  if (summary.assistantError || summary.resultSubtype.startsWith('error')) {
    const error = summary.assistantError || summary.errors[0] || summary.resultSubtype
    return {
      content: friendlyRoomAgentError(error),
      status: 'error',
      error,
    }
  }
  if (summary.assistantText) return { content: summary.assistantText, status: 'final' }
  if (summary.taskSummary) return { content: truncateRoomSummaryText(summary.taskSummary), status: 'final' }
  if (summary.toolUseSummary) return { content: truncateRoomSummaryText(summary.toolUseSummary), status: 'final' }

  const lines = [`${memberName} 已完成运行。`]
  if (summary.resultSubtype === 'success') {
    lines.push('运行结果：成功。')
  } else if (summary.resultSubtype) {
    lines.push(`运行结果：${summary.resultSubtype}。`)
  }
  if (summary.toolUseCount > 0) {
    const toolLabel = summary.toolNames.length > 0 ? `：${summary.toolNames.join('、')}` : ''
    lines.push(`执行了 ${summary.toolUseCount} 次工具调用${toolLabel}。`)
  }
  if (summary.recentToolResult) {
    lines.push(`最近工具结果：${truncateRoomSummaryText(summary.recentToolResult, 500)}`)
  }
  if (summary.errors.length > 0) {
    lines.push(`错误信息：${summary.errors.join('；')}`)
  }

  return { content: lines.join('\n'), status: 'final' }
}

function friendlyRoomAgentError(error: string): string {
  if (/Pi provider request failed:\s*terminated/i.test(error)) {
    return [
      '运行失败：Pi 请求被中断。',
      '可能原因：模型/网络连接中断、Pi runtime 被终止，或任务运行时间较长。',
      '建议：稍后重试；如果经常出现，请切换成员渠道/引擎，或把任务拆小后再交给该成员。',
      '',
      `原始错误：${error}`,
    ].join('\n')
  }
  return `运行失败：${error}`
}

function createRunPlan(input: {
  roomId: string
  roomChannelId: string
  member: RoomMemberConfig
  roomMembers: RoomMemberConfig[]
  userMessage: RoomMessage
  outputMessage: RoomMessage
  triggerType: RoomAgentTriggerType
  recentMessages: RoomMessage[]
  roomSummary: string
}): RoomAgentRunPlan {
  const isCoordinator = isCoordinatorMember(input.member)
  return {
    roomId: input.roomId,
    roomChannelId: input.roomChannelId,
    memberId: input.member.id,
    memberName: input.member.name,
    sourceMessageId: input.userMessage.id,
    outputMessageId: input.outputMessage.id,
    triggerType: input.triggerType,
    channelId: input.member.channelId,
    modelId: input.member.modelId,
    workspaceId: input.member.workspaceId,
    agentEngine: input.member.agentEngine,
    permissionMode: isCoordinator ? 'plan' : (input.member.permissionMode ?? 'bypassPermissions'),
    disallowedTools: isCoordinator ? [...ROOM_COORDINATOR_DISALLOWED_TOOLS] : undefined,
    systemPrompt: buildRoomMemberSystemPrompt(input.member, input.roomMembers),
    prompt: buildRoomMemberPrompt({
      member: input.member,
      roomChannelId: input.roomChannelId,
      roomMembers: input.roomMembers,
      userMessage: input.userMessage,
      recentMessages: input.recentMessages,
      roomSummary: input.roomSummary,
      triggerType: input.triggerType,
    }),
  }
}

function applyRunResult(roomId: string, messages: RoomMessage[], result: RoomAgentRunResult): void {
  const idx = messages.findIndex((message) => message.id === result.outputMessageId)
  if (idx === -1) throw new Error(`Room Agent 输出消息不存在: ${result.outputMessageId}`)
  const current = messages[idx]!
  const updated: RoomMessage = {
    ...current,
    content: result.content,
    status: result.status ?? 'final',
    error: result.error,
    updatedAt: now(),
  }
  messages[idx] = updated
  saveRoomMessages(roomId, getRoomMessages(roomId).map((message) => (
    message.id === updated.id ? updated : message
  )))
}

function normalizeAgentSessionIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-')
}

function readAgentSessionsIndexForRoom(): AgentSessionsIndexFile {
  return readJsonFileSafe<AgentSessionsIndexFile>(getAgentSessionsIndexPath()) ?? { version: 1, sessions: [] }
}

function writeAgentSessionsIndexForRoom(index: AgentSessionsIndexFile): void {
  writeJsonFileAtomic(getAgentSessionsIndexPath(), index)
}

export function getAgentSessionIdForRoomRunPlan(plan: RoomAgentRunPlan): string {
  return `room-${normalizeAgentSessionIdPart(plan.roomId)}-${normalizeAgentSessionIdPart(plan.roomChannelId)}-${normalizeAgentSessionIdPart(plan.memberId)}`
}

function resolveRoomWorkspaceId(workspaceId?: string): string | undefined {
  if (workspaceId) return workspaceId
  const candidate = getSettings().agentWorkspaceId
  return candidate && getAgentWorkspace(candidate) ? candidate : undefined
}

function resolveRoomAgentEngine(workspaceId?: string, agentEngine?: RoomMemberConfig['agentEngine']): AgentSessionMeta['agentEngine'] {
  if (agentEngine) return agentEngine
  const workspace = workspaceId ? getAgentWorkspace(workspaceId) : null
  return resolveAgentEngine({ workspace })
}

export function createAgentInputFromRoomRunPlan(plan: RoomAgentRunPlan | undefined): AgentSendInput {
  if (!plan) throw new Error('Room Agent 运行计划不存在')
  if (!plan.channelId) {
    throw new Error(`Room 成员缺少渠道配置，无法运行真实 Agent: ${plan.memberId}`)
  }

  return {
    sessionId: getAgentSessionIdForRoomRunPlan(plan),
    userMessage: `${plan.systemPrompt}\n\n${plan.prompt}`,
    channelId: plan.channelId,
    modelId: plan.modelId,
    workspaceId: resolveRoomWorkspaceId(plan.workspaceId),
    disallowedTools: plan.disallowedTools,
    permissionModeOverride: plan.permissionMode ?? 'bypassPermissions',
  }
}

export function ensureAgentSessionForRoomRunPlan(plan: RoomAgentRunPlan | undefined): AgentSessionMeta {
  if (!plan) throw new Error('Room Agent 运行计划不存在')
  const input = createAgentInputFromRoomRunPlan(plan)
  const index = readAgentSessionsIndexForRoom()
  const existingIndex = index.sessions.findIndex((session) => session.id === input.sessionId)
  const now = Date.now()
  const agentEngine = resolveRoomAgentEngine(input.workspaceId, plan.agentEngine)
  if (existingIndex >= 0) {
    const existing = index.sessions[existingIndex]!
    const updated: AgentSessionMeta = {
      ...existing,
      title: `Room · ${plan.memberName}`,
      channelId: input.channelId,
      workspaceId: input.workspaceId,
      agentEngine,
      permissionMode: input.permissionModeOverride,
      updatedAt: now,
    }
    index.sessions[existingIndex] = updated
    writeAgentSessionsIndexForRoom(index)
    return updated
  }

  const meta: AgentSessionMeta = {
    id: input.sessionId,
    title: `Room · ${plan.memberName}`,
    channelId: input.channelId,
    workspaceId: input.workspaceId,
    agentEngine,
    permissionMode: input.permissionModeOverride,
    createdAt: now,
    updatedAt: now,
  }
  index.sessions.push(meta)
  writeAgentSessionsIndexForRoom(index)
  mkdirSync(getAgentSessionsDir(), { recursive: true })
  return meta
}

function getDefaultRoutingDecision(
  member: RoomMemberConfig,
  shouldAutoSend: boolean,
  hasAutoResponder: boolean,
): RoomRoutingDecision {
  if (shouldAutoSend) {
    return {
      action: 'send',
      score: 0.8,
      reason: 'MVP 监听分流：普通消息默认交给第一个已配置渠道的监听成员回应。',
    }
  }
  if (hasAutoResponder) {
    return {
      action: 'silent',
      score: 0.2,
      reason: 'MVP 监听分流：已有监听成员自动回应，其他成员默认静默。',
    }
  }

  return {
    action: 'draft',
    score: 0.5,
    reason: 'MVP 监听分流：命中监听成员，先进入草稿卡。',
    content: `${member.name} 可能需要回应这条消息。真实 LLM 评分将在下一阶段接入。`,
  }
}

function createDirectResponse(
  roomId: string,
  roomChannelId: string,
  sourceMessageId: string,
  member: RoomMemberConfig,
  decision: RoomRoutingDecision,
): RoomMessage {
  const hasRuntime = Boolean(member.channelId)
  return createMessage({
    roomId,
    roomChannelId,
    role: 'agent',
    authorId: member.id,
    content: hasRuntime
      ? `${member.name} 正在思考...`
      : decision.content?.trim() || `${member.name} 判断这条消息需要直接回应，但尚未配置渠道，无法运行真实 Agent。`,
    status: hasRuntime ? 'streaming' : 'final',
    sourceMessageId,
  })
}

function createPendingDraft(
  roomId: string,
  roomChannelId: string,
  sourceMessageId: string,
  member: RoomMemberConfig,
  decision: RoomRoutingDecision,
): RoomDraft {
  return createDraft({
    roomId,
    roomChannelId,
    memberId: member.id,
    sourceMessageId,
    content: decision.content?.trim() || `${member.name} 可能需要回应这条消息。真实 LLM 评分将在下一阶段接入。`,
    score: decision.score,
    reason: decision.reason,
    status: 'pending',
  })
}

export function routeRoomAgentMentions(input: RoomAgentMentionRoutingInput): RoomAgentMentionRoutingResult {
  const roomChannelId = input.roomChannelId ?? DEFAULT_ROOM_CHANNEL_ID
  const members = listRoomMembers(input.roomId).filter((member) => member.enabled)
  const messagesBeforeRouting = getRoomMessages(input.roomId, roomChannelId)
  const sourceMessage = messagesBeforeRouting.find((message) => message.id === input.sourceMessageId)
  if (!sourceMessage) throw new Error(`Room 源消息不存在: ${input.sourceMessageId}`)
  const roomSummary = getRoomSummary(input.roomId)
  const handoffMembers = findDirectiveHandoffMembers(sourceMessage.content, members)
  const mentionedMembers = (handoffMembers.length > 0
    ? handoffMembers
    : findCompatiblePlainHandoffMembers(sourceMessage.content, members))
    .filter((member) => member.id !== input.excludeMemberId)
    .filter((member) => !messagesBeforeRouting.some((message) => (
      message.sourceMessageId === sourceMessage.id && message.authorId === member.id
    )))
  const routedMessages: RoomMessage[] = []
  const runPlans: RoomAgentRunPlan[] = []

  for (const member of mentionedMembers) {
    const message = createMentionResponse(input.roomId, roomChannelId, sourceMessage.id, member)
    routedMessages.push(message)
    appendRoomMessage(input.roomId, message)
    runPlans.push(createRunPlan({
      roomId: input.roomId,
      roomChannelId,
      member,
      roomMembers: members,
      userMessage: sourceMessage,
      outputMessage: message,
      triggerType: 'agent-mention',
      recentMessages: messagesBeforeRouting,
      roomSummary,
    }))
  }

  return { routedMessages, runPlans }
}

export function sendRoomMessage(input: RoomSendMessageInput, options: RoomSendMessageOptions = {}): RoomSendMessageResult {
  const content = input.content.trim()
  if (!content) throw new Error('Room 消息不能为空')

  const roomChannelId = input.roomChannelId ?? DEFAULT_ROOM_CHANNEL_ID
  const members = listRoomMembers(input.roomId).filter((member) => member.enabled)
  const previousMessages = getRoomMessages(input.roomId, roomChannelId)
  const roomSummary = getRoomSummary(input.roomId)
  const userMessage = createMessage({
    roomId: input.roomId,
    roomChannelId,
    role: 'human',
    authorId: input.authorId,
    content,
    status: 'final',
  })
  appendRoomMessage(input.roomId, userMessage)

  const mentionedMembers = findMentionedMembers(content, members)
  const routedMessages: RoomMessage[] = mentionedMembers.map((member) => createMentionResponse(input.roomId, roomChannelId, userMessage.id, member))
  for (const message of routedMessages) appendRoomMessage(input.roomId, message)
  const runPlans: RoomAgentRunPlan[] = routedMessages.map((message) => {
    const member = mentionedMembers.find((item) => item.id === message.authorId)
    if (!member) throw new Error(`Room 成员不存在: ${message.authorId}`)
    return createRunPlan({
      roomId: input.roomId,
      roomChannelId,
      member,
      roomMembers: members,
      userMessage,
      outputMessage: message,
      triggerType: 'mention',
      recentMessages: [...previousMessages, userMessage],
      roomSummary,
    })
  })

  const mentionedIds = new Set(mentionedMembers.map((member) => member.id))
  const listeningMembers = members.filter((member) => (
    member.listenMode === 'listen-and-score' && !mentionedIds.has(member.id)
  ))
  const drafts: RoomDraft[] = []
  if (mentionedMembers.length === 0) {
    const defaultResponderId = listeningMembers.find((member) => member.channelId)?.id
    const hasAutoResponder = Boolean(defaultResponderId)
    for (const member of listeningMembers) {
      const decision = input.routingDecisions?.[member.id] ?? getDefaultRoutingDecision(member, member.id === defaultResponderId, hasAutoResponder)
      if (decision.action === 'send') {
        const message = createDirectResponse(input.roomId, roomChannelId, userMessage.id, member, decision)
        routedMessages.push(message)
        appendRoomMessage(input.roomId, message)
        runPlans.push(createRunPlan({
          roomId: input.roomId,
          roomChannelId,
          member,
          roomMembers: members,
          userMessage,
          outputMessage: message,
          triggerType: 'routing-send',
          recentMessages: [...previousMessages, userMessage],
          roomSummary,
        }))
      } else if (decision.action === 'draft') {
        drafts.push(createPendingDraft(input.roomId, roomChannelId, userMessage.id, member, decision))
      }
    }
  }
  for (const draft of drafts) saveRoomDraft(draft)

  if (options.runAgent) {
    for (const plan of runPlans) {
      const result = options.runAgent(plan)
      applyRunResult(input.roomId, routedMessages, result)
    }
  }

  return { userMessage, routedMessages, drafts, runPlans }
}

export function updateRoomDraft(input: RoomUpdateDraftInput): RoomDraft {
  const roomChannelId = input.roomChannelId ?? DEFAULT_ROOM_CHANNEL_ID
  const draft = listRoomDrafts(input.roomId).find((item) => (
    item.id === input.draftId && (item.roomChannelId ?? DEFAULT_ROOM_CHANNEL_ID) === roomChannelId
  ))
  if (!draft) throw new Error(`Room 草稿不存在: ${input.draftId}`)

  const updated: RoomDraft = {
    ...draft,
    content: input.content ?? draft.content,
    status: input.action === 'send' ? 'sent' : 'discarded',
    updatedAt: now(),
  }
  saveRoomDraft(updated)

  if (input.action === 'send') {
    appendRoomMessage(input.roomId, createMessage({
      roomId: input.roomId,
      roomChannelId,
      role: 'agent',
      authorId: draft.memberId,
      content: updated.content,
      status: 'final',
      sourceMessageId: draft.sourceMessageId,
    }))
  }

  return updated
}

export function replaceRoomMessageContent(
  roomId: string,
  messageId: string,
  content: string,
  status: RoomMessage['status'] = 'final',
  error?: string,
): RoomMessage {
  const messages = getRoomMessages(roomId)
  const idx = messages.findIndex((message) => message.id === messageId)
  if (idx === -1) throw new Error(`Room 消息不存在: ${messageId}`)
  const updated: RoomMessage = { ...messages[idx]!, content, status, error, updatedAt: now() }
  messages[idx] = updated
  saveRoomMessages(roomId, messages)
  return updated
}
