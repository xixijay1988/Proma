import type { AgentProviderAdapter, AgentQueryInput, SDKMessage } from '@proma/shared'
import { convertPiTextDelta } from './pi-event-converter'
import { startPiProcessBridgeProbe, type StartedPiProcess } from './pi-process'

const PI_UNSUPPORTED_MESSAGE = 'Pi 进程集成尚未在此构建中实现或启用。'
const PI_PROCESS_BRIDGE_MESSAGE = 'Pi process bridge started, but protocol parsing is not implemented in this build.'
const PI_AGENT_ENABLED = '1'

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

function formatPiProcessDiagnostics(processResult: Awaited<StartedPiProcess['done']>): string {
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

export class PiAgentAdapter implements AgentProviderAdapter {
  readonly name = 'pi' as const
  private readonly processes = new Map<string, StartedPiProcess>()

  async *query(input: AgentQueryInput): AsyncIterable<SDKMessage> {
    if (process.env.PROMA_PI_AGENT_ENABLED !== PI_AGENT_ENABLED) {
      yield createErrorAssistantMessage(input, PI_UNSUPPORTED_MESSAGE, 'pi_not_enabled')
      yield createErrorResultMessage(input, PI_UNSUPPORTED_MESSAGE)
      return
    }

    let piProcess: StartedPiProcess
    try {
      piProcess = startPiProcessBridgeProbe({
        cwd: input.cwd,
        abortSignal: input.abortSignal,
      })
      this.processes.set(input.sessionId, piProcess)
    } catch (error) {
      const message = error instanceof Error
        ? `Pi process bridge failed to start: ${error.message}`
        : 'Pi process bridge failed to start: unknown error'
      yield createErrorAssistantMessage(input, message, 'pi_process_start_failed')
      yield createErrorResultMessage(input, message)
      return
    }

    try {
      const processResult = await piProcess.done
      const diagnosticMessage = `${PI_PROCESS_BRIDGE_MESSAGE}\n\n${formatPiProcessDiagnostics(processResult)}`
      yield createErrorAssistantMessage(input, diagnosticMessage, 'pi_protocol_not_implemented')
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
    piProcess.kill()
  }

  dispose(): void {
    for (const piProcess of this.processes.values()) {
      piProcess.kill()
    }
    this.processes.clear()
  }
}
