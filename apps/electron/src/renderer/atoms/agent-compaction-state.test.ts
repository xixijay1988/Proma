import { describe, expect, test } from 'bun:test'
import { applyAgentEvent, type AgentStreamState } from './agent-atoms'

function createState(): AgentStreamState {
  return {
    running: true,
    content: '',
    toolActivities: [],
    isCompacting: true,
    compactInFlight: true,
  }
}

describe('Agent 压缩后的运行状态', () => {
  test('Given 压缩是终态 When 完成 Then 保留收尾抑制直到 stream 结束', () => {
    const next = applyAgentEvent(createState(), { type: 'compact_complete' })

    expect(next.isCompacting).toBe(false)
    expect(next.compactInFlight).toBe(true)
  })

  test('Given Pi 压缩后将自动续跑 When 完成 Then 恢复普通运行指示器', () => {
    const next = applyAgentEvent(createState(), {
      type: 'compact_complete',
      willContinue: true,
    })

    expect(next.isCompacting).toBe(false)
    expect(next.compactInFlight).toBe(false)
    expect(next.running).toBe(true)
  })
})
