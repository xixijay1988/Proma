import type {
  AgentProviderAdapter,
  AgentQueryInput,
  SDKContentBlock,
  SDKMessage,
  AgentRuntimeCommand,
  AgentRuntimeExtensionUiRequest,
  AgentRuntimeExtensionUiResponse,
  AgentRuntimeCloneResult,
  AgentRuntimeForkMessage,
  AgentRuntimeForkResult,
  AgentRuntimeState,
  AgentRuntimeSessionStats,
  AgentRuntimeSwitchSessionResult,
  PromaEvent,
  PromaPermissionMode,
  SDKUserMessageInput,
} from '@proma/shared'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { convertPiTextDelta, convertPiThinkingDelta, convertPiToolStart } from './pi-event-converter'
import { mapPromaPermissionModeToPiMode } from './pi-permission-mapping'
import { startPiRpcSession, type PiRpcCommand, type PiRpcEvent, type StartedPiRpcSession } from './pi-process'

const PI_UNSUPPORTED_MESSAGE = 'Pi 进程集成尚未在此构建中实现或启用。'
const PI_RPC_TERMINATED_MESSAGE = 'Pi RPC 会话在完成前结束。'
const PI_COMMAND_TIMEOUT_MS = 10_000
const KNOWN_PI_RPC_EVENT_TYPES = new Set([
  'agent_start',
  'agent_end',
  'auto_retry_end',
  'auto_retry_start',
  'compaction_end',
  'compaction_start',
  'extension_ui_request',
  'message_start',
  'message_end',
  'message_update',
  'protocol_error',
  'queue_update',
  'response',
  'session',
  'tool_execution_end',
  'tool_execution_start',
  'tool_execution_update',
  'turn_end',
  'turn_start',
])
const PI_RUNTIME_COMMANDS = new Set([
  'abort',
  'abort_bash',
  'clone',
  'compact',
  'fork',
  'get_fork_messages',
  'get_commands',
  'get_messages',
  'get_session_stats',
  'get_state',
  'abort_retry',
  'set_auto_compaction',
  'set_auto_retry',
  'set_follow_up_mode',
  'set_model',
  'set_session_name',
  'set_steering_mode',
  'set_thinking_level',
  'switch_session',
])
const PI_THINKING_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'])
const PI_QUEUE_MODES = new Set(['all', 'one-at-a-time'])
const KNOWN_PI_MESSAGE_UPDATE_EVENT_TYPES = new Set([
  'done',
  'error',
  'start',
  'text_end',
  'text_delta',
  'text_start',
  'thinking_delta',
  'thinking_end',
  'thinking_start',
  'toolcall_delta',
  'toolcall_end',
  'toolcall_start',
])

interface PiRuntimeCommandInput {
  type: string
  [key: string]: unknown
}

interface PiDerivedRetryState {
  autoRetryEnabled?: boolean
  isRetrying?: boolean
}

function isPiAgentEnabled(): boolean {
  return process.env.PROMA_PI_AGENT_ENABLED !== '0'
}

function createErrorAssistantMessage(input: AgentQueryInput, message: string, errorType: string): SDKMessage {
  const textMessage = convertPiTextDelta({
    sessionId: input.sessionId,
    delta: message,
    model: input.model,
  })

  return {
    ...textMessage,
    message: {
      ...textMessage.message,
      stop_reason: 'error',
    },
    error: { message, errorType },
  }
}

function createErrorResultMessage(input: AgentQueryInput, message: string): SDKMessage {
  return {
    type: 'result',
    subtype: 'error',
    usage: {
      input_tokens: 0,
      output_tokens: 0,
    },
    errors: [message],
    session_id: input.sessionId,
  }
}

function createTransientTextDeltaMessage(input: AgentQueryInput, delta: string): SDKMessage {
  const message = convertPiTextDelta({
    sessionId: input.sessionId,
    delta,
    model: input.model,
  }) as SDKMessage

  return {
    ...message,
    _promaTransient: true,
    _promaTextDelta: true,
  } as unknown as SDKMessage
}

function createTransientThinkingDeltaMessage(input: AgentQueryInput, delta: string): SDKMessage {
  const message = convertPiThinkingDelta({
    sessionId: input.sessionId,
    delta,
    model: input.model,
  }) as SDKMessage

  return {
    ...message,
    _promaTransient: true,
    _promaThinkingDelta: true,
  } as unknown as SDKMessage
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function formatQueuedMessages(messages: string[], label: string): string[] {
  if (messages.length === 0) return []
  const preview = messages
    .slice(0, 3)
    .map((message, index) => `  ${index + 1}. ${message.length > 80 ? `${message.slice(0, 80)}...` : message}`)

  return [
    `- ${label}: ${messages.length}`,
    ...preview,
    ...(messages.length > preview.length ? [`  ...另有 ${messages.length - preview.length} 条`] : []),
  ]
}

function createPiQueueSummaryMessage(input: AgentQueryInput, event: PiRpcEvent): SDKMessage | null {
  if (event.type !== 'queue_update') return null

  const steering = asStringArray(event.steering)
  const followUp = asStringArray(event.followUp)
  if (steering.length === 0 && followUp.length === 0) return null

  const lines = [
    `Pi 队列已更新：steering: ${steering.length}, follow-up: ${followUp.length}`,
    ...formatQueuedMessages(steering, 'steering'),
    ...formatQueuedMessages(followUp, 'follow-up'),
  ]

  return {
    type: 'tool_use_summary',
    summary: lines.join('\n'),
    preceding_tool_use_ids: [],
    session_id: input.sessionId,
    _promaTransient: true,
    _promaPiQueueSummary: true,
  } as unknown as SDKMessage
}

function createPromaEventMessage(input: AgentQueryInput, event: PromaEvent): SDKMessage {
  return {
    type: 'system',
    subtype: 'pi_runtime_event',
    session_id: input.sessionId,
    _promaTransient: true,
    _promaEvent: event,
  } as unknown as SDKMessage
}

function createPiAutoRetryMessages(input: AgentQueryInput, event: PiRpcEvent): SDKMessage[] {
  if (event.type === 'auto_retry_start') {
    const attempt = getFiniteNumber(event, 'attempt') ?? 1
    const maxAttempts = getFiniteNumber(event, 'maxAttempts') ?? attempt
    const delayMs = getFiniteNumber(event, 'delayMs') ?? 0
    const delaySeconds = delayMs / 1000
    const reason = getString(event, 'errorMessage') ?? 'Pi auto retry started'
    const attemptData = {
      attempt,
      timestamp: Date.now(),
      reason,
      errorMessage: reason,
      delaySeconds,
    }

    return [
      createPromaEventMessage(input, {
        type: 'retry',
        status: 'starting',
        attempt,
        maxAttempts,
        delaySeconds,
        reason,
      }),
      createPromaEventMessage(input, {
        type: 'retry',
        status: 'attempt',
        attemptData,
      }),
    ]
  }

  if (event.type === 'auto_retry_end') {
    if (event.success === true) {
      return [createPromaEventMessage(input, { type: 'retry', status: 'cleared' })]
    }

    const attempt = getFiniteNumber(event, 'attempt') ?? 1
    const finalError = getString(event, 'finalError') ?? 'Pi auto retry failed'

    return [createPromaEventMessage(input, {
      type: 'retry',
      status: 'failed',
      attemptData: {
        attempt,
        timestamp: Date.now(),
        reason: finalError,
        errorMessage: finalError,
        delaySeconds: 0,
      },
    })]
  }

  return []
}

function createPiCompactionMessages(input: AgentQueryInput, event: PiRpcEvent): SDKMessage[] {
  if (event.type === 'compaction_start') {
    const reason = getString(event, 'reason') ?? undefined

    return [createPromaEventMessage(input, {
      type: 'compaction',
      status: 'starting',
      ...(reason ? { reason } : {}),
    })]
  }

  if (event.type === 'compaction_end') {
    const reason = getString(event, 'reason') ?? undefined
    const messages: SDKMessage[] = []
    const resultRecord = asRecord(event.result)

    if (event.aborted !== true && resultRecord) {
      messages.push(createPiCompactBoundaryMessage({
        sessionId: input.sessionId,
        data: resultRecord,
      }))
    }

    messages.push(createPromaEventMessage(input, {
      type: 'compaction',
      status: 'cleared',
      ...(reason ? { reason } : {}),
    }))

    return messages
  }

  return []
}

function createSuccessResultMessage(input: AgentQueryInput): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    usage: {
      input_tokens: 0,
      output_tokens: 0,
    },
    session_id: input.sessionId,
  }
}

function normalizePiToolResultContent(value: unknown): unknown {
  const record = asRecord(value)
  if (!record) return value ?? null

  return Array.isArray(record.content) ? record.content : value
}

function buildPiToolUseResult(
  value: unknown,
  isError: boolean,
  primitiveKey: 'result' | 'partialResult' = 'result',
): Record<string, unknown> | null {
  const record = asRecord(value)
  if (!record) {
    if (value == null) return null
    return {
      [primitiveKey]: value,
      isError,
    }
  }

  return {
    ...record,
    isError,
  }
}

function createToolResultMessage(input: AgentQueryInput, event: PiRpcEvent): SDKMessage | null {
  const toolUseId = getString(event, 'toolCallId')
  if (!toolUseId) return null
  const toolUseResult = buildPiToolUseResult(event.result, event.isError === true)

  return {
    type: 'user',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: normalizePiToolResultContent(event.result),
          is_error: event.isError === true,
        },
      ],
    },
    parent_tool_use_id: null,
    session_id: input.sessionId,
    ...(toolUseResult ? { toolUseResult } : {}),
  }
}

function createTransientToolProgressMessage(input: AgentQueryInput, event: PiRpcEvent): SDKMessage | null {
  if (event.type !== 'tool_execution_update') return null

  const toolUseId = getString(event, 'toolCallId')
  if (!toolUseId) return null
  const toolName = getString(event, 'toolName')
  const toolUseResult = buildPiToolUseResult(event.partialResult, false, 'partialResult')
  const args = asRecord(event.args)
  const enrichedToolUseResult = toolUseResult
    ? {
        ...toolUseResult,
        ...(toolName ? { toolName } : {}),
        ...(args ? { input: args } : {}),
      }
    : null

  return {
    type: 'user',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: normalizePiToolResultContent(event.partialResult),
          is_error: false,
        },
      ],
    },
    parent_tool_use_id: null,
    session_id: input.sessionId,
    ...(enrichedToolUseResult ? { toolUseResult: enrichedToolUseResult } : {}),
    _promaTransient: true,
    _promaToolProgress: true,
  } as unknown as SDKMessage
}

function formatPiProcessDiagnostics(processResult: Awaited<StartedPiRpcSession['done']>): string {
  const parts = [
    `exitCode=${processResult.exitCode ?? 'null'}`,
    `signal=${processResult.signal ?? 'null'}`,
  ]

  if (processResult.aborted) {
    parts.push('aborted=true')
  }
  if (processResult.errorMessage) {
    parts.push(`error=${processResult.errorMessage}`)
  }
  if (processResult.stderrSnippet.trim()) {
    parts.push(`stderr=${processResult.stderrSnippet.trim()}`)
  }
  if (processResult.stdoutSnippet.trim()) {
    parts.push(`stdout=${processResult.stdoutSnippet.trim()}`)
  }

  return parts.join('\n')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function getString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' ? value : null
}

function getBoolean(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key]
  return typeof value === 'boolean' ? value : null
}

function getFiniteNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function getRecord(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  return asRecord(record[key])
}

function getPiSessionIdFromFileName(filePath: string): string | null {
  const fileName = basename(filePath)
  if (!fileName.endsWith('.jsonl')) return null

  const withoutExt = fileName.slice(0, -'.jsonl'.length)
  const marker = 'Z_'
  const markerIndex = withoutExt.indexOf(marker)
  if (markerIndex >= 0) {
    const id = withoutExt.slice(markerIndex + marker.length)
    return id || null
  }

  const underscoreIndex = withoutExt.indexOf('_')
  if (underscoreIndex < 0) return withoutExt || null
  const id = withoutExt.slice(underscoreIndex + 1)
  return id || null
}

function getPromptFailureMessage(event: PiRpcEvent): string | null {
  if (event.type !== 'response') return null
  if (event.command !== 'prompt') return null
  if (event.success !== false) return null

  return typeof event.error === 'string'
    ? event.error
    : 'Pi prompt rejected before streaming.'
}

function getAssistantFailureMessage(event: PiRpcEvent): string | null {
  if (event.type !== 'message_end') return null

  const message = asRecord(event.message)
  if (message?.role !== 'assistant') return null

  const stopReason = getString(message, 'stopReason')
  if (stopReason !== 'error' && stopReason !== 'aborted') return null

  return getString(message, 'errorMessage') ?? `Pi assistant stopped with ${stopReason}.`
}

function getAgentEndFailureMessage(event: PiRpcEvent): string | null {
  if (event.type !== 'agent_end') return null
  if (!Array.isArray(event.messages)) return null

  for (const item of event.messages) {
    const message = asRecord(item)
    if (message?.role !== 'assistant') continue

    const stopReason = getString(message, 'stopReason')
    if (stopReason !== 'error' && stopReason !== 'aborted') continue

    return getString(message, 'errorMessage') ?? `Pi assistant stopped with ${stopReason}.`
  }

  return null
}

function extractAssistantContentFromPiMessage(message: Record<string, unknown>): SDKContentBlock[] {
  if (!Array.isArray(message.content)) return []

  const blocks: SDKContentBlock[] = []
  for (const block of message.content) {
    const blockRecord = asRecord(block)
    if (!blockRecord) continue

    if (blockRecord.type === 'thinking') {
      const thinking = getString(blockRecord, 'thinking')
      if (thinking) blocks.push({ type: 'thinking', thinking })
      continue
    }

    if (blockRecord.type === 'text') {
      const text = getString(blockRecord, 'text')
      if (text) blocks.push({ type: 'text', text })
    }
  }

  return blocks
}

function extractPiTextContent(value: unknown): string {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim()
  if (!Array.isArray(value)) return ''

  const parts: string[] = []
  for (const item of value) {
    const block = asRecord(item)
    if (block?.type === 'text') {
      const text = getString(block, 'text')
      if (text) parts.push(text)
    }
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

function extractSdkAssistantText(message: SDKMessage): string {
  if (message.type !== 'assistant') return ''

  const messageRecord = asRecord((message as Record<string, unknown>).message)
  return extractPiTextContent(messageRecord?.content)
}

function extractPiEntryId(event: PiRpcEvent, message: Record<string, unknown>): string | null {
  const directEntryId = getString(event, 'entryId') ?? getString(event, 'entry_id')
  if (directEntryId) return directEntryId

  const eventEntry = getRecord(event, 'entry')
  const eventEntryId = eventEntry
    ? getString(eventEntry, 'id') ?? getString(eventEntry, 'entryId') ?? getString(eventEntry, 'entry_id')
    : null
  if (eventEntryId) return eventEntryId

  const messageEntryId = getString(message, 'entryId') ?? getString(message, 'entry_id')
  if (messageEntryId) return messageEntryId

  const messageEntry = getRecord(message, 'entry')
  const nestedMessageEntryId = messageEntry
    ? getString(messageEntry, 'id') ?? getString(messageEntry, 'entryId') ?? getString(messageEntry, 'entry_id')
    : null
  return nestedMessageEntryId
}

function createFinalAssistantMessage(input: AgentQueryInput, event: PiRpcEvent): SDKMessage | null {
  if (event.type !== 'message_end') return null

  const message = asRecord(event.message)
  if (message?.role !== 'assistant') return null

  const content = extractAssistantContentFromPiMessage(message)
  if (content.length === 0) return null
  const piEntryId = extractPiEntryId(event, message)

  return {
    type: 'assistant',
    message: {
      content,
      ...(input.model ? { model: input.model } : {}),
    },
    parent_tool_use_id: null,
    session_id: input.sessionId,
    ...(piEntryId ? { _promaPiEntryId: piEntryId } : {}),
  }
}

interface PiAssistantSessionEntry {
  id: string
  text: string
}

function resolvePiSessionFile(input: AgentQueryInput): string | null {
  const explicitSessionPath = input.runtimeSessionPath?.trim()
  if (explicitSessionPath && existsSync(explicitSessionPath)) return explicitSessionPath

  const sessionDir = input.runtimeSessionDir?.trim()
  const sessionId = input.sessionId.trim()
  if (!sessionDir || !sessionId || !existsSync(sessionDir)) return null

  const candidates = readdirSync(sessionDir)
    .filter((entry) => entry.endsWith('.jsonl') && getPiSessionIdFromFileName(entry) === sessionId)
    .map((entry) => join(sessionDir, entry))

  if (candidates.length === 0) return null
  candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  return candidates[0] ?? null
}

function loadPiAssistantSessionEntries(input: AgentQueryInput): PiAssistantSessionEntry[] {
  const sessionFile = resolvePiSessionFile(input)
  if (!sessionFile) return []

  try {
    return readFileSync(sessionFile, 'utf-8')
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as unknown)
      .map(asRecord)
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .filter((entry) => entry.type === 'message' && typeof entry.id === 'string')
      .map((entry) => {
        const message = asRecord(entry.message)
        if (message?.role !== 'assistant') return null
        return {
          id: entry.id as string,
          text: extractPiTextContent(message.content),
        }
      })
      .filter((entry): entry is PiAssistantSessionEntry => entry !== null)
  } catch (error) {
    console.warn('[Pi Agent] 读取 Pi 原生 session entry 失败，分叉锚点将降级:', error)
    return []
  }
}

function attachPiEntryIdsFromSession(input: AgentQueryInput, messages: SDKMessage[]): SDKMessage[] {
  if (messages.length === 0) return []

  const entries = loadPiAssistantSessionEntries(input)
  if (entries.length === 0) return messages

  const pendingAssistantCount = messages.filter((message) => (
    message.type === 'assistant'
    && !((message as Record<string, unknown>)._promaPiEntryId)
  )).length
  const candidateEntries = pendingAssistantCount > 0
    ? entries.slice(-pendingAssistantCount)
    : []
  const usedEntryIds = new Set<string>()
  return messages.map((message) => {
    if (message.type !== 'assistant') return message
    if ((message as Record<string, unknown>)._promaPiEntryId) return message

    const text = extractSdkAssistantText(message)
    const matched = candidateEntries.find((entry) => !usedEntryIds.has(entry.id) && entry.text === text)
      ?? candidateEntries.find((entry) => !usedEntryIds.has(entry.id))
    if (!matched) return message

    usedEntryIds.add(matched.id)
    return {
      ...message,
      _promaPiEntryId: matched.id,
    } as SDKMessage
  })
}

function isPiResponseEvent(event: PiRpcEvent): boolean {
  return event.type === 'response' && typeof event.id === 'string' && typeof event.command === 'string'
}

function isRuntimeCommandResponse(event: PiRpcEvent): boolean {
  if (!isPiResponseEvent(event)) return false
  const command = getString(event, 'command')
  return command ? PI_RUNTIME_COMMANDS.has(command) : false
}

function normalizePiCommandError(command: string, event: PiRpcEvent): Error {
  const message = typeof event.error === 'string'
    ? event.error
    : `Pi RPC command failed: ${command}`

  return new Error(message)
}

function parseForkMessagesData(data: unknown): AgentRuntimeForkMessage[] {
  const dataRecord = asRecord(data)
  const messages = Array.isArray(dataRecord?.messages) ? dataRecord.messages : []
  const normalized: AgentRuntimeForkMessage[] = []

  for (const item of messages) {
    const itemRecord = asRecord(item)
    if (!itemRecord) continue

    const id = getString(itemRecord, 'id') ?? getString(itemRecord, 'entryId')
    if (!id) continue

    const text = getString(itemRecord, 'text') ?? ''
    normalized.push({
      ...itemRecord,
      id,
      text,
    })
  }

  return normalized
}

function parseForkResultData(data: unknown): AgentRuntimeForkResult {
  const dataRecord = asRecord(data) ?? {}
  const cancelled = getBoolean(dataRecord, 'cancelled') ?? false
  const text = getString(dataRecord, 'text')
  const sessionId = getString(dataRecord, 'sessionId')
  const sessionPath = getString(dataRecord, 'sessionPath')

  return {
    ...dataRecord,
    cancelled,
    ...(text ? { text } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(sessionPath ? { sessionPath } : {}),
  }
}

function parseCloneResultData(data: unknown): AgentRuntimeCloneResult {
  const dataRecord = asRecord(data) ?? {}
  const cancelled = getBoolean(dataRecord, 'cancelled') ?? false
  const sessionId = getString(dataRecord, 'sessionId')
  const sessionPath = getString(dataRecord, 'sessionPath')

  return {
    ...dataRecord,
    cancelled,
    ...(sessionId ? { sessionId } : {}),
    ...(sessionPath ? { sessionPath } : {}),
  }
}

function parseSwitchSessionResultData(data: unknown): AgentRuntimeSwitchSessionResult {
  const dataRecord = asRecord(data) ?? {}
  const cancelled = getBoolean(dataRecord, 'cancelled') ?? false

  return {
    ...dataRecord,
    cancelled,
  }
}

function parseRuntimeStateData(data: unknown): AgentRuntimeState {
  const dataRecord = asRecord(data) ?? {}
  const modelRecord = asRecord(dataRecord.model)
  const provider = modelRecord ? getString(modelRecord, 'provider') : undefined
  const modelId = modelRecord
    ? getString(modelRecord, 'id') ?? getString(modelRecord, 'modelId')
    : undefined
  const modelName = modelRecord ? getString(modelRecord, 'name') : undefined
  const thinkingLevel = getString(dataRecord, 'thinkingLevel')
  const isStreaming = getBoolean(dataRecord, 'isStreaming') ?? false
  const isCompacting = getBoolean(dataRecord, 'isCompacting') ?? false
  const steeringMode = getString(dataRecord, 'steeringMode')
  const followUpMode = getString(dataRecord, 'followUpMode')
  const nativeSessionId = getString(dataRecord, 'sessionId')
  const nativeSessionName = getString(dataRecord, 'sessionName')
  const nativeSessionFile = getString(dataRecord, 'sessionFile')
  const autoCompactionEnabled = getBoolean(dataRecord, 'autoCompactionEnabled')
  const autoRetryEnabled = getBoolean(dataRecord, 'autoRetryEnabled')
  const messageCount = typeof dataRecord.messageCount === 'number' ? dataRecord.messageCount : undefined
  const pendingMessageCount = typeof dataRecord.pendingMessageCount === 'number' ? dataRecord.pendingMessageCount : undefined

  return {
    ...(provider ? { provider } : {}),
    ...(modelId ? { modelId } : {}),
    ...(modelName ? { modelName } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
    isStreaming,
    isCompacting,
    ...(steeringMode ? { steeringMode } : {}),
    ...(followUpMode ? { followUpMode } : {}),
    ...(nativeSessionId ? { nativeSessionId } : {}),
    ...(nativeSessionName ? { nativeSessionName } : {}),
    ...(nativeSessionFile ? { nativeSessionFile } : {}),
    ...(autoCompactionEnabled != null ? { autoCompactionEnabled } : {}),
    ...(autoRetryEnabled != null ? { autoRetryEnabled } : {}),
    ...(messageCount != null ? { messageCount } : {}),
    ...(pendingMessageCount != null ? { pendingMessageCount } : {}),
  }
}

function getNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function parseRuntimeSessionStatsData(data: unknown): AgentRuntimeSessionStats {
  const dataRecord = asRecord(data) ?? {}
  const tokensRecord = asRecord(dataRecord.tokens) ?? {}
  const contextUsageRecord = asRecord(dataRecord.contextUsage)
  const tokens = {
    input: getNumber(tokensRecord, 'input'),
    output: getNumber(tokensRecord, 'output'),
    cacheRead: getNumber(tokensRecord, 'cacheRead'),
    cacheWrite: getNumber(tokensRecord, 'cacheWrite'),
    total: getNumber(tokensRecord, 'total'),
  }
  const contextUsage = contextUsageRecord
    ? {
        tokens: getNumber(contextUsageRecord, 'tokens') ?? null,
        maxTokens: getNumber(contextUsageRecord, 'maxTokens'),
        percent: getNumber(contextUsageRecord, 'percent') ?? null,
      }
    : undefined

  return {
    userMessages: getNumber(dataRecord, 'userMessages'),
    assistantMessages: getNumber(dataRecord, 'assistantMessages'),
    toolCalls: getNumber(dataRecord, 'toolCalls'),
    toolResults: getNumber(dataRecord, 'toolResults'),
    totalMessages: getNumber(dataRecord, 'totalMessages'),
    tokens,
    costUsd: getNumber(dataRecord, 'cost'),
    ...(contextUsage ? { contextUsage } : {}),
  }
}

function normalizeRuntimeCommandSource(source: string | undefined): AgentRuntimeCommand['source'] {
  if (source === 'extension' || source === 'prompt' || source === 'skill') {
    return source
  }
  return 'unknown'
}

function parseRuntimeCommandsData(data: unknown): AgentRuntimeCommand[] {
  const dataRecord = asRecord(data)
  const commands = Array.isArray(dataRecord?.commands) ? dataRecord.commands : []

  return commands.flatMap((command): AgentRuntimeCommand[] => {
    const commandRecord = asRecord(command)
    if (!commandRecord) return []

    const name = getString(commandRecord, 'name')?.trim()
    if (!name) return []

    const description = getString(commandRecord, 'description')
    const source = normalizeRuntimeCommandSource(getString(commandRecord, 'source') ?? undefined)
    const sourceInfoRecord = asRecord(commandRecord.sourceInfo)

    return [{
      name,
      ...(description ? { description } : {}),
      source,
      ...(sourceInfoRecord ? { sourceInfo: sourceInfoRecord } : {}),
    }]
  })
}

function createPiCompactMessages(input: {
  sessionId: string
  data: unknown
}): SDKMessage[] {
  return [
    {
      type: 'system',
      subtype: 'compacting',
      session_id: input.sessionId,
    },
    createPiCompactBoundaryMessage(input),
  ] as unknown as SDKMessage[]
}

function createPiCompactBoundaryMessage(input: {
  sessionId: string
  data: unknown
}): SDKMessage {
  const dataRecord = asRecord(input.data) ?? {}
  const summary = getString(dataRecord, 'summary') ?? 'Pi 已完成上下文压缩'
  const firstKeptEntryId = getString(dataRecord, 'firstKeptEntryId')
  const tokensBeforeValue = dataRecord.tokensBefore
  const tokensBefore = typeof tokensBeforeValue === 'number' ? tokensBeforeValue : undefined

  return {
    type: 'system',
    subtype: 'compact_boundary',
    summary,
    ...(firstKeptEntryId ? { first_kept_entry_id: firstKeptEntryId } : {}),
    ...(tokensBefore != null ? { tokens_before: tokensBefore } : {}),
    session_id: input.sessionId,
  } as unknown as SDKMessage
}

function normalizePiThinkingLevel(level: string): string {
  const normalized = level.trim()
  if (!PI_THINKING_LEVELS.has(normalized)) {
    throw new Error(`[Pi Agent] 不支持的 thinking level: ${level}`)
  }
  return normalized
}

function normalizePiQueueMode(mode: string): string {
  const normalized = mode.trim()
  if (!PI_QUEUE_MODES.has(normalized)) {
    throw new Error(`[Pi Agent] 不支持的队列模式: ${mode}`)
  }
  return normalized
}

function isExtensionUiDialogMethod(method: string): boolean {
  return method === 'confirm' || method === 'select' || method === 'input' || method === 'editor' || method === 'askUserQuestion'
}

function createExtensionUiResponse(
  request: AgentRuntimeExtensionUiRequest,
  result: Omit<AgentRuntimeExtensionUiResponse, 'type' | 'id'> | void,
): AgentRuntimeExtensionUiResponse | null {
  if (isExtensionUiDialogMethod(request.method)) {
    if (!result) {
      return { type: 'extension_ui_response', id: request.id, cancelled: true }
    }

    return { type: 'extension_ui_response', id: request.id, ...result }
  }

  if (!result) return null

  return { type: 'extension_ui_response', id: request.id, ...result }
}

function convertPiRpcEvent(input: AgentQueryInput, event: PiRpcEvent): SDKMessage[] {
  const retryMessages = createPiAutoRetryMessages(input, event)
  if (retryMessages.length > 0) return retryMessages

  const compactionMessages = createPiCompactionMessages(input, event)
  if (compactionMessages.length > 0) return compactionMessages

  if (event.type === 'message_update') {
    const assistantMessageEvent = asRecord(event.assistantMessageEvent)
    if (assistantMessageEvent?.type === 'text_delta') {
      const delta = getString(assistantMessageEvent, 'delta')
      if (!delta) return []
      return [createTransientTextDeltaMessage(input, delta)]
    }
    if (assistantMessageEvent?.type === 'thinking_delta') {
      const delta = getString(assistantMessageEvent, 'delta')
      if (!delta) return []
      return [createTransientThinkingDeltaMessage(input, delta)]
    }
  }

  if (event.type === 'tool_execution_start') {
    const toolUseId = getString(event, 'toolCallId')
    const toolName = getString(event, 'toolName')
    const args = asRecord(event.args) ?? {}
    if (!toolUseId || !toolName) return []

    return [convertPiToolStart({
      sessionId: input.sessionId,
      toolUseId,
      toolName,
      input: args,
      model: input.model,
    })]
  }

  if (event.type === 'tool_execution_end') {
    const toolResultMessage = createToolResultMessage(input, event)
    return toolResultMessage ? [toolResultMessage] : []
  }

  if (event.type === 'tool_execution_update') {
    const toolProgressMessage = createTransientToolProgressMessage(input, event)
    return toolProgressMessage ? [toolProgressMessage] : []
  }

  if (event.type === 'queue_update') {
    const queueSummaryMessage = createPiQueueSummaryMessage(input, event)
    return queueSummaryMessage ? [queueSummaryMessage] : []
  }

  return []
}

export class PiAgentAdapter implements AgentProviderAdapter {
  readonly name = 'pi' as const
  private readonly processes = new Map<string, StartedPiRpcSession>()
  private readonly retryStates = new Map<string, PiDerivedRetryState>()
  private readonly pendingResponses = new Map<string, Map<string, {
    command: string
    resolve: (event: PiRpcEvent) => void
    reject: (error: Error) => void
    timeout: NodeJS.Timeout
  }>>()
  private readonly unknownEventTypes = new Set<string>()
  private readonly unknownChildEventTypes = new Set<string>()
  private readonly malformedEventTypes = new Set<string>()

  private recordUnknownEvent(event: PiRpcEvent): void {
    if (KNOWN_PI_RPC_EVENT_TYPES.has(event.type)) return
    if (isRuntimeCommandResponse(event)) return
    if (this.unknownEventTypes.has(event.type)) return

    this.unknownEventTypes.add(event.type)
    console.warn(`[Pi Agent] 未识别 Pi RPC 事件，已跳过: ${event.type}`)
  }

  private consumePendingResponse(sessionId: string, event: PiRpcEvent): boolean {
    if (!isPiResponseEvent(event)) return false

    const responseId = getString(event, 'id')
    const pendingBySession = this.pendingResponses.get(sessionId)
    const pending = responseId ? pendingBySession?.get(responseId) : undefined
    if (!pending || !responseId) return false

    pendingBySession?.delete(responseId)
    if (pendingBySession && pendingBySession.size === 0) {
      this.pendingResponses.delete(sessionId)
    }
    clearTimeout(pending.timeout)

    if (event.success === false) {
      pending.reject(normalizePiCommandError(pending.command, event))
      return true
    }

    pending.resolve(event)
    return true
  }

  private rejectPendingResponses(sessionId: string, message: string): void {
    const pendingBySession = this.pendingResponses.get(sessionId)
    if (!pendingBySession) return

    this.pendingResponses.delete(sessionId)
    for (const pending of pendingBySession.values()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error(message))
    }
  }

  private sendRuntimeCommand(
    sessionId: string,
    command: PiRuntimeCommandInput,
    idPrefix: string,
  ): Promise<PiRpcEvent> {
    const piProcess = this.processes.get(sessionId)
    if (!piProcess) {
      throw new Error(`[Pi Agent] 会话未运行，无法执行 Pi 原生命令: ${sessionId}`)
    }

    const commandName = command.type
    const commandId = `${idPrefix}-${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const commandWithId: PiRpcCommand = {
      ...command,
      id: commandId,
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const pendingBySession = this.pendingResponses.get(sessionId)
        pendingBySession?.delete(commandId)
        if (pendingBySession && pendingBySession.size === 0) {
          this.pendingResponses.delete(sessionId)
        }
        reject(new Error(`[Pi Agent] Pi 原生命令超时: ${commandName}`))
      }, PI_COMMAND_TIMEOUT_MS)
      timeout.unref()

      const pendingBySession = this.pendingResponses.get(sessionId) ?? new Map()
      pendingBySession.set(commandId, {
        command: commandName,
        resolve,
        reject,
        timeout,
      })
      this.pendingResponses.set(sessionId, pendingBySession)

      try {
        piProcess.send(commandWithId)
      } catch (error) {
        pendingBySession.delete(commandId)
        if (pendingBySession.size === 0) {
          this.pendingResponses.delete(sessionId)
        }
        clearTimeout(timeout)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private updateRetryState(sessionId: string, patch: PiDerivedRetryState): void {
    const current = this.retryStates.get(sessionId) ?? {}
    this.retryStates.set(sessionId, { ...current, ...patch })
  }

  private clearRetryState(sessionId: string): void {
    this.retryStates.delete(sessionId)
  }

  private syncRetryStateFromEvent(sessionId: string, event: PiRpcEvent): void {
    if (event.type === 'auto_retry_start') {
      this.updateRetryState(sessionId, { isRetrying: true })
      return
    }

    if (event.type === 'auto_retry_end') {
      this.updateRetryState(sessionId, { isRetrying: false })
    }
  }

  private recordUnknownChildEvent(event: PiRpcEvent): void {
    if (event.type !== 'message_update') return

    const assistantMessageEvent = asRecord(event.assistantMessageEvent)
    const eventType = assistantMessageEvent ? getString(assistantMessageEvent, 'type') : null
    const childType = eventType ?? 'missing_type'
    if (KNOWN_PI_MESSAGE_UPDATE_EVENT_TYPES.has(childType)) return

    const key = `${event.type}:${childType}`
    if (this.unknownChildEventTypes.has(key)) return

    this.unknownChildEventTypes.add(key)
    console.warn(`[Pi Agent] 未识别 Pi message_update 子事件，已跳过: ${childType}`)
  }

  private recordMalformedEvent(event: PiRpcEvent): void {
    const missingFields: string[] = []

    if (event.type === 'tool_execution_start') {
      if (!getString(event, 'toolCallId')) missingFields.push('toolCallId')
      if (!getString(event, 'toolName')) missingFields.push('toolName')
    } else if (event.type === 'tool_execution_end') {
      if (!getString(event, 'toolCallId')) missingFields.push('toolCallId')
    }

    if (missingFields.length === 0) return

    const key = `${event.type}:${missingFields.join(',')}`
    if (this.malformedEventTypes.has(key)) return

    this.malformedEventTypes.add(key)
    console.warn(`[Pi Agent] Pi ${event.type} 事件缺少字段，已跳过: ${missingFields.join(', ')}`)
  }

  async *query(input: AgentQueryInput): AsyncIterable<SDKMessage> {
    if (!isPiAgentEnabled()) {
      yield createErrorAssistantMessage(input, PI_UNSUPPORTED_MESSAGE, 'pi_not_enabled')
      yield createErrorResultMessage(input, PI_UNSUPPORTED_MESSAGE)
      return
    }

    let piProcess: StartedPiRpcSession
    try {
      piProcess = startPiRpcSession({
        cwd: input.cwd,
        model: input.model,
        provider: input.provider,
        sessionId: input.sessionId,
        sessionDir: input.runtimeSessionDir,
        sessionPath: input.runtimeSessionPath,
        extensionPaths: input.runtimeExtensionPaths,
        skillPaths: input.runtimeSkillPaths,
        runtimeEnv: input.runtimeEnv,
        abortSignal: input.abortSignal,
      })
      this.processes.set(input.sessionId, piProcess)
    } catch (error) {
      const message = error instanceof Error
        ? `Pi RPC process failed to start: ${error.message}`
        : 'Pi RPC process failed to start: unknown error'
      yield createErrorAssistantMessage(input, message, 'pi_process_start_failed')
      yield createErrorResultMessage(input, message)
      return
    }

    try {
      if (input.runtimeThinkingLevel) {
        void this.setThinkingLevel(input.sessionId, input.runtimeThinkingLevel).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          console.warn(`[Pi Agent] 初始 thinking level 同步失败，继续发送 prompt: ${message}`)
        })
      }

      if (typeof input.runtimeAutoCompactionEnabled === 'boolean') {
        void this.setAutoCompaction(input.sessionId, input.runtimeAutoCompactionEnabled).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          console.warn(`[Pi Agent] 初始自动压缩设置同步失败，继续发送 prompt: ${message}`)
        })
      }

      if (typeof input.runtimeAutoRetryEnabled === 'boolean') {
        void this.setAutoRetry(input.sessionId, input.runtimeAutoRetryEnabled).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          console.warn(`[Pi Agent] 初始自动重试设置同步失败，继续发送 prompt: ${message}`)
        })
      }

      piProcess.send({
        id: `proma-prompt-${input.sessionId}-${Date.now()}`,
        type: 'prompt',
        message: input.prompt,
        ...(input.images && input.images.length > 0 ? { images: input.images } : {}),
      })

      const finalAssistantMessages: SDKMessage[] = []
      for await (const event of piProcess.events) {
        if (this.consumePendingResponse(input.sessionId, event)) {
          continue
        }

        if (event.type === 'protocol_error') {
          const message = typeof event.error === 'string' ? event.error : 'Pi RPC protocol error'
          this.rejectPendingResponses(input.sessionId, message)
          yield createErrorAssistantMessage(input, message, 'pi_protocol_error')
          yield createErrorResultMessage(input, message)
          return
        }

        if (event.type === 'extension_ui_request') {
          const request = event as AgentRuntimeExtensionUiRequest
          const result = input.handleExtensionUiRequest
            ? await input.handleExtensionUiRequest(request)
            : undefined
          const response = createExtensionUiResponse(request, result)
          if (response) {
            piProcess.send(response)
          }
          continue
        }

        const promptFailureMessage = getPromptFailureMessage(event)
        if (promptFailureMessage) {
          yield createErrorAssistantMessage(input, promptFailureMessage, 'pi_prompt_rejected')
          yield createErrorResultMessage(input, promptFailureMessage)
          return
        }

        const assistantFailureMessage = getAssistantFailureMessage(event)
        if (assistantFailureMessage) {
          const message = `Pi provider request failed: ${assistantFailureMessage}`
          yield createErrorAssistantMessage(input, message, 'pi_provider_error')
          yield createErrorResultMessage(input, message)
          return
        }

        this.syncRetryStateFromEvent(input.sessionId, event)
        this.recordMalformedEvent(event)

        for (const message of convertPiRpcEvent(input, event)) {
          yield message
        }

        const finalAssistantMessage = createFinalAssistantMessage(input, event)
        if (finalAssistantMessage) {
          finalAssistantMessages.push(finalAssistantMessage)
        }

        this.recordUnknownChildEvent(event)

        if (event.type === 'agent_end') {
          const agentEndFailureMessage = getAgentEndFailureMessage(event)
          if (agentEndFailureMessage) {
            const message = `Pi provider request failed: ${agentEndFailureMessage}`
            yield createErrorAssistantMessage(input, message, 'pi_provider_error')
            yield createErrorResultMessage(input, message)
            return
          }

          for (const message of attachPiEntryIdsFromSession(input, finalAssistantMessages)) {
            yield message
          }
          yield createSuccessResultMessage(input)
          return
        }

        this.recordUnknownEvent(event)
      }

      const processResult = await piProcess.done
      const diagnosticMessage = `${PI_RPC_TERMINATED_MESSAGE}\n\n${formatPiProcessDiagnostics(processResult)}`
      this.rejectPendingResponses(input.sessionId, diagnosticMessage)
      yield createErrorAssistantMessage(input, diagnosticMessage, 'pi_rpc_terminated')
      yield createErrorResultMessage(input, diagnosticMessage)
    } finally {
      this.processes.delete(input.sessionId)
      this.clearRetryState(input.sessionId)
      this.rejectPendingResponses(input.sessionId, '[Pi Agent] Pi RPC 会话已结束')
      piProcess.kill()
    }
  }

  abort(sessionId: string): void {
    const piProcess = this.processes.get(sessionId)
    if (!piProcess) return

    this.processes.delete(sessionId)
    this.clearRetryState(sessionId)
    piProcess.abort()
  }

  async interruptQuery(sessionId: string): Promise<void> {
    await this.sendRuntimeCommand(
      sessionId,
      { type: 'abort' },
      'proma-interrupt',
    )
  }

  async sendQueuedMessage(sessionId: string, message: SDKUserMessageInput): Promise<void> {
    if (!this.processes.has(sessionId)) {
      throw new Error(`[Pi Agent] 会话未运行，无法追加消息: ${sessionId}`)
    }

    const text = message.message.content.trim()
    if (!text) {
      throw new Error('[Pi Agent] 追加消息内容为空')
    }

    // 运行中追加仍走 prompt，让 Pi 保留 /skill、prompt template 与 extension command 展开语义。
    // streamingBehavior 只负责告诉 Pi 如何排队当前消息；这里等待 response，避免 UI 误判被拒绝的队列消息为成功。
    await this.sendRuntimeCommand(sessionId, {
      type: 'prompt',
      message: text,
      streamingBehavior: message.priority === 'now' ? 'steer' : 'followUp',
      ...(message.images && message.images.length > 0 ? { images: message.images } : {}),
    }, `proma-queued-prompt-${message.uuid ?? Date.now()}`)
  }

  async getForkMessages(sessionId: string): Promise<AgentRuntimeForkMessage[]> {
    const response = await this.sendRuntimeCommand(
      sessionId,
      { type: 'get_fork_messages' },
      'proma-get-fork-messages',
    )

    return parseForkMessagesData(response.data)
  }

  async fork(sessionId: string, entryId: string): Promise<AgentRuntimeForkResult> {
    const trimmedEntryId = entryId.trim()
    if (!trimmedEntryId) {
      throw new Error('[Pi Agent] fork entryId 不能为空')
    }

    const response = await this.sendRuntimeCommand(
      sessionId,
      { type: 'fork', entryId: trimmedEntryId },
      'proma-fork',
    )

    return parseForkResultData(response.data)
  }

  async clone(sessionId: string): Promise<AgentRuntimeCloneResult> {
    const response = await this.sendRuntimeCommand(
      sessionId,
      { type: 'clone' },
      'proma-clone',
    )

    return parseCloneResultData(response.data)
  }

  async switchSession(sessionId: string, sessionPath: string): Promise<AgentRuntimeSwitchSessionResult> {
    const trimmedSessionPath = sessionPath.trim()
    if (!trimmedSessionPath) {
      throw new Error('[Pi Agent] switch_session sessionPath 不能为空')
    }

    const response = await this.sendRuntimeCommand(
      sessionId,
      { type: 'switch_session', sessionPath: trimmedSessionPath },
      'proma-switch-session',
    )

    return parseSwitchSessionResultData(response.data)
  }

  async getMessages(sessionId: string): Promise<SDKMessage[]> {
    const response = await this.sendRuntimeCommand(
      sessionId,
      { type: 'get_messages' },
      'proma-get-messages',
    )
    const data = asRecord(response.data)
    const messages = Array.isArray(data?.messages) ? data.messages : []
    return messages.filter((message): message is SDKMessage => Boolean(asRecord(message)))
  }

  async getRuntimeState(sessionId: string): Promise<AgentRuntimeState> {
    const stateResponse = await this.sendRuntimeCommand(
      sessionId,
      { type: 'get_state' },
      'proma-get-state',
    )
    const statsResponse = await this.sendRuntimeCommand(
      sessionId,
      { type: 'get_session_stats' },
      'proma-get-session-stats',
    )
    const commandsResponse = await this.sendRuntimeCommand(
      sessionId,
      { type: 'get_commands' },
      'proma-get-commands',
    )
    return {
      ...parseRuntimeStateData(stateResponse.data),
      ...this.retryStates.get(sessionId),
      stats: parseRuntimeSessionStatsData(statsResponse.data),
      commands: parseRuntimeCommandsData(commandsResponse.data),
    }
  }

  async stopShellTask(sessionId: string, taskId: string): Promise<void> {
    if (!taskId.trim()) {
      throw new Error('[Pi Agent] Shell taskId 不能为空')
    }

    await this.sendRuntimeCommand(
      sessionId,
      { type: 'abort_bash' },
      'proma-abort-bash',
    )
    console.log(`[Pi Agent] Shell 任务停止请求已发送: sessionId=${sessionId}, taskId=${taskId}`)
  }

  async compact(sessionId: string, customInstructions?: string): Promise<SDKMessage[]> {
    const response = await this.sendRuntimeCommand(
      sessionId,
      {
        type: 'compact',
        ...(customInstructions?.trim() ? { customInstructions: customInstructions.trim() } : {}),
      },
      'proma-compact',
    )

    return createPiCompactMessages({ sessionId, data: response.data })
  }

  async setAutoCompaction(sessionId: string, enabled: boolean): Promise<void> {
    await this.sendRuntimeCommand(
      sessionId,
      { type: 'set_auto_compaction', enabled },
      'proma-set-auto-compaction',
    )
  }

  async setAutoRetry(sessionId: string, enabled: boolean): Promise<void> {
    await this.sendRuntimeCommand(
      sessionId,
      { type: 'set_auto_retry', enabled },
      'proma-set-auto-retry',
    )
    this.updateRetryState(sessionId, { autoRetryEnabled: enabled })
  }

  async abortRetry(sessionId: string): Promise<void> {
    await this.sendRuntimeCommand(
      sessionId,
      { type: 'abort_retry' },
      'proma-abort-retry',
    )
    this.updateRetryState(sessionId, { isRetrying: false })
  }

  async setThinkingLevel(sessionId: string, level: string): Promise<void> {
    await this.sendRuntimeCommand(
      sessionId,
      { type: 'set_thinking_level', level: normalizePiThinkingLevel(level) },
      'proma-set-thinking-level',
    )
  }

  async setModel(sessionId: string, input: { provider: string; modelId: string }): Promise<void> {
    const provider = input.provider.trim()
    const modelId = input.modelId.trim()
    if (!provider || !modelId) {
      throw new Error('[Pi Agent] runtime provider 和 modelId 不能为空')
    }

    await this.sendRuntimeCommand(
      sessionId,
      { type: 'set_model', provider, modelId },
      'proma-set-model',
    )
  }

  async setPermissionMode(sessionId: string, mode: string): Promise<void> {
    const piMode = mapPromaPermissionModeToPiMode(mode as PromaPermissionMode)
    await this.sendRuntimeCommand(
      sessionId,
      {
        type: 'prompt',
        message: `/proma-permission-mode ${piMode}`,
        streamingBehavior: 'steer',
      },
      'proma-set-permission-mode',
    )
    console.log(`[Pi Agent] 权限模式已切换: sessionId=${sessionId}, mode=${mode}, piMode=${piMode}`)
  }

  async setSteeringMode(sessionId: string, mode: string): Promise<void> {
    await this.sendRuntimeCommand(
      sessionId,
      { type: 'set_steering_mode', mode: normalizePiQueueMode(mode) },
      'proma-set-steering-mode',
    )
  }

  async setFollowUpMode(sessionId: string, mode: string): Promise<void> {
    await this.sendRuntimeCommand(
      sessionId,
      { type: 'set_follow_up_mode', mode: normalizePiQueueMode(mode) },
      'proma-set-follow-up-mode',
    )
  }

  async setSessionName(sessionId: string, name: string): Promise<void> {
    const trimmedName = name.trim()
    if (!trimmedName) {
      throw new Error('[Pi Agent] session name 不能为空')
    }

    await this.sendRuntimeCommand(
      sessionId,
      { type: 'set_session_name', name: trimmedName },
      'proma-set-session-name',
    )
  }

  dispose(): void {
    for (const piProcess of this.processes.values()) {
      piProcess.abort()
    }
    this.retryStates.clear()
    for (const sessionId of this.pendingResponses.keys()) {
      this.rejectPendingResponses(sessionId, '[Pi Agent] Pi adapter 已释放')
    }
    this.processes.clear()
  }
}
