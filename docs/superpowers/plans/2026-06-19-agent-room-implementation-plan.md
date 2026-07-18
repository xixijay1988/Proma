# Proma Agent Room Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 Proma 增加一个可持久化、可协作、可审计的 Agent Room 第三模式，支持 `@Agent` 触发、自动监听评分、草稿确认和现有权限链路复用。

**Architecture:** 新增 Room 的共享类型、主进程存储、Room 编排层、preload API 和 renderer Jotai/UI。Room 复用现有 Agent runtime、权限服务和流式消息体系，但独立管理房间、成员、摘要和草稿。

**Tech Stack:** Bun workspace、TypeScript、Electron main/preload/renderer、Jotai、现有 Proma Agent runtime、JSON/JSONL 本地存储。

---

### Task 1: 固化 Room 共享类型与 IPC 常量

**Files:**
- Create: `packages/shared/src/types/room.ts`
- Modify: `packages/shared/src/types/index.ts`
- Modify: `apps/electron/src/renderer/atoms/app-mode.ts`
- Modify: `apps/electron/src/renderer/atoms/tab-atoms.ts`
- Modify: `packages/shared/src/types/runtime.ts`
- Test: `packages/shared/src/types/room.test.ts`

**Step 1: 写失败测试**

新增类型测试，断言：

- `RoomMeta` / `RoomMemberConfig` / `RoomMessage` / `RoomDraft` 的字段完整。
- `ROOM_IPC_CHANNELS` 被导出。
- `AppMode` 支持 `room`。

**Step 2: 运行测试确认失败**

Run: `bun test packages/shared/src/types/room.test.ts`

Expected: 类型或导出错误。

**Step 3: 实现最小类型定义**

补齐 shared 类型与 IPC 常量导出。

**Step 4: 重新运行测试**

Run: `bun test packages/shared/src/types/room.test.ts`

Expected: pass.

### Task 2: 建立 Room 本地存储与路径工具

**Files:**
- Create: `apps/electron/src/main/lib/room-config-paths.ts`
- Create: `apps/electron/src/main/lib/room-manager.ts`
- Modify: `apps/electron/src/main/lib/config-paths.ts`
- Test: `apps/electron/src/main/lib/room-manager.test.ts`

**Step 1: 写失败测试**

覆盖：

- 房间目录自动创建。
- 房间索引读写。
- Room JSONL 追加与读取。
- 成员与摘要路径解析。

**Step 2: 运行测试确认失败**

Run: `bun test apps/electron/src/main/lib/room-manager.test.ts`

Expected: helper 不存在或返回错误。

**Step 3: 实现最小存储层**

先做最小 CRUD 和 JSONL 读写，不引入数据库。

**Step 4: 重新运行测试**

Run: `bun test apps/electron/src/main/lib/room-manager.test.ts`

Expected: pass.

### Task 3: 实现 Room 编排层

**Files:**
- Create: `apps/electron/src/main/lib/room-orchestrator.ts`
- Test: `apps/electron/src/main/lib/room-orchestrator.test.ts`

**Step 1: 写失败测试**

覆盖：

- `@Agent` 触发命中目标成员。
- 普通消息进入“规则筛选 + LLM 判定”分支。
- 高置信直接发送，低置信生成草稿。
- 工具权限请求沿用现有 Proma 服务。

**Step 2: 运行测试确认失败**

Run: `bun test apps/electron/src/main/lib/room-orchestrator.test.ts`

Expected: orchestrator 尚未实现。

**Step 3: 实现最小编排**

先实现消息路由、成员选择、草稿落盘与流式回传。

**Step 4: 重新运行测试**

Run: `bun test apps/electron/src/main/lib/room-orchestrator.test.ts`

Expected: pass.

### Task 4: 打通主进程 IPC 与 preload API

**Files:**
- Modify: `apps/electron/src/main/ipc.ts`
- Modify: `apps/electron/src/preload/index.ts`

**Step 1: 写失败测试**

新增 IPC 绑定测试，覆盖 Room 列表、发送消息、保存成员、草稿更新。

**Step 2: 运行测试确认失败**

Run: `bun test apps/electron/src/main/lib/room-orchestrator.test.ts apps/electron/src/main/ipc.test.ts`

Expected: handler 未注册。

**Step 3: 连接 IPC 到编排层**

把 Room API 暴露到 `window.electronAPI`。

**Step 4: 重新运行测试**

Run: `bun test apps/electron/src/main/lib/room-orchestrator.test.ts apps/electron/src/main/ipc.test.ts`

Expected: pass.

### Task 5: 添加 renderer atoms 与 Room UI

**Files:**
- Create: `apps/electron/src/renderer/atoms/room-atoms.ts`
- Create: `apps/electron/src/renderer/components/room/RoomView.tsx`
- Create: `apps/electron/src/renderer/components/room/RoomHeader.tsx`
- Create: `apps/electron/src/renderer/components/room/RoomMessages.tsx`
- Create: `apps/electron/src/renderer/components/room/RoomMemberPanel.tsx`
- Modify: `apps/electron/src/renderer/components/app-shell/ModeSwitcher.tsx`
- Modify: `apps/electron/src/renderer/components/tabs/MainArea.tsx`
- Test: `apps/electron/src/renderer/components/room/RoomView.test.tsx`

**Step 1: 写失败测试**

覆盖：

- mode switch 里能进入 Room。
- Room 消息流展示 human / agent / draft。
- 草稿卡可确认或丢弃。

**Step 2: 运行测试确认失败**

Run: `bun test apps/electron/src/renderer/components/room/RoomView.test.tsx`

Expected: Room 组件未实现。

**Step 3: 实现最小 UI**

先做单房间视图，再做成员侧栏和草稿卡。

**Step 4: 重新运行测试**

Run: `bun test apps/electron/src/renderer/components/room/RoomView.test.tsx`

Expected: pass.

### Task 6: 端到端验证与文档收口

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/specs/2026-06-19-agent-room-design.md`

**Step 1: 写端到端验收清单**

覆盖新建房间、添加成员、`@Agent`、自动监听、草稿确认、重启恢复。

**Step 2: 跑全量检查**

Run: `bun run typecheck`
Run: `bun test`
Run: `bun run electron:build`

**Step 3: 更新面向后续 AI 的文档**

把已实现事实同步到 README / AGENTS，保持文档与代码一致。
