export interface AgentResultDrainState {
  terminalResultReceived: boolean
  compactionInFlight: boolean
}

export type AgentResultDrainEvent =
  | 'terminal_result'
  | 'compaction_started'
  | 'compaction_finished'
  | 'compaction_continues'

export type AgentResultDrainTimeoutAction = 'start' | 'cancel' | 'none'

export interface AgentResultDrainTransition {
  state: AgentResultDrainState
  timeoutAction: AgentResultDrainTimeoutAction
}

export function createAgentResultDrainState(): AgentResultDrainState {
  return {
    terminalResultReceived: false,
    compactionInFlight: false,
  }
}

/**
 * 协调 terminal result 与 Pi post-run 压缩的收尾时序。
 *
 * Pi 会先发 agent_end（Proma 转成 result），再运行自动压缩。result drain timeout
 * 只能在没有压缩进行时生效，否则会在 compaction_end 到达前提前关闭 iterator。
 */
export function reduceAgentResultDrainState(
  state: AgentResultDrainState,
  event: AgentResultDrainEvent,
): AgentResultDrainTransition {
  switch (event) {
    case 'terminal_result': {
      const nextState = { ...state, terminalResultReceived: true }
      return {
        state: nextState,
        timeoutAction: nextState.compactionInFlight ? 'none' : 'start',
      }
    }

    case 'compaction_started':
      return {
        state: { ...state, compactionInFlight: true },
        timeoutAction: state.terminalResultReceived ? 'cancel' : 'none',
      }

    case 'compaction_finished':
      return {
        state: { ...state, compactionInFlight: false },
        timeoutAction: state.terminalResultReceived ? 'start' : 'none',
      }

    case 'compaction_continues':
      return {
        state: {
          terminalResultReceived: false,
          compactionInFlight: false,
        },
        timeoutAction: 'cancel',
      }
  }
}
