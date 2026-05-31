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

## 多端接力约定

- 后续每个重要阶段结束后，同步更新本文件或新增同目录 handoff。
- 其他终端继续开发前，先查看：
  - 本文件
  - `docs/superpowers/plans/2026-05-30-pi-rpc-minimal-loop.md`
  - 当前分支最新 commit
- 若需要跨机器同步，请提交并推送 handoff 更新，避免上下文只停留在单个 Codex 会话里。
