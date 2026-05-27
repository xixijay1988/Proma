# Pi Agent Engine Design

Date: 2026-05-27
Status: draft, approved for recording

## Background

Proma Agent mode currently relies mainly on `@anthropic-ai/claude-agent-sdk`.
That integration is powerful but heavy: native binary packaging, SDK-specific
session state, Claude-specific permission modes, MCP injection, fork/rewind
behavior, and event formats are deeply coupled to the current Agent pipeline.

We want to introduce a second bottom-level Agent framework based on
`earendil-works/pi`, selectable by users at the workspace level. The goal is
not to replace Claude Agent SDK immediately. The goal is to add a lighter,
experimental Agent backend, validate the integration, then iterate toward a
stable alternative.

## Confirmed Decisions

- Agent engine selection is workspace-level, not global and not per-message.
- Existing workspaces default to `claude-sdk`.
- New sessions should record the engine used at creation time, so later
  workspace engine changes do not break old session recovery or rendering.
- The rollout path is `C -> A -> B`:
  - C: experimental engine switch with clear limitations.
  - A: lightweight coding-agent alternative.
  - B: fuller peer implementation with more Proma Agent capabilities.
- The first implementation path is `B -> A`:
  - Start with `@earendil-works/pi-coding-agent` through process/RPC or JSON
    integration.
  - Later migrate the internals of `PiAgentAdapter` to
    `@earendil-works/pi-agent-core` if the integration proves stable.
- The first capability path is `B -> C`:
  - Start with local coding minimum loop.
  - Then expand toward a near-usable version.
- Permission handling must be unified through Proma's permission service.
  Proma should not expose two competing permission UIs.

## Pi Package Notes

Use the scoped npm packages:

- `@earendil-works/pi-ai`
- `@earendil-works/pi-agent-core`
- `@earendil-works/pi-coding-agent`

Do not use the unscoped placeholder packages:

- `pi-ai`
- `pi-agent-core`
- `pi-coding-agent`

At the time of investigation, the scoped packages were at version `0.75.5`.
Before adding dependencies, search and confirm the current versions again per
project policy.

`pi-coding-agent` requires Node `>=22.19.0`. Electron runtime compatibility and
packaged-app resolution must be verified before relying on direct imports or
CLI execution.

## Product Shape

Workspace settings should expose an Agent engine selector:

- `Claude SDK`
- `pi experimental`

The default remains `Claude SDK`.

When the current workspace uses pi, the Agent UI should show an experimental
status marker and make unsupported capabilities clear. This should be concise,
not a large explanatory panel.

Session metadata should persist the selected engine:

```ts
export type AgentEngine = 'claude-sdk' | 'pi'

export interface AgentWorkspace {
  agentEngine?: AgentEngine
}

export interface AgentSessionMeta {
  agentEngine?: AgentEngine
}
```

For migration, omitted `agentEngine` means `claude-sdk`.

## Architecture

Proma should keep owning the top-level Agent experience:

- session index and JSONL persistence
- workspace selection and workspace files
- settings and channel management
- permission UI
- renderer event handling
- remote bridge entry points

The bottom engine should be selected through an explicit adapter registry:

```ts
interface AgentRuntimeAdapter {
  query(input: AgentQueryInput): AsyncIterable<AgentRuntimeMessage>
  abort(sessionId: string): void
  dispose(): void
}
```

The current `AgentProviderAdapter` is already close to this idea, but it is
still named and typed around SDK messages. First implementation can extend it
minimally. A later cleanup can rename the concept from SDK-specific language to
runtime-neutral language.

Expected adapter shape:

- `ClaudeAgentAdapter`: keeps current behavior.
- `PiAgentAdapter`: wraps pi process/RPC/JSON integration at first.
- Later `PiAgentAdapter`: may switch its internal implementation to
  `pi-agent-core` without changing Proma callers.

`agent-service.ts` should stop constructing only `new ClaudeAgentAdapter()`.
Engine selection should happen from session metadata or workspace metadata,
with session metadata taking precedence.

## First Pi Capability Boundary

The first pi experimental loop should support:

- send prompt
- stream text output
- show tool activity for read/write/edit/bash
- stop current run
- run inside workspace cwd
- respect workspace files and attached directories as allowed file scope
- map Proma permission modes onto pi tool preflight

Not required in the first loop:

- Claude SDK native `sdkSessionId` resume
- fork session
- rewind files from SDK checkpoints
- Claude SDK built-in MCP injection
- full Task/SubAgent semantic parity
- thinking signature recovery
- complex queue semantics

Unsupported operations should be disabled or return clear, user-facing
messages instead of failing silently.

## Permission Mapping

Proma permission modes map to pi behavior as follows:

- `safe`: allow read-only tools; confirm write/edit/bash.
- `ask`: allow read file; confirm write/edit/bash/high-risk operations.
- `allow-all`: do not prompt, but still restrict access to workspace cwd and
  attached directories/files.

File scope checks remain mandatory even in `allow-all`.

## Event Conversion

Proma's renderer and remote bridges currently consume SDK-shaped messages and
`AgentStreamPayload`. To avoid a broad frontend migration in the first version,
`PiAgentAdapter` should convert pi events into existing Proma-compatible events.

Mapping direction:

- pi text delta -> assistant text event/message
- pi tool start/update/end -> Proma tool activity shape
- pi run end -> result/done event
- pi error -> typed error where possible
- pi-only metadata -> `proma_event` extension rather than forcing it into
  Claude SDK-specific structures

Long term, Proma should introduce `AgentRuntimeMessage` and move away from
Claude-specific `SDKMessage` naming in shared types. That is not required for
the experimental loop.

## Packaging And Dependency Strategy

First implementation should prefer process isolation for pi:

- Lower risk when Electron's runtime and pi's Node requirement diverge.
- Easier to kill/cleanup stuck pi runs.
- Allows Proma to keep pi as an experimental backend without destabilizing
  Claude SDK integration.

Before implementation:

- Verify current `@earendil-works/*` package versions.
- Verify `pi-coding-agent` JSON/RPC or process integration contract.
- Verify packaged app can resolve and execute the pi entry point.
- Decide whether pi dependencies are bundled by esbuild or treated as external.
- Confirm no install scripts or native assets complicate packaging.

## Testing Plan

Use BDD-style tests around behavior:

- Given an old workspace without `agentEngine`, when loaded, then it defaults to
  `claude-sdk`.
- Given a pi workspace, when a new session is created, then session metadata
  records `pi`.
- Given a pi session, when sending a prompt, then Proma uses `PiAgentAdapter`.
- Given `safe`, `ask`, and `allow-all`, when pi requests read/write/edit/bash,
  then permission behavior matches the agreed mapping.
- Given pi stream events, when converted, then renderer receives text output
  and tool activities.
- Given unsupported pi operations such as fork/rewind, when triggered, then the
  UI disables them or returns a clear limitation message.

## Iteration Roadmap

### Phase C: Experimental

- Workspace-level engine selector.
- `PiAgentAdapter` via `pi-coding-agent` process/RPC/JSON integration.
- Minimal coding loop: read/write/edit/bash, stream, stop, permissions.
- UI labels pi as experimental and limits unsupported actions.

### Phase A: Lightweight Alternative

- Stabilize event conversion and permissions.
- Improve session persistence and continuation behavior.
- Add better tool activity rendering.
- Support remote bridge runs if the local loop is stable.

### Phase B: Peer Agent Engine

- Evaluate migration from `pi-coding-agent` process integration to embedded
  `pi-agent-core`.
- Integrate Skills and MCP more deeply.
- Revisit fork/rewind, background tasks, queue semantics, and bridge parity.
- Rename shared runtime message abstractions away from SDK-specific naming.

## Open Questions

- Which pi mode is best for process integration: JSON, RPC, or SDK/process
  entry point?
- Can pi's default tools be constrained cleanly to Proma workspace scopes?
- How much of Proma's existing MCP/Skills model can pi consume directly?
- Should pi sessions write any pi-native state under the workspace directory,
  or should Proma fully own persisted state?
- What should the UI show for mixed history if a workspace engine changes after
  sessions already exist?

## Next Step

After this design is reviewed, write a concrete implementation plan. The first
implementation plan should focus only on Phase C and avoid trying to solve full
parity with Claude SDK.
