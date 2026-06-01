import type { SDKMessage } from '@proma/shared'

export function isPromaStreamingDeltaMessage(message: SDKMessage | Record<string, unknown>): boolean {
  const record = message as Record<string, unknown>
  return record._promaTextDelta === true || record._promaThinkingDelta === true
}

export function shouldStoreLiveAgentMessage(message: SDKMessage | Record<string, unknown>): boolean {
  const record = message as Record<string, unknown>
  if (record.type === 'prompt_suggestion') return false
  if (record.isReplay) return false
  if (record._promaTransient !== true) return true
  return isPromaStreamingDeltaMessage(record)
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

export function appendLiveAgentMessage(current: SDKMessage[], incoming: SDKMessage): SDKMessage[] {
  const baseMessages = hasFinalAssistantTextOrThinking(incoming)
    ? removePromaStreamingDeltas(current)
    : current

  const incomingUuid = (incoming as Record<string, unknown>).uuid
  if (
    typeof incomingUuid === 'string'
    && baseMessages.some((message) => (message as Record<string, unknown>).uuid === incomingUuid)
  ) {
    return current
  }

  return [...baseMessages, incoming]
}
