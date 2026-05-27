# Pi Agent Engine Phase C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an experimental workspace-level `pi` Agent engine path while preserving the existing Claude SDK Agent behavior.

**Architecture:** Proma keeps owning workspaces, sessions, permissions, IPC, and renderer state. The Agent runtime becomes selectable through session/workspace metadata and an adapter registry; Phase C introduces a `PiAgentAdapter` behind the existing Agent service boundary, initially using process/RPC integration and clear unsupported-operation fallbacks.

**Tech Stack:** Bun workspace, TypeScript, Electron main/preload IPC, React 18, Jotai, existing Proma Agent service, `@earendil-works/pi-coding-agent` after version verification.

---

## File Structure

- `packages/shared/src/types/agent.ts`: define `AgentEngine`, add `agentEngine` to workspace/session types, and narrow workspace update/create inputs.
- `packages/shared/src/types/agent-provider.ts`: add runtime-neutral engine metadata to adapter input without renaming the existing interface in Phase C.
- `apps/electron/src/main/lib/agent-workspace-manager.ts`: default/migrate workspace engines, support create/update engine changes.
- `apps/electron/src/main/lib/agent-session-manager.ts`: persist session engine at create/migrate/fork/move boundaries.
- `apps/electron/src/main/lib/agent-engine.ts`: new focused helper for resolving effective engine from session/workspace.
- `apps/electron/src/main/lib/agent-adapter-registry.ts`: new focused helper for adapter lifecycle and lookup.
- `apps/electron/src/main/lib/adapters/pi-agent-adapter.ts`: new experimental adapter with process/RPC boundary, initially implemented as a controlled stub until pi protocol validation is complete.
- `apps/electron/src/main/lib/adapters/pi-event-converter.ts`: convert pi events to Proma-compatible stream payloads.
- `apps/electron/src/main/lib/adapters/pi-permission-mapping.ts`: map Proma permission modes to pi tool preflight decisions.
- `apps/electron/src/main/lib/agent-service.ts`: use engine-aware orchestrator/adapter lookup instead of a single Claude adapter instance.
- `apps/electron/src/main/lib/agent-orchestrator.ts`: pass resolved engine/options into adapter and guard unsupported pi operations.
- `apps/electron/src/main/ipc.ts`: accept engine in workspace create/update IPC and expose unsupported operation responses.
- `apps/electron/src/preload/index.ts`: update Electron API types for workspace engine inputs.
- `apps/electron/src/renderer/components/agent/WorkspaceSelector.tsx`: show compact engine badge.
- `apps/electron/src/renderer/components/settings/AgentSettings.tsx`: add workspace engine selector UI.
- `apps/electron/src/renderer/components/agent/AgentView.tsx`: show concise pi experimental limitations and disable unsupported actions.
- `apps/electron/package.json`: add pi dependency only after version search.
- Tests:
  - `apps/electron/src/main/lib/agent-engine.test.ts`
  - `apps/electron/src/main/lib/adapters/pi-permission-mapping.test.ts`
  - `apps/electron/src/main/lib/adapters/pi-event-converter.test.ts`
  - `apps/electron/src/main/lib/agent-workspace-manager.test.ts`
  - `apps/electron/src/renderer/lib/agent-engine-ui.test.ts`

## Baseline

Already verified in the isolated worktree `/Users/xixi/Code/Proma/.worktrees/pi-agent-engine-phase-c`:

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun install
bun run typecheck
bun test
```

Expected baseline output:

```text
@proma/shared typecheck: Exited with code 0
@proma/core typecheck: Exited with code 0
@proma/ui typecheck: Exited with code 0
@proma/electron typecheck: Exited with code 0
47 pass
0 fail
```

---

### Task 1: Add Agent Engine Types And Defaults

**Files:**
- Modify: `packages/shared/src/types/agent.ts`
- Test: `apps/electron/src/main/lib/agent-engine.test.ts`

- [ ] **Step 1: Write the failing engine helper test**

Create `apps/electron/src/main/lib/agent-engine.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import type { AgentSessionMeta, AgentWorkspace } from '@proma/shared'
import { getAgentEngine, resolveAgentEngine } from './agent-engine'

describe('Agent engine resolution', () => {
  test('Given old workspace without engine When normalized Then defaults to claude-sdk', () => {
    const workspace = { id: 'w1', name: '默认', slug: 'default', createdAt: 1, updatedAt: 1 } satisfies AgentWorkspace

    expect(getAgentEngine(workspace)).toBe('claude-sdk')
  })

  test('Given session engine and workspace engine When resolving Then session engine wins', () => {
    const session = { id: 's1', title: '会话', agentEngine: 'pi', createdAt: 1, updatedAt: 1 } satisfies AgentSessionMeta
    const workspace = { id: 'w1', name: '默认', slug: 'default', agentEngine: 'claude-sdk', createdAt: 1, updatedAt: 1 } satisfies AgentWorkspace

    expect(resolveAgentEngine({ session, workspace })).toBe('pi')
  })

  test('Given no session engine and pi workspace When resolving Then workspace engine is used', () => {
    const session = { id: 's1', title: '会话', createdAt: 1, updatedAt: 1 } satisfies AgentSessionMeta
    const workspace = { id: 'w1', name: 'Pi', slug: 'pi', agentEngine: 'pi', createdAt: 1, updatedAt: 1 } satisfies AgentWorkspace

    expect(resolveAgentEngine({ session, workspace })).toBe('pi')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun test apps/electron/src/main/lib/agent-engine.test.ts
```

Expected: FAIL because `./agent-engine` and `AgentEngine` do not exist.

- [ ] **Step 3: Add shared types**

In `packages/shared/src/types/agent.ts`, above `AgentWorkspace`, add:

```ts
/** Agent 底层运行引擎 */
export type AgentEngine = 'claude-sdk' | 'pi'

/** 默认 Agent 引擎 */
export const DEFAULT_AGENT_ENGINE: AgentEngine = 'claude-sdk'
```

Extend `AgentWorkspace`:

```ts
  /** 工作区使用的 Agent 引擎；缺省视为 claude-sdk */
  agentEngine?: AgentEngine
```

Extend `AgentSessionMeta` after `workspaceId?: string`:

```ts
  /** 会话创建时绑定的 Agent 引擎；缺省视为 claude-sdk */
  agentEngine?: AgentEngine
```

- [ ] **Step 4: Add engine helper implementation**

Create `apps/electron/src/main/lib/agent-engine.ts`:

```ts
import { DEFAULT_AGENT_ENGINE } from '@proma/shared'
import type { AgentEngine, AgentSessionMeta, AgentWorkspace } from '@proma/shared'

export function getAgentEngine(input?: Pick<AgentWorkspace | AgentSessionMeta, 'agentEngine'> | null): AgentEngine {
  return input?.agentEngine ?? DEFAULT_AGENT_ENGINE
}

export function resolveAgentEngine(input: {
  session?: Pick<AgentSessionMeta, 'agentEngine'> | null
  workspace?: Pick<AgentWorkspace, 'agentEngine'> | null
}): AgentEngine {
  return input.session?.agentEngine ?? input.workspace?.agentEngine ?? DEFAULT_AGENT_ENGINE
}

export function isPiAgentEngine(engine: AgentEngine): boolean {
  return engine === 'pi'
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun test apps/electron/src/main/lib/agent-engine.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run typecheck**

Run:

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun run typecheck
```

Expected: all packages exit with code 0.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/types/agent.ts apps/electron/src/main/lib/agent-engine.ts apps/electron/src/main/lib/agent-engine.test.ts
git commit -m "feat(agent): add agent engine metadata"
```

---

### Task 2: Persist Workspace And Session Engine

**Files:**
- Modify: `apps/electron/src/main/lib/agent-workspace-manager.ts`
- Modify: `apps/electron/src/main/lib/agent-session-manager.ts`
- Modify: `apps/electron/src/main/ipc.ts`
- Modify: `apps/electron/src/preload/index.ts`
- Test: `apps/electron/src/main/lib/agent-workspace-manager.test.ts`

- [ ] **Step 1: Write failing workspace manager tests**

Create `apps/electron/src/main/lib/agent-workspace-manager.test.ts` with focused pure normalization tests instead of touching user `~/.proma` state:

```ts
import { describe, expect, test } from 'bun:test'
import type { AgentWorkspace } from '@proma/shared'
import { normalizeAgentWorkspaceForTest } from './agent-workspace-manager'

describe('Agent 工作区引擎持久化', () => {
  test('Given old workspace without agentEngine When normalized Then uses claude-sdk', () => {
    const workspace = { id: 'w1', name: '旧工作区', slug: 'old', createdAt: 1, updatedAt: 1 } satisfies AgentWorkspace

    expect(normalizeAgentWorkspaceForTest(workspace).agentEngine).toBe('claude-sdk')
  })

  test('Given pi workspace When normalized Then preserves pi engine', () => {
    const workspace = { id: 'w1', name: 'Pi', slug: 'pi', agentEngine: 'pi', createdAt: 1, updatedAt: 1 } satisfies AgentWorkspace

    expect(normalizeAgentWorkspaceForTest(workspace).agentEngine).toBe('pi')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun test apps/electron/src/main/lib/agent-workspace-manager.test.ts
```

Expected: FAIL because `normalizeAgentWorkspaceForTest` does not exist.

- [ ] **Step 3: Add workspace normalization and create/update engine inputs**

In `apps/electron/src/main/lib/agent-workspace-manager.ts`, import defaults:

```ts
import { DEFAULT_AGENT_ENGINE } from '@proma/shared'
import type { AgentEngine, AgentWorkspace, WorkspaceMcpConfig, SkillMeta, SkillImportSource, OtherWorkspaceSkillsGroup, WorkspaceCapabilities, SkillFileNode, SkillFileContent } from '@proma/shared'
```

Add near `writeIndex`:

```ts
function normalizeAgentWorkspace(workspace: AgentWorkspace): AgentWorkspace {
  return {
    ...workspace,
    agentEngine: workspace.agentEngine ?? DEFAULT_AGENT_ENGINE,
  }
}

export function normalizeAgentWorkspaceForTest(workspace: AgentWorkspace): AgentWorkspace {
  return normalizeAgentWorkspace(workspace)
}
```

Update `listAgentWorkspaces`, `listAgentWorkspacesByUpdatedAt`, and `getAgentWorkspace` to return normalized workspaces:

```ts
return index.workspaces.map(normalizeAgentWorkspace)
```

and:

```ts
return index.workspaces.slice().map(normalizeAgentWorkspace).sort((a, b) => b.updatedAt - a.updatedAt)
```

and:

```ts
return index.workspaces.find((w) => w.id === id) ? normalizeAgentWorkspace(index.workspaces.find((w) => w.id === id)!) : undefined
```

Change create signature:

```ts
export function createAgentWorkspace(name: string, agentEngine: AgentEngine = DEFAULT_AGENT_ENGINE): AgentWorkspace {
```

Add to created workspace:

```ts
    agentEngine,
```

Change update signature:

```ts
  updates: { name: string; agentEngine?: AgentEngine },
```

Set updated fields:

```ts
    name: updates.name,
    agentEngine: updates.agentEngine ?? existing.agentEngine ?? DEFAULT_AGENT_ENGINE,
```

Ensure default workspace includes:

```ts
      agentEngine: DEFAULT_AGENT_ENGINE,
```

- [ ] **Step 4: Update IPC/preload workspace input types**

In `packages/shared/src/types/agent.ts`, add explicit input interfaces near workspace types:

```ts
export interface AgentWorkspaceCreateInput {
  name: string
  agentEngine?: AgentEngine
}

export interface AgentWorkspaceUpdateInput {
  name: string
  agentEngine?: AgentEngine
}
```

Update `apps/electron/src/main/ipc.ts` workspace handlers to accept object inputs while preserving old string compatibility:

```ts
async (_, input: string | AgentWorkspaceCreateInput): Promise<AgentWorkspace> => {
  const name = typeof input === 'string' ? input : input.name
  const agentEngine = typeof input === 'string' ? undefined : input.agentEngine
  return createAgentWorkspace(name, agentEngine)
}
```

and update update handler:

```ts
async (_, id: string, updates: AgentWorkspaceUpdateInput): Promise<AgentWorkspace> => {
  return updateAgentWorkspace(id, updates)
}
```

Update `apps/electron/src/preload/index.ts` `ElectronAPI` signatures:

```ts
createAgentWorkspace: (input: string | AgentWorkspaceCreateInput) => Promise<AgentWorkspace>
updateAgentWorkspace: (id: string, updates: AgentWorkspaceUpdateInput) => Promise<AgentWorkspace>
```

- [ ] **Step 5: Persist session engine at create time**

In `apps/electron/src/main/lib/agent-session-manager.ts`, current signature is positional:

```ts
export function createAgentSession(
  title?: string,
  channelId?: string,
  workspaceId?: string,
): AgentSessionMeta
```

Change it to add an optional fourth argument:

```ts
export function createAgentSession(
  title?: string,
  channelId?: string,
  workspaceId?: string,
  agentEngine: AgentEngine = DEFAULT_AGENT_ENGINE,
): AgentSessionMeta
```

Import `AgentEngine` and `DEFAULT_AGENT_ENGINE`, then include it in the created meta:

```ts
agentEngine,
```

- [ ] **Step 6: Update AgentView session creation calls**

Update the preload and IPC signatures to preserve positional compatibility:

```ts
createAgentSession: (
  title?: string,
  channelId?: string,
  workspaceId?: string,
  agentEngine?: AgentEngine,
) => Promise<AgentSessionMeta>
```

In `apps/electron/src/main/ipc.ts`, pass the fourth argument through:

```ts
async (
  _,
  title?: string,
  channelId?: string,
  workspaceId?: string,
  agentEngine?: AgentEngine,
): Promise<AgentSessionMeta> => {
  const session = createAgentSession(title, channelId, workspaceId, agentEngine)
  feishuBridgeManager.ensureSessionMirror(session).catch((error) => {
    console.error('[飞书 Session 镜像] 新会话建群失败:', error)
  })
  return session
}
```

In renderer call sites that create Agent sessions from a workspace, derive current workspace engine:

```ts
const currentWorkspace = workspaces.find((w) => w.id === currentWorkspaceId)
const agentEngine = currentWorkspace?.agentEngine ?? 'claude-sdk'
```

Pass it as the fourth argument:

```ts
const meta = await window.electronAPI.createAgentSession(
  undefined,
  agentChannelId,
  currentWorkspaceId || undefined,
  agentEngine,
)
```

- [ ] **Step 7: Run tests**

Run:

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun test apps/electron/src/main/lib/agent-workspace-manager.test.ts apps/electron/src/main/lib/agent-engine.test.ts
bun run typecheck
```

Expected: tests pass and typecheck passes.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/types/agent.ts apps/electron/src/main/lib/agent-workspace-manager.ts apps/electron/src/main/lib/agent-session-manager.ts apps/electron/src/main/ipc.ts apps/electron/src/preload/index.ts apps/electron/src/renderer/components/agent/AgentView.tsx apps/electron/src/main/lib/agent-workspace-manager.test.ts
git commit -m "feat(agent): persist workspace agent engine"
```

---

### Task 3: Add Workspace Engine UI

**Files:**
- Modify: `apps/electron/src/renderer/components/settings/AgentSettings.tsx`
- Modify: `apps/electron/src/renderer/components/agent/WorkspaceSelector.tsx`
- Test: `apps/electron/src/renderer/lib/agent-engine-ui.test.ts`

- [ ] **Step 1: Write UI helper tests**

Create `apps/electron/src/renderer/lib/agent-engine-ui.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { getAgentEngineBadge, getAgentEngineLabel } from './agent-engine-ui'

describe('Agent engine UI helpers', () => {
  test('Given claude-sdk When rendering label Then returns Claude SDK', () => {
    expect(getAgentEngineLabel('claude-sdk')).toBe('Claude SDK')
  })

  test('Given pi When rendering badge Then marks experimental', () => {
    expect(getAgentEngineBadge('pi')).toEqual({ label: 'pi experimental', tone: 'warning' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun test apps/electron/src/renderer/lib/agent-engine-ui.test.ts
```

Expected: FAIL because helper does not exist.

- [ ] **Step 3: Add UI helper**

Create `apps/electron/src/renderer/lib/agent-engine-ui.ts`:

```ts
import type { AgentEngine } from '@proma/shared'

export interface AgentEngineBadge {
  label: string
  tone: 'neutral' | 'warning'
}

export function getAgentEngineLabel(engine: AgentEngine): string {
  return engine === 'pi' ? 'pi' : 'Claude SDK'
}

export function getAgentEngineBadge(engine: AgentEngine): AgentEngineBadge {
  if (engine === 'pi') return { label: 'pi experimental', tone: 'warning' }
  return { label: 'Claude SDK', tone: 'neutral' }
}
```

- [ ] **Step 4: Add selector in Agent settings**

In `apps/electron/src/renderer/components/settings/AgentSettings.tsx`, add a compact section near workspace configuration:

```tsx
<Select
  value={currentWorkspace?.agentEngine ?? 'claude-sdk'}
  onValueChange={(value) => {
    if (!currentWorkspace) return
    void window.electronAPI
      .updateAgentWorkspace(currentWorkspace.id, {
        name: currentWorkspace.name,
        agentEngine: value as AgentEngine,
      })
      .then((updated) => {
        setAgentWorkspaces((prev) => prev.map((w) => (w.id === updated.id ? updated : w)))
      })
      .catch((error) => {
        console.error('[Agent 设置] 更新工作区 Agent 引擎失败:', error)
        toast.error('更新工作区 Agent 引擎失败')
      })
  }}
>
  <SelectTrigger>
    <SelectValue placeholder="选择 Agent 引擎" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="claude-sdk">Claude SDK</SelectItem>
    <SelectItem value="pi">pi experimental</SelectItem>
  </SelectContent>
</Select>
```

Ensure imports include `AgentEngine`, `toast`, and existing Select components. If `setAgentWorkspaces` is not available, add `const setAgentWorkspaces = useSetAtom(agentWorkspacesAtom)`.

- [ ] **Step 5: Show compact badge in workspace selector**

In `apps/electron/src/renderer/components/agent/WorkspaceSelector.tsx`, import helper:

```ts
import { getAgentEngineBadge } from '@/lib/agent-engine-ui'
```

Inside each workspace row, derive badge:

```tsx
const badge = getAgentEngineBadge(ws.agentEngine ?? 'claude-sdk')
```

Render only for pi to keep UI quiet:

```tsx
{badge.tone === 'warning' && (
  <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-300">
    {badge.label}
  </span>
)}
```

- [ ] **Step 6: Run tests and typecheck**

Run:

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun test apps/electron/src/renderer/lib/agent-engine-ui.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/electron/src/renderer/lib/agent-engine-ui.ts apps/electron/src/renderer/lib/agent-engine-ui.test.ts apps/electron/src/renderer/components/settings/AgentSettings.tsx apps/electron/src/renderer/components/agent/WorkspaceSelector.tsx
git commit -m "feat(agent): add workspace engine selector"
```

---

### Task 4: Add Adapter Registry And Pi Unsupported Stub

**Files:**
- Create: `apps/electron/src/main/lib/agent-adapter-registry.ts`
- Create: `apps/electron/src/main/lib/adapters/pi-agent-adapter.ts`
- Modify: `apps/electron/src/main/lib/agent-service.ts`
- Test: `apps/electron/src/main/lib/agent-adapter-registry.test.ts`

- [ ] **Step 1: Write registry tests**

Create `apps/electron/src/main/lib/agent-adapter-registry.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun test apps/electron/src/main/lib/agent-adapter-registry.test.ts
```

Expected: FAIL because registry does not exist.

- [ ] **Step 3: Add pi adapter stub**

Create `apps/electron/src/main/lib/adapters/pi-agent-adapter.ts`:

```ts
import type { AgentProviderAdapter, AgentQueryInput, SDKMessage } from '@proma/shared'

export class PiAgentAdapter implements AgentProviderAdapter {
  readonly name = 'pi' as const

  async *query(input: AgentQueryInput): AsyncIterable<SDKMessage> {
    const now = new Date().toISOString()
    yield {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'pi experimental engine is installed but process integration is not enabled yet.' }],
        model: input.model,
      },
      parent_tool_use_id: null,
      session_id: input.sessionId,
      uuid: `pi-stub-${Date.now()}`,
    }
    yield {
      type: 'result',
      subtype: 'error_during_execution',
      usage: { input_tokens: 0, output_tokens: 0 },
      errors: [`${now}: pi process integration is not implemented in this build`],
      session_id: input.sessionId,
    }
  }

  abort(_sessionId: string): void {}

  dispose(): void {}
}
```

- [ ] **Step 4: Add adapter registry**

Create `apps/electron/src/main/lib/agent-adapter-registry.ts`:

```ts
import type { AgentEngine, AgentProviderAdapter } from '@proma/shared'
import { ClaudeAgentAdapter } from './adapters/claude-agent-adapter'
import { PiAgentAdapter } from './adapters/pi-agent-adapter'

export interface NamedAgentAdapter extends AgentProviderAdapter {
  readonly name: AgentEngine
}

export class AgentAdapterRegistry {
  private readonly adapters = new Map<AgentEngine, NamedAgentAdapter>()

  constructor(adapters: NamedAgentAdapter[]) {
    for (const adapter of adapters) this.adapters.set(adapter.name, adapter)
  }

  get(engine: AgentEngine): NamedAgentAdapter {
    const adapter = this.adapters.get(engine)
    if (!adapter) throw new Error(`不支持的 Agent 引擎: ${engine}`)
    return adapter
  }

  dispose(): void {
    for (const adapter of this.adapters.values()) adapter.dispose()
  }
}

export function createAgentAdapterRegistry(): AgentAdapterRegistry {
  const claude = new ClaudeAgentAdapter() as ClaudeAgentAdapter & { readonly name: 'claude-sdk' }
  Object.defineProperty(claude, 'name', { value: 'claude-sdk' })
  return new AgentAdapterRegistry([claude, new PiAgentAdapter()])
}

export function createAgentAdapterRegistryForTest(): AgentAdapterRegistry {
  return createAgentAdapterRegistry()
}
```

- [ ] **Step 5: Refactor agent-service to use registry for Claude without changing runtime behavior**

In `apps/electron/src/main/lib/agent-service.ts`, replace:

```ts
const adapter = new ClaudeAgentAdapter()
const orchestrator = new AgentOrchestrator(adapter, eventBus)
```

with:

```ts
const adapterRegistry = createAgentAdapterRegistry()
const orchestrator = new AgentOrchestrator(adapterRegistry.get('claude-sdk'), eventBus)
```

Update imports: remove direct `ClaudeAgentAdapter` import but keep `scanAndKillOrphanedClaudeSubprocesses`; import `createAgentAdapterRegistry`.

This task only adds the registry and pi stub. Engine-aware orchestrator switching happens in Task 5.

- [ ] **Step 6: Run tests and typecheck**

Run:

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun test apps/electron/src/main/lib/agent-adapter-registry.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/electron/src/main/lib/agent-adapter-registry.ts apps/electron/src/main/lib/adapters/pi-agent-adapter.ts apps/electron/src/main/lib/agent-adapter-registry.test.ts apps/electron/src/main/lib/agent-service.ts
git commit -m "feat(agent): add runtime adapter registry"
```

---

### Task 5: Route Sessions By Engine And Guard Unsupported Actions

**Files:**
- Modify: `apps/electron/src/main/lib/agent-service.ts`
- Modify: `apps/electron/src/main/lib/agent-orchestrator.ts`
- Modify: `apps/electron/src/main/ipc.ts`
- Modify: `apps/electron/src/renderer/components/agent/AgentView.tsx`
- Test: `apps/electron/src/main/lib/agent-engine-routing.test.ts`

- [ ] **Step 1: Write routing test**

Create `apps/electron/src/main/lib/agent-engine-routing.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import type { AgentSessionMeta, AgentWorkspace } from '@proma/shared'
import { resolveAgentEngine } from './agent-engine'

describe('Agent engine routing', () => {
  test('Given pi session When workspace is claude Then session still routes to pi', () => {
    const session = { id: 's1', title: 'Pi 会话', agentEngine: 'pi', workspaceId: 'w1', createdAt: 1, updatedAt: 1 } satisfies AgentSessionMeta
    const workspace = { id: 'w1', name: '默认', slug: 'default', agentEngine: 'claude-sdk', createdAt: 1, updatedAt: 1 } satisfies AgentWorkspace

    expect(resolveAgentEngine({ session, workspace })).toBe('pi')
  })
})
```

- [ ] **Step 2: Run routing test**

Run:

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun test apps/electron/src/main/lib/agent-engine-routing.test.ts
```

Expected: PASS if Task 1 was implemented correctly.

- [ ] **Step 3: Add engine-aware orchestrator selection boundary**

In `apps/electron/src/main/lib/agent-service.ts`, create one orchestrator per engine:

```ts
const adapterRegistry = createAgentAdapterRegistry()
const orchestrators = new Map<AgentEngine, AgentOrchestrator>()

function getOrchestrator(engine: AgentEngine): AgentOrchestrator {
  const existing = orchestrators.get(engine)
  if (existing) return existing
  const created = new AgentOrchestrator(adapterRegistry.get(engine), eventBus)
  orchestrators.set(engine, created)
  return created
}
```

Replace direct `orchestrator` usage inside `runAgent`, `runAgentHeadless`, `stopAgent`, `isAgentSessionActive`, `queueAgentMessage`, `updateAgentPermissionMode`, and `rewindAgentSession` with a resolved orchestrator.

For `runAgent` and `runAgentHeadless`, resolve from input/session/workspace:

```ts
const sessionMeta = getAgentSessionMeta(input.sessionId)
const workspace = sessionMeta?.workspaceId ? getAgentWorkspace(sessionMeta.workspaceId) : undefined
const engine = resolveAgentEngine({ session: sessionMeta, workspace })
const orchestrator = getOrchestrator(engine)
```

- [ ] **Step 4: Guard unsupported pi operations in service functions**

For fork/rewind operations, before calling Claude-specific SDK helpers, resolve engine from session meta. If `pi`, throw clear Chinese errors:

```ts
throw new Error('pi experimental 暂不支持会话分叉。请在 Claude SDK 工作区中使用该功能。')
```

and:

```ts
throw new Error('pi experimental 暂不支持文件快照回退。')
```

- [ ] **Step 5: Add pi limitation notice in AgentView**

In `apps/electron/src/renderer/components/agent/AgentView.tsx`, derive current engine:

```ts
const currentWorkspace = workspaces.find((w) => w.id === currentWorkspaceId)
const currentAgentEngine = currentWorkspace?.agentEngine ?? 'claude-sdk'
const isPiEngine = currentAgentEngine === 'pi'
```

Render a compact notice near the header/input area:

```tsx
{isPiEngine && (
  <div className="mx-4 mb-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
    pi experimental 当前支持本地 coding 最小闭环，分叉、回退和 Claude SDK 原生恢复暂不可用。
  </div>
)}
```

Disable fork/rewind buttons where rendered by checking `isPiEngine` or session meta `agentEngine === 'pi'`.

- [ ] **Step 6: Run typecheck and targeted tests**

Run:

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun test apps/electron/src/main/lib/agent-engine-routing.test.ts apps/electron/src/main/lib/agent-engine.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/electron/src/main/lib/agent-service.ts apps/electron/src/main/lib/agent-orchestrator.ts apps/electron/src/main/ipc.ts apps/electron/src/renderer/components/agent/AgentView.tsx apps/electron/src/main/lib/agent-engine-routing.test.ts
git commit -m "feat(agent): route sessions by agent engine"
```

---

### Task 6: Add Pi Event Conversion And Permission Mapping

**Files:**
- Create: `apps/electron/src/main/lib/adapters/pi-event-converter.ts`
- Create: `apps/electron/src/main/lib/adapters/pi-permission-mapping.ts`
- Modify: `apps/electron/src/main/lib/adapters/pi-agent-adapter.ts`
- Test: `apps/electron/src/main/lib/adapters/pi-event-converter.test.ts`
- Test: `apps/electron/src/main/lib/adapters/pi-permission-mapping.test.ts`

- [ ] **Step 1: Write permission mapping tests**

Create `apps/electron/src/main/lib/adapters/pi-permission-mapping.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { mapPiToolPermission } from './pi-permission-mapping'

describe('pi permission mapping', () => {
  test('Given safe mode When read tool requested Then allow', () => {
    expect(mapPiToolPermission({ mode: 'safe', toolName: 'read' })).toEqual({ behavior: 'allow' })
  })

  test('Given safe mode When write tool requested Then ask', () => {
    expect(mapPiToolPermission({ mode: 'safe', toolName: 'write' })).toEqual({ behavior: 'ask', dangerLevel: 'medium' })
  })

  test('Given allow-all mode When bash requested Then allow but require scope check', () => {
    expect(mapPiToolPermission({ mode: 'allow-all', toolName: 'bash' })).toEqual({ behavior: 'allow', requireScopeCheck: true })
  })
})
```

- [ ] **Step 2: Write event converter tests**

Create `apps/electron/src/main/lib/adapters/pi-event-converter.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { convertPiTextDelta, convertPiToolStart } from './pi-event-converter'

describe('pi event converter', () => {
  test('Given pi text delta When converted Then returns assistant SDK message', () => {
    const msg = convertPiTextDelta({ sessionId: 's1', delta: 'hello', model: 'model-a' })

    expect(msg.type).toBe('assistant')
    expect(msg.message.content[0]).toEqual({ type: 'text', text: 'hello' })
  })

  test('Given pi tool start When converted Then returns assistant tool_use message', () => {
    const msg = convertPiToolStart({ sessionId: 's1', toolUseId: 't1', toolName: 'bash', input: { command: 'pwd' } })

    expect(msg.type).toBe('assistant')
    expect(msg.message.content[0]).toEqual({ type: 'tool_use', id: 't1', name: 'bash', input: { command: 'pwd' } })
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun test apps/electron/src/main/lib/adapters/pi-permission-mapping.test.ts apps/electron/src/main/lib/adapters/pi-event-converter.test.ts
```

Expected: FAIL because modules do not exist.

- [ ] **Step 4: Implement permission mapping**

Create `apps/electron/src/main/lib/adapters/pi-permission-mapping.ts`:

```ts
import type { DangerLevel, PromaPermissionMode } from '@proma/shared'

export interface PiPermissionInput {
  mode: PromaPermissionMode
  toolName: string
}

export interface PiPermissionDecision {
  behavior: 'allow' | 'ask'
  dangerLevel?: DangerLevel
  requireScopeCheck?: boolean
}

const READ_ONLY_TOOLS = new Set(['read', 'list', 'grep', 'glob'])
const WRITE_TOOLS = new Set(['write', 'edit'])
const SHELL_TOOLS = new Set(['bash', 'shell'])

export function mapPiToolPermission(input: PiPermissionInput): PiPermissionDecision {
  const normalized = input.toolName.toLowerCase()
  if (input.mode === 'allow-all') return { behavior: 'allow', requireScopeCheck: true }
  if (READ_ONLY_TOOLS.has(normalized)) return { behavior: 'allow' }
  if (WRITE_TOOLS.has(normalized)) return { behavior: 'ask', dangerLevel: 'medium' }
  if (SHELL_TOOLS.has(normalized)) return { behavior: 'ask', dangerLevel: 'high' }
  return { behavior: 'ask', dangerLevel: 'medium' }
}
```

- [ ] **Step 5: Implement event converter**

Create `apps/electron/src/main/lib/adapters/pi-event-converter.ts`:

```ts
import type { SDKAssistantMessage } from '@proma/shared'

export interface PiTextDeltaInput {
  sessionId: string
  delta: string
  model?: string
}

export interface PiToolStartInput {
  sessionId: string
  toolUseId: string
  toolName: string
  input: Record<string, unknown>
}

export function convertPiTextDelta(input: PiTextDeltaInput): SDKAssistantMessage {
  return {
    type: 'assistant',
    message: {
      content: [{ type: 'text', text: input.delta }],
      model: input.model,
    },
    parent_tool_use_id: null,
    session_id: input.sessionId,
    uuid: `pi-text-${Date.now()}`,
  }
}

export function convertPiToolStart(input: PiToolStartInput): SDKAssistantMessage {
  return {
    type: 'assistant',
    message: {
      content: [{ type: 'tool_use', id: input.toolUseId, name: input.toolName, input: input.input }],
    },
    parent_tool_use_id: null,
    session_id: input.sessionId,
    uuid: `pi-tool-${input.toolUseId}`,
  }
}
```

- [ ] **Step 6: Wire helpers into PiAgentAdapter stub**

Update `apps/electron/src/main/lib/adapters/pi-agent-adapter.ts` to call `convertPiTextDelta` for the stub text message. This keeps tests representative for the later real pi process integration.

- [ ] **Step 7: Run tests and typecheck**

Run:

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun test apps/electron/src/main/lib/adapters/pi-permission-mapping.test.ts apps/electron/src/main/lib/adapters/pi-event-converter.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/electron/src/main/lib/adapters/pi-permission-mapping.ts apps/electron/src/main/lib/adapters/pi-permission-mapping.test.ts apps/electron/src/main/lib/adapters/pi-event-converter.ts apps/electron/src/main/lib/adapters/pi-event-converter.test.ts apps/electron/src/main/lib/adapters/pi-agent-adapter.ts
git commit -m "feat(agent): add pi event and permission mapping"
```

---

### Task 7: Verify Pi Dependency And Add Process Integration Spike

**Files:**
- Modify: `apps/electron/package.json`
- Modify: `apps/electron/src/main/lib/adapters/pi-agent-adapter.ts`
- Create: `apps/electron/src/main/lib/adapters/pi-process.ts`
- Test: `apps/electron/src/main/lib/adapters/pi-process.test.ts`

- [ ] **Step 1: Verify dependency version before installing**

Run:

```bash
npm view @earendil-works/pi-coding-agent version description engines dependencies --json
npm view @earendil-works/pi-agent-core version description engines --json
npm view @earendil-works/pi-ai version description engines --json
```

Expected: confirm current versions and Node engine. If version differs from `0.75.5`, use the current version and note it in the commit body.

- [ ] **Step 2: Install scoped dependency only**

Run:

```bash
PI_VERSION=$(npm view @earendil-works/pi-coding-agent version)
export PATH="$HOME/.bun/bin:$PATH"
bun add --filter @proma/electron "@earendil-works/pi-coding-agent@$PI_VERSION"
```

Expected: `apps/electron/package.json` and `bun.lock` update. Do not install unscoped placeholder packages.

- [ ] **Step 3: Write process resolver test**

Create `apps/electron/src/main/lib/adapters/pi-process.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { resolvePiCliEntrypointForTest } from './pi-process'

describe('pi process integration', () => {
  test('Given installed pi package When resolving entrypoint Then returns cli path', () => {
    const entrypoint = resolvePiCliEntrypointForTest()

    expect(entrypoint.endsWith('dist/cli.js')).toBe(true)
  })
})
```

- [ ] **Step 4: Implement pi process resolver**

Create `apps/electron/src/main/lib/adapters/pi-process.ts`:

```ts
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

export function resolvePiCliEntrypoint(): string {
  const cjsRequire = createRequire(__filename)
  const packageJsonPath = cjsRequire.resolve('@earendil-works/pi-coding-agent/package.json')
  return join(dirname(packageJsonPath), 'dist', 'cli.js')
}

export function resolvePiCliEntrypointForTest(): string {
  return resolvePiCliEntrypoint()
}
```

- [ ] **Step 5: Run resolver test**

Run:

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun test apps/electron/src/main/lib/adapters/pi-process.test.ts
```

Expected: PASS if package export permits `package.json` resolution. If it fails because package exports block `package.json`, change resolver to `cjsRequire.resolve('@earendil-works/pi-coding-agent')` and derive package root from that entrypoint.

- [ ] **Step 6: Add minimal process integration behind feature guard**

Update `PiAgentAdapter.query()` to check an environment flag before spawning:

```ts
if (process.env.PROMA_PI_AGENT_ENABLED !== '1') {
  yield convertPiTextDelta({ sessionId: input.sessionId, delta: 'pi experimental 尚未启用。请设置 PROMA_PI_AGENT_ENABLED=1 后重试。', model: input.model })
  return
}
```

When enabled, spawn the pi entrypoint with cwd and model environment. Use `AbortSignal` to kill the child on abort. Keep stdout line parsing isolated; if protocol details are not confirmed, emit a clear error result instead of guessing event semantics.

- [ ] **Step 7: Run full verification**

Run:

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun test apps/electron/src/main/lib/adapters/pi-process.test.ts apps/electron/src/main/lib/adapters/pi-event-converter.test.ts apps/electron/src/main/lib/adapters/pi-permission-mapping.test.ts
bun run typecheck
bun run electron:build
```

Expected: all pass. Build may show Vite chunk warnings only.

- [ ] **Step 8: Commit**

```bash
git add apps/electron/package.json bun.lock apps/electron/src/main/lib/adapters/pi-process.ts apps/electron/src/main/lib/adapters/pi-process.test.ts apps/electron/src/main/lib/adapters/pi-agent-adapter.ts
git commit -m "feat(agent): add experimental pi process bridge"
```

---

### Task 8: Final Phase C Verification And Documentation Update Request

**Files:**
- Modify only with user approval: `README.md`, `AGENTS.md`, `CLAUDE.md`
- Verify: full repo

- [ ] **Step 1: Run full test suite**

Run:

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun run typecheck
bun test
bun run electron:build
```

Expected: typecheck passes, tests pass, build passes with only known Vite chunk warnings.

- [ ] **Step 2: Manual dev smoke**

Run:

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun run dev
```

Expected:

```text
Vite starts on http://localhost:5173
Electron window opens
Existing Claude SDK workspace still works as before
A pi workspace can be selected and shows experimental marker
Sending a pi prompt returns either the guarded experimental message or real pi stream when PROMA_PI_AGENT_ENABLED=1
```

Stop the dev server after smoke verification.

- [ ] **Step 3: Ask for documentation permission**

Because project instructions require permission before updating docs, ask the user before changing `README.md`, `AGENTS.md`, and `CLAUDE.md`:

```text
Phase C changes affect documented Agent architecture and package versions. Do you want me to update README.md, AGENTS.md, and CLAUDE.md now?
```

- [ ] **Step 4: If approved, update docs**

Update docs to mention:

- Workspace-level Agent engine selection.
- `Claude SDK` remains default.
- `pi experimental` exists with limitations.
- Correct scoped pi packages.
- Phase C unsupported features.

- [ ] **Step 5: Commit docs if changed**

```bash
git add README.md AGENTS.md CLAUDE.md
git commit -m "docs: document experimental pi agent engine"
```

- [ ] **Step 6: Push feature branch**

```bash
git push -u origin codex/pi-agent-engine-phase-c
```

Expected: branch pushed to fork. If branch was previously pushed and rebased, use:

```bash
git push --force-with-lease origin codex/pi-agent-engine-phase-c
```
