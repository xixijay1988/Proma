import { describe, expect, test } from 'bun:test'
import type { AgentWorkspace, Channel, RoomDraft, RoomMemberConfig, RoomMessage } from '@proma/shared'
import { buildRoomMemberSaveInput, buildRoomMessageItems, canDeleteRoomChannel, createRoomMemberFormState, getMentionableMembers, getPendingDrafts, getRoomAgentSessionIdForMember, getRoomMentionQuery, getRoomMemberRuntimeLabels, insertRoomMention } from './room-view-model'

const baseTime = 1000

function member(id: string, name: string, avatar?: string): RoomMemberConfig {
  return {
    id,
    roomId: 'room-1',
    name,
    avatar,
    rolePrompt: `${name} 的角色说明`,
    enabled: true,
    listenMode: 'listen-and-score',
    createdAt: baseTime,
    updatedAt: baseTime,
  }
}

function message(input: Pick<RoomMessage, 'id' | 'role' | 'content'> & Partial<RoomMessage>): RoomMessage {
  return {
    roomId: 'room-1',
    status: 'final',
    createdAt: baseTime,
    updatedAt: baseTime,
    ...input,
  }
}

function draft(input: Pick<RoomDraft, 'id' | 'memberId' | 'content' | 'status'> & Partial<RoomDraft>): RoomDraft {
  return {
    roomId: 'room-1',
    sourceMessageId: 'msg-1',
    createdAt: baseTime,
    updatedAt: baseTime,
    ...input,
  }
}

function channel(input: Partial<Channel> & Pick<Channel, 'id' | 'name'>): Channel {
  return {
    provider: 'anthropic',
    baseUrl: 'https://example.com',
    apiKey: 'encrypted',
    models: [],
    enabled: true,
    createdAt: baseTime,
    updatedAt: baseTime,
    ...input,
  }
}

function workspace(input: Pick<AgentWorkspace, 'id' | 'name'>): AgentWorkspace {
  return {
    slug: input.id,
    createdAt: baseTime,
    updatedAt: baseTime,
    ...input,
  }
}

describe('Room 视图模型', () => {

  test('Given Room 成员标识包含特殊字符 When 构建隐藏 Agent sessionId Then 与主进程使用同一规范化格式', () => {
    expect(getRoomAgentSessionIdForMember('room.1', 'feature/design', 'member.2')).toBe('room-room-1-feature-design-member-2')
  })

  test('Given Room channels When judging delete action Then only non-default active channels can be deleted', () => {
    expect(canDeleteRoomChannel({ id: 'general', roomId: 'room-1', name: 'general', createdAt: baseTime, updatedAt: baseTime })).toBe(false)
    expect(canDeleteRoomChannel({ id: 'channel-1', roomId: 'room-1', name: 'frontend', archived: true, createdAt: baseTime, updatedAt: baseTime })).toBe(false)
    expect(canDeleteRoomChannel({ id: 'channel-2', roomId: 'room-1', name: 'backend', createdAt: baseTime, updatedAt: baseTime })).toBe(true)
  })

  test('Given human 和 agent 消息 When 构建消息项 Then 展示人类与成员身份', () => {
    const items = buildRoomMessageItems({
      messages: [
        message({ id: 'msg-1', role: 'human', content: '大家怎么看？' }),
        message({ id: 'msg-2', role: 'agent', authorId: 'agent-1', content: '我建议先做 MVP。' }),
      ],
      members: [member('agent-1', 'Planner', '🧭')],
    })

    expect(items).toEqual([
      expect.objectContaining({ id: 'msg-1', speakerName: '我', speakerAvatar: '你', align: 'right' }),
      expect.objectContaining({ id: 'msg-2', speakerName: 'Planner', speakerAvatar: '🧭', align: 'left' }),
    ])
  })

  test('Given agent message with progress When 构建消息项 Then 保留过程输出', () => {
    const items = buildRoomMessageItems({
      messages: [
        message({
          id: 'msg-1',
          role: 'agent',
          authorId: 'agent-1',
          content: 'Coder 正在思考...',
          status: 'streaming',
          progress: [
            { id: 'p-1', kind: 'tool', content: '开始使用工具：Write', createdAt: baseTime },
          ],
        }),
      ],
      members: [member('agent-1', 'Coder', '🤖')],
    })

    expect(items[0]?.progress).toEqual([
      { id: 'p-1', kind: 'tool', content: '开始使用工具：Write', createdAt: baseTime },
    ])
  })

  test('Given 草稿列表 When 过滤待确认草稿 Then 只展示 pending 草稿并补齐成员名', () => {
    const pending = getPendingDrafts({
      drafts: [
        draft({ id: 'draft-1', memberId: 'agent-1', content: '可以发出', status: 'pending' }),
        draft({ id: 'draft-2', memberId: 'agent-1', content: '已丢弃', status: 'discarded' }),
      ],
      members: [member('agent-1', 'Reviewer')],
    })

    expect(pending).toEqual([
      expect.objectContaining({ id: 'draft-1', memberName: 'Reviewer', content: '可以发出' }),
    ])
  })

  test('Given 草稿带评分 When 过滤待确认草稿 Then 提供百分比评分文案', () => {
    const pending = getPendingDrafts({
      drafts: [
        draft({ id: 'draft-1', memberId: 'agent-1', content: '可以发出', status: 'pending', score: 0.47 }),
      ],
      members: [member('agent-1', 'Reviewer')],
    })

    expect(pending[0]?.scoreLabel).toBe('47%')
  })

  test('Given 成员绑定渠道模型工作区 When 解析运行时标签 Then 展示可读名称并标记可运行', () => {
    const labels = getRoomMemberRuntimeLabels({
      member: {
        ...member('agent-1', 'Builder'),
        channelId: 'channel-1',
        modelId: 'model-1',
        workspaceId: 'workspace-1',
        agentEngine: 'pi',
      },
      channels: [channel({ id: 'channel-1', name: 'Claude', models: [{ id: 'model-1', name: 'Sonnet', enabled: true }] })],
      workspaces: [workspace({ id: 'workspace-1', name: 'Proma' })],
    })

    expect(labels).toEqual({
      channelLabel: 'Claude',
      modelLabel: 'Sonnet',
      workspaceLabel: 'Proma',
      engineLabel: 'Pi Agent RPC',
      runtimeReady: true,
    })
  })

  test('Given 成员未绑定渠道 When 解析运行时标签 Then 标记运行时未就绪', () => {
    const labels = getRoomMemberRuntimeLabels({
      member: member('agent-1', 'Builder'),
      channels: [],
      workspaces: [],
    })

    expect(labels.runtimeReady).toBe(false)
    expect(labels.channelLabel).toBe('未配置渠道')
  })

  test('Given 新成员表单 When 构建保存输入 Then 裁剪文本并忽略空可选项', () => {
    const state = createRoomMemberFormState({ roomId: 'room-1', memberCount: 0 })
    const input = buildRoomMemberSaveInput('room-1', {
      ...state,
      name: ' Planner ',
      avatar: ' ',
      rolePrompt: ' 负责拆解计划 ',
      channelId: 'channel-1',
      modelId: '',
      workspaceId: '',
      agentEngine: 'pi',
      privateMemorySummary: ' ',
    })

    expect(input).toEqual(expect.objectContaining({
      roomId: 'room-1',
      name: 'Planner',
      rolePrompt: '负责拆解计划',
      channelId: 'channel-1',
      enabled: true,
      listenMode: 'listen-and-score',
      permissionMode: 'plan',
      agentEngine: 'pi',
    }))
    expect(input.avatar).toBeUndefined()
    expect(input.modelId).toBeUndefined()
    expect(input.workspaceId).toBeUndefined()
    expect(input.privateMemorySummary).toBeUndefined()
  })

  test('Given 第二个新成员表单 When 构建默认状态 Then 默认使用执行权限', () => {
    const state = createRoomMemberFormState({ roomId: 'room-1', memberCount: 1 })

    expect(state.name).toBe('Agent 2')
    expect(state.permissionMode).toBe('bypassPermissions')
  })

  test('Given 输入 @ When 解析 mention Then 返回活跃查询', () => {
    expect(getRoomMentionQuery('请 @Co', 5)).toEqual({ active: true, startIndex: 2, query: 'Co' })
    expect(getRoomMentionQuery('请 @Co der', 8).active).toBe(false)
  })

  test('Given 成员列表 When 根据 mention query 过滤 Then 只返回启用且匹配的成员', () => {
    const coder = member('agent-1', 'Coder')
    const planner = { ...member('agent-2', 'Planner'), enabled: false }

    expect(getMentionableMembers({ members: [coder, planner], query: 'co' }).map((item) => item.name)).toEqual(['Coder'])
  })

  test('Given mention query When 插入成员 Then 替换当前 @片段并返回新光标', () => {
    const query = getRoomMentionQuery('请 @Co 看看', 5)
    const result = insertRoomMention('请 @Co 看看', 5, query, 'Coder')

    expect(result.value).toBe('请 @Coder 看看')
    expect(result.cursorIndex).toBe(9)
  })
})
