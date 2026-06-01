# 2026-05-31 Pi Agent Runtime Handoff

## 当前分支与提交

- 分支：`codex/pi-agent-engine-phase-c`
- 最新功能提交：`b0271cd feat(electron): integrate Pi Agent RPC runtime`
- 远端：`origin/codex/pi-agent-engine-phase-c`

## 项目目标对齐

- `pi` 需要成为与 `claude-sdk` 同级的 Agent runtime，用户可以在工作区层面灵活选择。
- Proma PI 当前定位是个人本地 Agent 工作台，优先补齐本地 coding 最小闭环。
- 交互逻辑借鉴 Proma 已有 Claude Agent SDK 体验，但 runtime 边界需要清晰标识为 Pi Agent。

## 本轮已完成

- `PiAgentAdapter` 从 CLI `--help` 探针升级为 Pi RPC runtime 调用。
- Pi 进程以 `--mode rpc` 启动，并注入持久化 `sessionId` 与 `sessionDir`。
- Pi RPC 事件转换为 Proma 兼容的 SDK message：
  - `message_update` 文本增量标记为 transient，不再持久化为大量 assistant 消息。
  - `message_end` 输出最终 assistant 文本并持久化。
  - 工具开始/结束映射为 `tool_use` / `tool_result`。
  - extension UI confirm/select/input 请求桥接到 Proma permission / AskUser。
  - provider / protocol / process 错误会显式展示到 UI。
- Runtime identity 已注入，Pi 会话不应再自称 Claude Agent SDK。
- AskUser 支持 placeholder、prefill 和自由文本返回。
- Renderer 修复：
  - streaming 文本增量累积展示。
  - transient Pi delta 不进入 liveMessages。
  - `SDKMessageRenderer` 合并相邻文本块，旧的碎片化历史刷新后也能正常显示。
- Pi runtime config：
  - Proma channel/provider/env 映射到 Pi runtime。
  - DeepSeek Anthropic-compatible `/anthropic` base URL 不写入 Pi `models.json`，保留 Pi 内置 `https://api.deepseek.com`。
  - 无需 override 时清理 session 级 stale `models.json`。
- 文档同步更新了 `README.md` 与 `AGENTS.md` 中的 Pi runtime 现状。

## 已验证

- `bun test`：101 pass / 0 fail
- `bun run typecheck`：通过
- `bun run electron:build`：通过，仅 Vite chunk size warning

## 运行方式

```bash
bun run --filter='@proma/electron' dev
```

如果遇到 dev 脚本反复递归打印，优先检查 `apps/electron/package.json` 的 workspace/filter 调用是否被从包内再次递归触发。当前推荐在 repo 根目录运行上面的命令。

## 已知限制

- Pi runtime 仍是 experimental。
- fork、rewind、Claude SDK 原生 resume parity、MCP 深度注入、Task/SubAgent 语义 parity 仍未完成。
- 当前重点是本地 coding 最小闭环，而不是宣称 Pi 已完全等价 Claude SDK。

## 下一步建议

- 用真实 Proma UI 新建 Pi 工作区和 Pi 会话，再做一次端到端手工验证：
  - 提问“你背后是什么 Agent SDK / runtime？”
  - 执行简单文件读写任务。
  - 验证工具过程展示、最终回答、会话历史刷新后的渲染。
- 若真实 Pi RPC 事件还有未覆盖字段，继续扩展 `pi-process.ts` 与 `pi-agent-adapter.ts` 的事件解析。
- 补齐 UI 上更明确的 runtime proof，例如过程区显示 `Pi Agent RPC`、session metadata 中展示 runtime engine。
- 阶段性稳定后再考虑打包产物验证和发布分支整理。

## 2026-06-01 Phase D 验证记录

- 当前开发态配置目录是 `~/.proma-dev`，不是正式版 `~/.proma`。
- dev 工作区 `默认工作区` 已设置 `agentEngine: "pi"`。
- dev 会话 `c336bfd4-83ac-4249-9dfc-64edfa240be9` 已通过真实 UI 路径验证身份问题：
  - 用户问题：`你是 Pi Agent 么`
  - Proma 持久化 JSONL 只有 3 行：user / final assistant / success result。
  - assistant 明确回答运行在 `Pi Agent RPC runtime`，底层是 `@earendil-works/pi-coding-agent` RPC 模式。
  - Pi 原生 session 日志确认 provider 是 `deepseek`，model 是 `deepseek-v4-flash`，并包含 runtime identity 注入。
- 使用一次性 Electron 验证脚本复用 dev DeepSeek 渠道做真实 Pi RPC 文件读写：
  - sessionId：`pi-e2e-92abb563-c85d-4b3e-b59e-c37987cdebe7`
  - cwd：`~/.proma-dev/agent-workspaces/default/pi-e2e-92abb563-c85d-4b3e-b59e-c37987cdebe7`
  - Pi 成功调用 `write` 创建 `proma-pi-e2e.txt`，内容为 `PI_AGENT_E2E_OK`。
  - Pi 随后调用 `read` 读回同一文件。
  - Adapter 输出包含工具调用，result subtype 为 `success`，最终 assistant 文本确认读回成功。
- Focused tests 重新验证：
  - `bun test apps/electron/src/main/lib/adapters/pi-process.test.ts apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts apps/electron/src/main/lib/adapters/pi-runtime-config.test.ts apps/electron/src/renderer/components/agent/ProcessBlockGroup.test.ts`
  - 结果：33 pass / 0 fail。

Phase D 当前结论：Pi runtime 的身份识别、DeepSeek provider 映射、真实 RPC 工具读写、最终消息持久化都已通过最小验收。仍建议补一轮可视 UI 手工检查，重点看工具过程折叠、刷新历史后的显示和中断按钮。

## 2026-06-01 Phase E Runtime Proof UI

- 新增统一 UI helper：`apps/electron/src/renderer/lib/agent-engine-ui.ts`
  - `getAgentEngineLabel('pi')` 现在返回 `Pi Agent RPC`。
  - `getAgentEngineRuntimeProof('pi')` 明确描述为 `@earendil-works/pi-coding-agent RPC runtime，不是 Claude Agent SDK`。
- Agent 会话头现在会在标题旁显示 runtime badge：
  - Pi 会话显示 `Pi Agent RPC` amber badge。
  - Claude 会话显示 `Claude SDK` neutral badge。
  - badge 的 `title` 包含底层 runtime 证明文案。
- 工作区列表沿用同一 helper，因此 Pi 工作区 badge 也显示为 `Pi Agent RPC`。
- Agent 设置页引擎选项改为 `Pi Agent RPC (experimental)`，避免继续使用过于含糊的 `pi experimental`。
- Pi 会话顶部提示条改为说明通过 `@earendil-works/pi-coding-agent` 运行本地 coding 最小闭环。
- 验证：
  - `bun test apps/electron/src/renderer/lib/agent-engine-ui.test.ts apps/electron/src/renderer/components/agent/ProcessBlockGroup.test.ts`：14 pass / 0 fail。
  - `bun run typecheck`：通过。
  - `bun run electron:build`：通过，仅既有 Vite chunk size warning。
  - `bun test`：103 pass / 0 fail。

## 2026-06-01 Phase F 协议硬化起步

- `PiAgentAdapter` 现在会识别并记录未知 Pi RPC 事件类型：
  - 未知事件不会产出 UI 消息，不会打断当前会话。
  - 同一种未知事件类型只记录一次 warning，避免重复事件刷屏。
  - warning 文案为中文：`[Pi Agent] 未识别 Pi RPC 事件，已跳过: <eventType>`。
- 新增 BDD 测试覆盖：未知事件出现后仍能继续收到 `agent_end` 并返回 `success`。
- 这一步是协议兼容性护栏，方便后续遇到 Pi 新事件类型时定位，而不是静默丢失上下文。

## 2026-06-01 Phase F 协议硬化继续

- `PiAgentAdapter` 继续扩展诊断护栏：
  - 已知 `message_update` 中遇到未知 `assistantMessageEvent.type` 时记录 warning，并继续等待后续事件。
  - `tool_execution_start` / `tool_execution_end` 缺少关键字段时记录 warning，并跳过该畸形工具事件。
  - 子事件和畸形事件的 warning 都会按类型去重，避免流式场景刷屏。
- 新增 BDD 测试覆盖：
  - 未知 `message_update` 子事件不打断会话（后续已将 `thinking_delta` 升级为已知事件，当前用 `future_delta` 覆盖未知分支）。
  - 缺少 `toolName` 的 `tool_execution_start` 不打断会话。
- 目的：真实 Pi RPC 协议扩展或异常输出时，Proma 不静默丢信息，也不因为非关键事件让会话失败。

## 2026-06-01 Phase F thinking 与生命周期事件补齐

- `thinking_delta` 已按 Pi 官方 RPC 协议升级为已知子事件：
  - 流式 `thinking_delta` 转换为 transient `thinking` SDK block，不进入历史持久化。
  - `message_end` 的最终 assistant content 会保留 `thinking` 与 `text` block，刷新历史后仍能看到完整思考块。
  - 编排层测试确认 transient text/thinking delta 不写入 JSONL，只持久化最终 assistant content。
- 扩展已知 Pi 顶层事件集合，正常生命周期事件不再误报未知：
  - `agent_start` / `turn_start` / `message_start` / `turn_end`
  - `tool_execution_update`
  - `queue_update` / compaction / auto-retry 等会话事件
- 新增/更新 BDD 测试覆盖：
  - `thinking_delta` 不再产生 warning，并保留最终 thinking block。
  - 文档内已知但当前不需要渲染的生命周期事件会安静跳过。
  - 未知子事件测试改为 `future_delta`，继续保留协议扩展诊断护栏。

## 多端接力约定

- 后续每个重要阶段结束后，同步更新本文件或新增同目录 handoff。
- 其他终端继续开发前，先查看：
  - 本文件
  - `docs/superpowers/plans/2026-05-30-pi-rpc-minimal-loop.md`
  - 当前分支最新 commit
- 若需要跨机器同步，请提交并推送 handoff 更新，避免上下文只停留在单个 Codex 会话里。
