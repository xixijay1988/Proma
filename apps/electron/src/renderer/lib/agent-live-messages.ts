import type { SDKMessage } from '@proma/shared'

export function isPromaStreamingDeltaMessage(message: SDKMessage | Record<string, unknown>): boolean {
  const record = message as Record<string, unknown>
  return record._promaTextDelta === true || record._promaThinkingDelta === true
}

export function isPromaToolProgressMessage(message: SDKMessage | Record<string, unknown>): boolean {
  const record = message as Record<string, unknown>
  return record._promaToolProgress === true
}

export function shouldStoreLiveAgentMessage(message: SDKMessage | Record<string, unknown>): boolean {
  const record = message as Record<string, unknown>
  if (record.type === 'prompt_suggestion') return false
  if (record.isReplay) return false
  if (record._promaTransient !== true) return true
  return isPromaStreamingDeltaMessage(record) || isPromaToolProgressMessage(record)
}

function hasFinalAssistantTextOrThinking(message: SDKMessage | Record<string, unknown>): boolean {
  const record = message as Record<string, unknown>
  if (record.type !== 'assistant') return false
  if (isPromaStreamingDeltaMessage(record)) return false

  const sdkMessage = record.message as { content?: unknown } | undefined
  if (!Array.isArray(sdkMessage?.content)) return false

  return sdkMessage.content.some((block) => {
    if (!block || typeof block !== 'object') return false
    const blockRecord = block as Record<string, unknown>
    return blockRecord.type === 'text' || blockRecord.type === 'thinking'
  })
}

function removePromaStreamingDeltas(messages: SDKMessage[]): SDKMessage[] {
  return messages.filter((message) => !isPromaStreamingDeltaMessage(message))
}

function getToolResultId(message: SDKMessage | Record<string, unknown>): string | null {
  const record = message as Record<string, unknown>
  if (record.type !== 'user') return null

  const sdkMessage = record.message as { content?: unknown } | undefined
  if (!Array.isArray(sdkMessage?.content)) return null

  for (const block of sdkMessage.content) {
    if (!block || typeof block !== 'object') continue
    const blockRecord = block as Record<string, unknown>
    if (blockRecord.type !== 'tool_result') continue
    return typeof blockRecord.tool_use_id === 'string' ? blockRecord.tool_use_id : null
  }

  return null
}

function isFinalToolResultMessage(message: SDKMessage): boolean {
  return getToolResultId(message) !== null && !isPromaToolProgressMessage(message)
}

function removePromaToolProgressFor(messages: SDKMessage[], toolUseId: string): SDKMessage[] {
  return messages.filter((message) => {
    if (!isPromaToolProgressMessage(message)) return true
    return getToolResultId(message) !== toolUseId
  })
}

export function appendLiveAgentMessage(current: SDKMessage[], incoming: SDKMessage): SDKMessage[] {
  let baseMessages = hasFinalAssistantTextOrThinking(incoming)
    ? removePromaStreamingDeltas(current)
    : current

  const incomingToolResultId = getToolResultId(incoming)
  if (incomingToolResultId && (isPromaToolProgressMessage(incoming) || isFinalToolResultMessage(incoming))) {
    baseMessages = removePromaToolProgressFor(baseMessages, incomingToolResultId)
  }

  const incomingUuid = (incoming as Record<string, unknown>).uuid
  if (
    typeof incomingUuid === 'string'
    && baseMessages.some((message) => (message as Record<string, unknown>).uuid === incomingUuid)
  ) {
    return current
  }

  return [...baseMessages, incoming]
}
