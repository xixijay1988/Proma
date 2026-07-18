# 2026-06-19 Agent Room Handoff

## 目标

为 Proma 增加一个类似 slock.ai / Raft 的 Agent 团队房间能力，让人类和多个 Agent 成员在同一房间里持续协作。

## 已确认决策

- 新增顶层模式：`room`
- 第一版只做单房间闭环
- 支持 `@Agent` 与自动监听
- 监听策略：轻量规则 + LLM 判定
- 输出形式：消息流 + 草稿卡
- Agent 成员是独立配置
- 记忆边界：成员私有记忆 + 房间摘要
- 工具权限复用现有 Proma 权限系统
- 存储：独立 Room 索引 + JSONL 消息日志
- 技术路线：Room 编排层复用现有 Agent runtime

## 交付物

以下文档已经准备好，后续 AI 可以直接接手：

- 需求与设计：`docs/superpowers/specs/2026-06-19-agent-room-design.md`
- 实施计划：`docs/superpowers/plans/2026-06-19-agent-room-implementation-plan.md`

## 推荐实施顺序

1. 先补 shared 类型和 Room 存储。
2. 再做 Room 编排层。
3. 然后接 IPC / preload。
4. 最后做 renderer atoms 和 Room UI。

## 风险点

- 自动监听如果没有分流，噪音会很快失控。
- 草稿态和最终消息态要严格区分，否则 UI 会反复抖动。
- Room 编排层不能和现有 Agent 会话管理缠在一起，否则后续会很难扩展多房间。

## 待决但不阻塞

- 房间列表页的最终信息密度。
- 成员管理是否一开始就支持模板。
- 草稿卡是否要支持“编辑后发送”。

## 给后续 AI 的一句话

先把 Room 当成一个独立协作体来设计，不要把它简化成“Agent 模式里的另一个会话页”。
