/**
 * Room Agent 成员运行队列。
 *
 * 同一个 Room 成员在同一频道中复用稳定 Agent session；底层 Agent 编排层不允许同一
 * session 并发 sendMessage。这里按 sessionId 串行化，避免复杂派发时把后续任务误报为
 * “上一条消息仍在处理中”。不同成员/频道的 sessionId 不同，仍可并行运行。
 */
export class RoomAgentRunQueue {
  private tails = new Map<string, Promise<void>>()
  private pendingCounts = new Map<string, number>()

  wouldQueue(sessionId: string): boolean {
    return this.tails.has(sessionId)
  }

  isBusy(sessionId: string): boolean {
    return this.tails.has(sessionId)
  }

  getPendingCount(sessionId: string): number {
    return this.pendingCounts.get(sessionId) ?? 0
  }

  enqueue(sessionId: string, run: () => Promise<void>): Promise<void> {
    const previous = this.tails.get(sessionId) ?? Promise.resolve()
    const queued = this.tails.has(sessionId)
    if (queued) this.pendingCounts.set(sessionId, this.getPendingCount(sessionId) + 1)

    const current = previous
      .catch(() => undefined)
      .then(async () => {
        if (queued) {
          const nextCount = Math.max(0, this.getPendingCount(sessionId) - 1)
          if (nextCount > 0) this.pendingCounts.set(sessionId, nextCount)
          else this.pendingCounts.delete(sessionId)
        }
        await run()
      })
      .finally(() => {
        if (this.tails.get(sessionId) === current) {
          this.tails.delete(sessionId)
          this.pendingCounts.delete(sessionId)
        }
      })

    this.tails.set(sessionId, current)
    return current
  }
}
