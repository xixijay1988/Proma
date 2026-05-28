# Pi Agent Engine Phase C Handoff

Date: 2026-05-28
Branch: `codex/pi-agent-engine-phase-c`
Latest verified code baseline: `50b409c fix(agent): route pi probe outside claude preflight`
PR entry: <https://github.com/xixijay1988/Proma/pull/new/codex/pi-agent-engine-phase-c>

## 接力入口

另一个 Codex 接手时，先同步分支：

```bash
git clone git@github.com:xixijay1988/Proma.git
cd Proma
git fetch origin
git checkout codex/pi-agent-engine-phase-c
export PATH="$HOME/.bun/bin:$PATH"
bun install
```

如果使用已有 clone：

```bash
cd /path/to/Proma
git fetch origin
git checkout codex/pi-agent-engine-phase-c
git pull --ff-only
export PATH="$HOME/.bun/bin:$PATH"
bun install
```

接手前必须读：

- `AGENTS.md`
- `CLAUDE.md`
- `docs/superpowers/specs/2026-05-27-pi-agent-engine-design.md`
- `docs/superpowers/plans/2026-05-27-pi-agent-engine-phase-c.md`
- 本文件

推荐继续使用 `superpowers:subagent-driven-development`。变更功能前先用 `superpowers:brainstorming` 或 `superpowers:writing-plans` 做小范围设计，修 bug 前用 `superpowers:systematic-debugging`，完成前用 `superpowers:verification-before-completion`。

## 当前决策

- Agent engine 选择粒度是 workspace-level。
- Session 创建时持久化 `agentEngine`，后续 workspace engine 变更不改变老 session。
- 缺失 `agentEngine` 的 legacy session 必须解析为 `claude-sdk`，不能跟随当前 workspace。
- 默认 engine 仍是 `claude-sdk`。
- `pi` 是 experimental；当前运行时能力只是受保护的 CLI `--help` probe/diagnostic，不是完整 agent loop。
- Pi 不应在未设置 `PROMA_PI_AGENT_ENABLED=1` 时启动。
- Pi 依赖使用 scoped package：`@earendil-works/pi-coding-agent@0.76.0`。
- 不要使用 unscoped `pi-coding-agent` / `pi-agent-core` / `pi-ai`。
- 当前 rollout 路径：`C -> A -> B`。
- 当前实现路径：`B -> A`。
- 当前能力路径：`B -> C`。

## 已完成内容

### 类型与元数据

- `packages/shared/src/types/agent.ts`
  - 增加 `AgentEngine = 'claude-sdk' | 'pi'`。
  - 增加 `DEFAULT_AGENT_ENGINE`。
  - `AgentWorkspace` 和 `AgentSessionMeta` 支持 `agentEngine`。
- `apps/electron/src/main/lib/agent-engine.ts`
  - 集中处理 engine 默认值、session/workspace 解析和 legacy session 语义。

### Workspace / Session 持久化

- `apps/electron/src/main/lib/agent-workspace-manager.ts`
  - workspace 读取、创建、更新、排序时归一化 `agentEngine`。
- `apps/electron/src/main/lib/agent-session-manager.ts`
  - 新 session 记录 workspace 当前 engine。
  - fork / migration 等路径保留 session engine。
- 新增对应 BDD 测试，覆盖旧 workspace、pi workspace、legacy session、pi session 路由。

### Adapter Registry 和 Service 路由

- `apps/electron/src/main/lib/agent-adapter-registry.ts`
  - 管理 `claude-sdk` / `pi` adapter lookup 和 dispose。
- `apps/electron/src/main/lib/agent-service.ts`
  - 按 session/workspace engine 获取 orchestrator。
  - active session 期间保留该 session 的 orchestrator，避免 stop/queue 路由错 engine。
  - 创建 orchestrator 时传入 engine，避免 pi adapter 被 claude-sdk 默认值覆盖。

### Pi Process Bridge

- `apps/electron/src/main/lib/adapters/pi-process.ts`
  - 解析 `@earendil-works/pi-coding-agent/dist/cli.js`。
  - 用 `process.execPath <cli> --help` 启动受控 probe。
  - Electron 主进程下设置 `ELECTRON_RUN_AS_NODE=1`。
  - 收集 stdout/stderr snippet，支持 abort / kill / timeout cleanup。
- `apps/electron/src/main/lib/adapters/pi-agent-adapter.ts`
  - 未设置 `PROMA_PI_AGENT_ENABLED=1` 时返回 `pi_not_enabled`。
  - 设置后执行 CLI probe。
  - 等待 `piProcess.done` 后再 yield `assistant.error` 和 `result error`，避免旧 iterator 路径提前终止导致诊断/result/cleanup 丢失。
  - 当前仍明确返回 `pi_protocol_not_implemented`，没有实现真实 Pi 协议。

### Orchestrator Pi 分支

- `apps/electron/src/main/lib/agent-orchestrator.ts`
  - 增加 engine 字段。
  - Pi 分支在 Windows shell、channel/API key、Claude SDK import、buildSdkEnv 之前分流。
  - `runPiProbe()` 负责：
    - 抢占 active session 后执行 Pi probe。
    - 持久化用户消息。
    - 推送 adapter SDKMessage 到 event bus。
    - 持久化 assistant/result。
    - 捕获 result subtype。
    - stop/error/finally 下释放 active slot 并 abort adapter。
  - 已修复一次 review 发现的边界：首条用户消息持久化失败时也会释放 active session 并调用 `adapter.abort()`。

### Permission / Event / UI

- `apps/electron/src/main/lib/adapters/pi-permission-mapping.ts`
  - 映射 Proma permission mode 到 Pi preflight 行为。
  - `allow-all` 仍保留 scope check 要求。
- `apps/electron/src/main/lib/adapters/pi-event-converter.ts`
  - 当前只做 text/tool_start 到 SDK-shaped message 的最小转换。
- Renderer settings / workspace selector 已支持 engine selector 和 experimental badge。
- Pi 不支持的 fork/rewind 路径有明确限制。

### Packaging / Docs

- `apps/electron/package.json`
  - 添加 `@earendil-works/pi-coding-agent@0.76.0`。
  - 当前版本已 bump 到 `0.10.22`。
- `apps/electron/electron-builder.yml`
  - 包含 `node_modules/@earendil-works/pi-coding-agent/**/*`。
- `README.md`、`AGENTS.md`、`CLAUDE.md`
  - 已记录 Pi experimental 状态、依赖命名、打包要求和限制。

## 已验证命令

最近一次完整代码验证在 `50b409c` 后执行：

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun run typecheck
bun test
bun run electron:build
```

结果：

- `bun run typecheck`: exit 0
- `bun test`: `82 pass`, `0 fail`
- `bun run electron:build`: exit 0
- `electron:build` 仍有既有 Vite chunk-size warning，不是本次新增失败。

之前也验证过打包目录：

```bash
cd apps/electron
CSC_IDENTITY_AUTO_DISCOVERY=false bun run scripts/dist.ts --current-arch --dir --no-sign
```

已确认 packaged output 包含：

```text
app.asar.unpacked/node_modules/@earendil-works/pi-coding-agent/dist/cli.js
```

## 关键测试文件

- `apps/electron/src/main/lib/agent-engine.test.ts`
- `apps/electron/src/main/lib/agent-engine-routing.test.ts`
- `apps/electron/src/main/lib/agent-session-manager.test.ts`
- `apps/electron/src/main/lib/agent-workspace-manager.test.ts`
- `apps/electron/src/main/lib/agent-adapter-registry.test.ts`
- `apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts`
- `apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts`
- `apps/electron/src/main/lib/adapters/pi-process.test.ts`
- `apps/electron/src/main/lib/adapters/pi-event-converter.test.ts`
- `apps/electron/src/main/lib/adapters/pi-permission-mapping.test.ts`
- `apps/electron/src/renderer/lib/agent-engine-ui.test.ts`

## 当前限制

- Pi 还不是可用 agent loop，只是 guarded CLI probe。
- 没有解析 Pi JSON/RPC/protocol stream。
- 没有 Pi-native session continuation。
- 没有 Pi MCP / Skills 深度集成。
- 没有 Pi fork / rewind parity。
- queue / interrupt 仍主要服务 Claude SDK 路径；Pi 只做 probe abort。
- UI 只应宣传 experimental，不要声称 Pi 已具备完整 Agent 能力。
- 直接在浏览器打开 Vite 页面可能空白；renderer 依赖 Electron preload 的 `window.electronAPI`。

## 已知环境注意事项

- 本机 shell PATH 里可能没有 `bun`，需要：

```bash
export PATH="$HOME/.bun/bin:$PATH"
```

- 当前验证环境中 Bun 是 `1.3.14`。
- `@earendil-works/pi-coding-agent` 要求 Node `>=22.19.0`；Electron runtime 兼容性仍要继续验证。
- Pi probe 在 Electron 主进程下通过 `ELECTRON_RUN_AS_NODE=1` 运行 CLI。
- 开发运行：

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun run dev
```

- 构建后运行：

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun run electron:start
```

## 下一步建议

### Next 1: 真实 Pi 协议发现

目标：确定 `@earendil-works/pi-coding-agent` 是否提供稳定 JSON/RPC/stdio/event stream 接口。

建议步骤：

1. 读 `node_modules/@earendil-works/pi-coding-agent/package.json`、`dist/cli.js`、README 或包内文档。
2. 用 isolated script 运行 CLI，记录可用 flags 和 stdout/stderr 形态。
3. 不要直接把探索代码接入 orchestrator。
4. 输出一份 `docs/superpowers/specs/*pi-protocol-notes.md`，记录可依赖和不可依赖的接口。

验收：

- 明确 Pi 的启动命令、输入协议、输出协议、退出码语义。
- 明确如何传 cwd、权限回调、abort。
- 如果没有稳定协议，明确下一步是否转向 `@earendil-works/pi-agent-core`。

### Next 2: Pi Runtime Message 抽象

目标：减少 Claude `SDKMessage` 命名对 Pi 的污染，但不要一次性大重构。

建议步骤：

1. 先设计 `AgentRuntimeMessage` 和 `AgentRuntimeResult` 的最小接口。
2. 只在 adapter boundary 增加类型别名或转换层。
3. 保持 renderer 仍消费现有 SDK-shaped message，避免大范围 UI 改动。
4. 用测试保护 Claude SDK 路径不变。

验收：

- `ClaudeAgentAdapter` 行为不变。
- `PiAgentAdapter` 内部不需要伪装过多 Claude-only 字段。
- 不引入 `any`。

### Next 3: Pi 最小可用 loop

目标：在 `PROMA_PI_AGENT_ENABLED=1` 下支持真实 prompt -> text output -> result。

建议步骤：

1. 在 `pi-agent-adapter.test.ts` 先写 BDD 测试：给定 fake Pi process 输出 text event，adapter yield assistant text 和 result。
2. 在 `pi-process.ts` 增加可测试的 stdio reader/parser。
3. 在 `PiAgentAdapter.query()` 中把 probe 替换为真实协议路径，但保留 feature flag。
4. 真实协议未就绪时继续返回 `pi_protocol_not_implemented`。

验收：

- 未设置 `PROMA_PI_AGENT_ENABLED=1` 不启动进程。
- 设置后能输出一段真实 assistant text。
- stop 会杀掉 Pi 进程并释放 active session。
- `bun test` 和 `bun run electron:build` 通过。

### Next 4: UI/文档收口

目标：让用户清楚知道 Pi 是 experimental 和当前限制。

建议步骤：

1. 在设置页 engine selector 附近保留简短 experimental 标记。
2. Agent view 不要出现长篇说明或 marketing copy。
3. README/AGENTS/CLAUDE 只在用户批准后继续更新。

验收：

- UI 不夸大 Pi 能力。
- 文档与实际能力一致。

## 接力工作规则

- 不要在 main repo `/Users/xixi/Code/Proma` 直接改这条线，优先使用当前 feature 分支或新 worktree。
- 不要 revert 用户或其他 agent 的未关联改动。
- 每次功能变更后，受影响包 patch version 要递增。
- Docs 需要用户允许后再改；本 handoff 是用户明确要求记录。
- 注释和日志优先中文。
- 状态管理继续用 Jotai。
- 依赖版本变更前必须搜索/确认版本。
- 完成前至少运行：

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun run typecheck
bun test
bun run electron:build
```

涉及打包时再运行：

```bash
cd apps/electron
CSC_IDENTITY_AUTO_DISCOVERY=false bun run scripts/dist.ts --current-arch --dir --no-sign
```

## 快速状态判断

如果新 Codex 只想确认当前状态，运行：

```bash
git status --short --branch
git log --oneline -5 --decorate
export PATH="$HOME/.bun/bin:$PATH"
bun test apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts
```

期望：

```text
## codex/pi-agent-engine-phase-c...origin/codex/pi-agent-engine-phase-c
recent history includes 50b409c ... fix(agent): route pi probe outside claude preflight
3 pass
0 fail
```
