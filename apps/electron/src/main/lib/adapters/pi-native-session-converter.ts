import type { SDKContentBlock, SDKMessage, SDKUserContentBlock } from '@proma/shared'

interface ConvertPiNativeSessionEntriesInput {
  sessionId: string
  entries: unknown[]
  leafEntryId?: string
}

interface PiNativeMessageEntry {
  type: string
  id?: string
  parentId?: string | null
  timestamp?: string
  message?: Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

function getBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key]
  return typeof value === 'boolean' ? value : undefined
}

function getCreatedAt(entry: PiNativeMessageEntry): number | undefined {
  if (!entry.timestamp) return undefined
  const timestamp = Date.parse(entry.timestamp)
  return Number.isFinite(timestamp) ? timestamp : undefined
}

function normalizePiTextBlocks(value: unknown): SDKUserContentBlock[] {
  if (typeof value === 'string') {
    return [{ type: 'text', text: value }]
  }

  if (!Array.isArray(value)) return []

  const blocks: SDKUserContentBlock[] = []
  for (const item of value) {
    const record = asRecord(item)
    if (!record) continue

    if (record.type === 'text') {
      const text = getString(record, 'text')
      if (text) blocks.push({ type: 'text', text })
    }
  }
  return blocks
}

function normalizePiAssistantBlocks(value: unknown): SDKContentBlock[] {
  if (!Array.isArray(value)) return []

  const blocks: SDKContentBlock[] = []
  for (const item of value) {
    const record = asRecord(item)
    if (!record) continue

    if (record.type === 'text') {
      const text = getString(record, 'text')
      if (text) blocks.push({ type: 'text', text })
      continue
    }

    if (record.type === 'thinking') {
      const thinking = getString(record, 'thinking')
      if (thinking) blocks.push({ type: 'thinking', thinking })
      continue
    }

    if (record.type === 'toolCall') {
      const id = getString(record, 'id')
      const name = getString(record, 'name')
      if (!id || !name) continue
      const input = asRecord(record.arguments) ?? {}
      blocks.push({ type: 'tool_use', id, name, input })
    }
  }

  return blocks
}

function createMessageMeta(entry: PiNativeMessageEntry): Record<string, unknown> {
  return {
    ...(entry.id ? { _promaPiEntryId: entry.id } : {}),
    ...(getCreatedAt(entry) ? { _createdAt: getCreatedAt(entry) } : {}),
  }
}

function convertUserMessage(sessionId: string, entry: PiNativeMessageEntry, message: Record<string, unknown>): SDKMessage | null {
  const content = normalizePiTextBlocks(message.content)
  if (content.length === 0) return null

  return {
    type: 'user',
    message: { content },
    parent_tool_use_id: null,
    session_id: sessionId,
    ...createMessageMeta(entry),
  } as SDKMessage
}

function convertAssistantMessage(sessionId: string, entry: PiNativeMessageEntry, message: Record<string, unknown>): SDKMessage | null {
  const content = normalizePiAssistantBlocks(message.content)
  if (content.length === 0) return null

  const model = getString(message, 'model')
  return {
    type: 'assistant',
    message: {
      content,
      ...(model ? { model } : {}),
    },
    parent_tool_use_id: null,
    session_id: sessionId,
    ...createMessageMeta(entry),
  } as SDKMessage
}

function convertToolResultMessage(sessionId: string, entry: PiNativeMessageEntry, message: Record<string, unknown>): SDKMessage | null {
  const toolUseId = getString(message, 'toolCallId')
  if (!toolUseId) return null

  return {
    type: 'user',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: Array.isArray(message.content) ? message.content : normalizePiTextBlocks(message.content),
          is_error: getBoolean(message, 'isError') === true,
        },
      ],
    },
    parent_tool_use_id: null,
    session_id: sessionId,
    ...createMessageMeta(entry),
  } as SDKMessage
}

function convertBashExecutionMessage(sessionId: string, entry: PiNativeMessageEntry, message: Record<string, unknown>): SDKMessage | null {
  const command = getString(message, 'command')
  const output = getString(message, 'output') ?? ''
  if (!command && !output) return null

  const text = command ? `$ ${command}${output ? `\n${output}` : ''}` : output
  return {
    type: 'assistant',
    message: { content: [{ type: 'text', text }] },
    parent_tool_use_id: null,
    session_id: sessionId,
    ...createMessageMeta(entry),
  } as SDKMessage
}

function convertCustomMessage(sessionId: string, entry: PiNativeMessageEntry, message: Record<string, unknown>): SDKMessage | null {
  if (getBoolean(message, 'display') !== true) return null
  const content = normalizePiTextBlocks(message.content)
  if (content.length === 0) return null

  return {
    type: 'assistant',
    message: { content },
    parent_tool_use_id: null,
    session_id: sessionId,
    ...createMessageMeta(entry),
  } as SDKMessage
}

function normalizeEntry(value: unknown): PiNativeMessageEntry | null {
  const record = asRecord(value)
  if (!record || record.type !== 'message') return null
  const message = asRecord(record.message)
  if (!message) return null

  return {
    type: 'message',
    id: getString(record, 'id'),
    parentId: typeof record.parentId === 'string' ? record.parentId : null,
    timestamp: getString(record, 'timestamp'),
    message,
  }
}

function filterEntriesByLeafPath(entries: PiNativeMessageEntry[], leafEntryId: string | undefined): PiNativeMessageEntry[] {
  if (!leafEntryId) return entries

  const byId = new Map<string, PiNativeMessageEntry>()
  for (const entry of entries) {
    if (entry.id) byId.set(entry.id, entry)
  }

  const pathIds = new Set<string>()
  let current = byId.get(leafEntryId)
  while (current?.id && !pathIds.has(current.id)) {
    pathIds.add(current.id)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }

  return entries.filter((entry) => entry.id ? pathIds.has(entry.id) : true)
}

export function convertPiNativeSessionEntriesToSDKMessages(input: ConvertPiNativeSessionEntriesInput): SDKMessage[] {
  const messages: SDKMessage[] = []
  const entries = filterEntriesByLeafPath(
    input.entries
      .map(normalizeEntry)
      .filter((entry): entry is PiNativeMessageEntry => entry !== null),
    input.leafEntryId,
  )

  for (const entry of entries) {
    if (!entry.message) continue
    const role = getString(entry.message, 'role')
    const converted = role === 'user'
      ? convertUserMessage(input.sessionId, entry, entry.message)
      : role === 'assistant'
        ? convertAssistantMessage(input.sessionId, entry, entry.message)
        : role === 'toolResult'
          ? convertToolResultMessage(input.sessionId, entry, entry.message)
          : role === 'bashExecution'
            ? convertBashExecutionMessage(input.sessionId, entry, entry.message)
            : role === 'custom'
              ? convertCustomMessage(input.sessionId, entry, entry.message)
              : null

    if (converted) messages.push(converted)
  }

  return messages
}
