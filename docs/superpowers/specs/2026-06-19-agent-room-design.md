# Proma Agent Room 需求与设计文档

> 日期：2026-06-19
> 状态：草案，已按当前对话确认的方向整理
> 范围：Proma Electron 桌面端的第三模式 Agent Room

## 1. 背景

Proma 现在已经具备 Chat、Agent、Scratch 三类工作台，以及工作区、Skills、MCP、记忆、权限、AskUser、后台任务和本地 JSON/JSONL 持久化能力。下一步不是再加一个“聊天窗口”，而是把 Proma 推进到更接近 slock.ai / Raft 的协作模型：人类与多个长期存在的 Agent 成员共享一个房间，围绕同一上下文持续工作。

本需求的目标是：

- 把 Agent 从“单会话工具”升级为“房间成员”。
- 让多个 Agent 在同一房间里协作，而不是各自孤立地发起会话。
- 保持 Proma 的本地优先、可审计、可持久化、可控权限的架构习惯。

## 2. 已确认产品方向

以下决策已经在对话中确认：

- 入口形态：新增第三模式 `Room`，不是藏在 Agent 二级菜单里。
- 房间数量：第一版只做单房间闭环，UI 也只展示一个默认房间入口，但数据模型要预留多房间。
- 触发方式：同时支持 `@Agent` 明确触发和自动监听。
- 监听策略：采用“轻量规则 + LLM 判定”的分流方式。
- 输出形式：消息流 + 草稿卡。
- Agent 成员：采用独立 Agent 配置，不只是复用现有工作区会话。
- 记忆边界：成员私有记忆 + 房间摘要。
- 工具权限：允许执行，但继续沿用 Proma 现有权限系统。
- 存储方式：独立 Room 索引 + Room JSONL 消息日志。
- 技术路线：新增 Room 编排层，复用现有 Agent runtime、权限服务和流式事件体系。

## 3. 用户需求

### 3.1 核心场景

1. 用户打开 Proma，进入 Room 模式。
2. 用户在房间里发送消息，像在一个协作频道里和 Agent 说话。
3. 用户 `@` 某个 Agent 成员时，该成员必须响应。
4. 未 `@` 的普通消息会被监听策略评估，相关时自动回应，不相关时沉默或进入草稿。
5. Agent 的回复会以流式方式进入房间消息流。
6. 低置信输出不会直接发言，而是先变成草稿卡供用户确认。
7. Agent 执行工具时，仍走 Proma 现有权限确认流程。

### 3.2 非目标

第一版不做：

- 远程 daemon / 多机连接。
- 真正的 Slack 兼容协议。
- 多房间切换、归档、线程树、频道邀请等完整协作系统。
- 本地数据库。
- 自动让 Agent 互相递归触发。
- 复杂工作流编排引擎。

## 4. 设计原则

- 本地优先：配置、成员、消息、草稿都落在 `~/.proma/`。
- 可审计：所有自动行为都可追溯到消息、草稿或权限记录。
- 少惊喜：能人工确认的就不要自动替用户决定。
- 复用既有底座：权限、AskUser、Agent runtime、流式事件、Jotai 都沿用。
- 先单房间闭环：先让一个房间完整跑通，再扩展多房间。

## 5. 信息架构

### 5.1 顶层模式

`AppMode` 需要扩展为：

- `chat`
- `agent`
- `room`
- `scratch`

Room 作为主模式之一进入顶栏切换，不应被隐藏在 Agent 模式内部。

### 5.2 房间界面

Room 视图建议包含三块：

- 左侧或上方：房间列表/房间信息，第一版可先只显示当前房间。
- 中间：消息流，展示人类消息、Agent 回复、系统事件、草稿卡。
- 右侧或抽屉：成员管理、监听开关、角色说明、记忆摘要状态。

## 6. 数据模型

### 6.1 Room 元数据

```ts
export interface RoomMeta {
  id: string
  title: string
  description?: string
  pinned?: boolean
  archived?: boolean
  createdAt: number
  updatedAt: number
}
```

### 6.2 Room 成员

```ts
export interface RoomMemberConfig {
  id: string
  roomId: string
  name: string
  avatar?: string
  rolePrompt: string
  channelId?: string
  modelId?: string
  workspaceId?: string
  enabled: boolean
  listenMode: 'mention-only' | 'listen-and-score'
  permissionMode?: 'safe' | 'ask' | 'allow-all'
  createdAt: number
  updatedAt: number
}
```

### 6.3 房间消息

```ts
export interface RoomMessage {
  id: string
  roomId: string
  role: 'human' | 'agent' | 'system' | 'draft'
  authorId?: string
  content: string
  status?: 'streaming' | 'final' | 'draft' | 'sent' | 'discarded'
  createdAt: number
  updatedAt: number
}
```

### 6.4 草稿

草稿不是最终消息，而是可确认的中间态。草稿需要记录：

- 对应的成员。
- 草稿来源消息。
- 评分结果。
- 是否已确认发送。

### 6.5 摘要

房间摘要建议单独持久化，作为成员共享上下文。成员私有记忆仍沿用各自的底层记忆边界，不与房间摘要混成一个东西。

## 7. 运行时架构

### 7.1 数据流

1. Renderer 里的 Room 输入框提交消息。
2. Jotai 状态先乐观更新房间消息流。
3. 通过 IPC 发送到主进程的 Room handler。
4. 主进程写入 Room JSONL 并更新元数据。
5. `room-orchestrator` 读取房间成员配置、摘要和上下文。
6. 若命中 `@Agent`，直接路由给目标成员。
7. 若是普通消息，先做轻量规则筛选，再走 LLM 判定。
8. 高置信结果直接转成流式消息，低置信结果转成草稿卡。
9. Agent 工具调用和权限请求继续走现有 Proma 权限链路。

### 7.2 编排层职责

`room-orchestrator` 负责：

- 接收房间消息。
- 决定触发哪些成员。
- 组装房间上下文、成员角色提示和摘要。
- 复用现有 Agent runtime 发起流式运行。
- 把流式输出回传给 Renderer。
- 维护草稿状态和消息状态。

它不负责：

- Agent runtime 的底层协议实现。
- 权限 UI 的具体渲染。
- 记忆服务的底层存储细节。

## 8. IPC 与持久化

### 8.1 新增 IPC 分组

建议新增：

- `ROOM_IPC_CHANNELS.LIST_ROOMS`
- `ROOM_IPC_CHANNELS.CREATE_ROOM`
- `ROOM_IPC_CHANNELS.UPDATE_ROOM`
- `ROOM_IPC_CHANNELS.DELETE_ROOM`
- `ROOM_IPC_CHANNELS.LIST_MEMBERS`
- `ROOM_IPC_CHANNELS.SAVE_MEMBER`
- `ROOM_IPC_CHANNELS.DELETE_MEMBER`
- `ROOM_IPC_CHANNELS.GET_MESSAGES`
- `ROOM_IPC_CHANNELS.SEND_MESSAGE`
- `ROOM_IPC_CHANNELS.UPDATE_DRAFT`
- `ROOM_IPC_CHANNELS.STOP_STREAM`

### 8.2 存储路径

建议采用：

- `~/.proma/rooms.json`
- `~/.proma/rooms/{roomId}.jsonl`
- `~/.proma/rooms/{roomId}/members.json`
- `~/.proma/rooms/{roomId}/summary.md`
- `~/.proma/rooms/{roomId}/drafts/{draftId}.json`

这样能维持 Proma 一贯的本地文件式结构。

## 9. 错误处理

- 如果某个成员配置缺失或损坏，房间仍可打开，坏成员被标记为不可用。
- 如果评分服务失败，普通消息默认不自动触发，避免误报。
- 如果草稿确认失败，保留草稿原始内容和错误原因。
- 如果权限请求未完成，流式运行暂停并等待用户处理。

## 10. 验收标准

第一版完成时，应满足：

- 能在顶栏看到 Room 模式入口。
- 能打开一个房间并发送消息。
- `@Agent` 能稳定触发指定成员。
- 普通消息能进入监听评分分支。
- 高置信自动回复、低置信草稿卡都能工作。
- Agent 工具权限继续沿用现有流程。
- 重启后房间、成员、消息和草稿可恢复。

## 11. 结论

这不是把 Proma 做成一个更花哨的聊天页，而是把它升级成一个可持续的 Agent 协作房间。第一版先把单房间闭环跑稳，后面再扩多房间、线程和更复杂的协作编排。
