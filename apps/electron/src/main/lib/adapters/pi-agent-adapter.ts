import type {
  AgentProviderAdapter,
  AgentQueryInput,
  SDKContentBlock,
  SDKMessage,
  AgentRuntimeExtensionUiRequest,
  AgentRuntimeExtensionUiResponse,
} from '@proma/shared'
import { convertPiTextDelta, convertPiThinkingDelta, convertPiToolStart } from './pi-event-converter'
import { startPiRpcSession, type PiRpcEvent, type StartedPiRpcSession } from './pi-process'

const PI_UNSUPPORTED_MESSAGE = 'Pi 进程集成尚未在此构建中实现或启用。'
const PI_RPC_TERMINATED_MESSAGE = 'Pi RPC 会话在完成前结束。'
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

function createToolResultMessage(input: AgentQueryInput, event: PiRpcEvent): SDKMessage | null {
  const toolUseId = getString(event, 'toolCallId')
  if (!toolUseId) return null

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
  }
}

function createTransientToolProgressMessage(input: AgentQueryInput, event: PiRpcEvent): SDKMessage | null {
  if (event.type !== 'tool_execution_update') return null

  const toolUseId = getString(event, 'toolCallId')
  if (!toolUseId) return null

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

function createFinalAssistantMessage(input: AgentQueryInput, event: PiRpcEvent): SDKMessage | null {
  if (event.type !== 'message_end') return null

  const message = asRecord(event.message)
  if (message?.role !== 'assistant') return null

  const content = extractAssistantContentFromPiMessage(message)
  if (content.length === 0) return null

  return {
    type: 'assistant',
    message: {
      content,
      ...(input.model ? { model: input.model } : {}),
    },
    parent_tool_use_id: null,
    session_id: input.sessionId,
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

  return []
}

export class PiAgentAdapter implements AgentProviderAdapter {
  readonly name = 'pi' as const
  private readonly processes = new Map<string, StartedPiRpcSession>()
  private readonly unknownEventTypes = new Set<string>()
  private readonly unknownChildEventTypes = new Set<string>()
  private readonly malformedEventTypes = new Set<string>()

  private recordUnknownEvent(event: PiRpcEvent): void {
    if (KNOWN_PI_RPC_EVENT_TYPES.has(event.type)) return
    if (this.unknownEventTypes.has(event.type)) return

    this.unknownEventTypes.add(event.type)
    console.warn(`[Pi Agent] 未识别 Pi RPC 事件，已跳过: ${event.type}`)
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
        if (event.type === 'protocol_error') {
          const message = typeof event.error === 'string' ? event.error : 'Pi RPC protocol error'
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
      yield createErrorAssistantMessage(input, diagnosticMessage, 'pi_rpc_terminated')
      yield createErrorResultMessage(input, diagnosticMessage)
    } finally {
      this.processes.delete(input.sessionId)
      piProcess.kill()
    }
  }

  abort(sessionId: string): void {
    const piProcess = this.processes.get(sessionId)
    if (!piProcess) return

    this.processes.delete(sessionId)
    piProcess.abort()
  }

  dispose(): void {
    for (const piProcess of this.processes.values()) {
      piProcess.abort()
    }
    this.processes.clear()
  }
}
