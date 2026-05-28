import type { SDKAssistantMessage } from '@proma/shared'

export interface PiTextDeltaInput {
  sessionId: string
  delta: string
  model?: string
  parentToolUseId?: string | null
}

export interface PiToolStartInput {
  sessionId: string
  toolUseId: string
  toolName: string
  input: Record<string, unknown>
  model?: string
  parentToolUseId?: string | null
}

export function convertPiTextDelta(input: PiTextDeltaInput): SDKAssistantMessage {
  return {
    type: 'assistant',
    message: {
      content: [{ type: 'text', text: input.delta }],
      ...(input.model ? { model: input.model } : {}),
    },
    parent_tool_use_id: input.parentToolUseId ?? null,
    session_id: input.sessionId,
  }
}

export function convertPiToolStart(input: PiToolStartInput): SDKAssistantMessage {
  return {
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          id: input.toolUseId,
          name: input.toolName,
          input: input.input,
        },
      ],
      ...(input.model ? { model: input.model } : {}),
    },
    parent_tool_use_id: input.parentToolUseId ?? null,
    session_id: input.sessionId,
  }
}
