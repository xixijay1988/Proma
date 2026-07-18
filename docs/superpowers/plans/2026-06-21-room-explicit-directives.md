# Room Explicit Directives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Room Agent-to-Agent routing from natural-language `@Agent` guessing to explicit Room directive handoff commands.

**Architecture:** User messages keep the convenient direct `@Agent` behavior. Agent replies no longer wake members from plain text mentions; they only wake members through parsed `room-handoff` directives. The parser is a small main-process utility with tests, and the orchestrator consumes its output when routing Agent replies.

**Tech Stack:** Bun test runner, TypeScript, existing Room manager/orchestrator JSONL storage.

---

### Task 1: Directive Parser

**Files:**
- Create: `apps/electron/src/main/lib/room-directives.ts`
- Test: `apps/electron/src/main/lib/room-orchestrator.test.ts`

- [ ] **Step 1: Write failing parser tests**

Add tests for parsing `::room-handoff{to="Coder" reason="实现"}` blocks and ignoring plain text mentions.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/electron/src/main/lib/room-orchestrator.test.ts`
Expected: FAIL because `parseRoomDirectives` does not exist.

- [ ] **Step 3: Implement minimal parser**

Create `parseRoomDirectives(content: string): RoomDirective[]`, supporting `room-handoff`, `room-wait-user`, `room-done`, and `room-note` blocks with simple `key="value"` attributes.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/electron/src/main/lib/room-orchestrator.test.ts`
Expected: PASS.

### Task 2: Agent Reply Routing Uses Directives

**Files:**
- Modify: `apps/electron/src/main/lib/room-orchestrator.ts`
- Test: `apps/electron/src/main/lib/room-orchestrator.test.ts`

- [ ] **Step 1: Write failing routing tests**

Cover: Agent text `收到用户确认后，我再 @Coder 执行` does not wake Coder; Agent directive `::room-handoff{to="Coder"}` wakes Coder.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/electron/src/main/lib/room-orchestrator.test.ts`
Expected: FAIL because existing routing still uses natural-language handoff detection.

- [ ] **Step 3: Implement directive-only routing for Agent replies**

In `routeRoomAgentMentions`, replace natural language handoff detection with `parseRoomDirectives(sourceMessage.content).filter(kind === 'room-handoff')`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/electron/src/main/lib/room-orchestrator.test.ts`
Expected: PASS.

### Task 3: Prompt Contract

**Files:**
- Modify: `apps/electron/src/main/lib/room-orchestrator.ts`
- Test: `apps/electron/src/main/lib/room-orchestrator.test.ts`

- [ ] **Step 1: Write failing prompt test**

Assert coordinator system prompt explains that plain `@Agent` in Agent replies does not wake members and that `room-handoff` is required.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/electron/src/main/lib/room-orchestrator.test.ts`
Expected: FAIL because prompt lacks directive contract.

- [ ] **Step 3: Add concise directive contract to prompt**

Update Room coordinator prompt with exact directive examples.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/electron/src/main/lib/room-orchestrator.test.ts`
Expected: PASS.

### Task 4: Verification

**Files:**
- Modify: `apps/electron/package.json`

- [ ] **Step 1: Bump electron patch version**

Set `@proma/electron` version to the next patch.

- [ ] **Step 2: Run focused tests**

Run: `bun test apps/electron/src/main/lib/room-orchestrator.test.ts apps/electron/src/main/lib/room-manager.test.ts apps/electron/src/main/lib/room-agent-run-queue.test.ts apps/electron/src/renderer/components/room/RoomView.test.ts`
Expected: all pass.

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: all packages exit 0.
