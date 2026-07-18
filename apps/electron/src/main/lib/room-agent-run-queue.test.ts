import { describe, expect, test } from 'bun:test'
import { RoomAgentRunQueue } from './room-agent-run-queue.ts'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('RoomAgentRunQueue', () => {
  test('Given same session jobs When enqueued quickly Then runs them sequentially', async () => {
    const queue = new RoomAgentRunQueue()
    const events: string[] = []

    const first = queue.enqueue('session-1', async () => {
      events.push('first:start')
      await delay(10)
      events.push('first:end')
    })
    const second = queue.enqueue('session-1', async () => {
      events.push('second:start')
      await delay(1)
      events.push('second:end')
    })

    await Promise.all([first, second])

    expect(events).toEqual(['first:start', 'first:end', 'second:start', 'second:end'])
  })

  test('Given different session jobs When enqueued quickly Then allows parallel runs', async () => {
    const queue = new RoomAgentRunQueue()
    const events: string[] = []

    const first = queue.enqueue('session-1', async () => {
      events.push('first:start')
      await delay(20)
      events.push('first:end')
    })
    const second = queue.enqueue('session-2', async () => {
      events.push('second:start')
      await delay(1)
      events.push('second:end')
    })

    await Promise.all([first, second])

    expect(events.indexOf('second:start')).toBeGreaterThan(events.indexOf('first:start'))
    expect(events.indexOf('second:end')).toBeLessThan(events.indexOf('first:end'))
  })

  test('Given active session When checking queued status Then reports queued before run starts', async () => {
    const queue = new RoomAgentRunQueue()
    let releaseFirst: (() => void) | undefined
    const first = queue.enqueue('session-1', () => new Promise<void>((resolve) => {
      releaseFirst = resolve
    }))

    await delay(1)
    expect(queue.isBusy('session-1')).toBe(true)
    expect(queue.wouldQueue('session-1')).toBe(true)

    const second = queue.enqueue('session-1', async () => undefined)
    expect(queue.getPendingCount('session-1')).toBe(1)

    releaseFirst?.()
    await Promise.all([first, second])
    expect(queue.isBusy('session-1')).toBe(false)
  })
})
