import type { AgentEngine, AgentProviderAdapter } from '@proma/shared'
import { ClaudeAgentAdapter } from './adapters/claude-agent-adapter'
import { PiAgentAdapter } from './adapters/pi-agent-adapter'

export interface NamedAgentAdapter extends AgentProviderAdapter {
  readonly name: AgentEngine
}

export class AgentAdapterRegistry {
  private readonly adapters = new Map<AgentEngine, NamedAgentAdapter>()

  constructor(adapters: NamedAgentAdapter[]) {
    for (const adapter of adapters) {
      this.adapters.set(adapter.name, adapter)
    }
  }

  get(engine: AgentEngine): NamedAgentAdapter {
    const adapter = this.adapters.get(engine)
    if (!adapter) {
      throw new Error(`不支持的 Agent 引擎: ${engine}`)
    }
    return adapter
  }

  dispose(): void {
    for (const adapter of this.adapters.values()) {
      adapter.dispose()
    }
  }
}

function withAgentAdapterName(
  name: AgentEngine,
  adapter: AgentProviderAdapter,
): NamedAgentAdapter {
  return Object.assign(adapter, { name })
}

export function createAgentAdapterRegistry(): AgentAdapterRegistry {
  return new AgentAdapterRegistry([
    withAgentAdapterName('claude-sdk', new ClaudeAgentAdapter()),
    new PiAgentAdapter(),
  ])
}

export function createAgentAdapterRegistryForTest(): AgentAdapterRegistry {
  return createAgentAdapterRegistry()
}
