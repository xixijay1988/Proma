import { describe, expect, test } from 'bun:test'
import { getPiAgentExperimentalNotice } from './pi-agent-capabilities-ui.ts'

describe('Pi Agent capability UI copy', () => {
  test('Given Pi Agent notice When rendered Then it mentions AskUserQuestion bridge support', () => {
    const notice = getPiAgentExperimentalNotice()

    expect(notice).toContain('AskUserQuestion')
    expect(notice).toContain('向用户提问')
    expect(notice).toContain('MCP bridge 不是 Claude SDK 深度注入')
  })
})
