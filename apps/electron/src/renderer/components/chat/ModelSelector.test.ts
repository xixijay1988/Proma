import { describe, expect, test } from 'bun:test'

import type { Channel } from '@proma/shared'
import { buildModelOptions } from './ModelSelector'

function channel(id: string): Channel {
  return {
    id,
    name: id,
    provider: 'anthropic',
    baseUrl: 'https://example.com',
    apiKey: '',
    enabled: true,
    models: [{ id: `${id}-model`, name: `${id} model`, enabled: true }],
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('ModelSelector options', () => {
  test('Given an explicit empty channel filter When building options Then no models are shown', () => {
    expect(buildModelOptions([channel('a'), channel('b')], undefined, [])).toEqual([])
  })
})
