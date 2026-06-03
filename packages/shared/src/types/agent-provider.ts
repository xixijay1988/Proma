/**
 * Agent Provider 适配器接口
 *
 * 定义 Proma 自己的 Agent 接口层，让底层 SDK 可替换。
 * 当前实现：ClaudeAgentAdapter（基于 @anthropic-ai/claude-agent-sdk）
 * 未来可扩展：PiAgentAdapter 等。
 */

import type { AgentRuntimeImageInput, SDKMessage } from './agent'

/** SDK 用户消息（队列消息注入用，匹配 SDK SDKUserMessage 结构） */
export interface SDKUserMessageInput {
  type: 'user'
  message: { role: 'user'; content: string }
  /** 用户本轮附带的图片输入（base64，不包含 data URL 前缀） */
  images?: AgentRuntimeImageInput[]
  parent_tool_use_id: null
  priority?: 'now' | 'next' | 'later'
  uuid?: string
  session_id: string
}

/** Runtime 扩展 UI 请求（当前由 Pi RPC extension_ui_request 使用） */
export interface AgentRuntimeExtensionUiRequest {
  type: 'extension_ui_request'
  id: string
  method: string
  title?: string
  message?: string
  options?: string[]
  placeholder?: string
  prefill?: string
  timeout?: number
  [key: string]: unknown
}

/** Runtime 扩展 UI 响应（当前写回 Pi RPC extension_ui_response） */
export interface AgentRuntimeExtensionUiResponse {
  type: 'extension_ui_response'
  id: string
  confirmed?: boolean
  value?: string
  cancelled?: boolean
  [key: string]: unknown
}

export type AgentRuntimeExtensionUiHandler = (
  request: AgentRuntimeExtensionUiRequest
) => Promise<Omit<AgentRuntimeExtensionUiResponse, 'type' | 'id'> | void>

/** Pi 原生可分叉消息候选（entry id 来自 Pi session tree） */
export interface AgentRuntimeForkMessage {
  id: string
  text: string
  [key: string]: unknown
}

/** Pi 原生 fork 返回值 */
export interface AgentRuntimeForkResult {
  cancelled: boolean
  text?: string
  [key: string]: unknown
}

/** Pi 原生 clone 返回值 */
export interface AgentRuntimeCloneResult {
  cancelled: boolean
  sessionId?: string
  sessionPath?: string
  [key: string]: unknown
}

/** Pi 原生 switch_session 返回值 */
export interface AgentRuntimeSwitchSessionResult {
  cancelled: boolean
  [key: string]: unknown
}

/** 活跃 runtime 的原生状态快照（当前主要由 Pi RPC get_state 提供） */
export interface AgentRuntimeState {
  provider?: string
  modelId?: string
  modelName?: string
  thinkingLevel?: string
  isStreaming: boolean
  isCompacting: boolean
  steeringMode?: string
  followUpMode?: string
  nativeSessionId?: string
  nativeSessionName?: string
  nativeSessionFile?: string
  autoCompactionEnabled?: boolean
  autoRetryEnabled?: boolean
  isRetrying?: boolean
  messageCount?: number
  pendingMessageCount?: number
  stats?: AgentRuntimeSessionStats
  commands?: AgentRuntimeCommand[]
}

/** 活跃 runtime 的会话统计信息（Pi RPC get_session_stats） */
export interface AgentRuntimeSessionStats {
  userMessages?: number
  assistantMessages?: number
  toolCalls?: number
  toolResults?: number
  totalMessages?: number
  tokens?: {
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
    total?: number
  }
  costUsd?: number
  contextUsage?: {
    tokens?: number | null
    maxTokens?: number
    percent?: number | null
  }
}

/** 活跃 runtime 当前注册的命令、Prompt 和 Skill（Pi RPC get_commands） */
export interface AgentRuntimeCommand {
  name: string
  description?: string
  source: 'extension' | 'prompt' | 'skill' | 'unknown'
  sourceInfo?: {
    name?: string
    path?: string
    [key: string]: unknown
  }
}

/**
 * Agent 查询输入（Provider 无关）
 *
 * 包含所有 Provider 都需要的通用字段。
 * SDK 特定配置通过 Adapter 的扩展输入类型传入。
 */
export interface AgentQueryInput {
  /** 会话 ID */
  sessionId: string
  /** 用户 prompt（已包含上下文注入） */
  prompt: string
  /** 用户本轮附带的图片输入（base64，不包含 data URL 前缀） */
  images?: AgentRuntimeImageInput[]
  /** 模型 ID */
  model?: string
  /** Agent 工作目录 */
  cwd?: string
  /** Runtime 原生 provider 名称（如 Pi RPC 的 provider） */
  provider?: string
  /** Runtime 原生会话目录（如 Pi RPC 的 --session-dir） */
  runtimeSessionDir?: string
  /** Runtime 原生会话文件路径（如 Pi RPC 的 --session） */
  runtimeSessionPath?: string
  /** Runtime 原生扩展入口（如 Pi RPC 的 --extension） */
  runtimeExtensionPaths?: string[]
  /** Runtime 原生 Skill 路径（如 Pi RPC 的 --skill） */
  runtimeSkillPaths?: string[]
  /** 传给底层 Runtime 子进程的额外环境变量 */
  runtimeEnv?: Record<string, string | undefined>
  /** Runtime 原生推理深度（如 Pi RPC 的 thinking level） */
  runtimeThinkingLevel?: string
  /** Runtime 原生自动上下文压缩开关（如 Pi RPC auto compaction） */
  runtimeAutoCompactionEnabled?: boolean
  /** Runtime 原生自动重试开关（如 Pi RPC auto retry） */
  runtimeAutoRetryEnabled?: boolean
  /** 中止信号 */
  abortSignal?: AbortSignal
  /** Runtime 扩展 UI 请求处理器（如 Pi RPC extension UI） */
  handleExtensionUiRequest?: AgentRuntimeExtensionUiHandler
}

/**
 * Agent Provider 适配器接口
 *
 * 职责：接收查询输入，返回 SDKMessage 异步迭代流。
 * SDK 返回完整 JSON 对象（includePartialMessages: false），外部直接透传。
 */
export interface AgentProviderAdapter {
  /** 发起查询，返回 SDKMessage 异步迭代流 */
  query(input: AgentQueryInput): AsyncIterable<SDKMessage>
  /** 中止指定会话的执行 */
  abort(sessionId: string): void
  /**
   * 软中断当前 turn，但保留活跃 Query/Channel 以便继续注入下一条用户消息。
   * 与 abort() 的区别：不杀子进程，允许立即续跑新消息。
   */
  interruptQuery?(sessionId: string): Promise<void>
  /** 释放资源 */
  dispose(): void
  /** 向活跃查询注入队列消息（可选，仅支持队列的 Provider 实现） */
  sendQueuedMessage?(sessionId: string, message: SDKUserMessageInput): Promise<void>
  /** 取消队列中的待发送消息（可选） */
  cancelQueuedMessage?(sessionId: string, messageUuid: string): Promise<void>
  /** 停止活跃 runtime 中的后台任务（可选，仅支持具备后台任务控制的 Provider） */
  stopTask?(sessionId: string, taskId: string): Promise<void>
  /** 停止活跃 runtime 中的 Shell 任务（可选，仅支持具备 Shell 控制的 Provider） */
  stopShellTask?(sessionId: string, taskId: string): Promise<void>
  /** 压缩活跃 runtime 的会话上下文（可选，仅支持具备原生 compact 的 Provider） */
  compact?(sessionId: string, customInstructions?: string): Promise<SDKMessage[]>
  /** 动态切换活跃 runtime 的自动上下文压缩（可选，仅支持具备 auto compaction 的 Provider） */
  setAutoCompaction?(sessionId: string, enabled: boolean): Promise<void>
  /** 动态切换活跃 runtime 的自动重试（可选，仅支持具备 auto retry 的 Provider） */
  setAutoRetry?(sessionId: string, enabled: boolean): Promise<void>
  /** 中止活跃 runtime 中正在进行的自动重试（可选） */
  abortRetry?(sessionId: string): Promise<void>
  /** 动态切换活跃 runtime 的推理深度（可选，仅支持具备 thinking level 的 Provider） */
  setThinkingLevel?(sessionId: string, level: string): Promise<void>
  /** 动态切换活跃查询的权限模式（可选，仅支持 SDK 原生 setPermissionMode 的 Provider） */
  setPermissionMode?(sessionId: string, mode: string): Promise<void>
  /** 动态切换活跃 runtime 的 steering 队列投递模式（可选，仅支持具备 queue mode 的 Provider） */
  setSteeringMode?(sessionId: string, mode: string): Promise<void>
  /** 动态切换活跃 runtime 的 follow-up 队列投递模式（可选，仅支持具备 queue mode 的 Provider） */
  setFollowUpMode?(sessionId: string, mode: string): Promise<void>
  /** 同步活跃 runtime 的原生会话名称（可选，仅支持具备 session name 的 Provider） */
  setSessionName?(sessionId: string, name: string): Promise<void>
  /** 获取活跃 runtime 的原生 fork 候选消息（可选，仅支持具备 session tree 的 Provider） */
  getForkMessages?(sessionId: string): Promise<AgentRuntimeForkMessage[]>
  /** 在活跃 runtime 中执行原生 fork（可选，仅支持具备 session tree 的 Provider） */
  fork?(sessionId: string, entryId: string): Promise<AgentRuntimeForkResult>
  /** 在活跃 runtime 中克隆当前分支到新原生 session（可选，仅支持具备 session tree 的 Provider） */
  clone?(sessionId: string): Promise<AgentRuntimeCloneResult>
  /** 在活跃 runtime 中切换到指定原生 session 文件（可选，仅支持具备 session tree 的 Provider） */
  switchSession?(sessionId: string, sessionPath: string): Promise<AgentRuntimeSwitchSessionResult>
  /** 获取活跃 runtime 当前消息快照（可选，用于 Pi 原生历史同步等运行中场景） */
  getMessages?(sessionId: string): Promise<SDKMessage[]>
  /** 获取活跃 runtime 当前状态快照（可选，用于 Pi runtime diagnostics） */
  getRuntimeState?(sessionId: string): Promise<AgentRuntimeState>
}
