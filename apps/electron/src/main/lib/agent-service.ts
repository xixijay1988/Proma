/**
 * Agent 服务层（IPC 薄层）
 *
 * 职责：
 * - 创建 AgentOrchestrator / EventBus / Adapter 实例
 * - 注册 EventBus IPC 转发中间件（webContents.send）
 * - 导出 IPC handler 调用的薄包装函数
 * - 文件操作（saveFilesToAgentSession）
 *
 * 所有业务逻辑已委托给 AgentOrchestrator。
 */

import { join, dirname } from 'node:path'
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { BrowserWindow } from 'electron'
import type { WebContents } from 'electron'
import { AGENT_IPC_CHANNELS, MAX_ATTACHMENT_SIZE } from '@proma/shared'
import type {
  AgentSendInput,
  AgentGenerateTitleInput,
  AgentSaveFilesInput,
  AgentSaveWorkspaceFilesInput,
  AgentSavedFile,
  AgentStreamEvent,
  AgentStreamPayload,
  AgentQueueMessageInput,
  PromaPermissionMode,
  AgentExternalRunSource,
  AgentEngine,
  AgentProviderAdapter,
  SwitchActiveSessionInput,
  SetPiSessionFileInput,
  ForkSessionInput,
  SDKMessage,
  SyncPiNativeSessionMessagesInput,
  SyncPiNativeSessionMessagesResult,
  ApplyPiGitCheckpointInput,
  ApplyPiGitCheckpointResult,
} from '@proma/shared'
import { scanAndKillOrphanedClaudeSubprocesses } from './adapters/claude-agent-adapter'
import { createAgentAdapterRegistry } from './agent-adapter-registry'
import { AgentEventBus } from './agent-event-bus'
import { AgentOrchestrator } from './agent-orchestrator'
import { getAgentSessionWorkspacePath, getWorkspaceFilesDir } from './config-paths'
import {
  appendSDKMessages,
  createAgentSession,
  forkAgentSession as forkAgentSessionFromManager,
  getAgentSessionMeta,
  getAgentSessionSDKMessages,
  syncPiNativeSessionMessages as syncPiNativeSessionMessagesFromFile,
  updateAgentSessionMeta,
} from './agent-session-manager'
import { getAgentWorkspace } from './agent-workspace-manager'
import { resolveAgentEngine, resolveExistingSessionAgentEngine } from './agent-engine'
import { applyPiGitCheckpoint, type PiGitCommandResult } from './adapters/pi-git-checkpoint-extension'

const MAX_IMPORTED_PI_TITLE_LENGTH = 20
const DEFAULT_AGENT_SESSION_TITLES = new Set([
  '新 Agent 会话',
  '新会话',
  '未命名会话',
])

// ===== 实例创建 =====

const eventBus = new AgentEventBus()
const adapterRegistry = createAgentAdapterRegistry()
const orchestrators = new Map<AgentEngine, AgentOrchestrator>()
const orchestratorAdapters = new Set<AgentProviderAdapter>()
const activeSessionOrchestrators = new Map<string, AgentOrchestrator>()

function getOrchestrator(engine: AgentEngine): AgentOrchestrator {
  const existing = orchestrators.get(engine)
  if (existing) return existing

  const adapter = adapterRegistry.get(engine)
  const orchestrator = new AgentOrchestrator(adapter, eventBus, engine)
  orchestrators.set(engine, orchestrator)
  orchestratorAdapters.add(adapter)
  return orchestrator
}

function resolveEngineForSession(sessionId: string): AgentEngine {
  const session = getAgentSessionMeta(sessionId)
  return session ? resolveExistingSessionAgentEngine({ session }) : resolveAgentEngine({})
}

function resolveEngineForRun(input: AgentSendInput): AgentEngine {
  const session = getAgentSessionMeta(input.sessionId)
  const workspaceId = input.workspaceId ?? session?.workspaceId
  const workspace = workspaceId ? getAgentWorkspace(workspaceId) : null
  return session
    ? resolveExistingSessionAgentEngine({ session })
    : resolveAgentEngine({ workspace })
}

function getSessionOrchestrator(sessionId: string): AgentOrchestrator {
  return getOrchestrator(resolveEngineForSession(sessionId))
}

function getActiveSessionOrchestrator(sessionId: string): AgentOrchestrator | null {
  return activeSessionOrchestrators.get(sessionId) ?? null
}

function getPiEntryId(message: SDKMessage): string | undefined {
  const value = (message as { _promaPiEntryId?: unknown })._promaPiEntryId
  return typeof value === 'string' && value.trim() ? value : undefined
}

function appendMissingPiRuntimeMessages(
  sessionId: string,
  runtimeMessages: SDKMessage[],
): SyncPiNativeSessionMessagesResult {
  const existingPiEntryIds = new Set(
    getAgentSessionSDKMessages(sessionId)
      .map((message) => getPiEntryId(message))
      .filter((entryId): entryId is string => Boolean(entryId)),
  )

  const messagesToAppend: SDKMessage[] = []
  let skippedCount = 0
  for (const message of runtimeMessages) {
    const entryId = getPiEntryId(message)
    if (entryId && existingPiEntryIds.has(entryId)) {
      skippedCount += 1
      continue
    }
    if (entryId) existingPiEntryIds.add(entryId)
    messagesToAppend.push(message)
  }

  appendSDKMessages(sessionId, messagesToAppend)
  return {
    importedCount: messagesToAppend.length,
    skippedCount,
    totalCount: runtimeMessages.length,
  }
}

function getSessionOperationOrchestrator(sessionId: string): AgentOrchestrator {
  return getActiveSessionOrchestrator(sessionId) ?? getSessionOrchestrator(sessionId)
}

function getRunOrchestrator(input: AgentSendInput): AgentOrchestrator {
  return getActiveSessionOrchestrator(input.sessionId) ?? getOrchestrator(resolveEngineForRun(input))
}

interface PiNativeSessionSummary {
  id?: string
  firstUserMessage?: string
}

function isDefaultAgentSessionTitle(title: string | undefined): boolean {
  const normalized = title?.trim()
  return !normalized || DEFAULT_AGENT_SESSION_TITLES.has(normalized)
}

function normalizeImportedPiTitle(text: string | undefined): string | undefined {
  const normalized = text?.replace(/\s+/g, ' ').trim()
  if (!normalized) return undefined
  return normalized.slice(0, MAX_IMPORTED_PI_TITLE_LENGTH)
}

function extractTextContent(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return undefined

  const parts: string[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const block = item as Record<string, unknown>
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
    }
  }

  return parts.join(' ')
}

function readPiNativeSessionSummary(sessionPath: string): PiNativeSessionSummary {
  try {
    const raw = readFileSync(sessionPath, 'utf-8')
    const lines = raw.split(/\r?\n/)
    const summary: PiNativeSessionSummary = {}

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      const parsed = JSON.parse(trimmed) as unknown
      if (!parsed || typeof parsed !== 'object') continue

      const entry = parsed as Record<string, unknown>
      if (entry.type === 'session' && typeof entry.id === 'string' && entry.id.trim()) {
        summary.id = entry.id.trim()
        continue
      }

      if (entry.type !== 'message' || summary.firstUserMessage) continue
      const message = entry.message
      if (!message || typeof message !== 'object') continue

      const messageRecord = message as Record<string, unknown>
      if (messageRecord.role !== 'user') continue

      const content = extractTextContent(messageRecord.content)
      const normalized = normalizeImportedPiTitle(content)
      if (normalized) {
        summary.firstUserMessage = normalized
      }
    }

    return summary
  } catch (error) {
    console.warn(`[Agent 服务] 读取 Pi 原生 session 摘要失败: ${sessionPath}`, error)
    return {}
  }
}

function buildPiSessionFileMetaUpdateForSession(sessionPath: string, sourceMeta: { title?: string }): {
  forkSourcePiSessionPath: string
  forkSourcePiSessionId?: string
  title?: string
} {
  const summary = readPiNativeSessionSummary(sessionPath)
  return {
    forkSourcePiSessionPath: sessionPath,
    ...(summary.id ? { forkSourcePiSessionId: summary.id } : {}),
    ...(isDefaultAgentSessionTitle(sourceMeta.title) && summary.firstUserMessage
      ? { title: summary.firstUserMessage }
      : {}),
  }
}

function trackActiveSessionOrchestrator(sessionId: string, orchestrator: AgentOrchestrator): void {
  activeSessionOrchestrators.set(sessionId, orchestrator)
}

function releaseActiveSessionOrchestrator(sessionId: string, orchestrator: AgentOrchestrator): void {
  if (activeSessionOrchestrators.get(sessionId) !== orchestrator) return
  if (orchestrator.isActive(sessionId)) return
  activeSessionOrchestrators.delete(sessionId)
}

export function __testTrackActiveSessionOrchestrator(sessionId: string, orchestrator: AgentOrchestrator): void {
  trackActiveSessionOrchestrator(sessionId, orchestrator)
}

export function __testReleaseActiveSessionOrchestrator(sessionId: string, orchestrator: AgentOrchestrator): void {
  activeSessionOrchestrators.delete(sessionId)
  releaseActiveSessionOrchestrator(sessionId, orchestrator)
}

/** 导出 EventBus 供飞书 Bridge 等外部服务订阅事件 */
export { eventBus as agentEventBus }

/**
 * 会话 → webContents 映射
 *
 * EventBus IPC 转发中间件通过此映射找到目标 webContents。
 * runAgent 开始时注册，结束时清理。
 */
const sessionWebContents = new Map<string, WebContents>()

/**
 * 已挂载 destroyed 回收钩子的 webContents 集合。
 *
 * 同一个主窗口 webContents 可能被多次注册（飞书 Bridge 每条消息触发一次 runAgentHeadless），
 * 用 WeakSet 去重避免 once listener 在同一 wc 上累积，触发 MaxListenersExceededWarning。
 */
const wcWithCleanupHook = new WeakSet<WebContents>()

/**
 * 注册 sessionId → webContents 映射，并在 webContents 销毁时自动清理所有相关条目。
 *
 * 仅依赖 finally 块清理无法覆盖窗口关闭、渲染进程崩溃、headless 路径主窗口被替换等
 * webContents 提前销毁的场景——destroyed 事件兜底。
 */
function registerWebContents(sessionId: string, wc: WebContents): void {
  // 同一 sessionId 切换 webContents 时直接覆盖；旧 wc 的 destroyed 钩子仍由 WeakSet 持有，
  // 触发时会扫描 sessionWebContents 清理所有指向旧 wc 的条目（见下方实现）。
  sessionWebContents.set(sessionId, wc)
  if (wcWithCleanupHook.has(wc)) return
  wcWithCleanupHook.add(wc)
  wc.once('destroyed', () => {
    // 单个 wc 可能映射到多个 sessionId（同窗口多 tab），需要清理所有指向它的条目
    for (const [sid, mappedWc] of sessionWebContents) {
      if (mappedWc === wc) sessionWebContents.delete(sid)
    }
  })
}

function isMainRendererWindow(win: BrowserWindow): boolean {
  if (win.isDestroyed()) return false
  const url = win.webContents.getURL()
  if (!url) return false
  if (url.startsWith('data:')) return false
  return !url.includes('window=quick-task')
    && !url.includes('window=voice-dictation')
    && !url.includes('window=detached-preview')
}

function getMainRendererWebContents(): WebContents | null {
  const win = BrowserWindow.getAllWindows().find(isMainRendererWindow)
  return win && !win.webContents.isDestroyed() ? win.webContents : null
}

// ===== EventBus IPC 转发中间件 =====

eventBus.use((sessionId, payload, next) => {
  const wc = sessionWebContents.get(sessionId)
  if (wc && !wc.isDestroyed()) {
    try {
      wc.send(AGENT_IPC_CHANNELS.STREAM_EVENT, { sessionId, payload } as AgentStreamEvent)
    } catch (err) {
      console.error(`[EventBus] wc.send 失败: sessionId=${sessionId}, payload.kind=${(payload as Record<string, unknown>)?.kind}`, err)
    }
  }
  next()
})

// ===== IPC 薄包装函数 =====

/**
 * 运行 Agent 并流式推送事件到渲染进程
 *
 * 注册 webContents 到 EventBus 映射，委托给 Orchestrator。
 */
export async function runAgent(
  input: AgentSendInput,
  webContents: WebContents,
): Promise<void> {
  const orchestrator = getRunOrchestrator(input)
  trackActiveSessionOrchestrator(input.sessionId, orchestrator)
  // 更新 webContents 映射（允许覆盖 — 由 orchestrator.activeSessions 处理真正的并发保护）
  registerWebContents(input.sessionId, webContents)
  try {
    await orchestrator.sendMessage(input, {
      onError: (error) => {
        if (!webContents.isDestroyed()) {
          webContents.send(AGENT_IPC_CHANNELS.STREAM_ERROR, {
            sessionId: input.sessionId,
            error,
          })
        }
      },
      onComplete: (messages, opts) => {
        if (!webContents.isDestroyed()) {
          webContents.send(AGENT_IPC_CHANNELS.STREAM_COMPLETE, {
            sessionId: input.sessionId,
            messages,
            stoppedByUser: opts?.stoppedByUser ?? false,
            startedAt: opts?.startedAt,
            resultSubtype: opts?.resultSubtype,
          })
        }
      },
      onTitleUpdated: (title) => {
        eventBus.emit(input.sessionId, {
          kind: 'proma_event',
          event: { type: 'title_updated', title },
        })
        if (!webContents.isDestroyed()) {
          webContents.send(AGENT_IPC_CHANNELS.TITLE_UPDATED, {
            sessionId: input.sessionId,
            title,
          })
        }
      },
    })
  } catch (err) {
    console.error('[Agent 服务] runAgent 未处理异常:', err)
    const errorMessage = err instanceof Error ? err.message : '未知错误'
    if (!webContents.isDestroyed()) {
      webContents.send(AGENT_IPC_CHANNELS.STREAM_ERROR, {
        sessionId: input.sessionId,
        error: errorMessage,
      })
      webContents.send(AGENT_IPC_CHANNELS.STREAM_COMPLETE, {
        sessionId: input.sessionId,
        messages: [],
        stoppedByUser: false,
      })
    }
  } finally {
    // 仅在 orchestrator 已完成此会话时清理映射
    // 避免被拒绝的请求误删仍在运行的会话映射
    if (!orchestrator.isActive(input.sessionId)) {
      sessionWebContents.delete(input.sessionId)
    }
    releaseActiveSessionOrchestrator(input.sessionId, orchestrator)
  }
}

/**
 * 无渲染进程的 Agent 运行（供飞书 Bridge 等外部调用方使用）
 *
 * 如果桌面窗口存在，同时注册 webContents 以便事件同步到桌面端 UI。
 * 事件同时通过 EventBus listeners 分发给飞书 Bridge。
 */
export async function runAgentHeadless(
  input: AgentSendInput,
  callbacks: {
    onError: (error: string) => void
    onComplete: () => void
    onTitleUpdated: (title: string) => void
    source?: AgentExternalRunSource
  },
): Promise<void> {
  // 尝试注册主窗口 webContents，让流式事件同步推送到桌面端
  const wc = getMainRendererWebContents()
  const runInput: AgentSendInput = input.startedAt != null ? input : { ...input, startedAt: Date.now() }
  const orchestrator = getRunOrchestrator(runInput)
  trackActiveSessionOrchestrator(runInput.sessionId, orchestrator)
  const startedAt = runInput.startedAt!
  if (wc) {
    registerWebContents(runInput.sessionId, wc)
  }

  try {
    await orchestrator.sendMessage(runInput, {
      onError: (error) => {
        callbacks.onError(error)
        // 同步到渲染进程
        if (wc && !wc.isDestroyed()) {
          wc.send(AGENT_IPC_CHANNELS.STREAM_ERROR, {
            sessionId: runInput.sessionId,
            error,
          })
        }
      },
      onComplete: (messages, opts) => {
        callbacks.onComplete()
        // 同步到渲染进程
        if (wc && !wc.isDestroyed()) {
          wc.send(AGENT_IPC_CHANNELS.STREAM_COMPLETE, {
            sessionId: runInput.sessionId,
            messages,
            stoppedByUser: opts?.stoppedByUser ?? false,
            startedAt: opts?.startedAt,
            resultSubtype: opts?.resultSubtype,
          })
        }
      },
      onTitleUpdated: (title) => {
        callbacks.onTitleUpdated(title)
        eventBus.emit(runInput.sessionId, {
          kind: 'proma_event',
          event: { type: 'title_updated', title },
        })
        // 同步到渲染进程
        if (wc && !wc.isDestroyed()) {
          wc.send(AGENT_IPC_CHANNELS.TITLE_UPDATED, {
            sessionId: runInput.sessionId,
            title,
          })
        }
      },
      onRunStarted: ({ startedAt: persistedStartedAt }) => {
        const session = getAgentSessionMeta(runInput.sessionId)
        eventBus.emit(runInput.sessionId, {
          kind: 'proma_event',
          event: {
            type: 'external_run_started',
            source: callbacks.source ?? 'bridge',
            sessionId: runInput.sessionId,
            title: session?.title,
            workspaceId: runInput.workspaceId ?? session?.workspaceId,
            modelId: runInput.modelId,
            startedAt: persistedStartedAt,
          },
        })
      },
    })
  } catch (err) {
    console.error('[Agent 服务] runAgentHeadless 未处理异常:', err)
    const errorMessage = err instanceof Error ? err.message : '未知错误'
    callbacks.onError(errorMessage)
    callbacks.onComplete()
    if (wc && !wc.isDestroyed()) {
      wc.send(AGENT_IPC_CHANNELS.STREAM_ERROR, { sessionId: runInput.sessionId, error: errorMessage })
      wc.send(AGENT_IPC_CHANNELS.STREAM_COMPLETE, { sessionId: runInput.sessionId, messages: [], stoppedByUser: false, startedAt })
    }
  } finally {
    if (!orchestrator.isActive(runInput.sessionId)) {
      sessionWebContents.delete(runInput.sessionId)
    }
    releaseActiveSessionOrchestrator(runInput.sessionId, orchestrator)
  }
}

/**
 * 生成 Agent 会话标题
 */
export async function generateAgentTitle(input: AgentGenerateTitleInput): Promise<string | null> {
  return getOrchestrator('claude-sdk').generateTitle(input)
}

/**
 * 中止指定会话的 Agent 执行
 */
export function stopAgent(sessionId: string): void {
  getSessionOperationOrchestrator(sessionId).stop(sessionId)
}

/**
 * 快照回退：回退到指定消息点，恢复文件 + 截断对话
 */
export async function rewindAgentSession(
  sessionId: string,
  assistantMessageUuid: string,
): Promise<import('@proma/shared').RewindSessionResult> {
  const engine = resolveEngineForSession(sessionId)
  return getOrchestrator(engine).rewindSession(sessionId, assistantMessageUuid)
}

/**
 * 显式应用 Pi git checkpoint。
 *
 * 前端只传 Proma session + Pi entry id；git ref 必须由主进程从当前 Pi native
 * session JSONL 重新解析，避免 renderer 伪造任意 git ref。
 */
export function applyPiGitCheckpointForSession(
  input: ApplyPiGitCheckpointInput,
  runGit?: (cwd: string, args: string[]) => PiGitCommandResult,
): ApplyPiGitCheckpointResult {
  const sourceMeta = getAgentSessionMeta(input.sessionId)
  if (!sourceMeta) {
    throw new Error(`Agent 会话不存在: ${input.sessionId}`)
  }

  const engine = resolveExistingSessionAgentEngine({ session: sourceMeta })
  if (engine !== 'pi') {
    throw new Error('仅支持 Pi Agent 会话恢复 Pi git checkpoint')
  }

  const sessionPath = sourceMeta.forkSourcePiSessionPath?.trim()
  if (!sessionPath) {
    throw new Error('当前 Pi 会话没有可恢复的原生 session 文件')
  }
  if (!existsSync(sessionPath)) {
    throw new Error(`Pi 原生 session 文件不存在: ${sessionPath}`)
  }

  const targetEntryId = input.targetEntryId.trim()
  if (!targetEntryId) {
    throw new Error('Pi checkpoint targetEntryId 不能为空')
  }

  const result = applyPiGitCheckpoint({
    sessionPath,
    targetEntryId,
    ...(runGit ? { runGit } : {}),
  })
  console.log(
    `[Agent 服务] Pi git checkpoint 恢复${result.restored ? '成功' : '未执行'}: session=${input.sessionId}, target=${targetEntryId}, checkpoint=${result.checkpoint?.entryId ?? 'none'}`,
  )
  return result
}

/**
 * 分叉 Agent 会话。
 *
 * Pi 运行中会话优先调用 runtime 原生 fork，以保持 Pi session tree 与 Proma 会话一致；
 * 之后仍复用 session-manager 的 Proma 层 fork 来复制 UI 历史和工作区文件。
 */
export async function forkAgentSession(input: ForkSessionInput): Promise<import('@proma/shared').AgentSessionMeta> {
  const sourceMeta = getAgentSessionMeta(input.sessionId)
  if (!sourceMeta) {
    throw new Error(`源 Agent 会话不存在: ${input.sessionId}`)
  }

  const engine = resolveExistingSessionAgentEngine({ session: sourceMeta })
  let runtimeFork:
    | { sessionId?: string; sessionPath?: string }
    | null = null

  if (engine === 'pi' && input.upToMessageUuid) {
    const activeOrchestrator = getActiveSessionOrchestrator(input.sessionId)
    if (activeOrchestrator) {
      try {
        runtimeFork = await activeOrchestrator.forkActiveRuntimeSession(input.sessionId, input.upToMessageUuid)
      } catch (error) {
        console.warn('[Agent 服务] Pi active runtime fork 失败，回退到 Proma 层分叉:', error)
      }
    }
  }

  const forked = await forkAgentSessionFromManager(input)
  if (runtimeFork?.sessionId || runtimeFork?.sessionPath) {
    const updated = updateAgentSessionMeta(forked.id, {
      ...(runtimeFork.sessionId ? { forkSourcePiSessionId: runtimeFork.sessionId } : {}),
      ...(runtimeFork.sessionPath ? { forkSourcePiSessionPath: runtimeFork.sessionPath } : {}),
    })
    console.log(`[Agent 服务] 已将 Pi runtime fork 绑定到 Proma 分叉会话: ${forked.id}`)
    return updated
  }

  return forked
}

/**
 * 克隆活跃 Pi runtime 的当前原生会话分支，并创建对应的 Proma 会话。
 */
export async function cloneActiveAgentSession(sessionId: string): Promise<import('@proma/shared').AgentSessionMeta> {
  const sourceMeta = getAgentSessionMeta(sessionId)
  if (!sourceMeta) {
    throw new Error(`源 Agent 会话不存在: ${sessionId}`)
  }

  const engine = resolveExistingSessionAgentEngine({ session: sourceMeta })
  if (engine !== 'pi') {
    throw new Error('当前仅 Pi Agent RPC 支持 runtime clone')
  }

  const activeOrchestrator = getActiveSessionOrchestrator(sessionId)
  if (!activeOrchestrator) {
    throw new Error('会话未在运行中，无法执行 runtime clone')
  }

  const cloneResult = await activeOrchestrator.cloneActiveRuntimeSession(sessionId)
  const title = `${sourceMeta.title} (clone)`
  const created = createAgentSession(title, sourceMeta.channelId, sourceMeta.workspaceId, engine)
  const updated = updateAgentSessionMeta(created.id, {
    forkSourcePiSessionId: cloneResult.sessionId,
    forkSourcePiSessionPath: cloneResult.sessionPath,
  })

  console.log(`[Agent 服务] 已创建 Pi runtime clone 会话: ${sourceMeta.id} → ${updated.id}`)
  return updated
}

/**
 * 切换活跃 Pi runtime 到指定原生 session 文件，并持久化到当前 Proma 会话。
 */
export async function switchActiveAgentSession(input: SwitchActiveSessionInput): Promise<import('@proma/shared').AgentSessionMeta> {
  const sourceMeta = getAgentSessionMeta(input.sessionId)
  if (!sourceMeta) {
    throw new Error(`Agent 会话不存在: ${input.sessionId}`)
  }

  const engine = resolveExistingSessionAgentEngine({ session: sourceMeta })
  if (engine !== 'pi') {
    throw new Error('当前仅 Pi Agent RPC 支持 runtime switch_session')
  }

  const activeOrchestrator = getActiveSessionOrchestrator(input.sessionId)
  if (!activeOrchestrator) {
    throw new Error('会话未在运行中，无法执行 runtime switch_session')
  }

  const switchResult = await activeOrchestrator.switchActiveRuntimeSession(input.sessionId, input.sessionPath)
  const updated = updateAgentSessionMeta(
    input.sessionId,
    buildPiSessionFileMetaUpdateForSession(switchResult.sessionPath, sourceMeta),
  )

  console.log(`[Agent 服务] 已切换 Pi runtime session: ${input.sessionId} → ${switchResult.sessionPath}`)
  return updated
}

/**
 * 设置 Pi 原生 session 文件，供该 Proma 会话下次启动 Pi runtime 时恢复。
 */
export async function setPiSessionFileForNextRun(input: SetPiSessionFileInput): Promise<import('@proma/shared').AgentSessionMeta> {
  const sourceMeta = getAgentSessionMeta(input.sessionId)
  if (!sourceMeta) {
    throw new Error(`Agent 会话不存在: ${input.sessionId}`)
  }

  const sessionPath = input.sessionPath.trim()
  if (!sessionPath) {
    throw new Error('Pi 原生 session 文件路径不能为空')
  }

  const engine = resolveExistingSessionAgentEngine({ session: sourceMeta })
  if (engine !== 'pi') {
    throw new Error('当前仅 Pi Agent RPC 支持设置原生 session 文件')
  }

  const updated = updateAgentSessionMeta(
    input.sessionId,
    buildPiSessionFileMetaUpdateForSession(sessionPath, sourceMeta),
  )

  console.log(`[Agent 服务] 已设置 Pi 下次启动 session 文件: ${input.sessionId} → ${sessionPath}`)
  return updated
}

/**
 * 同步 Pi 原生历史。
 *
 * 运行中的 Pi 会话优先从 active runtime 调用 get_messages；非运行状态或
 * runtime 不支持时，回退到传入的 Pi native session JSONL 文件。
 */
export async function syncPiNativeSessionMessages(
  input: SyncPiNativeSessionMessagesInput,
): Promise<SyncPiNativeSessionMessagesResult> {
  const sourceMeta = getAgentSessionMeta(input.sessionId)
  if (!sourceMeta) {
    throw new Error(`Agent 会话不存在: ${input.sessionId}`)
  }

  const engine = resolveExistingSessionAgentEngine({ session: sourceMeta })
  if (engine !== 'pi') {
    throw new Error('仅支持 Pi Agent 会话同步 Pi 原生历史')
  }

  const activeOrchestrator = getActiveSessionOrchestrator(input.sessionId)
  if (activeOrchestrator) {
    try {
      const runtimeMessages = await activeOrchestrator.getActiveRuntimeMessages(input.sessionId)
      const result = appendMissingPiRuntimeMessages(input.sessionId, runtimeMessages)
      console.log(
        `[Agent 服务] 已同步 Pi active runtime 历史: session=${input.sessionId}, imported=${result.importedCount}, skipped=${result.skippedCount}, total=${result.totalCount}`,
      )
      return result
    } catch (error) {
      if (!input.sessionPath?.trim()) {
        throw error
      }
      console.warn('[Agent 服务] Pi active runtime 历史同步失败，回退到 session 文件同步:', error)
    }
  }

  const sessionPath = input.sessionPath?.trim()
  if (!sessionPath) {
    throw new Error('Pi 原生 session 文件路径不能为空')
  }

  return syncPiNativeSessionMessagesFromFile({
    sessionId: input.sessionId,
    sessionPath,
    leafEntryId: input.leafEntryId,
  })
}

/**
 * 检查指定会话是否正在运行
 */
export function isAgentSessionActive(sessionId: string): boolean {
  const activeOrchestrator = getActiveSessionOrchestrator(sessionId)
  if (activeOrchestrator) return true

  const orchestrator = getSessionOrchestrator(sessionId)
  if (orchestrator.isActive(sessionId)) return true

  // 会话元数据异常或 engine 迁移过程中，兜底扫描已构造实例，避免漏报运行中会话。
  for (const existing of orchestrators.values()) {
    if (existing === orchestrator) continue
    if (existing.isActive(sessionId)) return true
  }
  return false
}

/** 中止所有活跃的 Agent 会话（应用退出时调用） */
export function stopAllAgents(): void {
  try {
    for (const orchestrator of orchestrators.values()) {
      orchestrator.stopAll()
    }
  } finally {
    adapterRegistry.disposeExcept(orchestratorAdapters)
  }
}

/**
 * 退出前最后兜底：扫描并强杀所有孤儿 claude-agent-sdk 子进程
 *
 * 必须在 stopAllAgents() 之后调用。针对 pidMap 未覆盖、dispose 漏杀等极端场景。
 * 同步执行，不 await，确保 before-quit 能在 Electron 超时前完成。
 */
export function killOrphanedClaudeSubprocesses(): void {
  scanAndKillOrphanedClaudeSubprocesses()
}

/**
 * 运行中动态切换会话的权限模式
 *
 * 同时更新 Proma 侧（canUseTool 动态读取）和 SDK 侧（query.setPermissionMode）。
 */
export async function updateAgentPermissionMode(sessionId: string, mode: PromaPermissionMode): Promise<void> {
  await getSessionOperationOrchestrator(sessionId).updateSessionPermissionMode(sessionId, mode)
}

// ===== 流式追加消息 =====

/**
 * 在 Agent 流式中追加发送消息
 *
 * 使用 'now' 优先级立即注入 SDK 并持久化。
 */
export async function queueAgentMessage(
  input: AgentQueueMessageInput,
  _webContents: WebContents,
): Promise<string> {
  return getSessionOperationOrchestrator(input.sessionId).queueMessage(
    input.sessionId,
    input.userMessage,
    undefined,
    input.uuid,
    { interrupt: input.interrupt },
  )
}

// ===== 文件操作 =====

/**
 * 保存文件到 Agent session 工作目录
 *
 * 将 base64 编码的文件写入 session 的 cwd，供 Agent 通过 Read 工具读取。
 */
export function saveFilesToAgentSession(input: AgentSaveFilesInput): AgentSavedFile[] {
  const sessionDir = getAgentSessionWorkspacePath(input.workspaceSlug, input.sessionId)
  const results: AgentSavedFile[] = []
  const usedPaths = new Set<string>()

  for (const file of input.files) {
    let targetPath = join(sessionDir, file.filename)

    // 防止同名文件覆盖
    if (usedPaths.has(targetPath) || existsSync(targetPath)) {
      const dotIdx = file.filename.lastIndexOf('.')
      const baseName = dotIdx > 0 ? file.filename.slice(0, dotIdx) : file.filename
      const ext = dotIdx > 0 ? file.filename.slice(dotIdx) : ''
      let counter = 1
      let candidate = join(sessionDir, `${baseName}-${counter}${ext}`)
      while (usedPaths.has(candidate) || existsSync(candidate)) {
        counter++
        candidate = join(sessionDir, `${baseName}-${counter}${ext}`)
      }
      targetPath = candidate
    }
    usedPaths.add(targetPath)

    mkdirSync(dirname(targetPath), { recursive: true })

    // 防御性检查：base64 字符串长度估算是否超 100MB 限制
    // base64 编码膨胀率约 4/3，data.length * 0.75 ≈ 原始字节数
    if (file.data.length * 0.75 > MAX_ATTACHMENT_SIZE) {
      console.warn(`[Agent 服务] 文件超过 100MB 限制，跳过: ${file.filename} (预估 ${(file.data.length * 0.75 / 1024 / 1024).toFixed(1)}MB)`)
      continue
    }

    const buffer = Buffer.from(file.data, 'base64')
    writeFileSync(targetPath, buffer)

    const actualFilename = targetPath.slice(sessionDir.length + 1)
    results.push({ filename: actualFilename, targetPath })
    console.log(`[Agent 服务] 文件已保存: ${targetPath} (${buffer.length} bytes)`)
  }

  return results
}

/**
 * 保存文件到工作区文件目录
 *
 * 将 base64 编码的文件写入工作区 workspace-files/ 目录，所有会话均可访问。
 */
export function saveFilesToWorkspaceFiles(input: AgentSaveWorkspaceFilesInput): AgentSavedFile[] {
  const wsFilesDir = getWorkspaceFilesDir(input.workspaceSlug)
  const results: AgentSavedFile[] = []
  const usedPaths = new Set<string>()

  for (const file of input.files) {
    let targetPath = join(wsFilesDir, file.filename)

    // 防止同名文件覆盖
    if (usedPaths.has(targetPath) || existsSync(targetPath)) {
      const dotIdx = file.filename.lastIndexOf('.')
      const baseName = dotIdx > 0 ? file.filename.slice(0, dotIdx) : file.filename
      const ext = dotIdx > 0 ? file.filename.slice(dotIdx) : ''
      let counter = 1
      let candidate = join(wsFilesDir, `${baseName}-${counter}${ext}`)
      while (usedPaths.has(candidate) || existsSync(candidate)) {
        counter++
        candidate = join(wsFilesDir, `${baseName}-${counter}${ext}`)
      }
      targetPath = candidate
    }
    usedPaths.add(targetPath)

    mkdirSync(dirname(targetPath), { recursive: true })

    if (file.data.length * 0.75 > MAX_ATTACHMENT_SIZE) {
      console.warn(`[Agent 服务] 工作区文件超过 100MB 限制，跳过: ${file.filename} (预估 ${(file.data.length * 0.75 / 1024 / 1024).toFixed(1)}MB)`)
      continue
    }

    const buffer = Buffer.from(file.data, 'base64')
    writeFileSync(targetPath, buffer)

    const actualFilename = targetPath.slice(wsFilesDir.length + 1)
    results.push({ filename: actualFilename, targetPath })
    console.log(`[Agent 服务] 工作区文件已保存: ${targetPath} (${buffer.length} bytes)`)
  }

  return results
}
