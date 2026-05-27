import { describe, expect, test } from 'bun:test'
import { createAgentAdapterRegistryForTest } from './agent-adapter-registry'

describe('Agent adapter registry', () => {
  test('Given claude-sdk engine When resolving adapter Then returns Claude adapter', () => {
    const registry = createAgentAdapterRegistryForTest()

    expect(registry.get('claude-sdk').name).toBe('claude-sdk')
  })

  test('Given pi engine When resolving adapter Then returns pi adapter', () => {
    const registry = createAgentAdapterRegistryForTest()

    expect(registry.get('pi').name).toBe('pi')
  })
})
