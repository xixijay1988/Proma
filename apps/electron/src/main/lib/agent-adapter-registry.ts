import type { AgentEngine, AgentProviderAdapter } from '@proma/shared'
import { ClaudeAgentAdapter } from './adapters/claude-agent-adapter'
import { PiAgentAdapter } from './adapters/pi-agent-adapter'

export interface NamedAgentAdapter extends AgentProviderAdapter {
  readonly name: AgentEngine
}

export interface AgentAdapterEntry {
  readonly name: AgentEngine
  readonly adapter: AgentProviderAdapter
}

interface RegisteredAgentAdapterEntry extends AgentAdapterEntry {
  readonly adapter: NamedAgentAdapter
}

export class AgentAdapterRegistry {
  private readonly adapters = new Map<AgentEngine, RegisteredAgentAdapterEntry>()

  constructor(entries: AgentAdapterEntry[]) {
    for (const entry of entries) {
      if (!isNamedAgentAdapter(entry.name, entry.adapter)) {
        throw new Error(`Agent 适配器名称不匹配: ${entry.name}`)
      }
      const registeredEntry: RegisteredAgentAdapterEntry = {
        name: entry.name,
        adapter: entry.adapter,
      }
      this.adapters.set(entry.name, registeredEntry)
    }
  }

  get(engine: AgentEngine): NamedAgentAdapter {
    const entry = this.adapters.get(engine)
    if (!entry) {
      throw new Error(`不支持的 Agent 引擎: ${engine}`)
    }
    return entry.adapter
  }

  getNamed(engine: AgentEngine): AgentAdapterEntry {
    const entry = this.adapters.get(engine)
    if (!entry) {
      throw new Error(`不支持的 Agent 引擎: ${engine}`)
    }
    return entry
  }

  dispose(): void {
    for (const entry of this.adapters.values()) {
      entry.adapter.dispose()
    }
  }
}

function isNamedAgentAdapter(
  name: AgentEngine,
  adapter: AgentProviderAdapter,
): adapter is NamedAgentAdapter {
  return 'name' in adapter && adapter.name === name
}

export function createAgentAdapterRegistry(): AgentAdapterRegistry {
  return new AgentAdapterRegistry([
    { name: 'claude-sdk', adapter: new ClaudeAgentAdapter() },
    { name: 'pi', adapter: new PiAgentAdapter() },
  ])
}

export function createAgentAdapterRegistryForTest(): AgentAdapterRegistry {
  return createAgentAdapterRegistry()
}
