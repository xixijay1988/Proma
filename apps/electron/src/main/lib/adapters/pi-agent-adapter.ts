import type {
  AgentProviderAdapter,
  AgentQueryInput,
  SDKContentBlock,
  SDKMessage,
  AgentRuntimeExtensionUiRequest,
  AgentRuntimeExtensionUiResponse,
  AgentRuntimeCloneResult,
  AgentRuntimeForkMessage,
  AgentRuntimeForkResult,
  AgentRuntimeSwitchSessionResult,
  SDKUserMessageInput,
} from '@proma/shared'
import { convertPiTextDelta, convertPiThinkingDelta, convertPiToolStart } from './pi-event-converter'
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
  'abort_bash',
  'clone',
  'fork',
  'get_fork_messages',
  'get_messages',
  'switch_session',
])
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

function getRecord(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  return asRecord(record[key])
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
  return messageEntry
    ? getString(messageEntry, 'id') ?? getString(messageEntry, 'entryId') ?? getString(messageEntry, 'entry_id')
    : null
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

    const id = getString(itemRecord, 'id')
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

function isExtensionUiDialogMethod(method: string): boolean {
  return method === 'confirm' || method === 'select' || method === 'input' || method === 'editor'
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
      piProcess.send({
        id: `proma-prompt-${input.sessionId}-${Date.now()}`,
        type: 'prompt',
        message: input.prompt,
      })

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

        this.recordMalformedEvent(event)

        for (const message of convertPiRpcEvent(input, event)) {
          yield message
        }

        const finalAssistantMessage = createFinalAssistantMessage(input, event)
        if (finalAssistantMessage) {
          yield finalAssistantMessage
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
      this.rejectPendingResponses(input.sessionId, '[Pi Agent] Pi RPC 会话已结束')
      piProcess.kill()
    }
  }

  abort(sessionId: string): void {
    const piProcess = this.processes.get(sessionId)
    if (!piProcess) return

    this.processes.delete(sessionId)
    piProcess.abort()
  }

  async sendQueuedMessage(sessionId: string, message: SDKUserMessageInput): Promise<void> {
    const piProcess = this.processes.get(sessionId)
    if (!piProcess) {
      throw new Error(`[Pi Agent] 会话未运行，无法追加消息: ${sessionId}`)
    }

    const text = message.message.content.trim()
    if (!text) {
      throw new Error('[Pi Agent] 追加消息内容为空')
    }

    // Proma 的运行中追加默认是"立即打断当前 turn 并续跑"，
    // 对应 Pi RPC 的 steer；非 now 优先级保留为 follow_up 兜底。
    piProcess.send({
      id: `proma-${message.priority === 'now' ? 'steer' : 'follow-up'}-${message.uuid ?? Date.now()}`,
      type: message.priority === 'now' ? 'steer' : 'follow_up',
      message: text,
    })
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

  dispose(): void {
    for (const piProcess of this.processes.values()) {
      piProcess.abort()
    }
    for (const sessionId of this.pendingResponses.keys()) {
      this.rejectPendingResponses(sessionId, '[Pi Agent] Pi adapter 已释放')
    }
    this.processes.clear()
  }
}
