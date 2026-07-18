import { describe, expect, test } from 'bun:test'
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import { createPiCompactionMessages } from './pi-compaction-messages'

describe('Pi 上下文压缩事件转换', () => {
  test('Given compaction_start When 转换 Then 输出正在压缩 system 消息', () => {
    const event: Extract<AgentSessionEvent, { type: 'compaction_start' }> = {
      type: 'compaction_start',
      reason: 'threshold',
    }

    expect(createPiCompactionMessages('session-1', event)).toEqual([{
      type: 'system',
      subtype: 'compacting',
      session_id: 'session-1',
    }])
  })

  test('Given 成功 compaction_end When 转换 Then 输出可持久化的完成边界', () => {
    const event: Extract<AgentSessionEvent, { type: 'compaction_end' }> = {
      type: 'compaction_end',
      reason: 'threshold',
      aborted: false,
      willRetry: false,
      result: {
        summary: '压缩摘要',
        firstKeptEntryId: 'entry-2',
        tokensBefore: 202_741,
        estimatedTokensAfter: 30_000,
      },
    }

    expect(createPiCompactionMessages('session-1', event)).toEqual([{
      type: 'system',
      subtype: 'compact_boundary',
      session_id: 'session-1',
      summary: '压缩摘要',
      first_kept_entry_id: 'entry-2',
      tokens_before: 202_741,
    }])
  })

  test('Given compaction_end 将自动续跑 When 转换 Then 在完成消息中保留 willRetry', () => {
    const event: Extract<AgentSessionEvent, { type: 'compaction_end' }> = {
      type: 'compaction_end',
      reason: 'overflow',
      aborted: false,
      willRetry: true,
      result: {
        summary: '溢出恢复摘要',
        firstKeptEntryId: 'entry-3',
        tokensBefore: 250_000,
        estimatedTokensAfter: 40_000,
      },
    }

    expect(createPiCompactionMessages('session-1', event)).toEqual([{
      type: 'system',
      subtype: 'compact_boundary',
      session_id: 'session-1',
      summary: '溢出恢复摘要',
      first_kept_entry_id: 'entry-3',
      tokens_before: 250_000,
      compact_will_retry: true,
    }])
  })

  test('Given 失败 compaction_end When 转换 Then 输出明确的失败状态', () => {
    const event: Extract<AgentSessionEvent, { type: 'compaction_end' }> = {
      type: 'compaction_end',
      reason: 'threshold',
      aborted: false,
      willRetry: false,
      result: undefined,
      errorMessage: 'Auto-compaction failed: quota exhausted',
    }

    expect(createPiCompactionMessages('session-1', event)).toEqual([{
      type: 'system',
      subtype: 'status',
      session_id: 'session-1',
      compact_result: 'failed',
      compact_error: 'Auto-compaction failed: quota exhausted',
    }])
  })

  test('Given 无需压缩的 compaction_end When 转换 Then 输出友好的 no-op 状态', () => {
    const event: Extract<AgentSessionEvent, { type: 'compaction_end' }> = {
      type: 'compaction_end',
      reason: 'manual',
      aborted: false,
      willRetry: false,
      result: undefined,
      errorMessage: 'Compaction failed: Nothing to compact (session too small)',
    }

    expect(createPiCompactionMessages('session-1', event)).toEqual([{
      type: 'system',
      subtype: 'compact_noop',
      session_id: 'session-1',
      message: '当前上下文较小，暂时无需压缩。',
    }])
  })

  test('Given 取消 compaction_end When 转换 Then 输出取消原因并结束压缩生命周期', () => {
    const event: Extract<AgentSessionEvent, { type: 'compaction_end' }> = {
      type: 'compaction_end',
      reason: 'manual',
      aborted: true,
      willRetry: false,
      result: undefined,
    }

    expect(createPiCompactionMessages('session-1', event)).toEqual([{
      type: 'system',
      subtype: 'status',
      session_id: 'session-1',
      compact_result: 'failed',
      compact_error: '上下文压缩已取消',
    }])
  })
})
