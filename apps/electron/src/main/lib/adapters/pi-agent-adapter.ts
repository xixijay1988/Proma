import type { AgentProviderAdapter, AgentQueryInput, SDKMessage } from '@proma/shared'

const PI_UNSUPPORTED_MESSAGE = 'Pi 进程集成尚未在此构建中实现或启用。'

export class PiAgentAdapter implements AgentProviderAdapter {
  readonly name = 'pi' as const

  async *query(input: AgentQueryInput): AsyncIterable<SDKMessage> {
    yield {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: PI_UNSUPPORTED_MESSAGE }],
        ...(input.model ? { model: input.model } : {}),
        stop_reason: 'error',
      },
      parent_tool_use_id: null,
      session_id: input.sessionId,
      error: { message: PI_UNSUPPORTED_MESSAGE, errorType: 'pi_not_implemented' },
    }

    yield {
      type: 'result',
      subtype: 'error',
      usage: {
        input_tokens: 0,
        output_tokens: 0,
      },
      errors: [PI_UNSUPPORTED_MESSAGE],
      session_id: input.sessionId,
    }
  }

  abort(_sessionId: string): void {}

  dispose(): void {}
}
