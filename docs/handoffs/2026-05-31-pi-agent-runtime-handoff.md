# 2026-05-31 Pi Agent Runtime Handoff

## 当前分支与提交

- 分支：`codex/pi-agent-engine-phase-c`
- 最新提交：请以 `git log -1 --oneline` 为准。
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

## 2026-06-01 Phase G1 流式 thinking 即时展示

- Pi transient text/thinking delta 现在会进入前端实时 SDKMessage 渲染路径：
  - 运行中即可显示 thinking block，不必等 `message_end` 后刷新历史。
  - text delta 也走同一路径，避免有 thinking 时旧 fallback 文本气泡被抑制导致正文不可见。
  - 最终 assistant content 到达时，会移除同一会话里的 transient text/thinking delta，用最终 `message_end` 内容替换。
- 新增纯函数 helper：`apps/electron/src/renderer/lib/agent-live-messages.ts`
  - 决定哪些 transient 消息可进入 liveMessages。
  - 处理最终 assistant 替换 transient delta。
  - 保留工具调用先到、最终 message_end 后到时的流式内容可见性。
- Renderer 现在会合并相邻 `thinking` block，避免 Pi thinking token 级碎片化。
- 新增 BDD 测试覆盖：
  - transient text/thinking 可进入实时消息，普通 transient 仍跳过。
  - final assistant 到达时替换 transient delta。
  - tool_use 先到时不会提前清除正在显示的 thinking。
  - 相邻 Pi thinking delta block 会合并成单个 thinking block。

## 2026-06-01 Phase G2 工具进度实时展示

- Pi `tool_execution_update` 现在会转换为 Proma transient `tool_result`：
  - `partialResult` 按 Pi 文档视为累计输出，前端直接替换显示，不做 delta 拼接。
  - 同一 `toolCallId` 的多次进度更新只保留最新一条，避免 liveMessages 膨胀。
  - 最终 `tool_execution_end` 到达时，会移除 transient 进度结果并用最终工具结果替换。
- Pi 工具结果内容已归一化：
  - `{ content: [{ type: 'text', text: '...' }] }` 会转换为 SDK `tool_result.content` 的 text block 数组。
  - 这样 Proma 现有 `ContentBlock` / `ToolResultRenderer` 可以直接展开显示 Pi 工具输出。
- 新增/更新 BDD 测试覆盖：
  - Pi tool update 会产出 transient progress tool_result。
  - 重复 progress 只保留最新累计输出。
  - final tool_result 替换 transient progress。
  - 已知 lifecycle 测试承认 `tool_execution_update` 现在是可渲染进度事件，同时仍不产生未知 warning。

## 2026-06-01 Phase G3/G4 可用性与打包验证

- 复核开发态真实 Pi 会话记录：
  - dev 配置目录 `~/.proma-dev` 的 Pi 会话 `c336bfd4-83ac-4249-9dfc-64edfa240be9` 已通过真实 UI 路径继续对话。
  - 持久化历史包含 `thinking`、`text`、`tool_use`、`tool_result` 与最终 `result success`。
  - Pi 原生日志确认 provider/model 为 `deepseek` / `deepseek-v4-flash`，且 prompt 内包含 Proma runtime identity。
  - 工具链覆盖 `bash`、`read`、`write`、`edit`，并最终清理测试文件。
- 打包验证：
  - `CSC_IDENTITY_AUTO_DISCOVERY=false bun run dist:fast` 通过，仅保留既有 Vite chunk-size warning。
  - 当前本地产物：`apps/electron/out/Proma-0.10.33-arm64.dmg`。
  - 产物验证通过：`out/mac-arm64/Proma.app/Contents/Resources/app.asar.unpacked/node_modules/@earendil-works/pi-coding-agent/dist/cli.js` 存在。
  - Claude SDK native binary 同样在 unpacked node_modules 中存在，未被 Pi 打包配置破坏。
  - 使用打包后的 `Proma.app` 以 `ELECTRON_RUN_AS_NODE=1` 执行 Pi CLI `--version`，返回 `0.76.0`。
- UI 文案继续收敛：
  - 分叉、回退等暂不支持提示统一为 `Pi Agent RPC experimental`，避免出现旧的 `pi experimental` 低信息密度称呼。

## 2026-06-01 Phase G5 首轮自动标题

- Agent 会话标题生成从 Claude SDK 专属路径提升为 Agent 编排通用能力：
  - Claude SDK 会话在首条用户消息持久化后立即尝试生成标题，`onSessionId` 回调只保留为去重兜底。
  - Pi Agent RPC 会话现在同样在首条用户消息持久化后触发标题生成，并通过既有 `TITLE_UPDATED` 事件同步侧边栏和 Tab。
  - 默认标题判断兼容 `新 Agent 会话`、`新会话`、`未命名会话`，避免旧会话默认标题漏掉。
- BDD 覆盖：
  - 新建 Pi 会话发送首条消息后，会基于第一条用户消息生成标题。
  - 会话索引中的标题与 `onTitleUpdated` 回调标题保持一致。
  - 如果用户在标题生成返回前手动重命名，会保留手动标题，不被自动标题覆盖。

## 2026-06-01 Phase H1 Pi 权限体验与能力边界

- Pi RPC 启动现在会加载 Proma 生成的权限扩展：
  - 扩展文件写入 session 级 Pi 配置目录：`pi-agent/{sessionId}/proma-extensions/proma-permission-bridge.mjs`。
  - `pi-process.ts` 支持通过 `--extension <path>` 显式加载扩展。
  - 扩展拦截 Pi `tool_call`，把写入、编辑、bash 等工具调用转换为结构化 `extension_ui_request`。
  - 主进程将结构化请求接回 Proma 现有 `PermissionBanner`，不引入第二套权限 UI。
- 权限模式映射：
  - Proma `bypassPermissions` → Pi `allow-all`：不弹窗，但仍做 Proma 允许目录范围检查。
  - Proma `auto` → Pi `ask`：读类工具自动允许，写/edit/bash 走 Proma 权限确认。
  - Proma `plan` → Pi `safe`：读类工具自动允许，写/edit/bash 走 Proma 权限确认。
  - `本次会话总是允许` 已对 Pi 结构化权限请求生效，后续同类工具请求会命中会话白名单。
- Pi 文件范围护栏：
  - 扩展会允许 session cwd、会话/工作区附加目录、工作区文件目录。
  - 绝对路径若不在允许范围内，会在 Pi tool_call 阶段直接 block。
  - 相对路径仍交给 Pi 以当前 cwd 解析。
- MCP / Skills 能力边界已显式化：
  - Pi prompt 增加 `<pi_capability_boundary>`，列出当前工作区已启用 MCP 与 Skills。
  - Pi 会被明确告知：Proma MCP 目前不是 Pi 原生工具深度注入；可编辑 `mcp.json`，但不要声称能直接调用。
  - 当时 Pi 会被明确告知 Proma Skills 还不是 Pi 原生 Skill 工具；此边界已在 Phase H2 更新为通过 Pi 原生 `--skill` loader 加载。
  - Agent 会话顶部提示条和 Agent 设置页说明也同步标注这个边界。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.35`。
- 验证：
  - `bun run typecheck`：通过。
  - `bun test`：123 pass / 0 fail。
  - `bun run electron:build`：通过，仅既有 Vite chunk-size warning。

## 2026-06-01 Phase H2 调研：Pi Skills 机制与 Proma 兼容性

- Pi `@earendil-works/pi-coding-agent@0.76.0` 没有在 npm 包内随附 Proma 这类 default-skills 内容；它内置的是 Agent Skills 加载与运行机制。
- Pi Skill 加载入口：
  - CLI 支持 `--skill <path>`，可重复传入。
  - `--no-skills` 只禁用默认发现，显式 `--skill` 仍会加载。
  - 默认发现位置包括 `~/.pi/agent/skills/`、`~/.agents/skills/`、项目 `.pi/skills/`、项目/祖先目录 `.agents/skills/`、包资源和 settings `skills` 数组。
- Pi Skill 格式：
  - 目录内 `SKILL.md` 是标准形态；扫描根目录时也支持直接 `.md` 文件。
  - frontmatter 至少需要 `description`，缺失则不加载。
  - `name` 可来自 frontmatter 或父目录名；Pi 会校验小写字母/数字/连字符、64 字符、无首尾/连续连字符，但大多只警告仍加载。
  - 支持 `disable-model-invocation: true`，该 Skill 不进入系统提示，但仍可通过 `/skill:name` 显式调用。
- Pi 运行机制：
  - 启动时只把 Skill 的 name/description/location 注入 `<available_skills>`，模型匹配后再用 read 读取完整 `SKILL.md`，属于 progressive disclosure。
  - `/skill:name args` 会展开为完整 `<skill>` XML block，并追加参数；代码层面要求用户文本以 `/skill:` 开头。
- 与 Proma 的兼容结论：
  - Proma active skills 目录 `~/.proma/agent-workspaces/{slug}/skills/{skillSlug}/SKILL.md` 与 Pi 的目录形态基本匹配。
  - Proma inactive skills 位于 `skills-inactive/`，只要不传给 Pi 就不会加载，符合现有启停语义。
  - Proma 目前 frontmatter parser 识别 `name`、`description`、`icon`、`version`；Pi 会忽略未知字段，但 Proma 暂不展示/识别 `disable-model-invocation`。
  - Proma `/skill` 富文本引用可以出现在消息任意位置；Pi 原生 `/skill:name` 只在消息开头展开，因此显式引用需要 Proma 适配层处理，不能直接依赖 Pi 命令解析。
- 推荐落地：
  - Pi 会话启动时把 active workspace `skills/` 目录通过 `--skill` 传给 Pi RPC，让 Pi 原生 Skill loader 接管可见 Skill 列表。
  - 同时把 workspace `skills/` 目录加入 Pi 权限扩展 allowed directories，避免 Pi read 被 Proma 路径护栏拦截。
  - 更新 `<pi_capability_boundary>` 文案：Skills 可声明为 Pi 原生加载；MCP 仍保持“非原生深度注入”边界。
  - 对 Proma `mentionedSkills` 单独展开为 Pi `<skill>` block 或强制前置 `/skill:name` 语义，保证富文本任意位置引用也稳定生效。

## 2026-06-01 Phase H2 实现：Pi 原生 Skill Loader 接入

- Pi RPC 参数新增 `--skill` 转发链路：
  - `AgentQueryInput.runtimeSkillPaths` → `PiAgentAdapter` → `startPiRpcSession()` → `buildPiRpcArgs()`。
  - `buildPiRpcArgs()` 会为每个有效路径追加 `--skill <path>`。
- Pi 编排层现在会为每个 Pi 会话收集：
  - 当前工作区 active skills 目录：`~/.proma/agent-workspaces/{slug}/skills/`。
  - 全局 Agent Skills 目录：`~/.agents/skills/`，用于接入 superpowers 这类跨 Agent 安装器生成的 skills。
  - 路径必须存在才传给 Pi，避免启动时产生无意义诊断。
- Pi 权限扩展 allowed directories 同步包含上述 Skill 路径：
  - 这样 Pi 按 `<available_skills>` 读取 `SKILL.md` 时不会被 Proma 路径护栏拦截。
- Prompt/UI 文案已更新：
  - Skills 现在表述为通过 Pi 原生 `--skill` loader 加载。
  - MCP 仍保持“非 Pi 原生深度注入，仅配置上下文可见”的边界。
- 注意：
  - Pi 原生 `/skill:name` 仍要求消息以 `/skill:` 开头；Proma 富文本 `mentionedSkills` 任意位置引用目前通过 prompt 指令引导主动读取，对“自动展开成 `<skill>` block”的强 parity 可作为后续 H3。

## 2026-06-01 Phase H3 Pi 运行态 Parity 检查

- 停止：
  - Proma `AgentOrchestrator.stop()` 对 Pi 与 Claude SDK 走同一条 active session 清理路径。
  - Pi adapter `abort(sessionId)` 会向活跃 RPC 会话发送 abort 并 kill 进程；二次清理是 no-op。
  - 新增回归测试覆盖：Pi 运行中停止后会调用 adapter abort、释放 active slot，并持久化 `stoppedByUser: true`。
- 追加消息：
  - 之前缺口：Claude adapter 支持 `sendQueuedMessage()`，Pi adapter 缺失，导致流式中再次输入会报“当前适配器不支持流式追加消息”。
  - 现在 Pi adapter 已实现 `sendQueuedMessage()`：
    - `priority: 'now'` 映射为 Pi RPC `steer`，用于 Proma 当前“立即打断并续跑”的追加语义。
    - 非 `now` 优先级保守映射为 Pi RPC `follow_up`。
  - 新增回归测试覆盖：Pi adapter 发送 `steer`，编排层能在 Pi active session 中追加并持久化用户消息。
- 切换会话：
  - 渲染层 `useGlobalAgentListeners` 全局挂载，所有流式消息按 `sessionId` 写入 `liveMessagesMapAtom` / `agentStreamingStatesAtom`。
  - 该路径不区分 Claude SDK 与 Pi，切换 Tab/会话不会卸载监听器，Pi 的普通流式输出与 Claude SDK 一致保留。
- 后台运行：
  - “切换会话后后台继续跑”已由上述全局 listener + sessionId map 保证，Pi 与 Claude SDK 走同一路径。
  - Claude SDK 原生 `task_backgrounded` / `shell_backgrounded` 这类后台任务事件，目前 Pi RPC 没有明确等价事件源；Pi 当前不能宣称具备 Claude Task/Shell 后台事件 parity。
  - Pi `queue_update` 已作为已知生命周期事件忽略，不会产生未知事件 warning。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.37`。

## 2026-06-01 Phase H4 Pi 显式 Skill 引用展开

- 背景：
  - Pi 原生 `/skill:name` 只有在用户文本以 `/skill:` 开头时才会展开为 `<skill ...>` block。
  - Proma 会在用户消息外层包裹 `<runtime_identity>` / `<pi_capability_boundary>` 等上下文，因此不能稳定依赖 Pi 的 slash-command 入口。
  - Proma 富文本引用还允许 `/skill:name` 出现在消息任意位置。
- 实现：
  - Pi 编排层新增 `buildMentionedPiSkillsBlock()`。
  - 当 `mentionedSkills` 非空时，Proma 会按 Pi 原生展开格式注入：
    - `<skill name="..." location="...">`
    - `References are relative to ...`
    - 去掉 frontmatter 后的 `SKILL.md` 正文
  - Skill 查找顺序沿用 Pi runtime skill paths：当前工作区 active `skills/` 优先，然后 `~/.agents/skills/`。
  - 找不到或读取失败的 Skill 会以注释形式保留诊断，不阻断本轮 Pi 会话。
- 效果：
  - 用户在 Pi 会话里显式写 `/skill:code-review`、`/skill:using-superpowers`，即使不在消息开头，也会获得稳定的 Skill 正文注入。
  - 这只补齐 Proma 的显式 Skill 引用语义；Pi 自己的 `<available_skills>` 自动匹配和原生 `--skill` loader 仍继续工作。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.38`。

## 2026-06-02 Phase I1 Pi MCP Bridge 起步

- 背景：
  - `@earendil-works/pi-coding-agent@0.76.0` 当前分发包没有 MCP client/server 原生注入路径。
  - 因此 Proma 不能像 Claude SDK 一样直接把 `mcpServers` 配置传给 Pi runtime。
- 实现：
  - 新增 `apps/electron/src/main/lib/adapters/pi-mcp-extension.ts`。
  - Pi 会话启动时根据当前工作区 `mcp.json` 生成 session 级 extension：`pi-agent/{sessionId}/proma-extensions/proma-mcp-bridge.mjs`。
  - 每个启用的 MCP server 会暴露为一个 Pi 原生桥接工具：
    - `mcp__<server>__call_tool`
    - 参数：`toolName` 与 `arguments`
  - bridge extension 在 Pi 子进程内用 `@modelcontextprotocol/sdk` 连接 stdio / http / sse MCP server，并通过 `client.callTool()` 执行真实 MCP 工具。
  - Pi 编排层现在会同时加载：
    - `proma-permission-bridge.mjs`
    - `proma-mcp-bridge.mjs`（仅当存在启用 MCP server 时）
  - `<pi_capability_boundary>` 已更新：
    - MCP 不再表述为“仅上下文可见”。
    - 明确说明当前是 Proma MCP bridge，不是 Claude SDK MCP 深度注入。
    - 用户显式 `#mcp:docs` 引用时会提示使用 `mcp__docs__call_tool`。
- UI 文案同步：
  - Agent 设置页和 Pi 会话顶部提示条改为说明 Skills 已通过 Pi 原生 loader，MCP 通过 Proma MCP bridge 暴露为 Pi 桥接工具。
- 当前边界：
  - I1 是服务器级 bridge：每个 MCP server 先暴露一个 `call_tool` 工具。
  - 尚未在会话启动时枚举 MCP `listTools()` 并为每个远端 MCP tool 生成独立 Pi 工具。该边界已在 I2 收窄为提供服务器级 `list_tools` 工具。
  - 内置 SDK MCP（如 mem / nano-banana）仍属于 Claude SDK 注入路径，尚未转换为 Pi MCP bridge。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.39`。
- 验证：
  - `bun test apps/electron/src/main/lib/adapters/pi-mcp-extension.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts --test-name-pattern "MCP|mcp"`：3 pass / 0 fail。

## 2026-06-02 Phase I2 Pi MCP list_tools 桥接

- 在 `proma-mcp-bridge.mjs` 中，每个启用 MCP server 现在会注册两个 Pi 原生桥接工具：
  - `mcp__<server>__list_tools`：连接 MCP server 并调用 `client.listTools()`，返回远端工具名、描述和 inputSchema。
  - `mcp__<server>__call_tool`：按 `toolName` / `arguments` 调用远端 MCP tool。
- `<pi_capability_boundary>` 已同步更新：
  - 不确定 MCP 工具名时，先调用 `mcp__<server>__list_tools`。
  - 用户显式 `#mcp:<server>` 引用时，也会提示先 list 再 call。
- 仍保留的边界：
  - 这是服务器级桥接工具，不是 Claude SDK 那样把每个 MCP tool 直接注入为 `mcp__server__tool`。
  - 后续可继续做 I3：在会话启动前或 extension runtime 中枚举远端工具并生成逐工具 Pi tool，前提是处理好 MCP server 启动延迟和失败降级。
- 验证：
  - `bun test apps/electron/src/main/lib/adapters/pi-mcp-extension.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts --test-name-pattern "MCP|mcp"`：3 pass / 0 fail。

## 2026-06-02 Phase I3 Pi MCP bridge runtime proof

- `proma-mcp-bridge.mjs` 现在额外注册 Pi slash command：
  - `proma:mcp_bridge_status`
  - 用途：在 Pi runtime 内显示当前 Proma MCP bridge 已加载的 server 和 bridge tool 名称，作为 runtime proof。
- 修复了源码 ESM 直接导入时的 resolver 稳健性：
  - `pi-mcp-extension.ts` 使用 `createRequire(import.meta.url)` 解析 MCP SDK 入口。
  - `pi-process.ts` 使用 `createRequire(import.meta.url)` 解析 Pi CLI 入口。
  - 这避免了 `__filename` 在 ESM smoke / 直接导入场景下触发 `ERR_AMBIGUOUS_MODULE_SYNTAX`。
- 打包配置同步：
  - `electron-builder.yml` 将 `@modelcontextprotocol/sdk` 及 MCP client 运行时依赖加入 `files`。
  - `@modelcontextprotocol/**` 加入 `asarUnpack`，避免 Pi 子进程中的 file URL import 解析到不可用的 asar 路径。
- Runtime smoke：
  - 使用生成的 `proma-mcp-bridge.mjs` 启动真实 Pi RPC `--mode rpc --no-session --extension <bridge>`。
  - 调用 RPC `get_commands`，确认 `proma:mcp_bridge_status` 可见。
  - 结果：`hasStatusCommand: true`，stderr 为空。

## 2026-06-02 Phase I4 Pi MCP bridge 错误回传

- `proma-mcp-bridge.mjs` 的 `list_tools` / `call_tool` 现在会捕获 MCP 连接、枚举和调用异常。
- MCP bridge 异常会以 Pi tool result 形式返回：
  - `content` 包含中文诊断：server、operation、toolName（如有）和 error message。
  - `details` 保留结构化字段，`isError: true`。
- 目的：
  - 避免 MCP server 未启动、配置错误、远端工具异常时直接中断 Pi turn 或表现为“会话结束但无回复”。
  - 让模型可以基于工具错误继续解释问题或建议用户检查配置。
- 验证：
  - `bun test apps/electron/src/main/lib/adapters/pi-mcp-extension.test.ts`：3 pass / 0 fail。

## 2026-06-02 Phase J1 Pi fork / rewind 最小兼容

- 背景：
  - Proma 原有 fork / rewind 路径依赖 Claude SDK `sdkSessionId`、`forkSession()` 和 SDK JSONL file-history-snapshot。
  - Pi 会话当前使用 Pi RPC `--session-id` / `--session-dir`，不会产生 Claude SDK `sdkSessionId`。
- Pi fork：
  - `forkAgentSession()` 现在会按会话 engine 分流。
  - Pi 会话不再调用 Claude SDK `forkSession()`。
  - 新 Pi fork 会话会：
    - 保留 `agentEngine: 'pi'`。
    - 复制源会话 Proma SDKMessages，可按 `upToMessageUuid` 截断。
    - 复制源会话工作目录到新会话目录，并改写历史消息中的源/目标路径。
    - 不设置 `sdkSessionId`，避免误走 Claude SDK resume。
- Pi rewind：
  - `AgentOrchestrator.rewindSession()` 对 Pi engine 增加最小兼容路径。
  - Pi rewind 会截断 Proma JSONL 到目标 assistant message。
  - 由于 Pi 当前没有接入 Claude SDK file-history-snapshot，文件系统保持当前状态，并在 `fileRewind.error` 中明确说明“Pi runtime 暂不支持 Claude SDK 文件快照回退”。
  - 不写入 `resumeAtMessageUuid`，避免下次消息误触发 Claude SDK `resumeSessionAt` 语义。
- 当前边界：
  - 这是 Proma 层 fork / rewind 的最小可用体验，不是 Pi 原生 session tree parity。
  - Pi RPC 自身存在 `fork` / `clone` / `switch_session` / `get_fork_messages` 命令，后续可继续做 J2：把 Proma UI 的 fork/rewind 映射到 Pi 原生 session tree。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.40`。
- 验证：
  - `bun test apps/electron/src/main/lib/agent-session-manager.test.ts apps/electron/src/main/lib/adapters/pi-mcp-extension.test.ts apps/electron/src/main/lib/adapters/pi-process.test.ts apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts`：42 pass / 0 fail。
  - `bun run typecheck`：通过。
  - `bun run electron:build`：通过，仅既有 Vite chunk-size warning。

## 2026-06-02 Phase I5 Pi MCP 逐工具桥接

- 背景：
  - I1/I2 的 MCP bridge 已能按 server 暴露 `mcp__<server>__list_tools` 与 `mcp__<server>__call_tool`。
  - 这仍比 Claude SDK MCP 深度注入多一层 `toolName` 参数，用户体验和工具可见性不够接近同级 runtime。
- 实现：
  - `proma-mcp-bridge.mjs` 现在是 async extension factory。
  - extension 初始化时会对每个启用 MCP server 调用 `client.listTools()`。
  - 成功枚举远端工具后，为每个 MCP tool 注册 Pi 原生工具：
    - `mcp__<server>__<tool>`
    - `parameters` 优先沿用 MCP `inputSchema`；非 object schema 时降级为 `{ arguments?: Record<string, unknown> }`。
    - 执行时直接 `client.callTool({ name: toolName, arguments: params })`。
  - 仍保留 server 级工具：
    - `mcp__<server>__list_tools`
    - `mcp__<server>__call_tool`
  - 如果启动时枚举失败，只记录诊断并保留 list/call 兜底，不阻断 Pi 会话启动。
  - `proma:mcp_bridge_status` 现在会显示每个 server 的 remote tool 注册数量。
- Prompt/UI 同步：
  - Pi capability boundary 改为提示：优先使用逐工具注册的 `mcp__<server>__<tool>`；逐工具不可见或不确定工具名时再用 list/call。
  - 显式 `#mcp:<server>` 引用也会提示相同的优先级。
  - Agent 设置页和 Pi 会话顶部提示同步为“逐工具调用 + server 级兜底”。
- 当前边界：
  - 这仍是 Proma MCP bridge，不是 Claude SDK MCP 深度注入。
  - 远端工具 schema 由 MCP server 提供，若 schema 非标准 object，Proma 会保守降级为 `arguments` 包裹参数。
- 验证：
  - `bun test apps/electron/src/main/lib/adapters/pi-mcp-extension.test.ts`：4 pass / 0 fail。
  - Pi 聚焦套件：43 pass / 0 fail。
  - `bun run typecheck`：通过。
  - `bun run electron:build`：通过，仅既有 Vite chunk-size warning。

## 2026-06-02 Phase J2 Pi fork / rewind 前端入口解锁

- 背景：
  - J1 已在主进程补齐 Pi Proma 层 fork / rewind 最小兼容。
  - 但 AgentView 前端仍有 Pi runtime 的 toast guard，导致用户无法实际点击入口。
- 实现：
  - 移除 Pi 会话 `handleFork()` 的前端阻断，直接调用现有 `forkAgentSession` IPC。
  - 移除 Pi 会话 `handleRewindRequest()` / `handleRewindConfirm()` 的前端阻断。
  - Pi rewind 现在会走主进程最小兼容路径：截断 Proma 历史，并通过现有 warning toast 告知文件快照回退不可用。
  - Pi 会话顶部提示更新为：
    - 支持 Proma 层分叉/回退。
    - 文件快照回退和 Pi 原生 session tree 仍在补齐。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.41`。
- 验证：
  - Pi 聚焦套件：43 pass / 0 fail。
  - `bun run typecheck`：通过。
  - `bun run electron:build`：通过，仅既有 Vite chunk-size warning。

## 2026-06-02 Phase J3 Pi session tree 命令桥与 entry id 截断点

- 背景：
  - Pi RPC 已原生支持 `get_fork_messages` / `fork` / `clone` / `switch_session`。
  - Proma 适配器此前只支持 prompt / steer / abort，前端和后端 fork/rewind 仍只能使用 Claude SDK 风格的 `uuid`。
  - Pi 最终 assistant 消息不一定有 Claude SDK `uuid`，导致部分 Pi 会话无法显示或执行 fork/rewind 操作入口。
- 实现：
  - `AgentProviderAdapter` 新增可选 runtime session-tree 能力：
    - `getForkMessages(sessionId)`
    - `fork(sessionId, entryId)`
  - `PiAgentAdapter` 新增运行中 RPC response 等待队列：
    - 按 command id 发送 `get_fork_messages` / `fork`。
    - 对匹配 response 进行消费，不再进入普通事件流。
    - 支持 response failure、进程结束和超时兜底。
  - Pi `message_end` 若携带 `entryId` / `entry_id` / `entry.id`，会保存为 SDKMessage 扩展字段 `_promaPiEntryId`。
  - `_promaPiEntryId` 不会覆盖 `uuid`，避免混淆 Claude SDK 消息 ID 与 Pi session tree entry ID。
  - Pi Proma-layer fork/rewind 截断点现在同时支持：
    - Claude SDK 风格 `uuid`
    - Pi 原生 `_promaPiEntryId`
  - 前端 assistant turn 操作栏使用 `uuid ?? _promaPiEntryId` 作为 fork/rewind target，因此 Pi 消息无 `uuid` 时也能显示入口。
- 当前边界：
  - 这是 Pi 原生 session tree parity 的基础设施，不代表已完整用 Pi native tree 创建 Proma 新会话。
  - `getForkMessages()` / `fork()` 目前要求 Pi RPC 会话处于活跃运行状态；离线会话 native tree 操作仍需后续单独启动/切换 Pi runtime。
  - 文件快照回退仍未接入 Pi 原生能力，Pi rewind 仍是 Proma 历史截断 + 文件系统保持当前状态。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.42`。
  - `@proma/shared` patch bump 到 `0.1.27`。
- 验证：
  - Pi 聚焦套件：49 pass / 0 fail。
  - `bun run typecheck`：通过。
  - `bun run electron:build`：通过，仅既有 Vite chunk-size warning。

## 2026-06-02 Phase J4 Pi 原生 fork 文件与入口一致性

- 背景：
  - J3 已让 Pi adapter 能发送原生 `get_fork_messages` / `fork` RPC 命令，并保存 `_promaPiEntryId`。
  - 但离线 Proma fork 仍需要为新 Proma session 准备 Pi 原生 JSONL，否则后续 Pi RPC 只能从 Proma 层历史继续，无法看到 Pi session tree 的 parent 关系。
  - 前端已放开 Pi fork / rewind 按钮后，主进程 IPC/service 层仍残留旧的 Pi guard，导致用户点击后仍可能收到“暂不支持”。
- 实现：
  - `AgentSessionMeta` 新增 Pi fork 来源元数据：
    - `forkSourcePiSessionId`
    - `forkSourcePiSessionPath`
  - `forkPiAgentSession()` 现在会在 `~/.proma/pi-agent-sessions/` 中查找源 Proma session 对应的 Pi native JSONL。
  - 若源 Pi native JSONL 存在，会为新 Proma session 写入一份 Pi child session JSONL：
    - header `id` 改为新 Proma session id。
    - header `cwd` 改为新 Proma session 工作目录。
    - header `parentSession` 指向源 Pi native JSONL 路径。
    - 非 header entries 保持拷贝。
  - 若源 Pi native JSONL 不存在或写入失败，仍保留 Proma 层 fork fallback，不阻断用户操作。
  - 删除 Pi 会话时只清理当前 session id 对应的 Pi native JSONL，不删除 `forkSourcePiSessionPath` 指向的父 session 文件。
  - 新增 `agent-session-capabilities.ts`，把 fork 能力判断从 IPC 大文件拆出；Pi 与 Claude SDK 都允许走 Proma fork 入口。
  - `agent-service.rewindAgentSession()` 移除过时 Pi guard，统一委托对应 engine 的 orchestrator；Pi 会走 Proma 层历史截断并返回文件快照不可用提示。
- 当前边界：
  - Pi rewind 仍是 Proma JSONL 历史截断，文件系统保持当前状态；尚未接入 Pi 原生文件快照能力。
  - Pi native fork 文件创建是离线兼容路径；活跃 Pi runtime 的 native `fork` 命令还没有成为 Proma UI fork 的主路径。
  - Pi session tree 的 `clone` / `switch_session` 尚未接入 Proma 会话切换模型。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.43`。
  - `@proma/shared` patch bump 到 `0.1.28`。
- 验证：
  - Pi 聚焦套件：65 pass / 0 fail。
  - `bun run typecheck`：通过。
  - `bun run electron:build`：通过，仅既有 Vite chunk-size warning。

## 2026-06-02 Phase J5 Pi native fork entry 裁剪

- 背景：
  - J4 已能在 Proma 离线 fork 时创建 Pi native child JSONL。
  - 但当用户在 Proma UI 中从某个 Pi entry id 分叉时，Proma JSONL 会正确截断，Pi native child JSONL 仍会复制源 session 的全部后续 entries。
  - 这会造成 Proma UI 历史和 Pi 原生 session tree 不一致，后续 Pi runtime 可能看到已经被 Proma fork 起点排除的后续对话。
- 实现：
  - `forkPiNativeSession()` 接收 `upToMessageUuid`。
  - 当 `upToMessageUuid` 命中 Pi native entry `id` 时，新 child JSONL 只复制到该 entry（inclusive）。
  - 当截断点不是 Pi native entry id（例如 Claude 风格 uuid）或未命中时，保守保留原有复制行为，避免误删 Pi tree。
- 当前边界：
  - 该裁剪只覆盖离线 fork 文件创建路径。
  - 活跃 Pi runtime 原生 `fork` 命令尚未接入 Proma UI fork 主路径。
  - Pi rewind 仍没有文件快照恢复能力。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.44`。
- 验证：
  - Pi 聚焦套件：66 pass / 0 fail。

## 2026-06-02 Phase J6 Pi native fork tree path 裁剪

- 背景：
  - Pi 官方文档说明 session 是 tree，`/fork` / `/clone` 会创建新 session 文件，branch 关系由 entry `parentId` 决定。
  - J5 的裁剪按 JSONL 顺序线性 slice，能去掉目标之后的 entries，但如果目标之前存在同父节点的 sibling branch，仍会被错误带入 child session。
- 实现：
  - `selectPiNativeForkEntries()` 现在命中 Pi entry id 后，优先按 `parentId` 从目标 entry 回溯到 root。
  - 新 child JSONL 只复制目标 entry 的祖先路径，排除 sibling branch。
  - 如果 parent 链缺失，回退到 J5 的线性 slice，避免因为异常 session 文件导致 fork 失败。
- 当前边界：
  - 仍属于离线 Proma fork 文件创建路径。
  - 活跃 Pi runtime 的原生 `fork` / `clone` / `switch_session` 还没有接入 Proma UI 主路径。
  - Pi rewind 文件快照恢复仍未实现。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.45`。
- 验证：
  - Pi 聚焦套件：67 pass / 0 fail。

## 2026-06-02 Phase J7 Pi active runtime clone / switch_session 命令桥

- 背景：
  - Pi RPC 文档提供原生 `clone` 与 `switch_session` 命令：
    - `clone`：复制当前 active branch 到新 session 文件。
    - `switch_session`：在活跃 runtime 中切换到指定 native session JSONL。
  - J3 只接入了 `get_fork_messages` / `fork`，Proma 还缺少 clone / switch_session 的 adapter 能力边界。
- 实现：
  - `AgentProviderAdapter` 新增可选能力：
    - `clone(sessionId)`
    - `switchSession(sessionId, sessionPath)`
  - 新增共享结果类型：
    - `AgentRuntimeCloneResult`
    - `AgentRuntimeSwitchSessionResult`
  - `PiAgentAdapter` 新增对应 RPC 命令桥：
    - `clone` 发送 `{ type: 'clone' }`
    - `switchSession` 发送 `{ type: 'switch_session', sessionPath }`
  - `clone` / `switch_session` responses 会进入 runtime command response 等待队列，不再被普通事件流误判为未知事件。
  - 返回值保留 runtime data，并将 `cancelled` 规范化为 boolean，默认为 `false`。
- 当前边界：
  - 这是 adapter-level bridge，尚未接入 Proma UI fork/clone/switch 主路径。
  - Proma 会话元数据和 native Pi session 文件之间的双向同步仍需后续 J8/J9 继续补齐。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.46`。
  - `@proma/shared` patch bump 到 `0.1.29`。
- 验证：
  - Pi 聚焦套件：69 pass / 0 fail。

## 2026-06-02 Phase J8 Pi active runtime clone 接入 Proma 会话层

- 背景：
  - J7 已经把 Pi RPC `clone` 命令接到 adapter 层，但 Proma 会话模型还不能消费 clone 返回值。
  - 用户需要 Pi runtime 在产品里逐步具备与 Claude SDK 同级的会话操作体验，而不是停留在 adapter 单测能力。
- 实现：
  - `AgentRuntimeCloneResult` 新增规范字段：
    - `sessionId`
    - `sessionPath`
  - `PiAgentAdapter` 解析 clone response 时会保留上述字段，避免 runtime data 只以宽泛 unknown 形式存在。
  - `AgentOrchestrator` 新增 `cloneActiveRuntimeSession(sessionId)`：
    - 只负责调用 adapter 的 runtime clone 能力。
    - adapter 不支持时返回明确错误。
    - runtime 返回 `cancelled` 时不落 Proma 新会话。
  - `agent-service.ts` 新增 `cloneActiveAgentSession(sessionId)`：
    - 仅允许 Pi 会话使用。
    - 必须命中活跃 orchestrator，否则提示“会话未在运行中，无法执行 runtime clone”。
    - 成功后创建新的 Proma 会话，继承 source 的 channel / workspace / engine。
    - 新会话 title 为 `<source title> (clone)`。
    - clone 返回的 Pi 原生 `sessionId` / `sessionPath` 写入 `forkSourcePiSessionId` / `forkSourcePiSessionPath`。
  - 新增 IPC / preload 通道：
    - `AGENT_IPC_CHANNELS.CLONE_ACTIVE_SESSION`
    - `window.electronAPI.cloneActiveAgentSession(sessionId)`
  - Renderer 在 Pi 会话 streaming 时显示“克隆当前 Pi 会话分支”工具栏按钮：
    - 成功后把新会话插入 sidebar，并切换到 clone 会话 tab。
    - 失败或取消时用 toast 展示原因。
- 当前边界：
  - 这一步只把 active runtime clone 接入 Proma 会话元数据和 UI 入口。
  - clone 出来的新 Proma 会话还没有自动触发 active runtime `switch_session`，因此后续需要补“切换/导入 Pi native session 文件”的双向同步。
  - Pi 消息级 fork 入口仍暂不在 UI 开放；已有 Proma 层 fork 能创建 Pi native child JSONL，但 active runtime 原生 fork 还不是主路径。
  - Pi rewind 仍只截断 Proma JSONL，不恢复文件快照。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.47`。
  - `@proma/shared` patch bump 到 `0.1.30`。
- 验证：
  - Pi 聚焦套件：71 pass / 0 fail。
  - `bun run typecheck`：通过。
  - `bun run electron:build`：通过，仅既有 Vite chunk-size warning。

## 2026-06-02 Phase J9 Pi clone 会话启动时恢复原生 session 文件

- 背景：
  - J8 已能把 active Pi runtime `clone` 落成新的 Proma 会话，并记录 Pi 原生 `sessionId` / `sessionPath`。
  - 但如果新 Proma clone 会话下一次运行仍只用 Proma session id 启动 Pi，就会变成“有元数据、无原生上下文”的空壳。
- 实现：
  - `AgentQueryInput` 新增 `runtimeSessionPath`，用于向 runtime 传递原生 session JSONL 文件路径。
  - Pi 编排路径读取 `AgentSessionMeta.forkSourcePiSessionPath`，并传给 `PiAgentAdapter.query()`。
  - `PiAgentAdapter` 将 `runtimeSessionPath` 转发给 `startPiRpcSession()`。
  - `pi-process.ts` 支持启动参数：
    - 有 `sessionPath` 时追加 `--session <path>`。
    - 仍保留 `--session-dir <dir>`，让 Pi 使用 Proma 隔离的 session storage。
    - 有 `sessionPath` 时不再传 `--session-id`，避免覆盖 Pi 原生文件路径恢复语义。
    - 没有 session dir / session path / session id 时才传 `--no-session`。
- 当前边界：
  - clone 会话的首轮运行会从 Pi 原生 session 文件恢复。
  - Proma 仍未提供独立的“导入/切换 Pi native session 文件”UI。
  - active runtime 的 `switch_session` 仍是 adapter-level 能力，尚未接入 Proma tab/session 切换模型。
  - Pi rewind 文件快照恢复仍未实现。
- 版本：
  - 沿用 J8：`@proma/electron` `0.10.47`，`@proma/shared` `0.1.30`。
- 验证：
  - Pi 聚焦套件：74 pass / 0 fail。
  - `bun run typecheck`：通过。
  - `bun run electron:build`：通过，仅既有 Vite chunk-size warning。

## 2026-06-02 Phase J10 Pi active runtime switch_session 接入 Proma 会话层

- 背景：
  - J7 已把 Pi RPC `switch_session` 接入 adapter 层，但 Proma service / IPC 还不能消费该能力。
  - J9 已让带 `forkSourcePiSessionPath` 的 Proma 会话下次运行时用 `--session <path>` 恢复 Pi 原生 session 文件。
  - 因此 active runtime switch 成功后，只要把目标 native session path 持久化到当前 Proma session，就能和 J9 的启动恢复路径闭环。
- 实现：
  - `AgentOrchestrator` 新增 `switchActiveRuntimeSession(sessionId, sessionPath)`：
    - 校验 sessionPath 非空。
    - 调用 adapter `switchSession(sessionId, sessionPath)`。
    - adapter 不支持或 Pi 返回 `cancelled` 时抛出明确错误。
  - `agent-service.ts` 新增 `switchActiveAgentSession(input)`：
    - 仅允许 Pi 会话使用。
    - 必须命中活跃 orchestrator，否则提示“会话未在运行中，无法执行 runtime switch_session”。
    - 成功后更新当前 Proma session 的 `forkSourcePiSessionPath`。
  - `@proma/shared` 新增 `SwitchActiveSessionInput` 与 IPC 通道：
    - `AGENT_IPC_CHANNELS.SWITCH_ACTIVE_SESSION`
  - `preload` 新增：
    - `window.electronAPI.switchActiveAgentSession(input)`
  - 主进程 IPC handler 已注册，renderer 或后续 UI 可直接调用。
- 当前边界：
  - 这一步完成 Proma service / IPC API，并持久化 native session path。
  - 现有 `openFileDialog()` 是附件读取路径，会读入文件内容，不适合作为 Pi session JSONL 选择器；因此本轮没有添加 UI 文件选择入口。
  - 后续应新增一个专用“选择 Pi native session 文件”的 IPC（只返回路径，不读取内容），再接入 Pi 会话工具栏或 session 菜单。
  - Pi rewind 文件快照恢复仍未实现。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.48`。
  - `@proma/shared` patch bump 到 `0.1.31`。
- 验证：
  - Pi 聚焦套件：75 pass / 0 fail。
  - `bun run typecheck`：通过。
  - `bun run electron:build`：通过，仅既有 Vite chunk-size warning。

## 2026-06-02 Phase J11 Pi native session 文件选择器 UI

- 背景：
  - J10 已有 active runtime `switch_session` 的 service / IPC API，但还缺少一个只返回路径、不读取内容的 Pi session JSONL 选择器。
  - 现有附件文件对话框会读取并复制文件内容，不适合用于 Pi 原生 session 文件路径导入。
- 实现：
  - `@proma/shared` 新增 IPC 通道：
    - `AGENT_IPC_CHANNELS.OPEN_PI_SESSION_FILE_DIALOG`
  - 主进程新增专用文件选择 handler：
    - 仅返回用户选择的文件路径。
    - filter 包含 `jsonl` 与所有文件。
    - 不读取文件内容，不把 Pi 原生 session 当附件复制。
  - `preload` 新增：
    - `window.electronAPI.openPiSessionFileDialog()`
  - Pi 会话运行中 toolbar 新增 session 文件按钮：
    - 选择文件后调用 `switchActiveAgentSession({ sessionId, sessionPath })`。
    - 成功后更新当前 Proma session 的 `forkSourcePiSessionPath`，并用 toast 显示已切换路径。
- 当前边界：
  - J11 只覆盖运行中的 active runtime 切换。
  - 非运行状态下要把 Pi 原生 session 文件设置为“下次启动恢复”，需要单独 service/IPC 语义，避免把静态配置误认为实时切换。
- 验证：
  - Pi 聚焦套件：75 pass / 0 fail。
  - `bun run typecheck`：通过。
  - `bun run electron:build`：通过，仅既有 Vite chunk-size warning。

## 2026-06-02 Phase J12 Pi 原生 session 文件下次启动恢复

- 背景：
  - J9 已支持 `AgentSessionMeta.forkSourcePiSessionPath` 在 Pi runtime 启动时转为 `--session <path>`。
  - J11 的 UI 入口只在 streaming 时执行 active runtime `switch_session`，用户无法在非运行状态预先导入 Pi 原生 session 文件。
- 实现：
  - `@proma/shared` 新增：
    - `SetPiSessionFileInput`
    - `AGENT_IPC_CHANNELS.SET_PI_SESSION_FILE_FOR_NEXT_RUN`
  - `agent-service.ts` 新增 `setPiSessionFileForNextRun(input)`：
    - 校验会话存在。
    - 校验 `sessionPath` 非空。
    - 仅允许 Pi Agent RPC 会话使用，Claude SDK 会话会被明确拒绝。
    - 将路径持久化到 `forkSourcePiSessionPath`，供下一次 Pi runtime 启动恢复。
  - 主进程 IPC / preload 新增：
    - `window.electronAPI.setPiSessionFileForNextRun(input)`
  - AgentView Pi session 文件按钮现在在 Pi 会话中始终显示：
    - streaming 时：调用已有 `switchActiveAgentSession`，立即切换活跃 Pi runtime。
    - 非 streaming 时：调用 `setPiSessionFileForNextRun`，只设置下次启动恢复文件。
    - toast 和 tooltip 会区分“切换当前 runtime”和“设置下次启动文件”。
- 当前边界：
  - 设置下次启动文件不会读取 Pi JSONL 并同步 Proma 消息历史；它只影响下一次 Pi runtime 的 native session 恢复。
  - Pi native session 浏览器、导入历史预览和 runtime `get_state/get_messages` 同步仍是后续工作。
  - Pi rewind 文件快照恢复仍未实现。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.49`。
  - `@proma/shared` patch bump 到 `0.1.32`。
- 验证：
  - 新增 BDD：
    - 非运行 Pi 会话设置 native session 文件后会持久化 `forkSourcePiSessionPath`。
    - Claude SDK 会话设置 Pi native session 文件会被拒绝。
  - Pi 聚焦套件：77 pass / 0 fail。
  - `bun run typecheck`：通过。

## 2026-06-02 Phase J13 Pi native session header 身份同步

- 背景：
  - J11/J12 已经能选择 Pi 原生 JSONL，并在 streaming 时实时 `switch_session` 或在非 streaming 时设置下次启动恢复。
  - 但 Proma 只保存了 `forkSourcePiSessionPath`，没有同步 Pi session header 里的 native `id`，会导致会话 parity 只有路径、缺少可追踪的 Pi 原生身份。
  - Pi 官方 `switch_session` RPC 当前只承诺返回 `{ cancelled }`，不能依赖 runtime response 补齐 session id。
- 实现：
  - `agent-service.ts` 新增轻量 Pi native session header 解析：
    - 只读取 JSONL 第一行。
    - 第一行必须是 `{ type: "session", id: "..." }` 才提取 id。
    - 解析失败只记录中文 warning，不阻断用户设置/切换 session 文件。
  - `switchActiveAgentSession()` 成功后会把所选 JSONL header id 写入 `forkSourcePiSessionId`。
  - `setPiSessionFileForNextRun()` 同样会在非运行状态导入时写入 `forkSourcePiSessionId`。
  - 没有 header 或 header 不符合 Pi session 格式时仍保留原有路径行为。
- 当前边界：
  - 本阶段只同步 Pi native session header 身份，不读取完整 JSONL 生成 Proma 消息历史。
  - Pi session name、首条消息摘要、message count、active branch 状态还未进入 Proma session metadata。
  - 后续若需要完整会话浏览器，应基于 Pi session-format 文档解析 JSONL 或调用 Pi runtime/session list 能力，而不是把文件选择器扩展成重型导入器。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.50`。
- 验证：
  - 新增 BDD：
    - active `switch_session` 时从 Pi JSONL header 同步 `forkSourcePiSessionId`。
    - 非运行状态设置下次启动文件时同步 `forkSourcePiSessionId`。
  - Pi 聚焦套件：79 pass / 0 fail。
  - `bun run typecheck`：通过。

## 2026-06-02 Phase J14 Pi native session 首条用户消息标题同步

- 背景：
  - J13 已同步 Pi JSONL header 的 native session id，但用户导入/切换 Pi 原生 session 后，如果 Proma 会话仍叫 `新 Agent 会话`，侧边栏仍缺少可识别上下文。
  - Pi session-format 文档显示用户消息存储在 JSONL `type: "message"` entry 的 `message.role: "user"` 中，可轻量读取首条用户消息作为本地标题 fallback。
- 实现：
  - `agent-service.ts` 的 Pi JSONL 解析从只读 header 扩展为 session summary：
    - 同步 header `id` 到 `forkSourcePiSessionId`。
    - 扫描首条 `message.role === "user"` 的文本内容。
    - 支持 string content 与 text block 数组 content。
    - 标题会压缩空白并截断到 20 字符，和现有 Agent 自动标题长度保持一致。
  - `switchActiveAgentSession()` 与 `setPiSessionFileForNextRun()` 都会在更新 Pi session path 时应用该 summary。
  - 仅当 Proma 会话标题仍是默认标题（`新 Agent 会话` / `新会话` / `未命名会话` / 空）时才自动覆盖；手动标题不会被覆盖。
- 当前边界：
  - 这仍是轻量摘要，不导入完整 Pi JSONL 历史到 Proma 消息列表。
  - active runtime `switch_session` 后的 UI 只更新 session meta；不会自动刷新当前消息流为 Pi JSONL 历史。
  - 后续完整 session browser 仍需要解析 message count、updatedAt、cwd、首条消息、命名信息和 active branch 状态。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.51`。
- 验证：
  - 新增 BDD：
    - 默认标题 Pi 会话设置 next-run native file 时，会用 Pi JSONL 首条用户消息生成本地标题。
    - 手动标题 Pi 会话设置 next-run native file 时，不覆盖手动标题。
  - Pi 聚焦套件：81 pass / 0 fail。
  - `bun run typecheck`：通过。

## 2026-06-02 Phase J15 Pi native session browser 数据层

- 背景：
  - J13/J14 已能在用户选择单个 Pi JSONL 文件时同步 native id 和首条用户消息标题。
  - 但后续要做真正的 Pi session browser，需要一个可复用的数据层扫描 Proma 当前 Pi runtime 使用的 session 目录，而不是每次只处理单个文件。
- 实现：
  - `@proma/shared` 新增 `PiNativeSessionSummary`：
    - `id`
    - `path`
    - `version`
    - `cwd`
    - `parentSession`
    - `createdAt`
    - `updatedAt`
    - `firstUserMessage`
    - `messageCount`
  - `agent-session-manager.ts` 新增 `listPiNativeSessions()`：
    - 扫描 `~/.proma*/pi-agent-sessions/`，即 Pi runtime 当前 `--session-dir`。
    - 只处理 `.jsonl`。
    - 解析 session header 与 message entries。
    - 支持用户消息 string content 和 text block 数组 content。
    - 按文件 `mtimeMs` 降序返回。
    - 损坏 JSONL 会记录中文 warning 并跳过，不影响其他 session。
  - IPC / preload 新增：
    - `AGENT_IPC_CHANNELS.LIST_PI_NATIVE_SESSIONS`
    - `window.electronAPI.listPiNativeSessions()`
- 当前边界：
  - 这是后续 UI session browser 的数据层，暂未新增可视 UI。
  - 当前 scanner 不解析 Pi active branch，也不计算完整 tree path，只提供轻量列表摘要。
  - 外部用户手动选择的 Pi JSONL 如果不在 Proma `pi-agent-sessions` 目录内，仍可通过 J11/J12 单文件入口使用，但不会出现在此列表中。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.52`。
  - `@proma/shared` patch bump 到 `0.1.33`。
- 验证：
  - 新增 BDD：
    - 能列出 Pi native session summaries。
    - 能解析 `cwd` / `parentSession` / `firstUserMessage` / `messageCount`。
    - 按 mtime 降序排序。
    - 跳过损坏 JSONL 和非 JSONL 文件。
  - Pi 聚焦套件：82 pass / 0 fail。
  - `bun run typecheck`：通过。

## 2026-06-02 Phase J16 Pi native session browser 工具栏 UI

- 背景：
  - J15 已提供 `listPiNativeSessions()` 数据层，但用户仍只能通过文件选择器手动定位 JSONL。
  - Pi 会话 parity 下一步需要先让用户能在 Proma 中看到最近 Pi 原生 session，并选择其中一个作为 runtime 切换/恢复目标。
- 实现：
  - `AgentView` 的 Pi session 工具栏按钮从直接打开文件选择器升级为 Popover：
    - 打开时调用 `window.electronAPI.listPiNativeSessions()` 刷新最近 Pi 原生 session。
    - 展示首条用户消息摘要、cwd 尾名、message count、更新时间。
    - 点击列表项时复用已有逻辑：
      - streaming：调用 `switchActiveAgentSession()`，立即切换活跃 Pi runtime。
      - 非 streaming：调用 `setPiSessionFileForNextRun()`，设置下次运行恢复文件。
    - 底部保留“选择 JSONL 文件...”作为外部/未扫描到 session 的兜底入口。
  - 新增 `pi-native-session-ui.ts` 纯工具函数：
    - `getPiNativeSessionDisplayTitle()`
    - `formatPiNativeSessionCwd()`
    - `formatPiNativeSessionTime()`
- 当前边界：
  - 这是轻量 browser UI，不会把 Pi JSONL 历史导入 Proma 消息列表。
  - 只展示 `~/.proma*/pi-agent-sessions/` 中可扫描的 session；外部文件仍需要通过兜底文件选择器进入。
  - 还未展示 Pi 原生 session tree / active branch / last message preview。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.53`。
- 验证：
  - 新增 BDD：
    - UI 摘要优先使用首条用户消息作为标题。
    - 无首条用户消息时回退到短 Pi session id。
    - cwd 和更新时间展示格式稳定。

## 2026-06-02 Phase J17 Pi native session 最近消息摘要

- 背景：
  - J16 的 session browser 已能展示首条用户消息、cwd、message count 和更新时间。
  - 对真实使用来说，只看首条消息很难判断最近进展，尤其是长 session 或 clone/fork session。
- 实现：
  - `PiNativeSessionSummary` 新增 `lastMessagePreview`。
  - `listPiNativeSessions()` 扫描每条 Pi `message` entry 时：
    - 首条 user message 仍写入 `firstUserMessage`。
    - 每条可提取文本的 message 都更新 `lastMessagePreview`，最终得到最近一条可展示消息。
    - 支持 string content 与 text block 数组 content，沿用 J15 的轻量解析策略。
  - `AgentView` 的 Pi 原生会话 Popover 在最近消息与首条用户消息不同时展示 `最近：...`。
- 当前边界：
  - `lastMessagePreview` 只从 `type: "message"` entry 提取文本，不展示 tool result、branch summary、compaction summary 或 custom message。
  - 仍不解析当前 active branch；如果 JSONL 内存在多分支，最近消息是文件顺序中的最后可展示 message，而不是严格当前 branch leaf。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.54`。
  - `@proma/shared` patch bump 到 `0.1.34`。
- 验证：
  - 新增 BDD：
    - Pi native session summary 能返回最后一条可展示消息预览。
    - 只有一条 user message 时，`lastMessagePreview` 与 `firstUserMessage` 保持一致。

## 2026-06-02 Phase J18 Pi native session tree 静态摘要

- 背景：
  - Pi session JSONL 是 tree 结构，真正上下文来自 leaf 到 root 的 branch。
  - 静态扫描文件时无法完全知道 runtime 交互中用户当前选中的 active branch，但 Pi `SessionManager` 加载文件时会把最后一个非 header entry 作为 fallback leaf。
  - Proma session browser 需要先暴露这个保守的 tree 摘要，为后续真正 branch browser 做准备。
- 实现：
  - `PiNativeSessionSummary` 新增：
    - `sessionName`：从 Pi `session_info.name` 解析。
    - `leafEntryId`：静态扫描得到的最后一个非 header entry id。
    - `branchEntryCount`：从 `leafEntryId` 沿 `parentId` 回溯到 root 的 entry 数。
  - `listPiNativeSessions()` 现在记录所有带 `id` / `parentId` 的 entry，轻量计算 branch 路径长度。
  - `AgentView` 的 Pi 原生会话 Popover：
    - 标题优先使用 `sessionName`，再回退首条用户消息。
    - 元信息展示 `branch N`，帮助区分文件总消息数与当前 fallback branch 深度。
- 当前边界：
  - `leafEntryId` 是静态文件 fallback leaf，不保证等同运行中 Pi runtime 当前 active branch。
  - `branchEntryCount` 只统计 entry 数，不转换为 Proma 消息、不处理 compaction 的上下文重建。
  - 后续若要准确 active branch，需要通过 Pi runtime RPC/session state 或实现更完整的 tree browser。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.55`。
  - `@proma/shared` patch bump 到 `0.1.35`。
- 验证：
  - 新增 BDD：
    - 能解析 Pi `session_info.name`。
    - 能返回静态 `leafEntryId`。
    - 能从 leaf 沿 parent 链计算 `branchEntryCount`。
    - UI 展示标题优先使用 Pi session name。

## 2026-06-02 Phase J19 Pi native session 历史转换预览层

- 背景：
  - J16-J18 已能浏览 Pi 原生 session 摘要，但选择/切换后 Proma 消息区仍不会显示 Pi JSONL 历史。
  - 直接自动覆盖 Proma JSONL 风险较高，需要先建立一个可测试、只读的转换层。
- 实现：
  - 新增 `pi-native-session-converter.ts`：
    - 将 Pi native `message.role: "user"` 转为 Proma `SDKUserMessage` text block。
    - 将 Pi native `assistant` text / thinking / toolCall block 转为 Proma assistant text / thinking / `tool_use`。
    - 将 Pi native `toolResult` 转为 Proma user `tool_result`。
    - 将 `bashExecution` 转为可展示 assistant text：`$ command\noutput`。
    - `custom.display === true` 的 custom message 转为 assistant text；隐藏 custom message 跳过。
    - 保留 `_promaPiEntryId` 和 `_createdAt`，供后续 fork/rewind/history UI 使用。
  - `agent-session-manager.ts` 新增 `loadPiNativeSessionSDKMessages(sessionPath, sessionId)`：
    - 读取 Pi JSONL。
    - 调用 converter。
    - 返回 Proma SDKMessage[]。
    - 不写入 Proma 会话 JSONL。
  - IPC / preload 新增只读预览通道：
    - `AGENT_IPC_CHANNELS.LOAD_PI_NATIVE_SESSION_MESSAGES`
    - `LoadPiNativeSessionMessagesInput`
    - `window.electronAPI.loadPiNativeSessionMessages(input)`
- 当前边界：
  - 这是“历史转换预览层”，不是自动导入/同步。
  - 暂不处理 compaction、branch_summary、custom_message、label、model_change/thinking_level_change 的完整语义。
  - 暂不按 active branch 过滤；当前转换输入是文件顺序中的 displayable messages。
  - 后续可基于 J18 的 `leafEntryId` 增加 branch-path-only 转换，再接入 UI 的“预览/同步历史”动作。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.56`。
  - `@proma/shared` patch bump 到 `0.1.36`。
- 验证：
  - 新增 BDD：
    - Pi native JSONL entries 能转换为 Proma SDKMessage。
    - text / thinking / toolCall / toolResult 基础展示结构正确。
    - hidden custom message 被跳过，bashExecution 可展示。
    - `loadPiNativeSessionSDKMessages()` 能从 JSONL 文件加载转换结果。

## 2026-06-02 Phase J20 Pi native session branch-path 历史预览

- 背景：
  - J19 的转换层按文件顺序转换 displayable messages；对 Pi 多分支 JSONL 来说，可能把 sibling branch 一起预览/导入。
  - J18 已能静态解析 `leafEntryId`，可以先按 leaf 到 root 的路径做 conservative branch preview。
- 实现：
  - `convertPiNativeSessionEntriesToSDKMessages()` 支持可选 `leafEntryId`：
    - 构建 `id -> entry` 索引。
    - 从 leaf 沿 `parentId` 回溯到 root。
    - 只转换该 branch path 上的 message entry。
  - `LoadPiNativeSessionMessagesInput` 新增可选 `leafEntryId`。
  - `loadPiNativeSessionSDKMessages(sessionPath, sessionId, leafEntryId?)` 将 leaf 传给 converter。
  - IPC / preload 的 `loadPiNativeSessionMessages(input)` 自动透传 leaf。
  - `AgentView` 的 Pi 原生 session Popover 增加只读预览动作：
    - 每个 session item 右侧有预览按钮。
    - 调用 `loadPiNativeSessionMessages({ sessionId, sessionPath, leafEntryId })`。
    - toast 显示当前 branch 可转换 Proma 消息数。
    - 不写入 Proma 会话历史。
- 当前边界：
  - branch path 使用 J18 静态 fallback leaf，不保证等同运行中的 active branch。
  - UI 只做读取探针和数量提示；还没有“导入/同步到 Proma 消息区”的确认动作。
  - 下一步应增加显式同步动作，并在写入前做重复 `_promaPiEntryId` 检查，避免重复导入。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.57`。
  - `@proma/shared` patch bump 到 `0.1.37`。
- 验证：
  - 新增 BDD：
    - converter 提供 `leafEntryId` 时只返回 leaf branch path 消息。
  - manager 读取 Pi JSONL 时可按 leaf 过滤，跳过 sibling branch。

## 2026-06-02 Phase J21 Pi native session 历史同步

- 背景：
  - J20 已能按静态 leaf branch 只读预览 Pi 原生 JSONL 历史，但 Proma 消息区仍不会展示这些历史。
  - 自动导入风险较高，因此本阶段只提供用户显式确认后的同步动作。
- 实现：
  - `SyncPiNativeSessionMessagesInput` / `SyncPiNativeSessionMessagesResult` 新增到 `@proma/shared`。
  - `agent-session-manager.ts` 新增 `syncPiNativeSessionMessages(input)`：
    - 仅允许目标 Proma 会话 engine 为 `pi`，Claude 会话会被拒绝。
    - 复用 J20 的 `loadPiNativeSessionSDKMessages(sessionPath, sessionId, leafEntryId)`。
    - 写入前读取现有 Proma SDKMessage，并按 `_promaPiEntryId` 去重。
    - 只追加缺失消息，返回 `importedCount` / `skippedCount` / `totalCount`。
  - IPC / preload 新增同步通道：
    - `AGENT_IPC_CHANNELS.SYNC_PI_NATIVE_SESSION_MESSAGES`
    - `window.electronAPI.syncPiNativeSessionMessages(input)`
  - `AgentView` 的 Pi 原生会话 Popover：
    - 每个 session item 右侧新增同步按钮（空闲时显示）。
    - 点击后先弹出确认框，不会直接写入历史。
    - 确认后同步当前静态 branch path，并刷新 `agentMessageRefreshAtom`。
    - toast 显示新增和跳过数量。
- 当前边界：
  - 同步使用 J18/J20 的静态 fallback leaf，不保证等同 Pi runtime 正在使用的 active branch。
  - 仅同步可转换的 displayable messages；compaction、label、model_change 等 Pi 原生元事件仍不导入。
  - 同步动作只在 UI 空闲时开放，避免运行中消息流和历史导入同时写入当前 Proma 会话。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.58`。
  - `@proma/shared` patch bump 到 `0.1.38`。
- 验证：
  - 新增 BDD：
    - Pi 会话同步 Pi 原生历史时，只追加当前 branch 中缺失的 `_promaPiEntryId` 消息，并跳过已存在消息。
    - Claude 会话同步 Pi 原生历史会被拒绝。
  - 已运行：
    - `bun test apps/electron/src/main/lib/agent-session-manager.test.ts apps/electron/src/main/lib/adapters/pi-native-session-converter.test.ts apps/electron/src/renderer/components/agent/pi-native-session-ui.test.ts --timeout 30000`：33 pass / 0 fail。
    - `bun run typecheck`：通过。

## 2026-06-02 Phase J22 Pi MCP bridge 远端工具命名稳定性

- 背景：
  - Pi MCP bridge 已能为启用的 MCP server 生成 server 级 `list_tools` / `call_tool` 兜底工具，并在启动时尝试把远端 MCP tools 注册为 Pi 原生逐工具调用。
  - 真实 MCP server 可能存在 `search-docs` / `search_docs` / `search docs` 这类名字；旧实现把它们都 sanitize 成同一个 `mcp__<server>__search_docs`，会导致 Pi 原生工具注册冲突或覆盖。
- 实现：
  - `pi-mcp-extension.ts` 新增远端工具 manifest 生成逻辑。
  - 对同一 server 内 sanitize 后重名的远端工具，生成稳定唯一 Pi native tool name：
    - 第一个保留原名，如 `mcp__docs__search_docs`。
    - 后续冲突追加 `_2` / `_3`。
  - 生成的 Pi MCP bridge extension 运行时也使用同一 manifest 逻辑，注册逐工具时不再直接用 `buildRemoteMcpToolName(server, tool.name)`。
- 当前边界：
  - 这解决的是 Pi 原生逐工具注册命名冲突，不代表 MCP bridge 已完全等价 Claude SDK MCP 深度注入。
  - 仍需要继续验证真实 MCP stdio/http/sse 端到端调用、权限展示、图像/资源结果渲染、长连接生命周期和打包后运行。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.59`。
  - `@proma/shared` patch bump 到 `0.1.39`。
- 验证：
  - 新增 BDD：
    - 远端 MCP 工具名 sanitize 后发生冲突时，生成的 Pi native tool name 仍唯一且稳定。
  - 已运行：
    - `bun test apps/electron/src/main/lib/adapters/pi-mcp-extension.test.ts --timeout 30000`：5 pass / 0 fail。

## 2026-06-02 Phase J23 Pi MCP bridge 结构化结果保真

- 背景：
  - Pi custom tool result 支持 `content: [{ type: "text" }, { type: "image" }]` 这类 content blocks。
  - 旧 Pi MCP bridge 将 MCP `result.content` 压成字符串：
    - text 变成纯字符串。
    - image 只剩 `[MCP image result]`。
    - resource 被 JSON stringify 后混在字符串里。
  - 这会让 Pi 逐工具 MCP bridge 在图像、资源和多块结果上弱于 Claude SDK MCP 工具结果。
- 实现：
  - `proma-mcp-bridge.mjs` 生成源码中新增 `normalizeMcpContentBlocks(content)`。
  - MCP tool result 现在返回 Pi tool content blocks：
    - text block 原样保留。
    - image block 在包含 `data` 与 `mimeType` 时原样保留。
    - resource block 转为带 `[MCP resource result]` 前缀的 text block。
    - 其他未知 MCP content item 转为 JSON text block。
  - `mcp__<server>__call_tool` 与逐工具 `mcp__<server>__<tool>` 都改为使用 `normalizeMcpContentBlocks(result.content)`。
  - 错误路径也改为 `{ type: "text", text: ... }` block，保持 Pi tool result 结构统一。
- 当前边界：
  - resource 当前仍以 text block 展示，没有做 Proma 附件或资源浏览器级渲染。
  - image block 保留给 Pi runtime / Provider 消费；Proma UI 是否完整渲染取决于后续 Pi event converter 与消息渲染路径。
  - 仍需做真实 MCP server E2E，验证 stdio/http/sse 结果在 Pi RPC 事件里如何回传。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.60`。
  - `@proma/shared` patch bump 到 `0.1.40`。
- 验证：
  - 新增 BDD：
    - MCP tool 返回结构化 content 时，生成的 Pi bridge 保留 content blocks，不再调用 `formatMcpContent(result.content)` 字符串化。
  - 已运行：
    - `bun test apps/electron/src/main/lib/adapters/pi-mcp-extension.test.ts --timeout 30000`：6 pass / 0 fail。

## 2026-06-02 Phase J24 Pi MCP bridge 真实 stdio E2E smoke

- 背景：
  - J23 已通过生成源码断言确认 Pi MCP bridge 不再把 MCP `result.content` 字符串化。
  - 但真实运行 generated extension 时，还需要验证：
    - extension 的 ESM import 能从 session 级临时目录正常解析。
    - bridge 能真实连接 stdio MCP server。
    - 逐工具注册后的 `execute()` 能拿到 MCP text / image / resource / structuredContent。
- 实现：
  - `pi-mcp-extension.test.ts` 新增真实 stdio MCP fixture：
    - 临时写入 `fixture-mcp-server.mjs`。
    - 使用 MCP SDK `Server` + `StdioServerTransport` 暴露 `inspect-result` 工具。
    - 工具返回 text、image、resource content blocks 与 `structuredContent`。
  - 测试动态 import 生成的 `proma-mcp-bridge.mjs`，用 fake Pi runtime 执行 extension factory。
  - 断言 bridge 会注册逐工具 `mcp__docs__inspect_result`，并且工具调用结果保留：
    - text block。
    - image block。
    - resource 转换后的 text block。
    - 顶层 `structuredContent` 与 `details.structuredContent`。
  - 修复真实运行暴露的问题：
    - generated bridge 之前裸导入 `typebox`，从临时 extension 目录运行时会找不到包。
    - 现在和 MCP SDK 一样通过 `resolveImportUrl('typebox')` 写入 file URL import。
  - `mcp__<server>__call_tool` 与逐工具 `mcp__<server>__<tool>` 现在都会保留 MCP `result.structuredContent`。
- 当前边界：
  - 该 E2E 使用 fake Pi runtime 执行 extension factory，没有启动完整 Pi RPC / 模型 turn。
  - 覆盖的是 stdio MCP；http / sse 仍需要后续 smoke。
  - Proma renderer 对 Pi MCP image/resource 结果的最终展示还需要继续验证和补齐。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.61`。
- 验证：
  - 新增 BDD：
    - 真实 stdio MCP server 通过 generated bridge 调用时，远端逐工具结果保留结构化 MCP 结果。
  - 已运行：
    - `bun test apps/electron/src/main/lib/adapters/pi-mcp-extension.test.ts --timeout 30000`：7 pass / 0 fail。

## 2026-06-02 Phase J25 Pi MCP 结果穿透到 Proma UI

- 背景：
  - J24 已验证 generated MCP bridge 能从真实 stdio MCP server 拿到 text / image / resource / structuredContent。
  - 但 Proma 侧仍有两处结果保真缺口：
    - `PiAgentAdapter` 只把 `result.content` 放进 SDK `tool_result.content`，没有把 Pi tool result 的 `structuredContent` / `details` 挂到 user message。
    - `ContentBlock.useToolResult()` 只拼接 text block，image block 即使保留到 SDKMessage 也不会进入默认工具结果 UI。
- 实现：
  - `PiAgentAdapter` 的 `tool_execution_end` 转换现在会保留 Pi tool result payload：
    - SDK user message 新增 `toolUseResult`。
    - `toolUseResult.structuredContent`、`details`、`isError` 可被前端和任务解析路径读取。
  - 新增 renderer helper：`tool-result-content.ts`。
    - `normalizeToolResultContent(content, toolUseResult)` 会提取：
      - 文本结果。
      - image content block，并转换为 `data:<mime>;base64,<data>`。
      - `structuredContent` 的格式化 JSON。
  - `ContentBlock` 现在基于该 helper 查找工具结果：
    - text-only 结果保持原行为。
    - image-only 或 structured-only 结果也会显示可展开结果区。
  - 默认工具结果渲染器现在支持：
    - MCP/未知工具图片结果网格。
    - 折叠的“结构化结果”JSON block。
    - Bash/Read/Edit/Write 等专属渲染器仍保持文本接口，不受 Pi MCP 图片路径影响。
- 当前边界：
  - 这一步覆盖 Proma SDKMessage 与默认 UI 渲染路径，不代表已完成真实 Pi RPC + 模型 turn 的可视验收。
  - resource 仍按 J23 的 text block 形式展示；还没有做资源下载/资源浏览器级体验。
  - http / sse MCP bridge smoke 仍待补齐。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.62`。
- 验证：
  - 新增 BDD：
    - Pi MCP tool result 含 image/resource/structuredContent 时，adapter 保留 display content 和 structured payload。
    - 工具结果 content normalization 可提取文本、图片和 structured JSON，同时保持字符串结果兼容。
  - 已运行：
    - `bun test apps/electron/src/renderer/components/agent/tool-result-content.test.ts apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts --timeout 30000`：25 pass / 0 fail。
    - `bun run typecheck`：通过。

## 2026-06-02 Phase J26 Pi MCP bridge 三类传输真实 smoke

- 背景：
  - J24 只覆盖真实 stdio MCP server。
  - `proma-mcp-bridge.mjs` 同时声明支持 stdio / Streamable HTTP / SSE，若不做真实 smoke，打包和 UI 之外仍缺少传输层运行证据。
- 实现：
  - `pi-mcp-extension.test.ts` 抽出 `runGeneratedBridgeTool()` 和 `expectStructuredFixtureResult()`，复用 generated bridge + fake Pi runtime 验证路径。
  - 新增真实 Streamable HTTP MCP fixture：
    - 使用 Node `createServer`。
    - 每个 POST `/mcp` 请求创建 MCP SDK `Server` + `StreamableHTTPServerTransport`。
    - 暴露 `inspect-result` 工具，返回 text / image / resource / structuredContent。
  - 新增真实 SSE MCP fixture：
    - GET `/mcp` 创建 MCP SDK `Server` + `SSEServerTransport`。
    - POST `/messages?sessionId=...` 交给同一 transport 处理 JSON-RPC 请求。
    - 暴露同一 `inspect-result` 工具。
  - stdio / http / sse 三种 MCP server 都会通过 generated `proma-mcp-bridge.mjs` 注册逐工具 `mcp__docs__inspect_result` 并执行真实 tool call。
- 当前边界：
  - 仍是 fake Pi runtime 执行 extension factory，不是完整 Pi RPC + 模型 turn。
  - 这一步证明 bridge extension 的三类 MCP transport 能实际连接和调用工具；还需要后续做真实 Pi RPC 会话中的 MCP tool 可见/可调用 smoke。
  - SSE 是 MCP SDK 已标注 deprecated 的兼容 transport，保留 smoke 主要用于兼容老 MCP server。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.63`。
- 验证：
  - 新增 BDD：
    - 真实 Streamable HTTP MCP server 通过 generated bridge 调用时，远端逐工具结果保留结构化 MCP 结果。
    - 真实 SSE MCP server 通过 generated bridge 调用时，远端逐工具结果保留结构化 MCP 结果。
  - 已运行：
    - `bun test apps/electron/src/main/lib/adapters/pi-mcp-extension.test.ts --timeout 30000`：9 pass / 0 fail。
    - `bun run typecheck`：通过。

## 2026-06-02 Phase J27 真实 Pi RPC MCP 工具可见性 smoke

- 背景：
  - J26 已证明 generated MCP bridge 可通过 fake Pi runtime 连接 stdio / Streamable HTTP / SSE MCP server 并调用逐工具。
  - 但仍缺少完整 Pi RPC 进程加载 extension 后，Proma MCP remote tools 是否真实进入 Pi runtime 的证据。
  - Pi RPC 当前只公开 `get_commands`，未公开 `getAllTools()` 或直接 tool introspection command。
- 实现：
  - `proma-mcp-bridge.mjs` 现在记录每个 MCP server 的 remote tool manifest：
    - `toolName`：MCP server 原始工具名。
    - `nativeToolName`：注册给 Pi 的原生工具名，例如 `mcp__docs__inspect_result`。
  - `proma:mcp_bridge_status` command 的 description 改为动态 `formatBridgeStatus()`：
    - 真实 Pi RPC `get_commands` 可直接读到 bridge server、remote tool count 与 remote native tool 名。
    - command handler 的 `details.servers[].remoteTools` 同步带上 remote manifest。
  - 新增真实 Pi RPC smoke：
    - 临时写入真实 stdio MCP fixture。
    - 生成 Proma MCP bridge extension。
    - 通过 `startPiRpcSession()` 启动真实 `@earendil-works/pi-coding-agent --mode rpc --extension <bridge>`。
    - 发送 RPC `get_commands`。
    - 断言 `proma:mcp_bridge_status` 来自 extension，且 description 包含 `mcp__docs__inspect_result` 与 `remote tools: 1`。
  - 打包保护：
    - generated bridge 会直接 file URL import `typebox`，packaged app 必须保留 `node_modules/typebox/**/*`。
    - `electron-builder.yml` 已将 `typebox` 加入 `files`。
    - 新增 BDD 断言 MCP bridge runtime-only dependencies 会被 electron-builder 保留。
- 当前边界：
  - 该 smoke 不依赖模型 API key，不触发 LLM tool call；它证明真实 Pi RPC 进程已加载 extension，并且 MCP remote tools 已被 bridge 注册到 extension command 可诊断路径。
  - Pi RPC 若未来公开 `getAllTools()`，可把本测试升级为直接 tool introspection。
  - 仍需要真实 UI 视觉验收：MCP 图片/结构化结果在 Proma 会话里是否展示得足够清晰。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.64`。
- 验证：
  - 新增 BDD：
    - 真实 Pi RPC process 加载 bridge 后，`get_commands` 的 status command 能证明 remote MCP tool 已注册。
    - Pi MCP bridge 打包依赖包含 MCP SDK 与 typebox。
  - 已运行：
    - `bun test apps/electron/src/main/lib/adapters/pi-mcp-extension.test.ts --timeout 30000`：11 pass / 0 fail。
    - `bun test apps/electron/src/main/lib/adapters/pi-mcp-extension.test.ts apps/electron/src/main/lib/adapters/pi-process.test.ts apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts apps/electron/src/main/lib/adapters/pi-permission-mapping.test.ts apps/electron/src/main/lib/agent-session-manager.test.ts apps/electron/src/renderer/components/agent/tool-result-content.test.ts --timeout 30000`：96 pass / 0 fail。

## 2026-06-02 Phase J28 Pi MCP 权限提示边界

- 背景：
  - J27 后，Proma MCP remote tools 会以 Pi native tool 名进入运行时，例如 `mcp__docs__inspect_result`。
  - 旧 Pi 权限映射会把这类工具当作 unknown tool，虽然仍会弹窗确认，但用户看到的是“使用 Pi 工具”，无法区分 MCP bridge 与普通 Pi 内置工具。
- 实现：
  - `mapPiToolPermission()` 增加 MCP 工具边界：
    - `mcp__<server>__list_tools` 视为只读探查，safe / ask 模式下自动允许。
    - `mcp__<server>__<tool>` 仍走确认，danger level 为 medium，与未知外部工具保持谨慎。
  - generated `proma-permission-bridge.mjs` 同步实现相同规则：
    - `list_tools` 自动允许。
    - remote MCP tool 权限确认描述为 `调用 MCP 工具: <server> / <tool>`。
  - 这样 Proma 权限横幅会明确呈现 MCP server/tool，而不是含糊显示 unknown/Pi tool。
- 当前边界：
  - MCP remote tool 的实际风险仍取决于外部 MCP server；Proma 目前不解析 MCP tool schema 来细分 read/write 风险。
  - 后续可在 MCP bridge manifest 中携带 server/tool metadata，并将其透传给权限扩展做更细粒度策略。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.65`。
- 验证：
  - 新增 BDD：
    - MCP list tools 在 safe 模式自动允许。
    - MCP remote tool 在 ask 模式需要 medium 确认。
    - generated permission extension 会输出 `调用 MCP 工具: server / tool` 描述。
  - 已运行：
    - `bun test apps/electron/src/main/lib/adapters/pi-permission-mapping.test.ts --timeout 30000`：15 pass / 0 fail。
    - `bun test apps/electron/src/main/lib/adapters/pi-mcp-extension.test.ts apps/electron/src/main/lib/adapters/pi-process.test.ts apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts apps/electron/src/main/lib/adapters/pi-permission-mapping.test.ts apps/electron/src/main/lib/agent-session-manager.test.ts apps/electron/src/renderer/components/agent/tool-result-content.test.ts --timeout 30000`：99 pass / 0 fail。

## 2026-06-02 Phase J29 Pi MCP packaged app smoke

- 背景：
  - J27/J28 已证明开发态与真实 Pi RPC 能加载 MCP bridge，但发布稳定性还需要证明 packaged app 中依赖路径可用。
  - 旧 `out/mac-arm64/Proma.app` 只包含 Pi CLI，没有 MCP SDK / typebox，`proma-mcp-bridge.mjs` 在产物里会失败。
- 实现：
  - 新增 release smoke 脚本：`apps/electron/scripts/pi-mcp-packaged-smoke.ts`。
    - 默认检查 `out/mac-${process.arch}/Proma.app`，也支持 `--app <Proma.app>`。
    - 检查 `app.asar.unpacked` 中存在 Pi CLI、`@modelcontextprotocol/sdk`、`typebox`。
    - 用 packaged `Proma.app/Contents/MacOS/Proma` + `ELECTRON_RUN_AS_NODE=1` 启动 runner。
    - runner 再用 packaged Electron Node 模式启动 Pi RPC：`pi-coding-agent/dist/cli.js --mode rpc --extension <bridge>`。
    - bridge 连接真实 stdio MCP fixture，并通过 `get_commands` 验证 `proma:mcp_bridge_status` 包含 `mcp__docs__inspect_result`。
  - `apps/electron/package.json` 新增脚本：
    - `bun run --filter='@proma/electron' smoke:pi-mcp-packaged`
  - 打包配置补齐：
    - `electron-builder.yml` 的 `files` 已包含 `node_modules/typebox/**/*`。
    - `asarUnpack` 现在也包含 `node_modules/typebox/**`，避免 file URL import 留在 asar 内。
- 验证路径：
  - 先用旧产物运行 smoke，失败并明确报缺：
    - `@modelcontextprotocol/sdk/package.json`
    - `typebox/package.json`
  - 使用当前源码重新打 dir 产物：
    - `cd apps/electron && bun run scripts/dist.ts --current-arch --dir --no-sign`
  - 再运行 packaged smoke 成功，输出：
    - `{"ok":true,"command":"proma:mcp_bridge_status","tool":"mcp__docs__inspect_result",...}`
- 版本：
  - `@proma/electron` patch bump 到 `0.10.66`。
- 当前边界：
  - smoke 当前只覆盖 macOS `.app` dir 产物；Windows/Linux 需要按对应可执行路径扩展脚本。
  - smoke 不触发真实 LLM tool call；它验证 packaged Pi RPC、extension load、MCP SDK/typebox import、真实 MCP listTools 和 command 可见性。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/pi-mcp-extension.test.ts --timeout 30000`：12 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/adapters/pi-mcp-extension.test.ts apps/electron/src/main/lib/adapters/pi-process.test.ts apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts apps/electron/src/main/lib/adapters/pi-permission-mapping.test.ts apps/electron/src/main/lib/agent-session-manager.test.ts apps/electron/src/renderer/components/agent/tool-result-content.test.ts --timeout 30000`：100 pass / 0 fail。
  - `bun run typecheck`：通过。
  - `bun run electron:build`：通过，仅既有 Vite chunk-size warning。
  - `cd apps/electron && bun run scripts/dist.ts --current-arch --dir --no-sign`：通过。
  - `bun run --filter='@proma/electron' smoke:pi-mcp-packaged`：通过。

## 2026-06-02 Phase J30 Pi MCP packaged smoke 跨平台路径准备

- 背景：
  - J29 的 packaged smoke 已跑通 macOS `.app`，但路径解析写死在 `Proma.app/Contents/...`。
  - 这会阻塞 Windows/Linux 产物验证，也容易让 runner 内部继续假设 `Contents/Resources`。
- 实现：
  - 新增 `apps/electron/scripts/pi-mcp-packaged-paths.ts`：
    - macOS 默认路径：`out/mac-${arch}/Proma.app`。
    - Windows 默认路径：`out/win-unpacked`，可执行文件 `Proma.exe`，resources 位于同级 `resources/`。
    - Linux 默认路径：`out/linux-unpacked`，可执行文件 `Proma`，resources 位于同级 `resources/`。
    - 支持传入 Windows/Linux 可执行文件路径并自动反推 app dir 与 resources dir。
  - `pi-mcp-packaged-smoke.ts` 改为使用 helper，并支持 `--platform darwin|win32|linux`。
  - smoke runner 内部资源路径解析也改为跨平台：
    - darwin：`dirname(dirname(process.execPath))/Resources`。
    - win32/linux：`dirname(process.execPath)/resources`。
  - 脚本入口增加 `import.meta.main` 保护，方便测试安全 import。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.67`。
- 当前边界：
  - 本阶段补齐的是 Windows/Linux packaged smoke 的路径与测试基础。
  - 真实 Windows/Linux 打包产物 smoke 尚未在本机执行，需要对应平台产物或 CI runner。
- 已运行：
  - `bun test apps/electron/scripts/pi-mcp-packaged-paths.test.ts apps/electron/src/main/lib/adapters/pi-mcp-extension.test.ts --timeout 30000`：17 pass / 0 fail。
  - `bun run typecheck`：通过。

## 2026-06-02 Phase J31 Release workflow Pi MCP packaged smoke gate

- 背景：
  - J29/J30 已有 packaged smoke 脚本和跨平台路径 helper，但 release workflow 仍直接 `electron-builder --publish always`。
  - 如果 Pi CLI / MCP SDK / typebox 等运行时依赖在打包配置中回退，只有发布后才会暴露。
- 实现：
  - `.github/workflows/release.yml` 增加发布前 packaged smoke gate：
    - macOS arm64 job：先 `npx electron-builder --mac --arm64 --dir`，再 `bun run smoke:pi-mcp-packaged -- --platform darwin`。
    - Windows x64 job：先 `npx electron-builder --win --x64 --dir`，再 `bun run smoke:pi-mcp-packaged -- --platform win32`。
  - 新增 `apps/electron/scripts/pi-mcp-release-workflow.test.ts`，用 BDD 断言 smoke gate 位于正式 publish step 之前。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.68`。
- 当前边界：
  - macOS x64 release job 已在 J32 补齐 smoke gate。
  - Linux 尚未在 release workflow 中构建，J30 已准备路径 helper，但需要后续新增 Linux release/CI job 才能真实跑。
- 已运行：
  - `bun test apps/electron/scripts/pi-mcp-release-workflow.test.ts`：2 pass / 0 fail。

## 2026-06-02 Phase J32 Release workflow macOS x64 smoke gate

- 背景：
  - J31 先覆盖了 macOS arm64 和 Windows x64，但 release workflow 还有独立的 macOS x64 job。
  - macOS x64 runner 会安装 `@anthropic-ai/claude-agent-sdk-darwin-x64` 等平台依赖，仍需要单独验证 packaged Pi runtime。
- 实现：
  - `build-mac-x64` job 在正式 publish 前新增：
    - `npx electron-builder --mac --x64 --dir`
    - `bun run smoke:pi-mcp-packaged -- --platform darwin`
  - `pi-mcp-release-workflow.test.ts` 同步断言 macOS x64 smoke gate 位于 `打包并发布 (macOS x64)` 之前。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.69`。
- 当前边界：
  - release workflow 现在覆盖 macOS arm64、macOS x64、Windows x64 packaged smoke。
  - Linux 仍待后续新增 build job 后接入。
- 已运行：
  - `bun test apps/electron/scripts/pi-mcp-release-workflow.test.ts`：2 pass / 0 fail。

## 2026-06-02 Phase J33 Pi MCP 权限风险 hint

- 背景：
  - J28 把 MCP remote tool 从 unknown tool 中区分出来，但所有逐工具 MCP 调用仍统一 medium ask。
  - 这对明显只读的 `search` / `list` / `inspect` 类 MCP 工具不够顺滑，也弱于 Claude SDK 的细粒度工具权限体验。
- 实现：
  - `mapPiToolPermission()` 新增 `toolDescription` 输入和 MCP read-like heuristic：
    - 名称首段为 `fetch/find/get/inspect/list/lookup/query/read/search`。
    - 描述存在且不包含 `create/delete/edit/write/update/remove/execute/run/send/upload` 等 mutation 词。
    - 满足条件时 safe/ask 模式下自动允许。
  - generated `proma-permission-bridge.mjs` 同步实现相同 heuristic。
  - generated `proma-mcp-bridge.mjs` 在远端 MCP tools 注册后发布全局 risk hints：
    - `globalThis.__PROMA_PI_MCP_TOOL_RISK_HINTS__[nativeToolName] = { risk, server, toolName, description }`
    - permission extension 在 `tool_call` 阶段读取该全局表。
    - read hint 自动 allow，write hint 继续 ask。
  - 真实 generated bridge 测试已验证 `mcp__docs__inspect_result` 会发布 read risk hint。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.70`。
- 当前边界：
  - 这是保守 heuristic，不解析完整 MCP schema side effect 语义。
  - 不确定或描述缺失的 MCP tool 仍保持 medium ask。
  - write-like hint 仍为 medium ask，后续可结合 server 信任级别或 MCP tool annotations 做更细粒度 danger level。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/pi-permission-mapping.test.ts apps/electron/src/main/lib/adapters/pi-mcp-extension.test.ts --timeout 30000`：32 pass / 0 fail。
  - `bun run typecheck`：通过。

## 2026-06-02 Phase J34 Pi Provider 兼容性进入 UI 选择闭环

- 背景：
  - 之前 `agentChannelIds` 与 Agent 模型选择器主要沿用 Claude SDK 的 Anthropic-compatible 假设。
  - Pi runtime 已能通过 `models.json` 和 env 映射接入 OpenAI-compatible / Qwen / Doubao / Custom 等 provider，但 UI 过滤没有完整表达这个 runtime 差异。
- 实现：
  - `@proma/shared` 新增 runtime-aware provider helper：
    - `PI_AGENT_COMPATIBLE_PROVIDERS`
    - `isProviderCompatibleWithAgentEngine(engine, provider)`
  - 保留旧 `isAgentCompatibleProvider()` 的 Claude SDK 保守语义，避免破坏既有调用方。
  - 渠道设置页按当前工作区 `agentEngine` 展示 Agent 可用渠道：
    - Claude SDK：仅 Anthropic 协议兼容渠道。
    - Pi Agent RPC：允许当前 Pi provider mapping 覆盖的所有 provider。
  - `ChannelForm` 新建/编辑后自动加入或移除 Agent 白名单时，同样按当前 runtime 判断。
  - 新增 renderer helper `agent-runtime-channel-options.ts`：
    - 统一计算当前 runtime 下模型选择器可展示的 channel ids。
    - 统一判断当前 runtime 是否有可用模型。
    - 统一判断当前选中的 channel/model 是否真的可用于当前 runtime。
  - `AgentView` 改为使用 runtime-aware 可选渠道列表传给 `ModelSelector`，并在发送前校验当前选中的模型可用。
  - `ModelSelector` 修正 `filterChannelIds=[]` 语义：显式空白名单现在显示空列表，而不是退回显示全部模型。
  - 切换 runtime 或保留旧 per-session 模型选择导致当前模型不可用时，`AgentView` 会自动选择第一个兼容 runtime 的可用模型，避免用户卡在不可发送状态。
- 版本：
  - `@proma/shared` patch bump 到 `0.1.41`。
  - `@proma/electron` patch bump 到 `0.10.71`。
- 当前边界：
  - 这是 UI/selector 层兼容闭环，不等价于所有 provider 的真实 LLM smoke 已覆盖。
  - 下一步仍需要对 Pi + Qwen / Doubao / Custom / Google 等实际调用做 provider-by-provider smoke，确认 Pi `models.json`、baseUrl、env key 和模型 id 组合全部可用。
- 已运行：
  - `bun test packages/shared/src/types/channel.test.ts apps/electron/src/renderer/lib/agent-runtime-channel-options.test.ts apps/electron/src/renderer/components/chat/ModelSelector.test.ts apps/electron/src/main/lib/adapters/pi-runtime-config.test.ts --timeout 30000`：13 pass / 0 fail。
  - `bun run typecheck`：通过。
  - `bun run electron:build`：通过，仅既有 Vite chunk-size warning。

## 2026-06-02 Phase J35 Pi Provider UI/runtime 映射防漂移测试

- 背景：
  - J34 让 UI 按 `PI_AGENT_COMPATIBLE_PROVIDERS` 放行 Pi provider。
  - 但 Pi 实际 runtime 入口仍由 `PI_PROVIDER_MAPPINGS` 决定，二者若未来新增 provider 时不同步，会出现 UI 能选但运行时无映射，或运行时支持但 UI 不显示。
- 实现：
  - `pi-runtime-config.test.ts` 新增防漂移 BDD：
    - `getPiRuntimeMappedProvidersForTest()` 返回当前 runtime provider mapping keys。
    - 断言该集合与 shared `PI_AGENT_COMPATIBLE_PROVIDERS` 完全一致。
  - `pi-runtime-config.ts` 导出测试用 `getPiRuntimeMappedProvidersForTest()`，生产路径不依赖它。
- 当前边界：
  - 该测试证明 provider 枚举同步，不证明每个 provider 的真实 API 调用成功。
  - 后续仍需要 provider-by-provider live smoke。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/pi-runtime-config.test.ts --timeout 30000`：5 pass / 0 fail。

## 2026-06-02 Phase J36 Pi Provider runtime config 矩阵验证

- 背景：
  - J35 证明 UI 放行 provider 集合与 runtime mapping keys 一致，但还没有逐 provider 验证实际生成的 Pi runtime 配置。
  - 风险点包括：错误的 Pi provider 名、API Key env 名、baseUrl 写入、OpenAI-compatible provider 是否注册 normalized model id。
- 实现：
  - `pi-runtime-config.test.ts` 新增 provider-by-provider matrix BDD：
    - 遍历 `getPiRuntimeProviderContractsForTest()`。
    - 对每个 provider 实际调用 `preparePiRuntimeConfig()`。
    - 校验 `config.provider`、对应 API Key env、`models.json` provider baseUrl。
    - 对 `registerModel=true` 的 provider 校验 `provider/model` 会被 normalize 为 `model` 并写入 `models.json.providers[piProvider].models`。
    - 对 `registerModel=false` 的 provider 校验不会写入自定义 models。
  - `pi-runtime-config.ts` 暴露测试用 contract 摘要 `getPiRuntimeProviderContractsForTest()`，生产路径不依赖。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.72`。
- 当前边界：
  - 该矩阵不触发真实 LLM API 调用，无法证明供应商账户/API Key 本身可用。
  - 它证明 Proma 传给 Pi runtime 的本地配置形态对所有 UI 允许的 provider 都有稳定测试覆盖。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/pi-runtime-config.test.ts --timeout 30000`：6 pass / 0 fail。

## 2026-06-02 Phase J37 Linux release packaged smoke gate

- 背景：
  - J31/J32 已让 release workflow 在 macOS arm64、macOS x64、Windows x64 正式发布前运行 Pi MCP packaged smoke。
  - J30 已准备 Linux packaged smoke 路径 helper，但 release workflow 还没有 Linux job，因此 Linux 产物无法验证 Pi runtime / MCP bridge 打包完整性。
- 实现：
  - `.github/workflows/release.yml` 新增 `build-linux-x64` job：
    - `ubuntu-latest` runner。
    - `bun install --frozen-lockfile`。
    - `bun run electron:build`。
    - 发布前先运行：
      - `npx electron-builder --linux --x64 --dir`
      - `bun run smoke:pi-mcp-packaged -- --platform linux`
    - smoke 通过后再 `npx electron-builder --linux --x64 --publish always`。
  - `pi-mcp-release-workflow.test.ts` 新增 Linux BDD，断言 Linux smoke gate 位于 `打包并发布 (Linux)` 之前。
  - Linux release 引入后，同步补齐 Claude Agent SDK Linux native binary 打包配置：
    - `apps/electron/package.json` optionalDependencies 新增 `@anthropic-ai/claude-agent-sdk-linux-x64@0.3.143` 和 `@anthropic-ai/claude-agent-sdk-linux-arm64@0.3.143`。
    - `electron-builder.yml` files 新增 Linux x64/arm64 SDK 子包 glob。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.73`。
- 当前边界：
  - 本阶段新增的是 CI/release workflow gate；本机未构建 Linux 产物。
  - Linux smoke 会在 ubuntu runner 上真实执行 packaged dir 产物 smoke；失败会阻止 Linux release publish。
- 已运行：
  - `bun test apps/electron/scripts/pi-mcp-release-workflow.test.ts --timeout 30000`：3 pass / 0 fail。

## 2026-06-02 Phase J38 Pi Provider config real RPC diagnostic smoke

- 背景：
  - J36 已验证 Proma 对每个 Pi-compatible provider 生成的 `models.json`、API Key env 和 provider mapping 形态正确。
  - 但还缺少一条证明“真实 Pi RPC 进程启动后确实能看到这些 Proma 注入配置”的 smoke。
- 实现：
  - `pi-runtime-config.ts` 测试 helper 新增 provider diagnostic extension：
    - 注册 `proma:provider_config_status` command。
    - command description 在 Pi 进程内读取 `models.json` 与 `process.env`，暴露 provider、API key env 是否存在、baseUrl、model ids。
  - `pi-runtime-config.test.ts` 新增真实 Pi RPC smoke：
    - 准备 Qwen 渠道，映射到 Pi `openai` provider。
    - 写入 `OPENAI_API_KEY`、DashScope OpenAI-compatible baseUrl、`qwen-plus` model。
    - 启动 `startPiRpcSession()`，通过 `get_commands` 断言 extension command 已加载，并且 description 证明 Pi 进程可见上述配置。
  - 说明：
    - Pi RPC 文档没有 `run_command` command；extension command 应通过 `prompt` 的 slash command 机制触发。
    - 为避免触发模型请求与测试挂起，本 smoke 对齐 `proma:mcp_bridge_status` 的做法，只通过 `get_commands` description 证明状态。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.74`。
- 当前边界：
  - 该 smoke 证明真实 Pi RPC 进程可见 Proma provider runtime config。
  - 仍不等价于 provider-by-provider 真实 LLM API 调用成功；后续需要在有真实 Key 的环境做 live smoke 或手动验收矩阵。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/pi-runtime-config.test.ts --timeout 30000`：7 pass / 0 fail。

## 2026-06-02 Phase J39 Skills 边界提示修正

- 背景：
  - H2 已让 Pi runtime 显式加载工作区 `skills/` 与全局 `~/.agents/skills/`。
  - 但通用 `buildSystemPrompt()` 的工作区信息仍保留旧文案：“外部命令安装到 .agents/skills/ 不会被加载”，会误导 Agent 对当前 Skills 能力边界的判断。
- 实现：
  - `agent-prompt-builder.ts` 更新 Skills 目录说明：
    - Proma 工作区 `skills/` 是主目录。
    - 支持原生 Agent Skills 的 runtime 也可能显式加载 `~/.agents/skills/` 等全局目录。
    - 如果某个 Skill 在当前会话不可见，再导入或移动到工作区 `skills/`。
  - 新增 `agent-prompt-builder.test.ts`，锁定 prompt 必须提到 `~/.agents/skills/`，且不能再声称 `.agents/skills` 不会被加载。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.75`。
- 已运行：
  - `bun test apps/electron/src/main/lib/agent-prompt-builder.test.ts --timeout 30000`：1 pass / 0 fail。

## 2026-06-02 Phase J40 Pi 原生 Skill loader 真实 RPC smoke

- 背景：
  - H2 已覆盖 `--skill` 参数链路，J39 修正了 Skills 能力边界提示。
  - 但还缺少一条真实 Pi RPC 进程 smoke，证明 Proma 传入的 skill path 会被 Pi 原生 Skill loader 注册为 `/skill:name` command。
- 实现：
  - `pi-process.test.ts` 新增真实 Pi RPC smoke：
    - 创建临时 `skills/proma-smoke-skill/SKILL.md`。
    - 通过 `startPiRpcSession({ skillPaths: [skillsRoot] })` 启动真实 Pi RPC。
    - 调用 `get_commands`，断言返回 `skill:proma-smoke-skill`，`source` 为 `skill`，description 与 SKILL.md frontmatter 一致。
  - 该 smoke 不触发 LLM 请求，只验证 Pi 原生 Skill loader 和 RPC command registry。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.76`。
- 当前边界：
  - 这证明 skill path 能被 Pi 加载并暴露为 `/skill:name`。
  - Proma 富文本任意位置 `/skill` 引用的正文展开已由 H4/J 系列测试覆盖；本 smoke 不再次触发 prompt expansion。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/pi-process.test.ts --timeout 30000`：9 pass / 0 fail。

## 2026-06-02 Phase J41 Pi active runtime get_messages 与运行中历史同步

- 背景：
  - J11-J13 已支持选择 Pi native session 文件、预览/同步离线 JSONL 历史。
  - 但 UI 在 Agent 运行中仍直接阻止同步 Pi 原生历史；这弱于同级 runtime 体验，也导致 active `switch_session` 后无法立即把 Pi runtime 当前消息快照同步回 Proma JSONL。
  - Pi RPC 文档提供 `get_messages`，可以在运行中读取当前 runtime 消息。
- 实现：
  - `AgentProviderAdapter` 新增可选 `getMessages(sessionId): Promise<SDKMessage[]>`。
  - `PiAgentAdapter` 实现 `getMessages()`：
    - 发送 Pi RPC `get_messages`。
    - 从 response `data.messages` 返回当前 runtime 消息快照。
  - `AgentOrchestrator` 新增 `getActiveRuntimeMessages()`。
  - `agent-service.ts` 新增 service 层 `syncPiNativeSessionMessages()`：
    - 若 Pi 会话正在运行，优先调用 active runtime `get_messages` 并按 `_promaPiEntryId` 去重追加到 Proma JSONL。
    - 若非运行状态，或 active runtime 同步失败且调用方提供了 `sessionPath`，回退到原有 Pi native JSONL 文件同步。
    - 无 active runtime 且无 `sessionPath` 时返回明确错误。
  - `ipc.ts` 的 `SYNC_PI_NATIVE_SESSION_MESSAGES` 改为调用 service 层，并移除“运行中禁止同步”guard。
  - `AgentView.tsx` 移除运行中同步阻断：
    - running 状态下同步时不再传 `sessionPath`，让主进程走 active runtime 快照。
    - 确认弹窗文案区分“运行中 runtime 快照”和“离线 session 文件 branch”。
  - 真实 Pi RPC smoke：
    - `pi-process.test.ts` 新增 `get_messages` smoke，启动真实 Pi RPC 后调用 `get_messages` 并验证空消息列表可返回。
- 版本：
  - `@proma/shared` patch bump 到 `0.1.42`。
  - `@proma/electron` patch bump 到 `0.10.77`。
- 当前边界：
  - 运行中同步依赖 Pi RPC `get_messages` 返回的消息已是 Proma 可展示形态；若未来 Pi 返回 native JSONL entry 形态，需要再接入 converter。
  - 该能力解决“运行中同步当前 runtime 历史”，不等价于 Pi 文件快照 rewind。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts --timeout 30000`：24 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-session-manager.test.ts --timeout 30000`：26 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/adapters/pi-process.test.ts --timeout 30000`：10 pass / 0 fail。

## 2026-06-02 Phase J42 Pi Provider live smoke 验收入口

- 背景：
  - J36/J38 已证明 Proma 生成的 provider mapping、`models.json`、API Key env 能被真实 Pi RPC 进程看见。
  - 但 provider-by-provider 的真实 LLM 调用不能放进默认 CI，因为依赖用户账号、Key、额度和网络。
- 实现：
  - 新增 `apps/electron/scripts/pi-provider-live-smoke.ts`：
    - 启动真实 Pi RPC。
    - 复用 `preparePiRuntimeConfig()` 为目标 provider 生成隔离 config/session dir。
    - 发送最小 prompt：`Reply with exactly: PROMA_PI_PROVIDER_OK`。
    - 默认跳过缺少 API Key 的 provider，而不是让常规 CI 失败。
    - 支持 `--providers qwen,doubao`、`--prompt`、`--timeout-ms`、`--keep-temp`。
  - 新增 package script：
    - `bun run --cwd apps/electron smoke:pi-provider-live -- --providers qwen`
  - 新增 `pi-provider-live-smoke.test.ts`：
    - 覆盖 provider 参数解析。
    - 覆盖 live smoke target 与 `PI_AGENT_COMPATIBLE_PROVIDERS` 防漂移。
    - 覆盖无 Key 时 skip，而非 fail。
    - 覆盖 custom provider 缺 `PROMA_PI_LIVE_CUSTOM_BASE_URL` 时给出明确 skip 原因。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.78`。
- 使用方式：
  - 单 provider 验证：
    - `OPENAI_API_KEY=... bun run --cwd apps/electron smoke:pi-provider-live -- --providers qwen`
  - 多 provider 验证：
    - `OPENAI_API_KEY=... DEEPSEEK_API_KEY=... bun run --cwd apps/electron smoke:pi-provider-live -- --providers qwen,deepseek`
  - 默认 provider/model 可通过脚本内的 `PROMA_PI_LIVE_<PROVIDER>_MODEL` / `PROMA_PI_LIVE_<PROVIDER>_BASE_URL` 环境变量覆盖。
- 当前边界：
  - 该脚本是有 Key 环境下的手动/可选验收入口，默认测试只验证 skip 和配置覆盖，不真实消耗模型额度。
  - 暂未把 live smoke 加入 release gate；只有打包完整性 smoke 适合默认 CI。
- 已运行：
  - `bun run --cwd apps/electron smoke:pi-provider-live -- --providers qwen --timeout-ms 1000`：缺少 `OPENAI_API_KEY` 时正常 skipped。
  - `bun test apps/electron/scripts/pi-provider-live-smoke.test.ts apps/electron/src/main/lib/adapters/pi-runtime-config.test.ts --timeout 30000`：12 pass / 0 fail。
  - `bun run typecheck`：通过。
  - `bun run electron:build`：通过，仅既有 Vite chunk-size warning。

## 2026-06-02 Phase J43 Pi rewind 原生 session 分支对齐

- 背景：
  - J1 已让 Pi rewind 支持 Proma JSONL 历史截断，但文件快照仍不是 Claude SDK parity。
  - 另一个隐患是：停止后回退 Proma 历史，如果 Pi 下次启动仍从旧 native session 文件末端恢复，runtime 视角和 UI 视角可能分叉。
- 实现：
  - `agent-session-manager.ts` 新增 `createPiNativeRewindSession()`：
    - 优先使用当前会话 `forkSourcePiSessionPath`，否则按 Proma session id 查找 Pi native session 文件。
    - 读取 Pi native session tree。
    - 按目标 Pi entry id 选择祖先路径，避免 sibling branch 混入。
    - 写入新的 `*_rewind_<sessionId>.jsonl` 分支文件。
    - header 保留 source header，并记录 `parentSession` 指向源 Pi session 文件。
  - `forkPiNativeSession()` 同步改为优先使用 `forkSourcePiSessionPath`，让 fork/rewind/switch 后的后续分叉继续沿当前 native branch 走。
  - `AgentOrchestrator.rewindSession()` 的 Pi 分支现在：
    - 先截断 Proma SDKMessages。
    - 尝试创建 Pi native rewind 分支。
    - 成功后更新会话元数据：
      - `forkSourcePiSessionId`
      - `forkSourcePiSessionPath`
    - 下次运行 Pi runtime 时会通过现有 `runtimeSessionPath` 从该 rewind 分支恢复。
  - 文件系统回退仍明确标注不可用：
    - 当前只对齐会话历史和 Pi native branch。
    - 不伪装成 Claude SDK `file-history-snapshot` parity。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.79`。
- 当前边界：
  - 仅覆盖停止后的 rewind；active session rewind 仍由 orchestrator 禁止，避免并发写入损坏。
  - 文件快照回退仍未接入 Pi 原生能力或 Proma 自建 checkpoint。
- 已运行：
  - `bun test apps/electron/src/main/lib/agent-session-manager.test.ts --test-name-pattern "rewinding" --timeout 30000`：4 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-session-manager.test.ts apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts apps/electron/src/main/lib/adapters/pi-process.test.ts --timeout 30000`：61 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts --timeout 30000`：15 pass / 0 fail。
  - `bun run typecheck`：通过。
  - `bun run electron:build`：通过，仅既有 Vite chunk-size warning。

## 2026-06-02 Phase J44 Pi active runtime fork 接入普通分叉入口

- 背景：
  - J7/J8 已接入 Pi active runtime `clone`，J43 已让停止后的 rewind 对齐 Pi native branch。
  - 但普通消息操作栏的“从此处分叉”在 Pi 会话中仍被 UI 禁用，且 IPC 直接调用 `agent-session-manager.forkAgentSession()`，无法优先消费 active runtime 原生 `fork`。
- 实现：
  - `agent-service.ts` 新增 service 层 `forkAgentSession(input)`：
    - 读取 source session engine。
    - Pi 会话且存在 active orchestrator 时，优先调用 `activeOrchestrator.forkActiveRuntimeSession(sessionId, upToMessageUuid)`。
    - 随后复用 `agent-session-manager.forkAgentSession()` 创建 Proma 分叉会话、复制 UI 历史和工作区文件。
    - 如果 runtime fork 返回 `sessionId` / `sessionPath`，写入新会话的 `forkSourcePiSessionId` / `forkSourcePiSessionPath`。
    - 如果 active runtime fork 失败或没有返回 session 文件元数据，保留既有 Proma/离线 Pi native fork fallback，不阻断用户分叉。
  - `AgentOrchestrator` 新增 `forkActiveRuntimeSession()`，封装 adapter `fork(sessionId, entryId)`。
  - `PiAgentAdapter.parseForkResultData()` 现在保留 runtime fork response 中的 `sessionId` / `sessionPath`。
  - `ipc.ts` 的 `FORK_SESSION` 改为走 service 层 `forkAgentSession()`，避免绕开 active runtime。
  - `AgentView.tsx` 重新开放 Pi 会话的 `onFork` / `onRewind` 操作入口，并更新提示条：
    - 现在描述 Pi session tree 分叉/克隆/切换已接入。
    - 文件快照回退仍明确标注为待补齐。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.80`。
- 当前边界：
  - active runtime fork 的 session 文件元数据取决于 Pi RPC response；如果当前 Pi 版本只返回 `text/cancelled`，Proma 会自动退回离线 fork 文件路径，不宣称 runtime native fork 完整成功。
  - `AgentMessages` 仍会在会话 streaming 中隐藏消息操作按钮，避免运行中对同一 JSONL 并发 fork/rewind。
  - 文件快照回退仍未实现。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts --test-name-pattern "native fork" --timeout 30000`：2 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-session-manager.test.ts --test-name-pattern "active pi session" --timeout 30000`：10 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts --timeout 30000`：15 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-session-manager.test.ts apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts apps/electron/src/main/lib/adapters/pi-process.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts --timeout 30000`：77 pass / 0 fail。
  - `bun run typecheck`：通过。
  - `bun run electron:build`：通过，仅既有 Vite chunk-size warning。

## 2026-06-02 Phase J45 Pi 工具进度保真与后台任务 parity 审计

- 背景：
  - 继续检查 Pi 在停止、切换会话、追加消息、后台运行时是否和 Claude SDK 一致。
  - Pi 包中能看到 `queue_update`、`tool_execution_start/end/update`、`session_before_*`、`turn_start/end` 等事件。
  - 但 Pi 的 `background` 语义主要是交互式 CLI 挂起到系统后台，不是 Claude SDK 的 `task_backgrounded` / `shell_backgrounded` 工具后台任务事件。
- 实现：
  - `pi-agent-adapter.ts` 的 `tool_execution_update` 临时 tool_result 现在保留 `toolUseResult` 元数据：
    - 对对象型 `partialResult`：保留原结构并补 `isError: false`。
    - 对字符串/primitive `partialResult`：包装为 `{ partialResult, isError: false }`。
    - 同时尽量补入 Pi 事件里的 `toolName` 和 `args`，映射为 Proma 可展示的 `toolName` / `input`。
  - Pi 最终 `tool_execution_end` 如果返回字符串/primitive，`toolUseResult` 会使用 `{ result, isError }`，避免和进度事件的 `partialResult` 混淆。
  - 这样 renderer live message 管道收到 Pi 工具流式结果时，不再只有孤立的 `tool_result.content`，后续 UI 调试和结果渲染能知道是哪一个工具、用什么输入产生的进度。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.81`。
- 当前边界：
  - 不把 Pi `tool_execution_update` 伪装成 Claude SDK `task_backgrounded` / `shell_backgrounded`。
  - Proma 现有后台任务 UI 管道仍等待 Pi runtime 提供真正的后台任务/后台 shell 事件，或后续由 Proma 侧实现明确的 checkpoint/background task 兼容层。
  - Pi 工具 streaming progress 已可保真展示和替换最终结果，但不是“任务脱离后继续运行”的 parity。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts --test-name-pattern "tool update" --timeout 30000`：1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts --test-name-pattern "known Pi lifecycle" --timeout 30000`：1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts --test-name-pattern "final tool result is primitive" --timeout 30000`：1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts --timeout 30000`：25 pass / 0 fail。

## 2026-06-02 Phase J46 Pi git checkpoint 基础设施

- 背景：
  - Claude SDK 可通过 `file-history-snapshot` 做文件回退，Pi runtime 目前只有 native session tree 回退。
  - 直接自动 `git stash apply` 风险较高，尤其用户工作区可能有未保存改动。
  - 本阶段先补安全基础：Proma 生成 Pi extension 记录 git checkpoint 元数据，rewind 时识别可用 checkpoint，但不自动改文件。
- 实现：
  - 新增 `adapters/pi-git-checkpoint-extension.ts`：
    - `ensurePiGitCheckpointExtension()` 写入 session 级 `proma-extensions/proma-git-checkpoint.mjs`。
    - extension 在 `tool_result` / `turn_start` 记录当前 Pi leaf entry，并执行 `git stash create`。
    - checkpoint 通过 `pi.appendEntry('proma-git-checkpoint', { targetEntryId, gitRef, cwd, createdAt })` 写进 Pi native session JSONL。
    - `session_before_fork` 只保留 no-op；没有 `git stash apply`，也不通过 `ctx.ui.select` 自动恢复文件。
  - Pi runtime extension list 现在默认加载三类 Proma extension：
    - `proma-permission-bridge.mjs`
    - `proma-mcp-bridge.mjs`（仅有 enabled MCP 时）
    - `proma-git-checkpoint.mjs`
  - 新增 Pi native checkpoint parser：
    - `listPiGitCheckpoints(sessionPath)` 解析 `customType: 'proma-git-checkpoint'` entries。
    - `findPiGitCheckpointForEntry(sessionPath, targetEntryId)` 支持直接命中或沿 `parentId` 找最近祖先 checkpoint。
  - `AgentOrchestrator.rewindSession()` 的 Pi 分支现在：
    - 创建 Pi native rewind 分支后，优先在新分支查找 checkpoint，找不到再查源 session。
    - 若存在 checkpoint，`fileRewind` 返回 `checkpoint` 元数据，并明确说明“已找到 checkpoint，但当前版本不会自动恢复文件”。
    - `canRewind` 仍为 `false`，避免 UI 误以为文件已经恢复。
  - `@proma/shared` 的 `RewindSessionResult.fileRewind` 增加可选 `checkpoint` 字段。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.82`。
  - `@proma/shared` patch bump 到 `0.1.43`。
- 当前边界：
  - 这不是完整文件回退 parity；它只证明 Pi native session 中已有 Proma 可识别的 git checkpoint 锚点。
  - 后续若要恢复文件，需要新增显式 UI/命令，显示 `gitRef/cwd/filesChanged` 风险后由用户确认，再执行安全恢复策略。
  - checkpoint 依赖 cwd 是 git repository；非 git 工作目录或无改动时 `git stash create` 可能返回空 ref。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/pi-git-checkpoint-extension.test.ts --timeout 30000`：4 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-session-manager.test.ts --timeout 30000`：28 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/adapters/pi-git-checkpoint-extension.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts --timeout 30000`：19 pass / 0 fail。

## 2026-06-02 Phase J47 Pi git checkpoint 显式文件恢复

- 背景：
  - J46 已能在 Pi native session JSONL 中记录和识别 Proma git checkpoint，但 rewind 后只能提示“找到 checkpoint”，用户无法在 Proma 内显式恢复文件。
  - 为继续靠近 Claude SDK 文件回退 parity，本阶段补受控恢复入口，但仍避免无确认自动改文件。
- 实现：
  - `adapters/pi-git-checkpoint-extension.ts` 新增 `applyPiGitCheckpoint()`：
    - 输入为 `sessionPath + targetEntryId`。
    - 主进程重新从 Pi native session JSONL 查找 checkpoint，renderer 不传 `gitRef`。
    - 恢复前执行 `git status --porcelain`。
    - 如果工作区有未提交改动，拒绝执行 `git stash apply`，提示用户先处理当前改动。
    - 工作区干净时执行 `git stash apply <checkpoint.gitRef>`。
  - `agent-service.ts` 新增 `applyPiGitCheckpointForSession()`：
    - 仅允许 Pi Agent 会话。
    - 使用会话元数据中的 `forkSourcePiSessionPath` 作为当前 native session 文件。
    - 检查 session 文件存在，再调用 checkpoint helper。
  - IPC / preload / shared 类型新增：
    - `AGENT_IPC_CHANNELS.APPLY_PI_GIT_CHECKPOINT`
    - `ApplyPiGitCheckpointInput`
    - `ApplyPiGitCheckpointResult`
    - `window.electronAPI.applyPiGitCheckpoint()`
  - `AgentView.tsx`：
    - Pi rewind 如果返回 `fileRewind.checkpoint`，不再只显示泛化不可用提示，而是打开二次确认入口。
    - 用户确认“恢复文件”后调用 `applyPiGitCheckpoint`。
    - 恢复成功后刷新 diff；失败时展示明确原因，尤其是工作区存在未提交改动。
    - 顶部 Pi runtime 提示同步更新为支持 “Pi git checkpoint 显式文件恢复”。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.83`。
  - `@proma/shared` patch bump 到 `0.1.44`。
- 当前边界：
  - 仍不是完全等同 Claude SDK `file-history-snapshot` 的无感恢复；这是基于 git checkpoint 的显式恢复。
  - 目前 `filesChanged` 暂为空数组，后续可通过 `git diff --name-only` 或 apply 前后 diff 补充展示。
  - 恢复要求 checkpoint cwd 是 git repository 且当前工作区干净。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/pi-git-checkpoint-extension.test.ts apps/electron/src/main/lib/agent-session-manager.test.ts --test-name-pattern "checkpoint" --timeout 30000`：7 pass / 0 fail。
  - `bun run typecheck`：通过。
  - `bun test apps/electron/src/main/lib/agent-session-manager.test.ts apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts apps/electron/src/main/lib/adapters/pi-process.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts apps/electron/src/main/lib/adapters/pi-git-checkpoint-extension.test.ts --timeout 30000`：85 pass / 0 fail。

## 2026-06-02 Phase J48 Pi checkpoint 恢复结果可观测性

- 背景：
  - J47 已支持显式恢复 Pi git checkpoint，但恢复成功后 `filesChanged` 暂为空数组。
  - 用户无法确认这次恢复具体影响了哪些文件，调试和信任成本仍偏高。
- 实现：
  - `applyPiGitCheckpoint()` 在 `git stash apply <ref>` 成功后新增 `git diff --name-only`：
    - 解析恢复后工作区的变更文件列表。
    - 自动去除空行和重复路径。
    - 返回到 `ApplyPiGitCheckpointResult.filesChanged`。
  - `AgentView.tsx` 的恢复成功 toast 现在会显示恢复文件数量和最多前三个文件名：
    - 例如：`已恢复 2 个文件：src/changed.ts、README.md`。
    - 无文件列表时仍回退显示工作区路径。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.84`。
  - `@proma/shared` patch bump 到 `0.1.45`。
- 当前边界：
  - 文件列表来自恢复后的 `git diff --name-only`，表示当前工作区相对 Git index/HEAD 的变更文件。
  - 如果未来需要更精确的“本次 apply 前后差异”，可在 apply 前后分别采样 diff 再做集合差异。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/pi-git-checkpoint-extension.test.ts apps/electron/src/main/lib/agent-session-manager.test.ts --test-name-pattern "checkpoint" --timeout 30000`：8 pass / 0 fail。
  - `bun run typecheck`：通过。
  - `bun test apps/electron/src/main/lib/agent-session-manager.test.ts apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts apps/electron/src/main/lib/adapters/pi-process.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts apps/electron/src/main/lib/adapters/pi-git-checkpoint-extension.test.ts --timeout 30000`：86 pass / 0 fail。

## 2026-06-02 Phase J49 Pi MCP call_tool 兜底权限语义

- 背景：
  - J48 后 Pi MCP bridge 已能将 MCP 服务器逐工具注册为 `mcp__<server>__<tool>`，并向权限扩展发布 read/write 风险提示。
  - 但当模型使用兜底 `mcp__<server>__call_tool` 时，权限扩展只能看到外层工具名，无法依据 `input.toolName` 继承真实远端工具风险。
  - 结果是读类 MCP fallback 调用容易产生不必要确认，体验弱于逐工具路径。
- 实现：
  - `proma-permission-bridge.mjs` 的 `getGlobalMcpToolRiskHint(toolName, input)` 现在先查外层工具名。
  - 若外层工具是 `__call_tool` 且没有直接 hint，则读取 `input.toolName`，在 `globalThis.__PROMA_PI_MCP_TOOL_RISK_HINTS__` 中查找同 server、同远端 toolName 的风险提示。
  - 匹配到 `risk: 'read'` 时沿用自动允许；匹配到 `risk: 'write'` 时继续要求确认。
  - 匹配不到 hint 时保持原行为：兜底 `call_tool` 仍走确认，避免把未知 MCP 调用误判为安全读操作。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.85`。
- 当前边界：
  - 该增强依赖 MCP bridge 启动时能成功 `listTools()` 并发布远端工具风险提示。
  - 如果远端工具无法枚举、工具名动态变化或 server 名不一致，fallback 仍会触发确认。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/pi-permission-mapping.test.ts --test-name-pattern "call_tool fallback"`：1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/adapters/pi-permission-mapping.test.ts apps/electron/src/main/lib/adapters/pi-mcp-extension.test.ts apps/electron/scripts/pi-mcp-packaged-paths.test.ts apps/electron/scripts/pi-mcp-release-workflow.test.ts --timeout 30000`：41 pass / 0 fail。

## 2026-06-02 Phase J50 Pi 内置 memory MCP bridge

- 背景：
  - Claude SDK 路径会通过 `createSdkMcpServer()` 注入 Proma 内置记忆工具 `mem`。
  - Pi MCP bridge 在 J49 前主要覆盖工作区 `mcp.json`，未覆盖全局内置 memory 工具。
  - 这会导致用户切到 Pi runtime 后无法通过同一套 Agent 工作台能力调用记忆，削弱 Pi 作为同级 runtime 的可用性。
- 实现：
  - 新增 `adapters/pi-memory-extension.ts`：
    - 全局记忆配置启用且存在 API Key 时，生成 session 级 `proma-memory-bridge.mjs`。
    - 注册 Pi 原生工具：
      - `mcp__mem__recall_memory`
      - `mcp__mem__add_memory`
    - 工具直接调用 MemOS Cloud HTTP API，与 Claude SDK memory MCP 的语义保持一致。
    - 向 `globalThis.__PROMA_PI_MCP_TOOL_RISK_HINTS__` 发布风险提示：recall 为 `read`，add 为 `write`。
  - 凭据处理：
    - extension 文件不序列化 Memory API Key。
    - 主进程只通过 Pi runtime env 注入 `PROMA_MEMOS_API_KEY`。
  - `AgentOrchestrator.runPiSession()`：
    - 启用 memory 时将 `proma-memory-bridge.mjs` 加入 `runtimeExtensionPaths`。
    - 将 `PROMA_MEMOS_API_KEY` 合并到 Pi runtime env。
    - 在 `<pi_capability_boundary>` 中新增 `Proma builtin Pi MCP tools`，列出 memory 工具名，方便模型稳定发现。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.86`。
- 当前边界：
  - memory bridge 是 Proma 内置 Pi extension，不写入也不污染工作区 `mcp.json`。
  - 仍需 Memory 设置已启用且配置 API Key；未配置时 Pi 不加载该 extension。
  - Nano Banana 内置生图 MCP 尚未接入 Pi bridge，可作为下一阶段补齐内置工具 parity。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/pi-memory-extension.test.ts`：2 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts --test-name-pattern "enabled memory"`：1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/adapters/pi-memory-extension.test.ts apps/electron/src/main/lib/adapters/pi-permission-mapping.test.ts apps/electron/src/main/lib/adapters/pi-mcp-extension.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts --timeout 30000`：51 pass / 0 fail。

## 2026-06-02 Phase J51 Pi 内置 Nano Banana MCP bridge

- 背景：
  - J50 已把 Proma 内置 memory 工具作为 Pi native extension 注入。
  - Claude SDK 路径还会通过 `createSdkMcpServer()` 注入内置 Nano Banana 生图工具，但 Pi runtime 之前无法使用该 Proma 内置能力。
  - 这会让用户切到 Pi 后丢失同一套 Agent 工作台里的生图/修图场景。
- 实现：
  - 新增 `adapters/pi-nano-banana-extension.ts`：
    - 当 Chat 工具配置中的 `nano-banana` 已启用且存在 API Key 时，生成 session 级 `proma-nano-banana-bridge.mjs`。
    - 注册 Pi 原生工具：
      - `mcp__nano_banana__generate_image`
    - 工具支持文生图、参考图路径、多轮上下文、aspect ratio、image size 等参数。
    - Gemini 响应中的 image content 会作为 Pi tool result 的 MCP image block 返回，便于 Proma UI 展示。
    - 同时把生成图片保存到当前 Agent session cwd 的 `generated-images/` 目录，方便 Agent 后续继续引用。
    - 向 `globalThis.__PROMA_PI_MCP_TOOL_RISK_HINTS__` 发布风险提示：`generate_image` 为 `write`，因为会创建文件。
  - 凭据处理：
    - extension 文件不序列化 Nano Banana API Key。
    - 主进程只通过 Pi runtime env 注入 `PROMA_NANO_BANANA_API_KEY`。
    - baseUrl/model 会写入 extension 源码，但不含 secret。
  - `AgentOrchestrator.runPiSession()`：
    - 启用 Nano Banana 时将 `proma-nano-banana-bridge.mjs` 加入 `runtimeExtensionPaths`。
    - 将 `PROMA_NANO_BANANA_API_KEY` 合并到 Pi runtime env。
    - 在 `<pi_capability_boundary>` 的 `Proma builtin Pi MCP tools` 中列出 `mcp__nano_banana__generate_image`，方便模型稳定发现。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.87`。
- 当前边界：
  - 该 bridge 复用 Chat 工具配置中的 Nano Banana 开关和凭据，不写入也不污染工作区 `mcp.json`。
  - Pi extension 自包含 Gemini 调用逻辑，避免 Pi 子进程 import 主进程服务导致打包路径不稳定。
  - 相比 Claude SDK MCP server，Pi bridge 当前只保存到工作目录并返回 MCP image block；暂未调用 Proma `saveAttachment()` 写入全局附件索引。
  - 需要用户已在工具设置中启用 Nano Banana 且配置 API Key；未配置时 Pi 不加载该 extension。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/pi-nano-banana-extension.test.ts`：3 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts --test-name-pattern "enabled nano banana"`：1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/adapters/pi-nano-banana-extension.test.ts apps/electron/src/main/lib/adapters/pi-memory-extension.test.ts apps/electron/src/main/lib/adapters/pi-mcp-extension.test.ts apps/electron/src/main/lib/adapters/pi-permission-mapping.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts --timeout 30000`：55 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-session-manager.test.ts apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts apps/electron/src/main/lib/adapters/pi-process.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts apps/electron/src/main/lib/adapters/pi-git-checkpoint-extension.test.ts apps/electron/src/main/lib/adapters/pi-permission-mapping.test.ts apps/electron/src/main/lib/adapters/pi-mcp-extension.test.ts apps/electron/src/main/lib/adapters/pi-memory-extension.test.ts apps/electron/src/main/lib/adapters/pi-nano-banana-extension.test.ts --timeout 30000`：126 pass / 0 fail。
  - `bun run typecheck`：通过。
  - `bun run electron:build`：通过，仅既有 Vite chunk-size warning。

## 2026-06-03 Phase J52 Pi Task 工具可见进度 bridge

- 背景：
  - Proma 系统提示词已经要求多步骤、长耗时任务使用 `TaskCreate` / `TaskUpdate` 展示可见进度。
  - Renderer 已有 `TaskCreate` / `TaskUpdate` / `TaskGet` / `TaskList` 的聚合和专用渲染器。
  - Claude SDK 路径可通过原生 Task 工具形成进度卡片；Pi runtime 之前没有同名工具，复杂任务可见性弱于 Claude SDK。
- 实现：
  - 新增 `adapters/pi-task-extension.ts`：
    - 每个 Pi 会话生成 `proma-task-bridge.mjs`。
    - 注册 Pi 原生工具：
      - `TaskCreate`
      - `TaskUpdate`
      - `TaskGet`
      - `TaskList`
    - 工具名与 Claude SDK 保持一致，复用现有 renderer 的任务聚合和结果渲染逻辑，无需改 UI。
    - 任务状态存储在 Pi extension 进程内存中，服务于当前 Pi 会话的可见进度。
    - `TaskCreate` / `TaskUpdate` / `TaskGet` 返回 `{ task }` JSON 文本，`TaskList` 返回 `{ tasks }` JSON 文本，匹配现有解析器。
  - 权限处理：
    - `mapPiToolPermission()` 新增 `TaskCreate` / `TaskUpdate` / `TaskGet` / `TaskList` / `TodoWrite` 进度工具白名单。
    - `proma-permission-bridge.mjs` 源码同步加入 `progressTools`，真实 Pi 会话调用这些进度工具时不会触发权限确认。
  - `AgentOrchestrator.runPiSession()`：
    - 默认把 `proma-task-bridge.mjs` 加入 `runtimeExtensionPaths`。
    - 在 `<pi_capability_boundary>` 的 `Proma builtin Pi MCP tools` 中列出四个 Task 工具，方便模型稳定发现。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.88`。
- 当前边界：
  - 这是 Pi 会话内的可见进度 bridge，不是跨会话持久化任务系统。
  - 任务状态当前不写入 `~/.proma/`，停止/重启 Pi 会话后由历史消息中的 tool_use/tool_result 负责 UI 回放。
  - 这不等同于 Claude SDK 的后台 Task/SubAgent 运行语义；它先补齐多步骤工作流的可见进度工具 parity。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/pi-task-extension.test.ts`：1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/adapters/pi-permission-mapping.test.ts --test-name-pattern "Proma task tool"`：1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts --test-name-pattern "task extension"`：1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/adapters/pi-permission-mapping.test.ts --test-name-pattern "task tools are allowed"`：1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts --timeout 30000`：18 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-session-manager.test.ts apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts apps/electron/src/main/lib/adapters/pi-process.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts apps/electron/src/main/lib/adapters/pi-git-checkpoint-extension.test.ts apps/electron/src/main/lib/adapters/pi-permission-mapping.test.ts apps/electron/src/main/lib/adapters/pi-mcp-extension.test.ts apps/electron/src/main/lib/adapters/pi-memory-extension.test.ts apps/electron/src/main/lib/adapters/pi-nano-banana-extension.test.ts apps/electron/src/main/lib/adapters/pi-task-extension.test.ts --timeout 30000`：130 pass / 0 fail。
  - `bun run typecheck`：通过。
  - `bun run electron:build`：通过，仅既有 Vite chunk-size warning。

## 2026-06-03 Phase J53 Pi 队列更新可见性

- 背景：
  - Proma UI 已有 `tool_use_summary` 事件展示路径，可用于呈现工具或运行时状态摘要。
  - Pi runtime 会在追加/排队消息时发出 `queue_update`，其中包含 `steering` 与 `followUp` 队列。
  - J53 前适配器把 `queue_update` 当作已知 lifecycle 事件静默跳过，用户在运行中追加消息时缺少明确反馈。
- 实现：
  - `PiAgentAdapter` 新增 `createPiQueueSummaryMessage()`：
    - 当 `queue_update` 非空时生成 transient SDK-shaped `tool_use_summary`。
    - 摘要格式包含队列计数：`Pi 队列已更新：steering: N, follow-up: M`。
    - 额外附带最多数条消息预览，便于确认追加内容已进入 Pi runtime。
    - 标记 `_promaTransient: true` 与 `_promaPiQueueSummary: true`，避免把它误认为真实模型输出。
  - 空队列 `queue_update` 继续静默处理，避免 UI 噪音。
  - 新增回归测试覆盖非空 `queue_update` 会产出可见 summary，且最终 result 仍正常结束。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.89`。
- 当前边界：
  - 这是 Pi 队列状态的可见性增强，不是完整后台任务输出 retrieval。
  - 追加消息仍依赖 Pi runtime 的 `steer` / queue 语义；Proma 侧现在能展示“已进入队列”，但不主动拉取后台任务日志。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts --test-name-pattern "queue update" --timeout 30000`：1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts --timeout 30000`：26 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-session-manager.test.ts apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts apps/electron/src/main/lib/adapters/pi-process.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts apps/electron/src/main/lib/adapters/pi-git-checkpoint-extension.test.ts apps/electron/src/main/lib/adapters/pi-permission-mapping.test.ts apps/electron/src/main/lib/adapters/pi-mcp-extension.test.ts apps/electron/src/main/lib/adapters/pi-memory-extension.test.ts apps/electron/src/main/lib/adapters/pi-nano-banana-extension.test.ts apps/electron/src/main/lib/adapters/pi-task-extension.test.ts --timeout 30000`：131 pass / 0 fail。

## 2026-06-03 Phase J54 GET_TASK_OUTPUT 历史任务输出恢复

- 背景：
  - `AGENT_IPC_CHANNELS.GET_TASK_OUTPUT` 已经暴露到 preload / renderer，但主进程此前固定返回空输出。
  - J52 后 Pi 已有 `TaskCreate` / `TaskUpdate` / `TaskGet` / `TaskList` 可见进度 bridge，任务工具结果会作为 SDKMessage 持久化到 Proma JSONL。
  - 固定空返回会让后续后台任务/任务输出 UI 误以为有接口但拿不到任何历史结果。
- 实现：
  - `agent-session-manager.ts` 新增 `getAgentTaskOutput(input)`：
    - 扫描 Proma 已持久化的 Agent 会话 SDKMessage 历史。
    - 建立 `tool_use.id → tool name/input` 映射。
    - 从后续 `tool_result` 中提取结构化 `toolUseResult` 或 text block 内容。
    - 支持通过 `TaskCreate` 返回的 `{ task: { id } }`、`TaskUpdate/TaskGet` input 中的 `taskId`、以及结果中的 task id 匹配目标任务。
    - 最近匹配结果优先；`completed/cancelled/deleted/error/failed/stopped` 等终态会返回 `isComplete: true`。
  - `ipc.ts` 的 `GET_TASK_OUTPUT` 不再固定空返回，改为委托 `getAgentTaskOutput()`。
  - 新增 BDD 回归测试：
    - 先写入 TaskCreate 与 TaskUpdate 的持久化 SDKMessage。
    - 请求 `task-pi-1` 输出。
    - 验证返回最新 completed 结果和 `isComplete: true`。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.90`。
- 当前边界：
  - 这是只读历史输出恢复，不是 Claude SDK / Pi runtime 的实时后台任务控制。
  - 对 Pi 而言，它依赖 Proma 已经持久化过 Task bridge 的 tool_use/tool_result；运行时内存任务状态不会被单独拉取。
  - J55 已将 `STOP_TASK` 接到 Claude SDK `query.stopTask(taskId)`；Pi 与 Shell 的任务停止仍需要后续按 runtime 能力继续补齐或明确 UI 降级。
- 已运行：
  - `bun test apps/electron/src/main/lib/agent-session-manager.test.ts --test-name-pattern "task output" --timeout 30000`：红灯确认 `getAgentTaskOutput is not a function`，实现后 1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-session-manager.test.ts --timeout 30000`：30 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-session-manager.test.ts apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts apps/electron/src/main/lib/adapters/pi-process.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts apps/electron/src/main/lib/adapters/pi-git-checkpoint-extension.test.ts apps/electron/src/main/lib/adapters/pi-permission-mapping.test.ts apps/electron/src/main/lib/adapters/pi-mcp-extension.test.ts apps/electron/src/main/lib/adapters/pi-memory-extension.test.ts apps/electron/src/main/lib/adapters/pi-nano-banana-extension.test.ts apps/electron/src/main/lib/adapters/pi-task-extension.test.ts --timeout 30000`：132 pass / 0 fail。
  - `bun run typecheck`：通过。
  - `bun run electron:build`：通过，仅既有 Vite chunk-size warning。

## 2026-06-03 Phase J55 Claude SDK STOP_TASK 真实停止路径

- 背景：
  - Renderer / preload / IPC 已经暴露 `AGENT_IPC_CHANNELS.STOP_TASK`，但主进程此前只打印占位 warning。
  - Claude Agent SDK 的 `Query` 类型已经提供 `stopTask(taskId): Promise<void>`，并会在停止后通过 `task_notification` 推送 stopped 状态。
  - Proma renderer 已有 `task_notification` 监听与 UI 更新路径，因此主进程只需要把停止请求路由到活跃 SDK query。
- 实现：
  - `AgentProviderAdapter` 新增可选能力 `stopTask(sessionId, taskId)`。
  - `ClaudeAgentAdapter.stopTask()`：
    - 从 `activeQueries` 查找当前会话的活跃 query。
    - 调用 `query.stopTask(taskId)`。
    - 如果会话没有活跃 query，返回明确中文错误。
  - `AgentOrchestrator.stopTask()`：
    - 先确认 session 仍在运行。
    - 再检查当前 adapter 是否实现 `stopTask`。
    - 对不支持的 runtime 返回明确错误，避免静默假成功。
  - `agent-service.ts` 新增 `stopAgentTask(input)` 并接入 IPC：
    - `type: 'agent'` 走 orchestrator。
    - `type: 'shell'` 暂时明确报错：`Shell 后台任务停止暂未接入 runtime 控制`。
  - `ipc.ts` 的 `STOP_TASK` 从占位 warning 改为调用 `stopAgentTask(input)`。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.91`。
  - `@proma/shared` patch bump 到 `0.1.46`。
- 当前边界：
  - Claude SDK 后台 Task 停止已走真实 SDK 能力。
  - Pi runtime 当前仍没有确认到同等 agent task stop RPC；如果前端对 Pi 会话触发 agent `STOP_TASK`，会得到“当前适配器不支持停止后台任务”的显式错误。
  - J56 已将 Pi Shell 停止接到 Pi RPC `abort_bash`；Claude SDK/Shell 单独停止仍需继续评估 runtime 能力边界。
- 已运行：
  - `bun test apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts --test-name-pattern "stopping background task" --timeout 30000`：1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts --timeout 30000`：19 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-session-manager.test.ts apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts apps/electron/src/main/lib/adapters/pi-process.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts apps/electron/src/main/lib/adapters/pi-git-checkpoint-extension.test.ts apps/electron/src/main/lib/adapters/pi-permission-mapping.test.ts apps/electron/src/main/lib/adapters/pi-mcp-extension.test.ts apps/electron/src/main/lib/adapters/pi-memory-extension.test.ts apps/electron/src/main/lib/adapters/pi-nano-banana-extension.test.ts apps/electron/src/main/lib/adapters/pi-task-extension.test.ts --timeout 30000`：133 pass / 0 fail。
  - `bun run typecheck`：通过。
  - `bun run electron:build`：通过，仅既有 Vite chunk-size warning。

## 2026-06-03 Phase J56 Pi Shell 停止接入 abort_bash

- 背景：
  - J55 已让 Claude SDK 的 agent task stop 走真实 `query.stopTask(taskId)`。
  - Pi RPC 没有发现同等的 `stop_task` / 按 taskId 停止后台 Agent Task 命令，但已暴露 `abort_bash`，可停止当前活跃 Bash。
  - Proma `STOP_TASK` 类型已区分 `agent` / `shell`，因此可以先把 Pi Shell 停止接入 runtime 原生命令，缩小运行中控制体验差距。
- 实现：
  - `AgentProviderAdapter` 新增可选能力 `stopShellTask(sessionId, taskId)`。
  - `PiAgentAdapter.stopShellTask()`：
    - 校验 `taskId` 非空。
    - 通过 `sendRuntimeCommand()` 发送 Pi RPC `{ type: 'abort_bash' }`。
    - 把 `abort_bash` 加入可被 pending response 消费的 runtime command 集合。
  - `AgentOrchestrator.stopShellTask()`：
    - 要求 session 仍在运行。
    - 检查当前 adapter 是否实现 `stopShellTask`。
    - 不支持时返回明确中文错误。
  - `agent-service.ts`：
    - `StopTaskInput.type === 'shell'` 从固定报错改为委托 `orchestrator.stopShellTask()`。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.92`。
  - `@proma/shared` patch bump 到 `0.1.47`。
- 当前边界：
  - Pi RPC `abort_bash` 是停止当前活跃 Bash，不是按 `taskId` 精确停止多个并行 shell task；Proma 仍保留 `taskId` 参数用于统一接口和日志。
  - Pi agent task stop 仍未找到同等 runtime 命令，继续保持显式 unsupported。
  - Claude SDK 的 shell task 单独停止能力尚未确认；J56 只补齐 Pi RPC 明确支持的 Shell 控制能力。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts --test-name-pattern "shell task is stopped" --timeout 30000`：红灯确认 `adapter.stopShellTask is not a function`，实现后 1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts --test-name-pattern "stopping shell task" --timeout 30000`：1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts --timeout 30000`：47 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-session-manager.test.ts apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts apps/electron/src/main/lib/adapters/pi-process.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts apps/electron/src/main/lib/adapters/pi-git-checkpoint-extension.test.ts apps/electron/src/main/lib/adapters/pi-permission-mapping.test.ts apps/electron/src/main/lib/adapters/pi-mcp-extension.test.ts apps/electron/src/main/lib/adapters/pi-memory-extension.test.ts apps/electron/src/main/lib/adapters/pi-nano-banana-extension.test.ts apps/electron/src/main/lib/adapters/pi-task-extension.test.ts --timeout 30000`：135 pass / 0 fail。
  - `bun run typecheck`：通过。
  - `bun run electron:build`：通过，仅既有 Vite chunk-size warning。

## 2026-06-03 Phase J57 Pi /compact 原生压缩路径

- 背景：
  - Proma renderer 已有 `/compact` UX：发送 `/compact` 后进入压缩态，并能消费 `compacting` / `compact_boundary` 系统事件。
  - Claude SDK 路径已有上下文压缩体验；Pi runtime 已在 RPC 层暴露 `compact` 命令，但 J57 前 Pi 会把 `/compact` 当普通用户提示词发送给模型。
  - 这会导致 Pi 模式下压缩语义不稳定，也无法可靠持久化压缩边界。
- 实现：
  - `AgentProviderAdapter` 新增可选能力 `compact(sessionId, customInstructions?)`。
  - `PiAgentAdapter.compact()`：
    - 向 Pi RPC 发送 `{ type: 'compact' }`，请求 id 前缀为 `proma-compact`。
    - 支持可选 `customInstructions`，当前 UI 尚未暴露自定义指令入口。
    - 将 Pi compact response 转换为 Proma 兼容 SDKMessage：
      - `system / compacting`
      - `system / compact_boundary`
    - 映射 `summary`、`firstKeptEntryId`、`tokensBefore` 到 Proma 的压缩边界字段。
  - `AgentOrchestrator.runPiSession()`：
    - 持久化用户 `/compact` 后识别该命令并走 `adapter.compact()`。
    - 向 event bus 推送 `compacting` 与 `compact_boundary`，驱动现有 UI。
    - 只持久化 `compact_boundary`，不持久化瞬态 `compacting`。
    - 不再调用普通 `adapter.query()`，避免模型把 `/compact` 当聊天内容处理。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.93`。
  - `@proma/shared` patch bump 到 `0.1.48`。
- 当前边界：
  - Pi 原生 compact 依赖 Pi runtime 和当前模型认证可用。
  - Proma 侧已预留 `customInstructions` 入参，但 UI 暂未提供自定义压缩指令。
  - 这只补齐当前活跃 Pi 会话的 `/compact` 路径，不改变 fork/rewind/resume 等仍待补齐能力。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts --test-name-pattern "compacting session" --timeout 30000`：红灯确认 `adapter.compact is not a function`，实现后 1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts --test-name-pattern "compact command" --timeout 30000`：红灯确认普通 `query` 被调用，实现后 1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts --timeout 30000`：49 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-session-manager.test.ts apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts apps/electron/src/main/lib/adapters/pi-process.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts apps/electron/src/main/lib/adapters/pi-git-checkpoint-extension.test.ts apps/electron/src/main/lib/adapters/pi-permission-mapping.test.ts apps/electron/src/main/lib/adapters/pi-mcp-extension.test.ts apps/electron/src/main/lib/adapters/pi-memory-extension.test.ts apps/electron/src/main/lib/adapters/pi-nano-banana-extension.test.ts apps/electron/src/main/lib/adapters/pi-task-extension.test.ts --timeout 30000`：137 pass / 0 fail。
  - `bun run typecheck`：通过。
  - `bun run electron:build`：通过，仅既有 Vite chunk-size warning。

## 2026-06-03 Phase J58 Pi thinking level 同步

- 背景：
  - Proma Agent 输入区已有思考模式开关，Claude SDK 路径会把 `agentThinking` / `agentEffort` 传给 SDK `query()`。
  - Pi RPC 已暴露 `set_thinking_level`，但 J58 前 Pi 会话没有从 Proma 设置同步 thinking level。
  - 这会导致同一 UI 设置下，Pi 与 Claude SDK 的推理深度体验不一致。
- 实现：
  - `AgentQueryInput` 新增 `runtimeThinkingLevel?: string`。
  - `AgentProviderAdapter` 新增可选能力 `setThinkingLevel(sessionId, level)`。
  - `PiAgentAdapter`：
    - 将 `set_thinking_level` 加入 runtime command response 集合。
    - 新增 `setThinkingLevel()`，发送 Pi RPC `{ type: 'set_thinking_level', level }`。
    - 校验 Pi 支持的 level：`off` / `minimal` / `low` / `medium` / `high` / `xhigh`。
    - `query()` 启动 Pi RPC 后，如果输入带 `runtimeThinkingLevel`，先非阻塞发送 thinking 命令，再发送 prompt，避免在事件流消费前等待 response 导致死锁。
  - `AgentOrchestrator.runPiSession()`：
    - 读取 `getSettings()`。
    - 将 Proma `agentThinking` / `agentEffort` 映射为 Pi level：
      - `disabled` -> `off`
      - `adaptive + low|medium|high` -> `low|medium|high`
      - `adaptive + max` -> `xhigh`
      - `enabled` -> `high`
    - 通过 `runtimeThinkingLevel` 传给 Pi adapter。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.94`。
  - `@proma/shared` patch bump 到 `0.1.49`。
- 当前边界：
  - Proma UI 当前主要是 adaptive / disabled 开关；`enabled(budgetTokens)` 在 Pi 中没有等价 token budget，先保守映射为 `high`。
  - 初始 thinking 同步失败时会打印中文 warning 并继续发送 prompt，避免因为个别模型不支持 thinking 导致整个 Pi 会话不可用。
  - 运行中动态切换 thinking 的 UI/IPC 尚未接入；J58 只补齐新 turn 启动时的设置同步。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts --test-name-pattern "thinking level" --timeout 30000`：红灯确认等待 response 会超时，实现非阻塞同步后 1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts --test-name-pattern "adaptive thinking enabled" --timeout 30000`：红灯确认未传 runtime thinking level，实现后 1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts --timeout 30000`：51 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-session-manager.test.ts apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts apps/electron/src/main/lib/adapters/pi-process.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts apps/electron/src/main/lib/adapters/pi-git-checkpoint-extension.test.ts apps/electron/src/main/lib/adapters/pi-permission-mapping.test.ts apps/electron/src/main/lib/adapters/pi-mcp-extension.test.ts apps/electron/src/main/lib/adapters/pi-memory-extension.test.ts apps/electron/src/main/lib/adapters/pi-nano-banana-extension.test.ts apps/electron/src/main/lib/adapters/pi-task-extension.test.ts --timeout 30000`：139 pass / 0 fail。
  - `bun run typecheck`：通过。
  - `bun run electron:build`：通过，仅既有 Vite chunk-size warning。

## 2026-06-03 Phase J59 Pi runtime get_state diagnostics

- 背景：
  - Pi RPC 原生暴露 `get_state`，可返回当前模型、thinking level、streaming/compacting 状态、队列模式、原生 session 文件、消息数量等。
  - Proma J58 已能把 Proma thinking 设置同步到 Pi，但缺少反向查询 runtime 当前状态的统一接口。
  - 这会限制后续 UI runtime proof、调试面板、队列/压缩状态判断和 Pi 能力边界展示。
- 实现：
  - `AgentProviderAdapter` 新增可选能力 `getRuntimeState(sessionId)`。
  - `AgentQueryInput` 保持 J58 的 `runtimeThinkingLevel`；J59 新增共享状态结构：
    - `AgentRuntimeState`
    - `GetRuntimeStateInput`
    - `AgentRuntimeStateResult`
  - `PiAgentAdapter`：
    - 将 `get_state` 加入 runtime command response 集合。
    - 新增 `getRuntimeState()`，发送 Pi RPC `{ type: 'get_state' }`。
    - 将 Pi `RpcSessionState` 规范化为 Proma 字段：`provider`、`modelId`、`modelName`、`thinkingLevel`、`isStreaming`、`isCompacting`、`steeringMode`、`followUpMode`、`nativeSessionId`、`nativeSessionName`、`nativeSessionFile`、`autoCompactionEnabled`、`messageCount`、`pendingMessageCount`。
  - `AgentOrchestrator`：
    - 新增 `getActiveRuntimeState(sessionId)`，委托 adapter 获取活跃 runtime 状态。
  - `agent-service.ts` / `ipc.ts` / `preload/index.ts`：
    - 新增 `getAgentRuntimeState(input)`。
    - 新增 IPC 通道 `agent:get-runtime-state`。
    - Renderer 侧 `window.electronAPI.getRuntimeState(input)` 可直接读取活跃 runtime 状态。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.95`。
  - `@proma/shared` patch bump 到 `0.1.50`。
- 当前边界：
  - 该接口要求会话有活跃 runtime；非运行中会话会沿用现有 orchestrator/adapter 错误路径。
  - Claude SDK 当前没有等价 `get_state`，因此该能力是可选 Provider 能力，主要服务 Pi diagnostics。
  - J59 只提供主进程到 renderer 的数据接口，暂未新增可视化 UI。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts --test-name-pattern "runtime state" --timeout 30000`：红灯确认 `adapter.getRuntimeState is not a function`，实现后 1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts --test-name-pattern "runtime state" --timeout 30000`：红灯确认 `orchestrator.getActiveRuntimeState is not a function`，实现后 1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts --timeout 30000`：53 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-session-manager.test.ts apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts apps/electron/src/main/lib/adapters/pi-process.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts apps/electron/src/main/lib/adapters/pi-git-checkpoint-extension.test.ts apps/electron/src/main/lib/adapters/pi-permission-mapping.test.ts apps/electron/src/main/lib/adapters/pi-mcp-extension.test.ts apps/electron/src/main/lib/adapters/pi-memory-extension.test.ts apps/electron/src/main/lib/adapters/pi-nano-banana-extension.test.ts apps/electron/src/main/lib/adapters/pi-task-extension.test.ts --timeout 30000`：141 pass / 0 fail。
  - `bun run typecheck`：通过。
  - `bun run electron:build`：通过，仅既有 Vite chunk-size warning。

## 2026-06-03 Phase J60 Pi session stats runtime diagnostics

- 背景：
  - J59 已将 Pi RPC `get_state` 暴露为 Proma 可查询的活跃 runtime 状态。
  - Pi RPC 同时提供 `get_session_stats`，能返回当前原生会话的消息数量、工具调用数量、token、费用和上下文占用。
  - 这些数据是后续运行态证明、调试面板、自动压缩提示和 Pi / Claude SDK 行为差异排查的基础。
- 实现：
  - `AgentRuntimeState` 新增可选 `stats` 字段。
  - `AgentRuntimeSessionStats` 统一表达 Pi `SessionStats` 的可展示字段：
    - `userMessages` / `assistantMessages`
    - `toolCalls` / `toolResults`
    - `totalMessages`
    - `tokens.input` / `tokens.output` / `tokens.cacheRead` / `tokens.cacheWrite` / `tokens.total`
    - `costUsd`
    - `contextUsage.tokens` / `contextUsage.maxTokens` / `contextUsage.percent`
  - `PiAgentAdapter.getRuntimeState()`：
    - 先发送 `{ type: 'get_state' }`。
    - 再发送 `{ type: 'get_session_stats' }`。
    - 合并为单个 Proma runtime diagnostics 结果返回 renderer IPC 边界。
  - 测试补齐 adapter 与 orchestrator 两层断言，确保 runtime state route 会透传 `stats`。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.96`。
  - `@proma/shared` patch bump 到 `0.1.51`。
- 当前边界：
  - 该统计仍依赖活跃 Pi runtime；已结束会话不会通过该接口读取历史 JSONL。
  - Claude SDK 路径没有等价原生命令，`stats` 仍是 provider optional diagnostics，不作为统一 Agent 能力强制要求。
  - J60 只扩展 IPC 数据结构与主进程 adapter，暂未新增 UI 展示。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts --test-name-pattern "runtime state" --timeout 30000`：通过，runtime state 测试覆盖 `get_state` + `get_session_stats`。
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts --timeout 30000`：53 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-session-manager.test.ts apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts apps/electron/src/main/lib/adapters/pi-process.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts apps/electron/src/main/lib/adapters/pi-git-checkpoint-extension.test.ts apps/electron/src/main/lib/adapters/pi-permission-mapping.test.ts apps/electron/src/main/lib/adapters/pi-mcp-extension.test.ts apps/electron/src/main/lib/adapters/pi-memory-extension.test.ts apps/electron/src/main/lib/adapters/pi-nano-banana-extension.test.ts apps/electron/src/main/lib/adapters/pi-task-extension.test.ts --timeout 30000`：141 pass / 0 fail。
  - `bun run typecheck`：通过。
  - `bun run electron:build`：通过，仅既有 Vite chunk-size warning。

## 2026-06-03 Phase J61 Pi runtime command diagnostics

- 背景：
  - J59/J60 已能读取 Pi runtime state 与 session stats，但还不能证明当前 Pi runtime 实际加载了哪些 extension、prompt 和 skill。
  - Pi RPC 原生 `get_commands` 会汇总 extension commands、prompt templates 和 skills。
  - 这可以支撑后续 UI 展示"当前确实是 Pi runtime 且加载了哪些能力"，也能帮助排查 Skill / MCP 是否进入 Pi 原生命令边界。
- 实现：
  - `AgentRuntimeState` 新增可选 `commands` 字段。
  - 新增 `AgentRuntimeCommand` 结构：
    - `name`
    - `description`
    - `source`: `extension` / `prompt` / `skill` / `unknown`
    - `sourceInfo`
  - `PiAgentAdapter.getRuntimeState()` 在 `get_state` 与 `get_session_stats` 后继续发送 `{ type: 'get_commands' }`。
  - Adapter 会过滤空名称命令，并规范化未知 source 为 `unknown`。
  - Orchestrator runtime state 路由测试覆盖 `commands` 透传，避免上层字段收窄。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.97`。
  - `@proma/shared` patch bump 到 `0.1.52`。
- 当前边界：
  - 该能力仍要求 Pi runtime 活跃；目前不会读取已结束会话的历史命令快照。
  - J61 只提供诊断数据，不新增 renderer UI。
  - Claude SDK 没有同名 RPC，但 Proma 可把该字段作为 provider optional diagnostics 使用。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts --test-name-pattern "runtime state" --timeout 30000`：红灯确认未发送 `get_commands`，实现后 1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts --timeout 30000`：53 pass / 0 fail。

## 2026-06-03 Phase J62 Pi auto compaction runtime sync

- 背景：
  - Pi RPC 原生支持 `set_auto_compaction`，可在上下文接近阈值时由 runtime 自动压缩。
  - Proma J57 已支持手动 `/compact` 路由到 Pi 原生 `compact`，但新 turn 启动时没有同步自动压缩策略。
  - 为了让 Pi 的上下文管理体验更接近 Claude SDK，先在 Pi runtime 查询启动阶段默认启用自动压缩。
- 实现：
  - `AgentQueryInput` 新增 `runtimeAutoCompactionEnabled?: boolean`。
  - `AgentProviderAdapter` 新增可选能力 `setAutoCompaction(sessionId, enabled)`。
  - `PiAgentAdapter`：
    - 将 `set_auto_compaction` 加入 runtime command response 集合。
    - 新增 `setAutoCompaction()`，发送 Pi RPC `{ type: 'set_auto_compaction', enabled }`。
    - `query()` 启动后、prompt 发送前，如果输入带 `runtimeAutoCompactionEnabled`，非阻塞发送自动压缩设置，避免等待 response 导致事件流死锁。
  - `AgentOrchestrator.runPiSession()`：
    - 对 Pi runtime query 传入 `runtimeAutoCompactionEnabled: true`。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.98`。
  - `@proma/shared` patch bump 到 `0.1.53`。
- 当前边界：
  - J62 先采用 Pi runtime 默认启用策略，暂未新增 UI 设置开关。
  - 如果 Pi runtime 不支持或同步失败，会打印中文 warning 并继续发送 prompt，避免影响主对话。
  - `getRuntimeState()` 已可通过 `autoCompactionEnabled` 反查当前 runtime 状态。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts --test-name-pattern "auto compaction" --timeout 30000`：红灯确认未发送 `set_auto_compaction`，实现后 1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts --test-name-pattern "auto compaction" --timeout 30000`：红灯确认未传 `runtimeAutoCompactionEnabled`，实现后 1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts --timeout 30000`：55 pass / 0 fail。

## 2026-06-03 Phase J63 Pi auto retry runtime sync

- 背景：
  - Pi RPC 原生支持 `set_auto_retry` 与 `abort_retry`，可把 provider / runtime 失败后的自动重试交给 Pi runtime。
  - Proma Claude SDK 路径已有错误重试事件与 UI 状态；Pi 路径此前只靠 Proma 外层最小循环，没有暴露 Pi 原生 retry 控制。
  - J63 先补齐 runtime 能力边界：默认启用 Pi auto retry，并提供 abort retry adapter 能力，后续可接入 UI 的"取消重试"操作。
- 实现：
  - `AgentQueryInput` 新增 `runtimeAutoRetryEnabled?: boolean`。
  - `AgentProviderAdapter` 新增可选能力：
    - `setAutoRetry(sessionId, enabled)`
    - `abortRetry(sessionId)`
  - `PiAgentAdapter`：
    - 将 `set_auto_retry` / `abort_retry` 加入 runtime command response 集合。
    - 新增 `setAutoRetry()` 与 `abortRetry()`。
    - `query()` 启动后、prompt 发送前，如果输入带 `runtimeAutoRetryEnabled`，非阻塞发送自动重试设置。
  - `AgentOrchestrator.runPiSession()`：
    - 对 Pi runtime query 传入 `runtimeAutoRetryEnabled: true`。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.99`。
  - `@proma/shared` patch bump 到 `0.1.54`。
- 当前边界：
  - J63 暂未新增 renderer IPC / UI 来触发 `abortRetry()`。
  - Pi runtime 的 auto retry 生命周期事件目前仍只作为已知 lifecycle event 跳过；后续可转换为 Proma `retry` stream event，复用现有 RetryingNotice。
  - 如果 Pi runtime 不支持或同步失败，会打印中文 warning 并继续发送 prompt。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts --test-name-pattern "auto retry" --timeout 30000`：红灯确认未发送 `set_auto_retry`，实现后 1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts --test-name-pattern "retry is aborted" --timeout 30000`：红灯确认 `abortRetry is not a function`，实现后 1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts --test-name-pattern "auto retry" --timeout 30000`：红灯确认未传 `runtimeAutoRetryEnabled`，实现后 1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts --timeout 30000`：58 pass / 0 fail。

## 2026-06-03 Phase J64 Pi auto retry lifecycle stream bridge

- 背景：
  - J63 已默认启用 Pi runtime auto retry，但 Pi 原生 `auto_retry_start` / `auto_retry_end` 生命周期事件仍只被 adapter 识别后跳过。
  - Proma Claude SDK 路径已有统一 `retry` stream event，renderer 全局监听会转换成 `retrying` / `retry_attempt` / `retry_cleared` / `retry_failed` 状态。
  - J64 将 Pi retry lifecycle 接入同一条 Proma 事件流，复用现有重试 UI，不新增 renderer 专属分支。
- 实现：
  - `PiAgentAdapter`：
    - `auto_retry_start` 转为两个瞬态 `_promaEvent`：
      - `retry starting`，包含 `attempt` / `maxAttempts` / `delaySeconds` / `reason`。
      - `retry attempt`，包含 `RetryAttempt` 详情。
    - `auto_retry_end success=true` 转为 `retry cleared`。
    - `auto_retry_end success=false` 转为 `retry failed`，包含最终失败 attempt。
    - 这些消息使用 `_promaTransient: true` 与 `subtype: "pi_runtime_event"`，不代表真实 assistant/result 输出。
  - `AgentOrchestrator.runPiSession()`：
    - 在 Pi adapter 消息进入普通 SDK emit / persistence 之前识别瞬态 `_promaEvent`。
    - 转发为 `{ kind: "proma_event", event }`，并跳过 SDK 消息发送与 JSONL 持久化。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.100`。
- 当前边界：
  - J64 只桥接 runtime 生命周期事件，不新增"取消重试"按钮；`abortRetry()` adapter 能力仍等待 renderer IPC/UI 接入。
  - `_promaEvent` 是 Proma 内部瞬态字段，没有扩展 shared `SDKMessage` 公共结构。
  - Pi runtime 若未实际发出 auto retry 生命周期事件，UI 不会显示重试状态。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts --test-name-pattern "auto retry lifecycle" --timeout 30000`：红灯确认未产出 retry event，实现后 1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts --test-name-pattern "Proma retry events" --timeout 30000`：红灯确认未转发 `proma_event`，实现后 1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts --test-name-pattern "auto retry" --timeout 30000`：3 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-session-manager.test.ts apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts apps/electron/src/main/lib/adapters/pi-process.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts apps/electron/src/main/lib/adapters/pi-git-checkpoint-extension.test.ts apps/electron/src/main/lib/adapters/pi-permission-mapping.test.ts apps/electron/src/main/lib/adapters/pi-mcp-extension.test.ts apps/electron/src/main/lib/adapters/pi-memory-extension.test.ts apps/electron/src/main/lib/adapters/pi-nano-banana-extension.test.ts apps/electron/src/main/lib/adapters/pi-task-extension.test.ts --timeout 30000`：149 pass / 0 fail。
  - `bun run typecheck`：4 个 workspace 包 typecheck 均 exit 0。
  - `bun run electron:build`：Electron build exit 0；保留既有 Vite large chunk warning。
  - `git diff --check`：无 whitespace 问题。

## 2026-06-03 Phase J65 Pi auto retry abort IPC/UI

- 背景：
  - Pi interactive mode 在自动重试倒计时时支持通过 Escape 取消 retry。
  - Proma J64 已能显示 Pi runtime retry lifecycle，但用户还不能只取消 retry，只能停止整个 Agent。
  - J65 补齐"状态可见后可控制"这层能力，让 Pi 自动重试体验更接近原生 runtime。
- 实现：
  - `@proma/shared`：
    - 新增 `AbortRuntimeRetryInput`。
    - 新增 `AGENT_IPC_CHANNELS.ABORT_RUNTIME_RETRY = "agent:abort-runtime-retry"`。
  - `AgentOrchestrator`：
    - 新增 `abortRuntimeRetry(sessionId)`，要求会话活跃且 adapter 支持 `abortRetry()`。
    - 不支持的 runtime 会抛出明确中文错误，不做 silent no-op。
  - `agent-service.ts` / `ipc.ts` / `preload/index.ts`：
    - 暴露 `abortAgentRuntimeRetry()` 与 `window.electronAPI.abortRuntimeRetry(input)`。
  - `AgentMessages.RetryingNotice`：
    - 非失败重试状态显示一个停止图标按钮。
    - 点击后调用新 IPC；UI 状态仍等待 runtime 后续 `auto_retry_end` / `retry_failed` 事件更新。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.101`。
  - `@proma/shared` patch bump 到 `0.1.55`。
- 当前边界：
  - Claude SDK 路径没有等价 runtime retry abort 能力；调用会明确报错。
  - Pi `get_state` 当前未暴露 `isRetrying` / `autoRetryEnabled`，J65 不修改 Pi runtime state 解析。
- 已运行：
  - `bun test apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts --test-name-pattern "aborting runtime retry" --timeout 30000`：红灯确认方法缺失，实现后 1 pass / 0 fail。
  - `bun run --filter='@proma/electron' typecheck`：exit 0。
  - `bun run --filter='@proma/shared' typecheck`：exit 0。
  - `bun test apps/electron/src/main/lib/agent-session-manager.test.ts apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts apps/electron/src/main/lib/adapters/pi-process.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts apps/electron/src/main/lib/adapters/pi-git-checkpoint-extension.test.ts apps/electron/src/main/lib/adapters/pi-permission-mapping.test.ts apps/electron/src/main/lib/adapters/pi-mcp-extension.test.ts apps/electron/src/main/lib/adapters/pi-memory-extension.test.ts apps/electron/src/main/lib/adapters/pi-nano-banana-extension.test.ts apps/electron/src/main/lib/adapters/pi-task-extension.test.ts --timeout 30000`：150 pass / 0 fail。
  - `bun run typecheck`：4 个 workspace 包 typecheck 均 exit 0。
  - `bun run electron:build`：Electron build exit 0；保留既有 Vite large chunk warning。
  - `git diff --check`：无 whitespace 问题。

## 2026-06-03 Phase J66 Pi compaction lifecycle stream bridge

- 背景：
  - Pi RPC 原生会在手动/自动上下文压缩时发出 `compaction_start` / `compaction_end`。
  - Proma Claude SDK 路径已有 `compacting` / `compact_complete` UI 状态，以及持久化 `compact_boundary` 历史分界线。
  - J66 将 Pi compaction lifecycle 接入同一条 Proma 状态流，避免 Pi 自动压缩时 UI 静默无状态、刷新后缺少压缩分界。
- 实现：
  - `@proma/shared`：
    - `PromaEvent` 新增 `{ type: "compaction", status: "starting" | "cleared", reason?: string }`。
  - `PiAgentAdapter`：
    - `compaction_start` 转为瞬态 `_promaEvent`：`compaction starting`。
    - `compaction_end` 转为瞬态 `_promaEvent`：`compaction cleared`。
    - `compaction_end` 若未 aborted 且包含 `result`，额外产出 `system:compact_boundary`，复用已有历史渲染。
  - `AgentOrchestrator.runPiSession()`：
    - 已有 `_promaEvent` 转发链路复用到 compaction。
    - Pi 专属主循环现在也会累积 `system:compact_boundary` / `permission_denied`，与 Claude 通用分支持久化规则一致。
  - Renderer：
    - `payloadToLegacyEvents()` 导出并测试。
    - Proma compaction event 映射为现有 `compacting` / `compact_complete`，复用 `CompactingIndicator`。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.102`。
  - `@proma/shared` patch bump 到 `0.1.56`。
- 当前边界：
  - J66 不新增独立 Pi compaction UI；只复用已有压缩状态和历史分界线。
  - 如果 Pi `compaction_end` 没有 `result` 或 `aborted=true`，只清理 UI 压缩状态，不写入假的 `compact_boundary`。
  - Pi runtime state 的 `isCompacting` 仍来自 `get_state` 查询；流式 UI 状态由 lifecycle event 即时驱动。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts -t "Given Pi compaction lifecycle events"`：红灯确认未产出 compaction event，实现后 1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts -t "Given pi adapter emits Proma compaction events"`：红灯确认 Pi 分支未持久化 `compact_boundary`，实现后 1 pass / 0 fail。
  - `bun test apps/electron/src/renderer/hooks/useGlobalAgentListeners.test.ts`：1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/adapters/pi-process.test.ts apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts apps/electron/src/main/lib/adapters/pi-event-converter.test.ts apps/electron/src/main/lib/adapters/pi-permission-mapping.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts apps/electron/src/renderer/hooks/useGlobalAgentListeners.test.ts`：100 pass / 0 fail。

## 2026-06-03 Phase J67 Pi retry runtime state diagnostics

- 背景：
  - Pi upstream `AgentSession` 有 `isRetrying` / `autoRetryEnabled` getter，但当前 `@earendil-works/pi-coding-agent@0.76.0` RPC `get_state` 尚未返回这两个字段。
  - Proma 已能同步 Pi auto retry 并桥接 retry lifecycle；runtime diagnostics 仍缺少 retry 开关与进行中状态。
  - J67 不修改 `node_modules`，而是在 Proma adapter 侧用已发送命令和 lifecycle event 派生诊断字段。
- 实现：
  - `@proma/shared`：
    - `AgentRuntimeState` / `AgentRuntimeStateResult` 新增 `autoRetryEnabled?: boolean` 与 `isRetrying?: boolean`。
  - `PiAgentAdapter`：
    - 新增 session 级 derived retry state。
    - `setAutoRetry()` 成功后记录 `autoRetryEnabled`。
    - `auto_retry_start` 记录 `isRetrying: true`。
    - `auto_retry_end` 与 `abortRetry()` 成功后记录 `isRetrying: false`。
    - `getRuntimeState()` 合并 Pi RPC `get_state` 与 Proma-side derived retry diagnostics。
    - query finally、abort、dispose 时清理 session retry state。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.103`。
  - `@proma/shared` patch bump 到 `0.1.57`。
- 当前边界：
  - 该字段只对活跃 Pi runtime 可靠；会话结束后 adapter 会清理派生状态。
  - 如果用户未通过 Proma 调用 `set_auto_retry`，`autoRetryEnabled` 可能保持 undefined，避免假装知道 Pi 内部默认值。
  - 若未来 Pi RPC 原生返回 `isRetrying` / `autoRetryEnabled`，可改为优先使用 runtime 原生字段或与派生状态做一致性检查。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts -t "Given Pi retry lifecycle is active"`：红灯确认 runtime state 缺少 retry 字段，实现后 1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts -t "runtime state|auto retry|retry is aborted"`：6 pass / 0 fail。

## 2026-06-03 Phase J68 Pi runtime status popover

- 背景：
  - J61-J67 已经逐步把 Pi RPC `get_state` / `get_session_stats` / `get_commands`、retry、compaction 等能力接到主进程和 shared 类型。
  - Renderer 侧此前没有调用 `window.electronAPI.getRuntimeState()` 的入口，导致用户无法在 Proma UI 中直接验证当前 Pi runtime 的 provider/model、retry/compaction、原生 session、MCP/Skills commands。
  - J68 目标是补一个轻量可观察性入口，帮助 Pi runtime 更接近 Claude SDK 集成的可理解、可诊断体验。
- 实现：
  - 新增 `pi-runtime-status-ui.ts`：
    - 将 `AgentRuntimeStateResult` 格式化为用户可读状态行。
    - 将 runtime commands 按 `extension` / `skill` / `prompt` / `unknown` 分组。
  - 新增 `PiRuntimeStatusPopover.tsx`：
    - 仅在 Pi 会话工具栏出现。
    - 打开/刷新时调用 `window.electronAPI.getRuntimeState({ sessionId })`。
    - 展示运行状态、自动重试、自动压缩、模型、provider、thinking、queue、原生 session、消息/统计/tokens/context/cost、session 文件。
    - 展示 Pi runtime 当前注册的 Extensions / Skills / Prompts / Other commands，长列表每组先显示前 8 个。
    - 会话未运行时给出明确提示：Pi runtime 实时状态仅运行中可读取。
  - `AgentView`：
    - Pi 工具栏新增 Activity 图标入口，放在 Pi clone 与 Pi native session 切换之间。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.104`。
- 当前边界：
  - J68 不做后台轮询，只在用户打开或手动刷新时读取 active runtime state。
  - J68 不把 runtime state 持久化到会话 JSONL；会话结束后仍以历史消息与 Pi native session 文件为准。
  - Popover 当前偏诊断，不替代后续更完整的 runtime inspector / MCP-Skills 边界管理页面。
- 已运行：
  - `bun test apps/electron/src/renderer/components/agent/pi-runtime-status-ui.test.ts`：红灯确认 helper 不存在，实现后 2 pass / 0 fail。
  - `bun test apps/electron/src/renderer/components/agent/pi-runtime-status-ui.test.ts apps/electron/src/renderer/components/agent/pi-native-session-ui.test.ts apps/electron/src/renderer/components/agent/ProcessBlockGroup.test.ts apps/electron/src/renderer/hooks/useGlobalAgentListeners.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts`：84 pass / 0 fail。
  - `bun run typecheck`：4 个 workspace 包 typecheck 均 exit 0。
  - `bun run electron:build`：Electron build exit 0；保留既有 Vite large chunk warning。
  - `git diff --check`：无 whitespace 问题。

## 2026-06-03 Phase J69 Pi TaskOutput parity

- 背景：
  - Claude/Proma 工具边界已有 `TaskOutput`，用于读取后台任务输出与完成状态。
  - Pi task extension 此前只注入 `TaskCreate` / `TaskUpdate` / `TaskGet` / `TaskList`，导致 Pi runtime 对任务输出工具不完整。
  - Pi 官方仍不支持 background bash；J69 不伪造后台 shell，而是补齐任务工具兼容层的 `TaskOutput`。
- 实现：
  - `Pi task extension`：
    - `TASK_TOOL_NAMES` 新增 `TaskOutput`。
    - 新增 `TaskOutput` 工具，参数为 `taskId` 与兼容用 `block?: boolean`。
    - 返回 Proma/Claude 兼容结构：`{ output, isComplete, task }`。
    - `isComplete` 在 `completed` / `cancelled` / `error` / `deleted` 时为 true。
    - `block` 参数当前只作为 Claude SDK parity 输入接受，Pi 会立即返回当前任务快照，不等待后台进程。
  - 权限：
    - `TaskOutput` 加入 Pi progress/read-only allowlist。
    - 生成的 Pi permission extension 同步免确认，避免读取任务输出时弹权限。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.105`。
- 当前边界：
  - `TaskOutput` 输出的是 Pi task extension 内存任务状态快照，不代表 Pi 原生 background bash 输出。
  - Pi session 结束后 extension 内存任务表随 runtime 生命周期清理，历史仍以 Proma JSONL 中已持久化的 tool result 为准。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/pi-task-extension.test.ts`：红灯确认缺少 `TaskOutput`，实现后 1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/adapters/pi-permission-mapping.test.ts`：红灯确认 `TaskOutput` 未免确认，实现后 22 pass / 0 fail。

## 2026-06-03 Phase J70 Pi queued prompt streaming behavior

- 背景：
  - Pi RPC 文档说明：流式运行中若继续发送 `prompt`，可通过 `streamingBehavior: "steer" | "followUp"` 控制排队方式。
  - Pi 原生 `steer` / `follow_up` 命令不允许 extension commands，而 `prompt` 会保留 Skill commands、prompt templates 与 extension commands 的展开/执行路径。
  - Proma 之前在 `sendQueuedMessage()` 中直接发送 `steer` / `follow_up`，这会让 Pi 运行中追加消息的能力边界窄于 Claude SDK 路径。
- 实现：
  - `PiAgentAdapter.sendQueuedMessage()`：
    - 运行中追加消息统一发送 `type: "prompt"`。
    - `priority: "now"` 映射为 `streamingBehavior: "steer"`。
    - 其他优先级映射为 `streamingBehavior: "followUp"`。
    - command id 改为 `proma-queued-prompt-*`，表明这是 prompt 排队语义而非裸 steer/follow_up。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.106`。
- 当前边界：
  - J70 不改变 Proma renderer 队列 UI，也不新增 queue mode 设置入口。
  - 当前 `SDKUserMessageInput` 仍只包含文本；Pi RPC 图片队列能力尚未接入 Proma Agent 输入链路。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts -t "queued message" --timeout 30000`：红灯确认旧实现发送 `steer`，实现后 2 pass / 0 fail。

## 2026-06-03 Phase J71 Pi image input bridge

- 背景：
  - Claude SDK 路径具备多模态输入能力；Pi RPC `prompt` 命令同样支持 `images: [{ type, data, mimeType }]`。
  - Proma Agent UI 已能接收图片附件，但此前只把图片作为 `<attached_files>` 文件引用交给 Agent，不会给 Pi runtime 发送原生 image payload。
  - J71 补齐 Pi 初始 prompt 的图片输入桥接，让 Pi 模型在支持视觉输入时可以直接接收用户上传图片。
- 实现：
  - `@proma/shared`：
    - 新增 `AgentRuntimeImageInput`。
    - `AgentSendInput` / `AgentQueryInput` 新增 `images?: AgentRuntimeImageInput[]`。
  - Renderer：
    - 新增 `agent-runtime-images.ts`，从 pending files 中提取非 path-backed、base64 可用的 `image/*` 附件。
    - `AgentView.handleSend()` 在清理 pending file data 之前构造 runtime images，并随 `sendAgentMessage` 传给主进程。
  - Main / Pi adapter：
    - `AgentOrchestrator.runPiSession()` 将 `input.images` 透传给 Pi adapter。
    - `PiAgentAdapter.query()` 在初始 `prompt` RPC command 中带上 `images`。
- 版本：
  - `@proma/shared` patch bump 到 `0.1.58`。
  - `@proma/electron` patch bump 到 `0.10.107`。
- 当前边界：
  - J71 只桥接初始发送图片；运行中追加消息仍只支持文本，因为 `AgentQueueMessageInput` / `SDKUserMessageInput` 还没有图片字段。
  - path-backed 图片或大文件图片不会被内联读取；仍通过 `<attached_files>` 引用路径，避免隐式读取大文件。
  - Claude SDK 路径目前不消费 `AgentSendInput.images`，仍保持既有文件引用行为；后续若要完全统一多模态，需要单独补 Claude adapter/orchestrator 的 provider-neutral image path。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts -t "image inputs" --timeout 30000`：红灯确认 prompt command 缺少 images，实现后 1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts -t "image input" --timeout 30000`：红灯确认 orchestrator 未透传 images，实现后 1 pass / 0 fail。
  - `bun test apps/electron/src/renderer/components/agent/agent-runtime-images.test.ts`：红灯确认 helper 缺失，实现后 2 pass / 0 fail。

## 2026-06-03 Phase J72 Pi queued image input bridge

- 背景：
  - J71 已把初始 prompt 图片桥接到 Pi RPC `prompt.images`。
  - Pi RPC 的运行中追加同样通过 `prompt + streamingBehavior` 支持 `images`；但 Proma 的 `AgentQueueMessageInput` / `SDKUserMessageInput` 仍只透传文本。
  - 这会导致 Pi 在“运行中追加消息”场景下仍弱于 Claude SDK 的多模态体验。
- 实现：
  - `@proma/shared`：
    - `AgentQueueMessageInput` 新增 `images?: AgentRuntimeImageInput[]`。
    - `SDKUserMessageInput` 新增 `images?: AgentRuntimeImageInput[]`。
  - Renderer：
    - `agent-runtime-images.ts` 新增 `buildQueueableAgentRuntimeImages()`，只允许非 path-backed、base64 可用的 `image/*` 作为运行中追加 payload。
    - `AgentView.handleSend()` 在 streaming 分支允许追加这些内联图片，并通过 `queueAgentMessage()` 传给主进程。
    - 普通文件、path-backed 图片、数据已失效的图片仍保持提示，要求等待当前 turn 完成后再作为文件附件发送。
  - Main / Pi adapter：
    - `queueAgentMessage()` / `AgentOrchestrator.queueMessage()` 将 `images` 透传到 `SDKUserMessageInput`。
    - `PiAgentAdapter.sendQueuedMessage()` 在 queued `prompt` command 中带上 `images`，保留 `streamingBehavior: "steer" | "followUp"`。
- 版本：
  - `@proma/shared` patch bump 到 `0.1.59`。
  - `@proma/electron` patch bump 到 `0.10.108`。
- 当前边界：
  - 运行中追加仍要求有文本说明；纯图片追加暂不开放，避免 Pi prompt message 为空。
  - queued images 仅在 Pi adapter 消费；Claude SDK 路径仍保持既有文本 queue 行为。
  - path-backed 图片不会被隐式读取成 base64，仍需走会话完成后的文件引用路径。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts -t "queued image inputs" --timeout 30000`：红灯确认 queued prompt command 缺少 images，实现后 1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts -t "queued image input" --timeout 30000`：红灯确认 orchestrator 未透传 queued images，实现后 1 pass / 0 fail。
  - `bun test apps/electron/src/renderer/components/agent/agent-runtime-images.test.ts -t "queueable"`：红灯确认 helper 缺失，实现后 queueable 用例通过；随后全文件 4 pass / 0 fail。

## 2026-06-03 Phase J73 Pi queued prompt acceptance parity

- 背景：
  - J70/J72 已让 Pi 运行中追加消息走 `prompt + streamingBehavior`，保留 `/skill`、prompt template 与 extension command 展开语义。
  - 但 `PiAgentAdapter.sendQueuedMessage()` 此前只把 RPC command 写入进程就返回，不等待 Pi 的 `response`。
  - 如果 Pi 在 preflight/acceptance 阶段拒绝 queued prompt，Proma renderer 会误以为追加成功，并可能清理输入附件或显示乐观消息。
- 实现：
  - `PiAgentAdapter.sendQueuedMessage()` 改为复用 `sendRuntimeCommand()` 发送 queued `prompt`。
  - queued prompt 现在等待 Pi `response`：
    - `success: true` 后才返回给 orchestrator / IPC。
    - `success: false` 会抛出 Pi response error，前端可按既有 queue 失败逻辑回滚乐观消息。
  - 继续保留 `streamingBehavior: "steer" | "followUp"` 与 queued images 透传。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.109`。
- 当前边界：
  - 这是 queued prompt acceptance parity，不是完整队列管理 UI；Proma 仍未接入 `CANCEL_QUEUED_MESSAGE` / `PROMOTE_QUEUED_MESSAGE` 的用户界面。
  - Pi queue_update 当前仍作为 transient summary 展示，不持久化每条 queued item 的 Proma 状态机。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts -t "queued prompt is rejected" --timeout 30000`：红灯确认旧实现静默成功，实现后 1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts -t "queued message|queued image|follow-up|queued prompt is rejected|queued adapter rejects" --timeout 30000`：6 pass / 0 fail。

## 2026-06-03 Phase J74 Claude image input parity

- 背景：
  - J71/J72 已把 Proma Agent UI 的 inline image payload 接入 Pi 初始 prompt 与运行中追加消息。
  - 但统一类型 `AgentQueryInput.images` / `SDKUserMessageInput.images` 在 Claude SDK adapter 中仍未被消费，导致 Claude 路径继续只收到纯文本 content。
  - 这会让同一套 Proma 附件语义只对 Pi 生效，不利于后续按 Claude Agent SDK 做功能 parity 对齐。
- 实现：
  - `ClaudeAgentAdapter` 新增 `buildClaudeUserContent()`：
    - 无图片时保持原有字符串 content，兼容现有 Claude 文本会话。
    - 有图片时转换为 Anthropic `MessageParam.content` block 数组：`text` + `image/base64`。
    - 仅透传 Claude SDK 支持的 `image/jpeg` / `image/png` / `image/gif` / `image/webp`，不支持的 MIME 会打印中文 warning 并跳过。
  - 初始 `query()` 入队和 `sendQueuedMessage()` 队列注入都改为使用统一转换。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.110`。
- 当前边界：
  - 这次只补 provider-neutral image payload 的 Claude 消费路径，不改变 renderer 对 path-backed/大文件图片的保守策略。
  - 如果用户选择的 Claude SDK 兼容渠道或模型本身不支持视觉输入，后续错误仍由底层 Provider/SDK 返回。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/claude-agent-adapter.test.ts --timeout 30000`：红灯确认旧实现 content 仍是字符串，实现后 2 pass / 0 fail。
  - `bun run --filter='@proma/electron' typecheck`：通过。
  - `git diff --check`：通过。
  - `bun test`：285 pass / 0 fail。
  - `bun run typecheck`：4 个 workspace 全部通过。
  - `bun run electron:build`：通过；仅保留既有 Vite large chunk warning。

## 2026-06-03 Phase J75 Pi runtime permission mode switching parity

- 背景：
  - Claude SDK adapter 已支持运行中 `query.setPermissionMode()`，Proma 的 `updateSessionPermissionMode()` 会在会话活跃时同步通知 adapter。
  - Pi 权限体验由 Proma 生成的 permission extension 实现；J75 前该 extension 的 `PI_PERMISSION_MODE` 是启动时常量。
  - 这会导致用户在 Pi 会话运行中切到“完全访问”后，Proma 外层状态已变化，但 Pi runtime 内部权限桥仍可能按旧模式继续弹审批。
- 实现：
  - `Pi permission extension`：
    - 将权限模式从常量改为 `currentPermissionMode` 可变状态。
    - 注册内部 extension command `/proma-permission-mode <safe|ask|allow-all>`。
    - 工具预检和权限请求 payload 均读取最新 `currentPermissionMode`。
  - `PiAgentAdapter.setPermissionMode()`：
    - 复用 `mapPromaPermissionModeToPiMode()` 将 Proma `bypassPermissions` / `auto` / `plan` 映射到 Pi `allow-all` / `ask` / `safe`。
    - 通过 Pi RPC `prompt` 发送内部命令，并设置 `streamingBehavior: "steer"`，让运行中切换也能立即被 extension command 处理。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.111`。
- 当前边界：
  - Pi 仍没有内置 permission mode；这是 Proma permission extension 层的 parity。
  - `allow-all` 仍会绕过 Proma extension 的目录 guard，与 Proma “完全访问”语义一致；真实文件系统边界仍取决于宿主运行环境。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/pi-permission-mapping.test.ts -t "dynamic mode switching|embeds mode|bypasses path" --timeout 30000`：红灯确认旧 extension 无动态命令，实现后 3 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts -t "permission mode changes" --timeout 30000`：红灯确认 `setPermissionMode` 缺失，实现后 1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/adapters/pi-permission-mapping.test.ts apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts --timeout 30000`：96 pass / 0 fail。
  - `bun run --filter='@proma/electron' typecheck`：通过。
  - `git diff --check`：通过。

## 2026-06-03 Phase J76 Pi queue mode control parity

- 背景：
  - Pi RPC 支持官方队列投递模式命令：
    - `set_steering_mode`：控制 `streamingBehavior: "steer"` 的 queued prompts 是全部投递还是逐条投递。
    - `set_follow_up_mode`：控制 `streamingBehavior: "followUp"` 的 queued prompts 是全部投递还是逐条投递。
  - Proma 之前只能展示 `get_state` 返回的 `steeringMode` / `followUpMode`，不能运行中切换。
  - Pi RPC `queue_update` 只返回 pending 文本数组，没有稳定 item id，因此本阶段不实现伪取消/伪提升单条队列消息。
- 实现：
  - `@proma/shared`：
    - `AgentProviderAdapter` 新增可选 `setSteeringMode()` / `setFollowUpMode()`。
    - 新增 `PiRuntimeQueueMode` 与 `UpdateRuntimeQueueModesInput`。
    - 新增 IPC 通道 `agent:update-runtime-queue-modes`。
  - Main：
    - `PiAgentAdapter` 将 `set_steering_mode` / `set_follow_up_mode` 加入 runtime command 白名单。
    - 新增 `normalizePiQueueMode()`，只允许 `all` / `one-at-a-time`。
    - `AgentOrchestrator.updateRuntimeQueueModes()` 将运行中设置转发到 adapter，并对不支持的 runtime 给出明确错误。
    - `agent-service` / `ipc.ts` 接入 `updateAgentRuntimeQueueModes()`。
  - Preload / Renderer：
    - `window.electronAPI.updateRuntimeQueueModes()` 暴露给渲染进程。
    - `PiRuntimeStatusPopover` 在 Pi runtime 状态弹窗里增加 steering / follow-up 两个紧凑二选一控制，设置成功后刷新状态。
- 版本：
  - `@proma/shared` patch bump 到 `0.1.60`。
  - `@proma/electron` patch bump 到 `0.10.112`。
- 当前边界：
  - 这是 Pi 官方 queue mode parity，不是完整队列 item 管理。
  - 由于 Pi RPC 没有暴露 queued item id 与单条 cancel/promote 命令，Proma 暂不把 `CANCEL_QUEUED_MESSAGE` / `PROMOTE_QUEUED_MESSAGE` 强行接到 Pi。
  - Claude SDK 路径没有对应 queue mode 概念；该控制只在 Pi runtime 状态弹窗中出现。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts`：红灯确认 `setSteeringMode` / `setFollowUpMode` 缺失，实现后 44 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts`：红灯确认 `updateRuntimeQueueModes` 缺失，实现后 32 pass / 0 fail。
  - `bun run typecheck`：4 个 workspace 全部通过。

## 2026-06-03 Phase J77 Pi soft interrupt parity

- 背景：
  - Claude SDK adapter 已实现 `interruptQuery()`，Proma 在运行中追加消息且 `interrupt: true` 时，会先软中断当前 turn，再注入 queued user message。
  - Pi adapter 之前没有 `interruptQuery()`，因此 Pi 会退化为普通 `streamingBehavior: "steer"` 队列，无法表达“先停止当前输出/工具循环，再继续处理新消息”的交互。
  - Pi RPC 文档提供 `abort` command，用于 abort 当前 agent operation；这可以作为不杀进程的软中断等价能力。
- 实现：
  - `PiAgentAdapter`：
    - 将 `abort` 加入可等待 runtime command 白名单。
    - 新增 `interruptQuery(sessionId)`，通过 `sendRuntimeCommand({ type: "abort" }, "proma-interrupt")` 发送 Pi RPC abort command 并等待 response。
    - 保持 `abort(sessionId)` 的硬停止语义不变：`stopAgent` 仍会清理进程并进入 kill 兜底。
  - `AgentOrchestrator.queueMessage(..., { interrupt: true })` 无需额外改动；现有逻辑会在 Pi adapter 暴露 `interruptQuery()` 后自动先软中断再注入消息。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.113`。
- 当前边界：
  - Pi soft interrupt 依赖 Pi RPC `abort` 的语义；它会中止当前 operation，但后续 queued prompt 仍按 Pi 的 prompt/queue 机制处理。
  - 这不是 `stopAgent`，不会主动删除 Proma active session，也不会走 `piProcess.abort()` 的 kill 兜底。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts -t "interrupted softly|queued message is sent|queued prompt is rejected"`：红灯确认 `interruptQuery` 缺失，实现后 5 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts -t "queueing interrupting message|queueing message|stopping"`：7 pass / 0 fail。

## 2026-06-03 Phase J78 Pi native session name sync

- 背景：
  - Proma 已经会基于第一次用户消息自动生成 Agent 会话标题，但 Pi 原生 runtime 的 `sessionName` 不会同步更新。
  - Pi RPC 提供 `set_session_name` 命令，`get_state` 也会通过 `sessionName` 暴露当前原生名称；Proma 之前只解析展示，没有写回能力。
  - Claude SDK 没有对应的运行中 native session name API，因此该能力以 adapter optional method 形式补齐，不影响 Claude 路径。
- 实现：
  - `@proma/shared`：
    - `AgentProviderAdapter` 新增可选 `setSessionName(sessionId, name)`。
  - Main：
    - `PiAgentAdapter` 将 `set_session_name` 加入 runtime command 白名单。
    - 新增 `setSessionName()`，对空名称做保护，并通过 Pi RPC 发送 `{ type: "set_session_name", name }`。
    - `AgentOrchestrator.autoGenerateTitle()` 在 Proma 元数据和 UI 回调更新后，best-effort 调用 adapter 的 `setSessionName()`。
- 版本：
  - `@proma/shared` patch bump 到 `0.1.61`。
  - `@proma/electron` patch bump 到 `0.10.114`。
- 当前边界：
  - 仅同步自动标题生成结果；用户手动重命名会话后的 Pi 原生命名同步还需要后续从会话 meta 更新入口接入。
  - 如果 Pi runtime 不活跃或 RPC 命令失败，Proma 标题仍然保留，只记录中文 warning。
- 已运行：
  - `bun test apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts -t "session name"`：红灯确认 `setSessionName` 缺失，实现后 1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts -t "generates title"`：红灯确认自动标题未同步 Pi 原生名称，实现后 1 pass / 0 fail。

## 2026-06-03 Phase J79 Pi manual rename native session sync

- 背景：
  - J78 已经把 Proma 自动生成标题同步到 Pi 原生 `sessionName`。
  - 手动重命名仍然直接走 `ipc.ts -> updateAgentSessionMeta()`，没有经过 `agent-service` / `AgentOrchestrator`，所以活跃 Pi runtime 的原生命名不会同步。
- 实现：
  - `AgentOrchestrator` 新增 `updateRuntimeSessionName()`，仅在会话活跃且 adapter 支持 `setSessionName()` 时转发。
  - `agent-service` 新增 `renameAgentSessionTitle()`：
    - 先更新 Proma 会话元数据，保持用户重命名的本地持久化优先。
    - 对非空标题 best-effort 同步活跃 runtime 的原生会话名，失败只记录 warning。
  - `AGENT_IPC_CHANNELS.UPDATE_TITLE` 改为调用 `renameAgentSessionTitle()`，因此 UI 手动重命名会话时自动获得 Pi 原生命名同步。
- 版本：
  - `@proma/electron` patch bump 到 `0.10.115`。
- 当前边界：
  - 只同步活跃 runtime；不活跃 Pi 会话的原生 JSONL 文件名/内容不会被后台改写。
  - Proma 本地标题保留原输入；同步给 Pi 的名称会 trim，避免 Pi 原生命名为空或带首尾空格。
- 已运行：
  - `bun test apps/electron/src/main/lib/agent-session-manager.test.ts -t "title is renamed"`：红灯确认 `renameAgentSessionTitle` 缺失，实现后 1 pass / 0 fail。
  - `bun test apps/electron/src/main/lib/agent-session-manager.test.ts apps/electron/src/main/lib/agent-orchestrator-pi-routing.test.ts apps/electron/src/main/lib/adapters/pi-agent-adapter.test.ts`：110 pass / 0 fail。
  - `git diff --check`：通过。

## 多端接力约定

- 后续每个重要阶段结束后，同步更新本文件或新增同目录 handoff。
- 其他终端继续开发前，先查看：
  - 本文件
  - `docs/superpowers/plans/2026-05-30-pi-rpc-minimal-loop.md`
  - 当前分支最新 commit
- 若需要跨机器同步，请提交并推送 handoff 更新，避免上下文只停留在单个 Codex 会话里。
