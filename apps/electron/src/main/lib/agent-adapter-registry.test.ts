import { describe, expect, test } from 'bun:test'
import type { AgentEngine, AgentQueryInput, SDKMessage } from '@proma/shared'
import { AgentAdapterRegistry, createAgentAdapterRegistryForTest, type NamedAgentAdapter } from './agent-adapter-registry'
import { ClaudeAgentAdapter } from './adapters/claude-agent-adapter'

class FakeAgentAdapter implements NamedAgentAdapter {
  readonly name: AgentEngine
  disposeCount = 0

  constructor(name: AgentEngine) {
    this.name = name
  }

  async *query(_input: AgentQueryInput): AsyncIterable<SDKMessage> {}

  abort(_sessionId: string): void {}

  dispose(): void {
    this.disposeCount += 1
  }
}

describe('Agent adapter registry', () => {
  test('Given a Claude adapter When reading name Then it is declared by the adapter without registry mutation', () => {
    const adapter = new ClaudeAgentAdapter()

    expect(adapter.name).toBe('claude-sdk')
  })

  test('Given claude-sdk engine When resolving adapter Then returns Claude adapter', () => {
    const registry = createAgentAdapterRegistryForTest()

    expect(registry.get('claude-sdk').name).toBe('claude-sdk')
  })

  test('Given pi engine When resolving adapter Then returns pi adapter', () => {
    const registry = createAgentAdapterRegistryForTest()

    expect(registry.get('pi').name).toBe('pi')
  })

  test('Given registered adapters When disposing registry Then disposes every adapter once', () => {
    const claude = new FakeAgentAdapter('claude-sdk')
    const pi = new FakeAgentAdapter('pi')
    const registry = new AgentAdapterRegistry([
      { name: 'claude-sdk', adapter: claude },
      { name: 'pi', adapter: pi },
    ])

    registry.dispose()

    expect(claude.disposeCount).toBe(1)
    expect(pi.disposeCount).toBe(1)
  })

  test('Given unsupported engine When resolving adapter Then throws localized unsupported engine error', () => {
    const registry = createAgentAdapterRegistryForTest()
    const unsupportedEngine = 'unknown-engine' as unknown as AgentEngine

    expect(() => registry.get(unsupportedEngine)).toThrow('不支持的 Agent 引擎: unknown-engine')
  })
})
