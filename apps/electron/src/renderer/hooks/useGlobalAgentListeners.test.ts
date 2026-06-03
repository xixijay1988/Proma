import { describe, expect, test } from 'bun:test'
import type { AgentStreamPayload } from '@proma/shared'
import { payloadToLegacyEvents } from './useGlobalAgentListeners'

describe('useGlobalAgentListeners payload conversion', () => {
  test('Given Proma compaction event When converting payload Then maps to legacy compacting events', () => {
    const startPayload = {
      kind: 'proma_event',
      event: { type: 'compaction', status: 'starting', reason: 'threshold' },
    } satisfies AgentStreamPayload
    const endPayload = {
      kind: 'proma_event',
      event: { type: 'compaction', status: 'cleared', reason: 'threshold' },
    } satisfies AgentStreamPayload

    expect(payloadToLegacyEvents(startPayload)).toEqual([{ type: 'compacting' }])
    expect(payloadToLegacyEvents(endPayload)).toEqual([{ type: 'compact_complete' }])
  })
})
