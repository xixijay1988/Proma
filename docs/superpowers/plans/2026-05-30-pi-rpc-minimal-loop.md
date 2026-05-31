# Pi RPC Minimal Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current pi `--help` probe with a minimal `--mode rpc` loop that can stream text, surface terminal results, and abort cleanly.

**Architecture:** Keep pi behind the existing adapter boundary and preserve Claude SDK behavior unchanged. Add a tiny RPC transport in `pi-process.ts`, let `PiAgentAdapter` translate Pi JSONL events into the existing Proma SDK-shaped stream, and keep unsupported Pi capabilities explicit instead of pretending parity.

**Tech Stack:** Bun workspace, TypeScript, Electron main process, existing Proma Agent adapter boundary, `@earendil-works/pi-coding-agent@0.76.0`.

---

### Task 1: Add A Testable Pi RPC Transport

**Files:**
- Modify: `apps/electron/src/main/lib/adapters/pi-process.ts`
- Test: `apps/electron/src/main/lib/adapters/pi-process.test.ts`

- [ ] **Step 1: Write the failing transport test**

Add a test that feeds mocked stdout JSONL into a parser helper and expects newline-delimited Pi events to be split without using Node `readline`.

- [ ] **Step 2: Run the focused test**

Run: `bun test apps/electron/src/main/lib/adapters/pi-process.test.ts`

Expected: fail because the RPC parser helper does not exist yet.

- [ ] **Step 3: Implement the minimal transport**

Add a small helper that:
- spawns `process.execPath` with `--mode rpc`
- writes JSON commands to stdin
- splits stdout by LF only
- collects stderr snippets
- supports `abort()` and timeout cleanup

- [ ] **Step 4: Run the focused test again**

Run: `bun test apps/electron/src/main/lib/adapters/pi-process.test.ts`

Expected: pass.

### Task 2: Stream Text And Final Results Through PiAgentAdapter

**Files:**
- Modify: `apps/electron/src/main/lib/adapters/pi-agent-adapter.ts`
- Test: `apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts`

- [ ] **Step 1: Write the failing adapter behavior test**

Add a test that simulates a Pi RPC `message_update` text delta and a final `agent_end`/success response, then asserts Proma yields assistant text plus a terminal result message.

- [ ] **Step 2: Run the focused test**

Run: `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts`

Expected: fail because the adapter still returns probe diagnostics.

- [ ] **Step 3: Implement the minimal event mapping**

Map:
- Pi text delta -> assistant text message
- Pi tool start/end -> tool activity message
- Pi success end -> result/done message
- Pi RPC error -> typed error result

Keep `PROMA_PI_AGENT_ENABLED` gating intact.

- [ ] **Step 4: Run the focused test again**

Run: `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts`

Expected: pass.

### Task 3: Verify Abort, Typecheck, And Build

**Files:**
- No new files

- [ ] **Step 1: Run the relevant pi tests**

Run: `bun test apps/electron/src/main/lib/adapters/pi-process.test.ts apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts apps/electron/src/main/lib/adapters/pi-event-converter.test.ts apps/electron/src/main/lib/adapters/pi-permission-mapping.test.ts`

Expected: all pass.

- [ ] **Step 2: Run repository typecheck**

Run: `bun run typecheck`

Expected: all packages exit with code 0.

- [ ] **Step 3: Run Electron build**

Run: `bun run electron:build`

Expected: exit code 0.

