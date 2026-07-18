import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import type { SDKMessage } from '@proma/shared'

type PiCompactionEvent = Extract<AgentSessionEvent, {
  type: 'compaction_start' | 'compaction_end'
}>

/** 将 Pi 原生压缩生命周期转换为 Proma 可渲染、可持久化的 system 消息。 */
export function createPiCompactionMessages(
  sessionId: string,
  event: PiCompactionEvent,
): SDKMessage[] {
  if (event.type === 'compaction_start') {
    return [{
      type: 'system',
      subtype: 'compacting',
      session_id: sessionId,
    } as unknown as SDKMessage]
  }

  if (!event.aborted && event.result) {
    return [{
      type: 'system',
      subtype: 'compact_boundary',
      session_id: sessionId,
      summary: event.result.summary,
      first_kept_entry_id: event.result.firstKeptEntryId,
      tokens_before: event.result.tokensBefore,
      ...(event.willRetry ? { compact_will_retry: true } : {}),
    } as unknown as SDKMessage]
  }

  const errorMessage = event.errorMessage ?? ''
  if (/nothing to compact|already compacted/i.test(errorMessage)) {
    return [{
      type: 'system',
      subtype: 'compact_noop',
      session_id: sessionId,
      message: /already compacted/i.test(errorMessage)
        ? '当前上下文已经压缩过，无需重复压缩。'
        : '当前上下文较小，暂时无需压缩。',
    } as unknown as SDKMessage]
  }

  return [{
    type: 'system',
    subtype: 'status',
    session_id: sessionId,
    compact_result: 'failed',
    compact_error: event.errorMessage
      ?? (event.aborted ? '上下文压缩已取消' : '上下文压缩未完成'),
  } as unknown as SDKMessage]
}
