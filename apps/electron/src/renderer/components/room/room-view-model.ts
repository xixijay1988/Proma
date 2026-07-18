import { DEFAULT_ROOM_CHANNEL_ID } from '@proma/shared'
import type { AgentEngine, AgentWorkspace, Channel, PromaPermissionMode, RoomChannel, RoomDraft, RoomMemberConfig, RoomMemberListenMode, RoomMemberSaveInput, RoomMessage } from '@proma/shared'

export interface RoomMessageItem {
  id: string
  role: RoomMessage['role']
  content: string
  status: RoomMessage['status']
  progress: RoomMessage['progress']
  speakerName: string
  speakerAvatar: string
  align: 'left' | 'right'
  createdAt: number
}

export interface PendingRoomDraftItem {
  id: string
  roomId: string
  memberId: string
  memberName: string
  memberAvatar: string
  content: string
  score?: number
  scoreLabel?: string
  reason?: string
  sourceMessageId: string
  createdAt: number
}

export interface BuildRoomMessageItemsInput {
  messages: RoomMessage[]
  members: RoomMemberConfig[]
}

export interface GetPendingDraftsInput {
  drafts: RoomDraft[]
  members: RoomMemberConfig[]
}

export interface RoomMemberRuntimeLabelsInput {
  member: RoomMemberConfig
  channels: Channel[]
  workspaces: AgentWorkspace[]
}

export interface RoomMemberRuntimeLabels {
  channelLabel: string
  modelLabel: string
  workspaceLabel: string
  engineLabel: string
  runtimeReady: boolean
}

export interface RoomMemberFormState {
  memberId?: string
  name: string
  avatar: string
  rolePrompt: string
  channelId: string
  modelId: string
  workspaceId: string
  agentEngine: AgentEngine | ''
  listenMode: RoomMemberListenMode
  permissionMode: PromaPermissionMode
  enabled: boolean
  privateMemorySummary: string
}

export interface CreateRoomMemberFormStateInput {
  roomId: string
  member?: RoomMemberConfig
  memberCount: number
}

export interface RoomMentionQuery {
  active: boolean
  startIndex: number
  query: string
}

export function canDeleteRoomChannel(channel: RoomChannel): boolean {
  return channel.id !== DEFAULT_ROOM_CHANNEL_ID && !channel.archived
}

export function normalizeRoomAgentSessionPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-')
}

export function getRoomAgentSessionIdForMember(roomId: string, roomChannelId: string, memberId: string): string {
  return `room-${normalizeRoomAgentSessionPart(roomId)}-${normalizeRoomAgentSessionPart(roomChannelId)}-${normalizeRoomAgentSessionPart(memberId)}`
}

function getMemberMap(members: RoomMemberConfig[]): Map<string, RoomMemberConfig> {
  return new Map(members.map((member) => [member.id, member]))
}

export function buildRoomMessageItems(input: BuildRoomMessageItemsInput): RoomMessageItem[] {
  const memberMap = getMemberMap(input.members)
  return input.messages.map((message) => {
    const member = message.authorId ? memberMap.get(message.authorId) : undefined
    const isHuman = message.role === 'human'
    return {
      id: message.id,
      role: message.role,
      content: message.content,
      status: message.status,
      progress: message.progress,
      speakerName: isHuman ? '我' : member?.name ?? 'Room Agent',
      speakerAvatar: isHuman ? '你' : member?.avatar ?? '🤖',
      align: isHuman ? 'right' : 'left',
      createdAt: message.createdAt,
    }
  })
}

export function getPendingDrafts(input: GetPendingDraftsInput): PendingRoomDraftItem[] {
  const memberMap = getMemberMap(input.members)
  return input.drafts
    .filter((draft) => draft.status === 'pending')
    .map((draft) => {
      const member = memberMap.get(draft.memberId)
      return {
        id: draft.id,
        roomId: draft.roomId,
        memberId: draft.memberId,
        memberName: member?.name ?? 'Room Agent',
        memberAvatar: member?.avatar ?? '🤖',
        content: draft.content,
        score: draft.score,
        scoreLabel: typeof draft.score === 'number' ? `${Math.round(draft.score * 100)}%` : undefined,
        reason: draft.reason,
        sourceMessageId: draft.sourceMessageId,
        createdAt: draft.createdAt,
      }
    })
}

export function getRoomMemberRuntimeLabels(input: RoomMemberRuntimeLabelsInput): RoomMemberRuntimeLabels {
  const channel = input.channels.find((item) => item.id === input.member.channelId)
  const model = channel?.models.find((item) => item.id === input.member.modelId)
  const workspace = input.workspaces.find((item) => item.id === input.member.workspaceId)

  return {
    channelLabel: channel?.name ?? '未配置渠道',
    modelLabel: model?.name ?? input.member.modelId ?? '默认模型',
    workspaceLabel: workspace?.name ?? '默认工作区',
    engineLabel: input.member.agentEngine === 'pi'
      ? 'Pi Agent RPC'
      : input.member.agentEngine === 'claude-sdk'
        ? 'Claude SDK'
        : '跟随工作区',
    runtimeReady: Boolean(input.member.channelId && channel),
  }
}

export function createRoomMemberFormState(input: CreateRoomMemberFormStateInput): RoomMemberFormState {
  const fallbackName = input.memberCount === 0 ? 'Planner' : `Agent ${input.memberCount + 1}`
  return {
    memberId: input.member?.id,
    name: input.member?.name ?? fallbackName,
    avatar: input.member?.avatar ?? (input.memberCount === 0 ? '🧭' : '🤖'),
    rolePrompt: input.member?.rolePrompt ?? '你是 Room 中的协作 Agent。请先理解上下文，再给出简洁、可执行的建议。',
    channelId: input.member?.channelId ?? '',
    modelId: input.member?.modelId ?? '',
    workspaceId: input.member?.workspaceId ?? '',
    agentEngine: input.member?.agentEngine ?? '',
    listenMode: input.member?.listenMode ?? 'listen-and-score',
    permissionMode: input.member?.permissionMode ?? (input.memberCount === 0 ? 'plan' : 'bypassPermissions'),
    enabled: input.member?.enabled ?? true,
    privateMemorySummary: input.member?.privateMemorySummary ?? '',
  }
}

function optionalValue(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function buildRoomMemberSaveInput(roomId: string, state: RoomMemberFormState): RoomMemberSaveInput {
  return {
    roomId,
    memberId: state.memberId,
    name: state.name.trim(),
    avatar: optionalValue(state.avatar),
    rolePrompt: state.rolePrompt.trim(),
    channelId: optionalValue(state.channelId),
    modelId: optionalValue(state.modelId),
    workspaceId: optionalValue(state.workspaceId),
    agentEngine: state.agentEngine || undefined,
    listenMode: state.listenMode,
    permissionMode: state.permissionMode,
    enabled: state.enabled,
    privateMemorySummary: optionalValue(state.privateMemorySummary),
  }
}

export function getRoomMentionQuery(value: string, cursorIndex: number): RoomMentionQuery {
  const beforeCursor = value.slice(0, cursorIndex)
  const atIndex = beforeCursor.lastIndexOf('@')
  if (atIndex < 0) return { active: false, startIndex: -1, query: '' }
  const query = beforeCursor.slice(atIndex + 1)
  if (/\s/.test(query)) return { active: false, startIndex: -1, query: '' }
  return { active: true, startIndex: atIndex, query }
}

export function getMentionableMembers(input: { members: RoomMemberConfig[]; query: string }): RoomMemberConfig[] {
  const normalizedQuery = input.query.trim().toLowerCase()
  return input.members
    .filter((member) => member.enabled)
    .filter((member) => !normalizedQuery || member.name.toLowerCase().includes(normalizedQuery))
    .slice(0, 6)
}

export function insertRoomMention(value: string, cursorIndex: number, query: RoomMentionQuery, memberName: string): { value: string; cursorIndex: number } {
  if (!query.active) return { value, cursorIndex }
  const mention = `@${memberName} `
  const restStart = value[cursorIndex] === ' ' ? cursorIndex + 1 : cursorIndex
  const nextValue = `${value.slice(0, query.startIndex)}${mention}${value.slice(restStart)}`
  return { value: nextValue, cursorIndex: query.startIndex + mention.length }
}
