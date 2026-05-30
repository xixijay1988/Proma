# Pi Protocol Discovery Notes

Date: 2026-05-30
Package: `@earendil-works/pi-coding-agent@0.76.0`
Status: discovery complete, implementation not started

## 目标

本记录用于 Phase C 的 Next 1：确认 Pi 是否具备可被 Proma 依赖的进程协议，并为后续最小可用 loop 提供实现边界。

结论：首版集成应使用 `pi-coding-agent` 的 CLI RPC mode，通过子进程隔离接入。暂不使用 JSON mode 作为主路径，也暂不直接 import SDK。

## 包与入口

`@earendil-works/pi-coding-agent@0.76.0` 的关键信息：

- CLI bin: `pi -> dist/cli.js`
- package main: `dist/index.js`
- Node engine: `>=22.19.0`
- 主要依赖：`@earendil-works/pi-agent-core`、`@earendil-works/pi-ai`、`@earendil-works/pi-tui`

本地已验证：

```bash
node node_modules/@earendil-works/pi-coding-agent/dist/cli.js --version
```

输出：

```text
0.76.0
```

`--help` 显示可用 mode：

- `--mode text`
- `--mode json`
- `--mode rpc`

常用启动参数包括：

- `--provider <name>`
- `--model <pattern>`
- `--api-key <key>`
- `--session-dir <dir>`
- `--no-session`
- `--tools <tools>`
- `--no-tools`
- `--no-builtin-tools`
- `--no-context-files`
- `--no-extensions`
- `--no-skills`
- `--offline`

`cwd` 没有独立 CLI flag，应通过 `child_process.spawn(..., { cwd })` 设置。

## 模式对比

| 模式 | 能力 | 适合 Proma 首版 |
| --- | --- | --- |
| `--mode json` | 单次 prompt，stdout 输出 JSONL 事件；错误多走 stderr 和退出码 | 不适合。没有命令通道，不利于 stop、queue、permission UI |
| `--mode rpc` | 长驻 JSONL stdin/stdout；支持 prompt、steer、follow_up、abort、get_state、模型与 thinking 配置、extension UI | 适合。边界清晰，能覆盖 Phase C 最小 loop |
| SDK direct import | 功能最完整，可直接使用 `createAgentSession()`、extensions、custom tools | 暂不适合。ESM、Node 版本、worker/native/wasm、资源路径和 Electron main 污染风险更高 |

推荐路线：`PiAgentAdapter` 继续保持子进程边界，内部从当前 guarded `--help` probe 演进到 `--mode rpc`。

## RPC 协议

RPC mode 使用 JSON Lines：

- stdin 写入 command，每条以 LF `\n` 结束。
- stdout 混合输出 response 和 AgentSessionEvent。
- stderr 仍可能输出诊断日志。
- 不要用 Node `readline` 解析 stdout。Pi 自身实现也说明 `readline` 会错误处理 `U+2028` / `U+2029`；Proma 应实现严格 LF buffer splitter。

最小启动示例：

```bash
node node_modules/@earendil-works/pi-coding-agent/dist/cli.js \
  --mode rpc \
  --provider anthropic \
  --model claude-sonnet-4-5 \
  --api-key "$ANTHROPIC_API_KEY" \
  --session-dir /path/to/proma/pi-sessions
```

临时不落 Pi session：

```bash
node node_modules/@earendil-works/pi-coding-agent/dist/cli.js \
  --mode rpc \
  --model openai/gpt-4o \
  --api-key "$OPENAI_API_KEY" \
  --no-session
```

Electron packaged app 中不应直接依赖包内 `RpcClient` 的 spawn 逻辑，因为它默认 spawn `"node"`。Proma 现有 `pi-process.ts` 使用 `process.execPath` 并设置 `ELECTRON_RUN_AS_NODE=1`，这更适合 Electron 打包环境。

## 最小命令流

查询状态：

```json
{"id":"state-1","type":"get_state"}
```

本地 isolated probe 得到成功响应：

```json
{"id":"state-1","type":"response","command":"get_state","success":true,"data":{"isStreaming":false,"isCompacting":false,"steeringMode":"one-at-a-time","followUpMode":"one-at-a-time","autoCompactionEnabled":true,"messageCount":0,"pendingMessageCount":0}}
```

发送 prompt：

```json
{"id":"prompt-1","type":"prompt","message":"列出当前目录的 TypeScript 文件"}
```

如果 preflight 接受，stdout 先返回：

```json
{"id":"prompt-1","type":"response","command":"prompt","success":true}
```

如果失败，例如缺少 API key，则返回：

```json
{"id":"prompt-1","type":"response","command":"prompt","success":false,"error":"No API key found for the selected model..."}
```

流式过程中可发送：

```json
{"id":"abort-1","type":"abort"}
```

或者排队/转向：

```json
{"id":"steer-1","type":"steer","message":"停止当前方向，先检查配置"}
{"id":"follow-1","type":"follow_up","message":"完成后总结风险"}
```

`prompt` 命令也支持 streaming 行为：

```json
{"id":"prompt-2","type":"prompt","message":"改为先只做调查","streamingBehavior":"steer"}
```

模型与 thinking 可通过 RPC 改变：

```json
{"id":"model-1","type":"set_model","provider":"anthropic","modelId":"claude-sonnet-4-5"}
{"id":"thinking-1","type":"set_thinking_level","level":"high"}
```

注意：`set_model` 只能在 Pi 已知且有可用凭证的模型中切换，不能通过 RPC command 传入 API key。API key 应在启动时通过 `--api-key` 或环境变量/AuthStorage 提供。

## 事件映射

Pi RPC stdout 会输出 AgentSessionEvent。Phase C 最小 loop 需要先覆盖这些事件：

| Pi event | Proma 映射 |
| --- | --- |
| `agent_start` / `turn_start` | 可作为内部运行状态，不必直接展示 |
| `message_start` | 初始化 assistant message |
| `message_update` + `assistantMessageEvent.type = "text_delta"` | assistant text delta |
| `tool_execution_start` | Proma tool_start / 工具活动开始 |
| `tool_execution_update` | Proma 工具活动增量更新 |
| `tool_execution_end` | Proma tool_result / 工具活动结束 |
| `message_end` / `turn_end` | 收束当前 assistant message |
| `queue_update` | 后续接入 queue/follow-up UI |
| `auto_retry` | 可映射为 Proma 运行提示或内部诊断 |
| `agent_end` | result/done |
| RPC response `success:false` | typed error result |

当前 Proma renderer 仍消费 SDK-shaped message。下一步实现应在 `PiAgentAdapter` 内完成转换，先避免大范围前端迁移。长期再引入 runtime-neutral `AgentRuntimeMessage`。

## 权限与工具

Pi 文档说明核心不内置 permission popup。Proma 需要通过 extension bridge 接管权限 UI。

Pi extension 可监听：

```ts
pi.on("tool_call", async (event, ctx) => {
  const confirmed = await ctx.ui.confirm({
    title: "允许工具调用？",
    message: event.toolName,
  })

  if (!confirmed) {
    return { block: true, reason: "用户拒绝" }
  }

  return {}
})
```

`ToolCallEventResult` 支持：

```ts
interface ToolCallEventResult {
  block?: boolean
  reason?: string
}
```

RPC mode 会把 extension UI request 发到 stdout：

```json
{"type":"extension_ui_request","id":"perm-1","method":"confirm","title":"Allow command?","message":"rm -rf tmp","timeout":10000}
```

Proma 需要回写：

```json
{"type":"extension_ui_response","id":"perm-1","confirmed":true}
```

建议 Phase C 的权限桥路径：

1. Proma 为 Pi 启动生成或引用一个 Proma-owned permission extension。
2. extension 在 `tool_call` 中把 tool name/input 转成 Proma permission request。
3. extension 通过 `ctx.ui.confirm/select/input` 触发 RPC `extension_ui_request`。
4. Proma 主进程把 request 转发到现有 permission UI。
5. 用户响应后，Proma 写入 `extension_ui_response`。
6. extension 返回 `{ block: true, reason }` 或允许继续。

已知内置工具：

- `read`
- `bash`
- `edit`
- `write`
- 默认关闭的只读工具：`grep`、`find`、`ls`

工具输入形态：

- `read`: `{ path, offset?, limit? }`
- `bash`: `{ command, timeout? }`
- `write`: `{ path, content }`
- `edit`: `{ path, edits: [{ oldText, newText }] }`

Proma 的 `allow-all` 仍必须执行工作区/附件路径 scope check，不能完全交给 Pi。

## Session 与配置隔离

Pi 默认使用 `~/.pi/agent`。Proma 不应污染或依赖用户全局 Pi 配置，建议启动时设置隔离目录：

```bash
PI_CODING_AGENT_DIR=/path/to/proma/pi-agent
PI_CODING_AGENT_SESSION_DIR=/path/to/proma/pi-sessions
PI_OFFLINE=1
PI_TELEMETRY=0
```

实现策略：

- Proma 继续拥有 `~/.proma/agent-sessions` 元数据和 JSONL。
- Pi 原生 session 可先放到 Proma-owned 子目录，例如 workspace/session 下的 `pi-session/`。
- Phase C 可优先使用 `--no-session` 降低状态复杂度；如果要支持 Pi continuation，再切到 `--session-dir`。
- 默认禁用或受控启用 Pi context files，避免和 Proma 的 system prompt / workspace context 重复注入。

## JSON Mode 观察

本地 probe：

```bash
node node_modules/@earendil-works/pi-coding-agent/dist/cli.js --mode json "hello"
```

在没有 API key 时：

- stdout 只输出 session header。
- stderr 输出 `No API key found...`。
- exit code 为 `1`。

这说明 JSON mode 可以作为诊断参考，但不适合作为 Proma 的主运行协议：失败语义分散在 stdout/stderr/exit code，且缺少运行中的 command channel。

## Direct SDK 观察

SDK 暴露：

- `createAgentSession`
- `AgentSession`
- `createAgentSessionRuntime`
- `SessionManager`
- `AuthStorage`
- `ModelRegistry`
- extensions/custom tools 相关类型

Direct SDK 优点是能力完整，后续如果需要深度控制 `customTools`、`extensionFactories`、auth/session/runtime，可以再评估。

首版不采用 direct SDK 的原因：

- package 是 ESM，Electron main 现有构建/运行边界需要额外验证。
- 要求 Node `>=22.19.0`，需核对 Electron 39 实际 Node 版本。
- Pi 的 worker、native/wasm、资源发现、settings、extensions 直接进入 Electron main，风险高。
- 子进程 RPC 更容易 kill/abort/cleanup，符合 experimental rollout。

## 打包风险

继续保留 `@earendil-works/pi-coding-agent` 为 Electron packaged app 可解析的外部文件。后续实现 RPC loop 前需要验证：

- packaged output 中存在 `node_modules/@earendil-works/pi-coding-agent/dist/cli.js`。
- Pi 依赖树中的资源文件、wasm、worker thread 在 ASAR/unpacked 路径下可用。
- `process.execPath + ELECTRON_RUN_AS_NODE=1` 能在 packaged Electron 内执行 RPC mode。
- 启动时可设置 Proma-owned `PI_CODING_AGENT_DIR` 和 `PI_CODING_AGENT_SESSION_DIR`。
- Windows 下 Electron 子进程路径和 quoting 行为单独验证。

## 下一步实现建议

### Next 2: Runtime Message 抽象

- 增加 `AgentRuntimeMessage` / `AgentRuntimeResult` 的最小边界。
- 保持 renderer 继续消费 SDK-shaped message。
- 只在 adapter boundary 降低 Claude SDK 命名污染。

### Next 3: Pi RPC 最小 Loop

BDD 验收：

- Given `PROMA_PI_AGENT_ENABLED` 未设置，when query Pi session，then 不启动 Pi 进程并返回 `pi_not_enabled`。
- Given fake RPC stdout 输出 `message_update` text delta，when adapter query，then yield Proma assistant text。
- Given RPC response `success:false`，when prompt rejected，then yield typed error result。
- Given user stop，when Pi run active，then 写入 `abort`，超时后 kill fallback。
- Given `extension_ui_request`，when permission UI resolve，then 写入 `extension_ui_response`。

实现顺序：

1. 在 `pi-process.ts` 增加可测试的 JSONL stdin/stdout RPC client，不使用 Node `readline`。
2. 在 `pi-agent-adapter.test.ts` 用 fake process 覆盖 prompt accepted/rejected/text/error/abort。
3. 将 `PiAgentAdapter.query()` 从 `--help` probe 切到 `--mode rpc`，保留 feature flag。
4. 先只支持 prompt、text delta、tool start/end、error、done、abort。
5. 权限 bridge 单独作为下一小步，不和 text loop 混在同一提交。

## 未解决问题

- Proma channel provider/model 如何稳定映射到 Pi provider/model 名称。
- OpenAI-compatible 自定义 base URL 是否需要 Pi model config 或 extension 才能覆盖。
- Pi extension 文件应使用 `.ts` 直接加载还是预构建 `.mjs`，需用 packaged app 验证。
- Pi native session continuation 与 Proma JSONL session 的边界。
- MCP / Skills 是否通过 Pi 原生机制接入，还是先由 Proma prompt/context 注入。
- Electron 39 的 Node 版本是否满足 Pi `>=22.19.0`，以及后续 Electron 升级策略。
