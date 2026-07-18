/**
 * Agent Room 相关类型定义
 *
 * Room 是 Proma 的 Agent 团队房间：人类与多个长期存在的 Agent 成员共享消息流。
 */

import type { AgentEngine, PromaPermissionMode } from './agent'

/** Room 成员监听方式 */
export type RoomMemberListenMode = 'mention-only' | 'listen-and-score'

/** Room 消息角色 */
export type RoomMessageRole = 'human' | 'agent' | 'system'

/** Room 消息状态 */
export type RoomMessageStatus = 'pending' | 'streaming' | 'final' | 'error'

/** Room Agent 轻量过程输出类型 */
export type RoomProgressKind = 'status' | 'text' | 'tool' | 'task' | 'retry' | 'error'

/** Room Agent 轻量过程输出 */
export interface RoomProgressItem {
  id: string
  kind: RoomProgressKind
  content: string
  createdAt: number
}

/** Room 草稿状态 */
export type RoomDraftStatus = 'pending' | 'sent' | 'discarded'

/** Room 监听评分后的动作 */
export type RoomRoutingAction = 'send' | 'draft' | 'silent'

/** Room 轻量索引项 */
export interface RoomMeta {
  /** 房间唯一标识 */
  id: string
  /** 房间标题 */
  title: string
  /** 房间描述 */
  description?: string
  /** 是否置顶 */
  pinned?: boolean
  /** 是否已归档 */
  archived?: boolean
  /** 创建时间戳 */
  createdAt: number
  /** 更新时间戳 */
  updatedAt: number
}

/** Room 内置默认频道 ID */
export const DEFAULT_ROOM_CHANNEL_ID = 'general'

/** Room 频道 */
export interface RoomChannel {
  /** 频道唯一标识；默认频道固定为 general */
  id: string
  /** 所属房间 ID */
  roomId: string
  /** 频道名称，不含 # */
  name: string
  /** 频道说明 */
  description?: string
  /** 是否归档 */
  archived?: boolean
  /** 创建时间戳 */
  createdAt: number
  /** 更新时间戳 */
  updatedAt: number
}

/** 创建 Room 频道输入 */
export interface RoomChannelCreateInput {
  roomId: string
  name: string
  description?: string
}

/** 更新 Room 频道输入 */
export interface RoomChannelUpdateInput {
  name?: string
  description?: string
  archived?: boolean
}

/** 创建 Room 输入 */
export interface RoomCreateInput {
  title?: string
  description?: string
}

/** 更新 Room 输入 */
export interface RoomUpdateInput {
  title?: string
  description?: string
  pinned?: boolean
  archived?: boolean
}

/** Room Agent 成员配置 */
export interface RoomMemberConfig {
  /** 成员唯一标识 */
  id: string
  /** 所属房间 ID */
  roomId: string
  /** 展示名称 */
  name: string
  /** 头像或 emoji */
  avatar?: string
  /** 角色提示词 */
  rolePrompt: string
  /** 使用的渠道 ID */
  channelId?: string
  /** 使用的模型 ID */
  modelId?: string
  /** 绑定的工作区 ID */
  workspaceId?: string
  /** 成员运行引擎；未设置时跟随工作区 */
  agentEngine?: AgentEngine
  /** 是否启用 */
  enabled: boolean
  /** 监听模式 */
  listenMode: RoomMemberListenMode
  /** 成员默认权限模式 */
  permissionMode?: PromaPermissionMode
  /** 成员私有记忆摘要 */
  privateMemorySummary?: string
  /** 创建时间戳 */
  createdAt: number
  /** 更新时间戳 */
  updatedAt: number
}

/** 创建或更新 Room 成员输入 */
export interface RoomMemberSaveInput {
  roomId: string
  memberId?: string
  name: string
  avatar?: string
  rolePrompt: string
  channelId?: string
  modelId?: string
  workspaceId?: string
  agentEngine?: AgentEngine
  enabled?: boolean
  listenMode?: RoomMemberListenMode
  permissionMode?: PromaPermissionMode
  privateMemorySummary?: string
}

/** Room 消息 */
export interface RoomMessage {
  /** 消息唯一标识 */
  id: string
  /** 所属房间 ID */
  roomId: string
  /** 所属 Room 频道 ID。旧消息缺省时视为 general。 */
  roomChannelId?: string
  /** 消息角色 */
  role: RoomMessageRole
  /** 发送者 ID。human 可为空，agent 对应 memberId */
  authorId?: string
  /** 消息正文 */
  content: string
  /** 消息状态 */
  status: RoomMessageStatus
  /** 错误信息 */
  error?: string
  /** 临时过程输出；用于渲染运行中的可折叠进度，不要求持久化 */
  progress?: RoomProgressItem[]
  /** 触发本消息的源消息 ID */
  sourceMessageId?: string
  /** 创建时间戳 */
  createdAt: number
  /** 更新时间戳 */
  updatedAt: number
}

/** Room 草稿 */
export interface RoomDraft {
  /** 草稿唯一标识 */
  id: string
  /** 所属房间 ID */
  roomId: string
  /** 所属 Room 频道 ID。旧草稿缺省时视为 general。 */
  roomChannelId?: string
  /** 生成草稿的成员 ID */
  memberId: string
  /** 来源消息 ID */
  sourceMessageId: string
  /** 草稿正文 */
  content: string
  /** 监听评分 */
  score?: number
  /** 分流原因 */
  reason?: string
  /** 草稿状态 */
  status: RoomDraftStatus
  /** 创建时间戳 */
  createdAt: number
  /** 更新时间戳 */
  updatedAt: number
}

/** Room 发送消息输入 */
export interface RoomSendMessageInput {
  roomId: string
  roomChannelId?: string
  content: string
  authorId?: string
  /**
   * 可选：监听成员的路由判定结果。
   *
   * MVP 阶段用于把“轻量规则 + LLM 判定”的边界固定下来：
   * - send：高置信，直接进入房间消息流
   * - draft：低置信，进入草稿卡等待确认
   * - silent：不相关，保持沉默
   *
   * 后续真实 LLM scorer 接入时，可由主进程 Room 编排层生成该结构。
   */
  routingDecisions?: Record<string, RoomRoutingDecision>
}

/** Room 监听路由判定结果 */
export interface RoomRoutingDecision {
  action: RoomRoutingAction
  score?: number
  reason?: string
  content?: string
}

/** Room 草稿更新输入 */
export interface RoomUpdateDraftInput {
  roomId: string
  roomChannelId?: string
  draftId: string
  action: 'send' | 'discard'
  content?: string
}

/** Room Agent 后台运行状态事件 */
export type RoomStreamEvent =
  | {
      type: 'message_added'
      roomId: string
      message: RoomMessage
    }
  | {
      type: 'agent_started'
      roomId: string
      roomChannelId?: string
      messageId: string
      memberId: string
      sessionId: string
    }
  | {
      type: 'agent_progress'
      roomId: string
      roomChannelId?: string
      messageId: string
      memberId: string
      sessionId: string
      item: RoomProgressItem
    }
  | {
      type: 'agent_completed'
      roomId: string
      roomChannelId?: string
      messageId: string
      memberId: string
      sessionId: string
      content: string
    }
  | {
      type: 'agent_error'
      roomId: string
      roomChannelId?: string
      messageId: string
      memberId: string
      sessionId: string
      error: string
    }

/** Room IPC 通道常量 */
export const ROOM_IPC_CHANNELS = {
  LIST_ROOMS: 'room:list-rooms',
  CREATE_ROOM: 'room:create-room',
  UPDATE_ROOM: 'room:update-room',
  DELETE_ROOM: 'room:delete-room',
  LIST_CHANNELS: 'room:list-channels',
  CREATE_CHANNEL: 'room:create-channel',
  UPDATE_CHANNEL: 'room:update-channel',
  DELETE_CHANNEL: 'room:delete-channel',
  LIST_MEMBERS: 'room:list-members',
  SAVE_MEMBER: 'room:save-member',
  DELETE_MEMBER: 'room:delete-member',
  GET_MESSAGES: 'room:get-messages',
  SEND_MESSAGE: 'room:send-message',
  LIST_DRAFTS: 'room:list-drafts',
  UPDATE_DRAFT: 'room:update-draft',
  STOP_STREAM: 'room:stop-stream',
  STREAM_EVENT: 'room:stream-event',
} as const
