import type { AgentProviderAdapter, AgentQueryInput, SDKMessage } from '@proma/shared'
import { convertPiTextDelta } from './pi-event-converter'

const PI_UNSUPPORTED_MESSAGE = 'Pi 进程集成尚未在此构建中实现或启用。'

export class PiAgentAdapter implements AgentProviderAdapter {
  readonly name = 'pi' as const

  async *query(input: AgentQueryInput): AsyncIterable<SDKMessage> {
    const unsupportedMessage = convertPiTextDelta({
      sessionId: input.sessionId,
      delta: PI_UNSUPPORTED_MESSAGE,
      model: input.model,
    })

    yield {
      ...unsupportedMessage,
      message: {
        ...unsupportedMessage.message,
        stop_reason: 'error',
      },
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
