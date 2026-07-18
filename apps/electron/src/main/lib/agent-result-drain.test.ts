import { describe, expect, test } from 'bun:test'
import {
  createAgentResultDrainState,
  reduceAgentResultDrainState,
} from './agent-result-drain'

describe('Agent result drain 生命周期', () => {
  test('Given terminal result 已到达 When 随后开始压缩 Then 取消 result drain timeout', () => {
    const afterResult = reduceAgentResultDrainState(
      createAgentResultDrainState(),
      'terminal_result',
    )
    expect(afterResult.timeoutAction).toBe('start')

    const afterCompactionStart = reduceAgentResultDrainState(
      afterResult.state,
      'compaction_started',
    )
    expect(afterCompactionStart.timeoutAction).toBe('cancel')
    expect(afterCompactionStart.state).toEqual({
      terminalResultReceived: true,
      compactionInFlight: true,
    })
  })

  test('Given terminal result 后压缩仍在进行 When 压缩完成 Then 重新启动 drain timeout', () => {
    const afterResult = reduceAgentResultDrainState(
      createAgentResultDrainState(),
      'terminal_result',
    )
    const afterCompactionStart = reduceAgentResultDrainState(
      afterResult.state,
      'compaction_started',
    )
    const afterCompactionEnd = reduceAgentResultDrainState(
      afterCompactionStart.state,
      'compaction_finished',
    )

    expect(afterCompactionEnd.timeoutAction).toBe('start')
    expect(afterCompactionEnd.state).toEqual({
      terminalResultReceived: true,
      compactionInFlight: false,
    })
  })

  test('Given 压缩结束后 Pi 将自动续跑 When 收到 continuation Then 清除旧 terminal result 且不启动 timeout', () => {
    const afterResult = reduceAgentResultDrainState(
      createAgentResultDrainState(),
      'terminal_result',
    )
    const afterCompactionStart = reduceAgentResultDrainState(
      afterResult.state,
      'compaction_started',
    )
    const afterContinuation = reduceAgentResultDrainState(
      afterCompactionStart.state,
      'compaction_continues',
    )

    expect(afterContinuation.timeoutAction).toBe('cancel')
    expect(afterContinuation.state).toEqual({
      terminalResultReceived: false,
      compactionInFlight: false,
    })
  })

  test('Given 压缩先于 terminal result 开始 When result 到达 Then 不提前启动 drain timeout', () => {
    const afterCompactionStart = reduceAgentResultDrainState(
      createAgentResultDrainState(),
      'compaction_started',
    )
    const afterResult = reduceAgentResultDrainState(
      afterCompactionStart.state,
      'terminal_result',
    )

    expect(afterResult.timeoutAction).toBe('none')
    expect(afterResult.state.compactionInFlight).toBe(true)
  })
})
