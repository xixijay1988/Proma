import { describe, expect, test } from 'bun:test'
import { convertPiTextDelta, convertPiToolStart } from './pi-event-converter'

describe('pi event converter', () => {
  test('Given pi text delta When converted Then returns assistant SDK message', () => {
    const msg = convertPiTextDelta({ sessionId: 's1', delta: 'hello', model: 'model-a' })

    expect(msg.type).toBe('assistant')
    expect(msg.message.content[0]).toEqual({ type: 'text', text: 'hello' })
  })

  test('Given pi tool start When converted Then returns assistant tool_use message', () => {
    const msg = convertPiToolStart({
      sessionId: 's1',
      toolUseId: 't1',
      toolName: 'bash',
      input: { command: 'pwd' },
    })

    expect(msg.type).toBe('assistant')
    expect(msg.message.content[0]).toEqual({
      type: 'tool_use',
      id: 't1',
      name: 'bash',
      input: { command: 'pwd' },
    })
  })
})
