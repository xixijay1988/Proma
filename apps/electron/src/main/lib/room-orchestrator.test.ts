import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function runRoomScript(script: string): string {
  const homeDir = mkdtempSync(join(tmpdir(), 'proma-room-orchestrator-'))
  try {
    const result = Bun.spawnSync({
      cmd: [process.execPath, '--eval', script],
      cwd: import.meta.dir,
      env: {
        ...process.env,
        HOME: homeDir,
        PROMA_DEV: undefined,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const stdout = result.stdout.toString()
    const stderr = result.stderr.toString()
    expect(result.exitCode, stderr || stdout).toBe(0)
    return stdout.trim()
  } finally {
    rmSync(homeDir, { recursive: true, force: true })
  }
}

describe('room-orchestrator', () => {
  test('Given Room directive blocks When parsing content Then returns structured directives', () => {
    const output = runRoomScript(`
      const { parseRoomDirectives } = await import('./room-directives.ts')

      const directives = parseRoomDirectives(\`我会派发任务。

::room-handoff{to="Coder" reason="实现页面"}\\n请实现热点日报页面。
::

::room-wait-user{reason="确认视觉风格"}\\n请确认是否使用卡片布局。
::\`)

      console.log(JSON.stringify(directives))
    `)

    expect(JSON.parse(output.split('\n').at(-1) ?? '[]')).toEqual([
      {
        kind: 'room-handoff',
        attrs: { to: 'Coder', reason: '实现页面' },
        body: '请实现热点日报页面。',
      },
      {
        kind: 'room-wait-user',
        attrs: { reason: '确认视觉风格' },
        body: '请确认是否使用卡片布局。',
      },
    ])
  })

  test('Given plain mentions without directives When parsing content Then returns no directives', () => {
    const output = runRoomScript(`
      const { parseRoomDirectives } = await import('./room-directives.ts')

      console.log(JSON.stringify(parseRoomDirectives('收到用户确认后，我再 @Coder 执行动作。')))
    `)

    expect(JSON.parse(output.split('\n').at(-1) ?? '[]')).toEqual([])
  })

  test('Given an @mention When sending room message Then routes to the mentioned member', () => {
    const output = runRoomScript(`
      const { createRoom, getRoomMessages, saveRoomMember } = await import('./room-manager.ts')
      const { createAgentInputFromRoomRunPlan, sendRoomMessage } = await import('./room-orchestrator.ts')

      const room = createRoom({ title: '工程房间' })
      const member = saveRoomMember({
        roomId: room.id,
        name: 'Pat',
        rolePrompt: '整理需求。',
        listenMode: 'listen-and-score',
      })

      const result = sendRoomMessage({ roomId: room.id, content: '@Pat 帮我整理验收标准' })
      const messages = getRoomMessages(room.id)
      console.log(JSON.stringify({
        routed: result.routedMessages.length,
        drafts: result.drafts.length,
        agentAuthor: messages.find((message) => message.role === 'agent')?.authorId,
        total: messages.length,
        memberId: member.id,
        status: messages.find((message) => message.role === 'agent')?.status,
        content: messages.find((message) => message.role === 'agent')?.content,
      }))
    `)

    const result = JSON.parse(output.split('\n').at(-1) ?? '{}')
    expect(result.routed).toBe(1)
    expect(result.drafts).toBe(0)
    expect(result.agentAuthor).toBe(result.memberId)
    expect(result.total).toBe(2)
    expect(result.status).toBe('final')
    expect(result.content).toContain('尚未配置渠道')
  })

  test('Given a member with runtime bindings When mentioned Then returns an Agent run plan with room context', () => {
    const output = runRoomScript(`
      const { mkdirSync, writeFileSync } = await import('node:fs')
      const { getAgentWorkspacesIndexPath, getWorkspaceFilesDir } = await import('./config-paths.ts')
      const { appendRoomMessage, createRoom, saveRoomMember, saveRoomSummary } = await import('./room-manager.ts')
      const { sendRoomMessage } = await import('./room-orchestrator.ts')

      writeFileSync(getAgentWorkspacesIndexPath(), JSON.stringify({
        version: 2,
        workspaces: [{ id: 'workspace-1', name: '测试工作区', slug: 'test-workspace', createdAt: 1, updatedAt: 1 }],
      }))
      mkdirSync(getWorkspaceFilesDir('test-workspace'), { recursive: true })

      const room = createRoom({ title: '工程房间' })
      appendRoomMessage(room.id, {
        id: 'old-1',
        roomId: room.id,
        role: 'human',
        content: '我们正在做 Slock Room。',
        status: 'final',
        createdAt: 1,
        updatedAt: 1,
      })
      saveRoomSummary(room.id, '房间正在讨论 Agent 协作能力。')
      const member = saveRoomMember({
        roomId: room.id,
        name: 'Builder',
        avatar: '🛠️',
        rolePrompt: '你负责把需求拆成可执行开发步骤。',
        channelId: 'channel-1',
        modelId: 'model-1',
        workspaceId: 'workspace-1',
        permissionMode: 'ask',
        privateMemorySummary: '偏好先写测试再实现。',
        listenMode: 'listen-and-score',
      })

      const result = sendRoomMessage({ roomId: room.id, content: '@Builder 请实现真实 runtime 接入计划' })
      const plan = result.runPlans[0]
      console.log(JSON.stringify({
        runPlans: result.runPlans.length,
        memberId: plan?.memberId,
        outputMessageId: plan?.outputMessageId,
        channelId: plan?.channelId,
        modelId: plan?.modelId,
        workspaceId: plan?.workspaceId,
        permissionMode: plan?.permissionMode,
        triggerType: plan?.triggerType,
        hasSummary: plan?.prompt.includes('房间正在讨论 Agent 协作能力。'),
        hasPrivateMemory: plan?.prompt.includes('偏好先写测试再实现。'),
        hasRolePrompt: plan?.systemPrompt.includes('你负责把需求拆成可执行开发步骤。'),
        hasCompleteTaskInstruction: plan?.systemPrompt.includes('请在本轮完成实际操作'),
        hasFullHandoffInstruction: plan?.systemPrompt.includes('完整、可执行的最终目标'),
        executorDoesNotAskHumanDirectly: plan?.systemPrompt.includes('执行成员不要直接向用户确认方案'),
        executorEscalatesToCoordinator: plan?.systemPrompt.includes('@协调/规划/验收成员'),
        hasWorkspaceFilesAbsolutePathRule: plan?.prompt.includes('工作区持久文件目录') && plan.prompt.includes('/workspace-files'),
        warnsRelativeWorkspaceFilesPath: plan?.prompt.includes('不要把 workspace-files/xxx 当作相对 cwd 路径'),
        hasHistory: plan?.prompt.includes('我们正在做 Slock Room。'),
        sameMember: plan?.memberId === member.id,
        status: result.routedMessages[0]?.status,
        placeholder: result.routedMessages[0]?.content,
      }))
    `)

    expect(JSON.parse(output.split('\n').at(-1) ?? '{}')).toEqual({
      runPlans: 1,
      memberId: expect.any(String),
      outputMessageId: expect.any(String),
      channelId: 'channel-1',
      modelId: 'model-1',
      workspaceId: 'workspace-1',
      permissionMode: 'ask',
      triggerType: 'mention',
      hasSummary: true,
      hasPrivateMemory: true,
      hasRolePrompt: true,
      hasCompleteTaskInstruction: true,
      hasFullHandoffInstruction: true,
      executorDoesNotAskHumanDirectly: true,
      executorEscalatesToCoordinator: true,
      hasWorkspaceFilesAbsolutePathRule: true,
      warnsRelativeWorkspaceFilesPath: true,
      hasHistory: true,
      sameMember: true,
      status: 'streaming',
      placeholder: 'Builder 正在思考...',
    })
  })

  test('Given CEO coordinator is mentioned When building run plan Then it delegates instead of executing tools', () => {
    const output = runRoomScript(`
      const { createRoom, saveRoomMember } = await import('./room-manager.ts')
      const { createAgentInputFromRoomRunPlan, sendRoomMessage } = await import('./room-orchestrator.ts')

      const room = createRoom({ title: 'CEO 协调房间' })
      const ceo = saveRoomMember({
        roomId: room.id,
        name: 'CEO',
        rolePrompt: '负责派发任务。',
        channelId: 'ceo-channel',
        permissionMode: 'bypassPermissions',
        listenMode: 'listen-and-score',
      })
      saveRoomMember({
        roomId: room.id,
        name: 'Coder',
        rolePrompt: '负责实现代码。',
        channelId: 'coder-channel',
        listenMode: 'mention-only',
      })

      const result = sendRoomMessage({ roomId: room.id, content: '@CEO 帮我创建一个每日 AI 热点的小报展示页面' })
      const plan = result.runPlans[0]
      const agentInput = createAgentInputFromRoomRunPlan(plan)
      console.log(JSON.stringify({
        sameMember: plan?.memberId === ceo.id,
        isCoordinatorPrompt: plan?.systemPrompt.includes('协调/规划/验收角色特别规则'),
        hasExecutorRule: plan?.systemPrompt.includes('执行成员交付规则'),
        hasGenericDoActualWork: plan?.systemPrompt.includes('如果任务属于你的职责并且你能直接完成'),
        forbidsDirectTools: plan?.systemPrompt.includes('即使你具备工具权限，也不要使用 Write/Edit/Bash'),
        listsCoderAsExecutor: plan?.systemPrompt.includes('可派发执行成员：@Coder'),
        requiresHandoffDirective: plan?.systemPrompt.includes('::room-handoff{to="Coder"'),
        plainMentionDoesNotWake: plan?.systemPrompt.includes('普通正文里的 @成员 只表示提及，不会唤醒成员'),
        blocksCoordinatorTools: agentInput.disallowedTools?.includes('Read') && agentInput.disallowedTools?.includes('Bash') && agentInput.disallowedTools?.includes('Write'),
        permissionMode: plan?.permissionMode,
      }))
    `)

    expect(JSON.parse(output.split('\n').at(-1) ?? '{}')).toEqual({
      sameMember: true,
      isCoordinatorPrompt: true,
      hasExecutorRule: false,
      hasGenericDoActualWork: false,
      forbidsDirectTools: true,
      listsCoderAsExecutor: true,
      requiresHandoffDirective: true,
      plainMentionDoesNotWake: true,
      blocksCoordinatorTools: true,
      permissionMode: 'plan',
    })
  })

  test('Given coordinator has no executor When building run plan Then it must not self execute', () => {
    const output = runRoomScript(`
      const { createRoom, saveRoomMember } = await import('./room-manager.ts')
      const { sendRoomMessage } = await import('./room-orchestrator.ts')

      const room = createRoom({ title: '单协调房间' })
      saveRoomMember({
        roomId: room.id,
        name: 'CEO',
        rolePrompt: '负责派发任务。',
        channelId: 'ceo-channel',
        permissionMode: 'bypassPermissions',
        listenMode: 'listen-and-score',
      })

      const result = sendRoomMessage({ roomId: room.id, content: '@CEO 帮我创建一个每日 AI 热点的小报展示页面' })
      const plan = result.runPlans[0]
      console.log(JSON.stringify({
        permissionMode: plan?.permissionMode,
        noExecutorWarning: plan?.systemPrompt.includes('当前没有可派发执行成员'),
        forbidsDirectTools: plan?.systemPrompt.includes('不要自己直接实现'),
      }))
    `)

    expect(JSON.parse(output.split('\n').at(-1) ?? '{}')).toEqual({
      permissionMode: 'plan',
      noExecutorWarning: true,
      forbidsDirectTools: true,
    })
  })

  test('Given multiple Room channels When sending a message Then Agent context stays in current channel', () => {
    const output = runRoomScript(`
      const { appendRoomMessage, createRoom, createRoomChannel, saveRoomMember } = await import('./room-manager.ts')
      const { sendRoomMessage } = await import('./room-orchestrator.ts')

      const room = createRoom({ title: '频道协作房间' })
      const frontend = createRoomChannel({ roomId: room.id, name: 'frontend' })
      appendRoomMessage(room.id, {
        id: 'general-old',
        roomId: room.id,
        roomChannelId: 'general',
        role: 'human',
        content: '这是默认频道的旧消息，不应进入前端频道上下文。',
        status: 'final',
        createdAt: 1,
        updatedAt: 1,
      })
      const member = saveRoomMember({
        roomId: room.id,
        name: 'Coder',
        rolePrompt: '负责实现代码。',
        channelId: 'channel-1',
        listenMode: 'mention-only',
      })

      const result = sendRoomMessage({ roomId: room.id, roomChannelId: frontend.id, content: '@Coder 请实现按钮样式' })
      const plan = result.runPlans[0]
      console.log(JSON.stringify({
        runPlans: result.runPlans.length,
        planChannelId: plan?.roomChannelId,
        messageChannelId: result.userMessage.roomChannelId,
        hasCurrentChannel: plan?.prompt.includes('当前频道：#' + frontend.id),
        leakedGeneralHistory: plan?.prompt.includes('默认频道的旧消息'),
        sameMember: plan?.memberId === member.id,
      }))
    `)

    expect(JSON.parse(output.split('\n').at(-1) ?? '{}')).toEqual({
      runPlans: 1,
      planChannelId: expect.any(String),
      messageChannelId: expect.any(String),
      hasCurrentChannel: true,
      leakedGeneralHistory: false,
      sameMember: true,
    })
  })

  test('Given an injected Agent runner When member is triggered Then replaces placeholder with runner output', () => {
    const output = runRoomScript(`
      const { createRoom, getRoomMessages, saveRoomMember } = await import('./room-manager.ts')
      const { sendRoomMessage } = await import('./room-orchestrator.ts')

      const room = createRoom({ title: '真实回复房间' })
      saveRoomMember({
        roomId: room.id,
        name: 'Builder',
        rolePrompt: '负责实现。',
        listenMode: 'listen-and-score',
      })

      const result = sendRoomMessage(
        { roomId: room.id, content: '@Builder 请给出下一步' },
        {
          runAgent: (plan) => {
            return {
              content: '真实 runner 输出：下一步先接流式事件。',
              status: 'final',
              outputMessageId: plan.outputMessageId,
            }
          },
        },
      )
      const agentMessage = getRoomMessages(room.id).find((message) => message.role === 'agent')
      console.log(JSON.stringify({
        runPlans: result.runPlans.length,
        returnedContent: result.routedMessages[0]?.content,
        storedContent: agentMessage?.content,
        status: agentMessage?.status,
      }))
    `)

    expect(JSON.parse(output.split('\n').at(-1) ?? '{}')).toEqual({
      runPlans: 1,
      returnedContent: '真实 runner 输出：下一步先接流式事件。',
      storedContent: '真实 runner 输出：下一步先接流式事件。',
      status: 'final',
    })
  })

  test('Given an Agent reply mentions another member When routing mentions Then starts the mentioned member', () => {
    const output = runRoomScript(`
      const { createRoom, getRoomMessages, saveRoomMember } = await import('./room-manager.ts')
      const { replaceRoomMessageContent, routeRoomAgentMentions, sendRoomMessage } = await import('./room-orchestrator.ts')

      const room = createRoom({ title: '协作房间' })
      const planner = saveRoomMember({
        roomId: room.id,
        name: 'Planner',
        rolePrompt: '负责规划并分派任务。',
        channelId: 'planner-channel',
        listenMode: 'listen-and-score',
      })
      const coder = saveRoomMember({
        roomId: room.id,
        name: 'Coder',
        rolePrompt: '负责实现代码。',
        channelId: 'coder-channel',
        modelId: 'coder-model',
        listenMode: 'mention-only',
      })

      const first = sendRoomMessage({ roomId: room.id, content: '@Planner 请规划 Todo 应用' })
      const plannerOutputId = first.routedMessages[0]?.id
      replaceRoomMessageContent(room.id, plannerOutputId, \`我已经完成规划，现在派发实现。\n\n::room-handoff{to="Coder" reason="实现 Todo 网页应用"}\\n请按照计划实现 Todo 网页应用。\n::\`, 'final')
      const routed = routeRoomAgentMentions({
        roomId: room.id,
        sourceMessageId: plannerOutputId,
        excludeMemberId: planner.id,
      })
      const messages = getRoomMessages(room.id)
      const coderMessage = messages.find((message) => message.authorId === coder.id)
      const plan = routed.runPlans[0]
      console.log(JSON.stringify({
        routedMessages: routed.routedMessages.length,
        runPlans: routed.runPlans.length,
        memberId: plan?.memberId,
        channelId: plan?.channelId,
        modelId: plan?.modelId,
        triggerType: plan?.triggerType,
        status: coderMessage?.status,
        content: coderMessage?.content,
        promptHasPlannerOutput: plan?.prompt.includes('请按照计划实现 Todo 网页应用。'),
        promptShowsTriggerSender: plan?.prompt.includes('发送者：Agent(@Planner)'),
        systemPromptRequiresPlannerReview: plan?.systemPrompt.includes('@Planner') && plan.systemPrompt.includes('room-handoff') && plan.systemPrompt.includes('验收'),
      }))
    `)

    expect(JSON.parse(output.split('\n').at(-1) ?? '{}')).toEqual({
      routedMessages: 1,
      runPlans: 1,
      memberId: expect.any(String),
      channelId: 'coder-channel',
      modelId: 'coder-model',
      triggerType: 'agent-mention',
      status: 'streaming',
      content: 'Coder 正在思考...',
      promptHasPlannerOutput: true,
      promptShowsTriggerSender: true,
      systemPromptRequiresPlannerReview: true,
    })
  })

  test('Given an Agent praise mentions another member When routing mentions Then does not start a new run', () => {
    const output = runRoomScript(`
      const { createRoom, getRoomMessages, saveRoomMember } = await import('./room-manager.ts')
      const { replaceRoomMessageContent, routeRoomAgentMentions, sendRoomMessage } = await import('./room-orchestrator.ts')

      const room = createRoom({ title: '验收房间' })
      const planner = saveRoomMember({
        roomId: room.id,
        name: 'Planner',
        rolePrompt: '负责验收。',
        channelId: 'planner-channel',
        listenMode: 'listen-and-score',
      })
      saveRoomMember({
        roomId: room.id,
        name: 'Coder',
        rolePrompt: '负责实现代码。',
        channelId: 'coder-channel',
        listenMode: 'mention-only',
      })

      const first = sendRoomMessage({ roomId: room.id, content: '@Planner 请验收 Todo 应用' })
      const plannerOutputId = first.routedMessages[0]?.id
      replaceRoomMessageContent(room.id, plannerOutputId, '**@Coder** 交付质量很好，验收通过。用户，Todo 网页应用已完成。', 'final')
      const routed = routeRoomAgentMentions({
        roomId: room.id,
        sourceMessageId: plannerOutputId,
        excludeMemberId: planner.id,
      })
      console.log(JSON.stringify({
        routedMessages: routed.routedMessages.length,
        runPlans: routed.runPlans.length,
        totalMessages: getRoomMessages(room.id).length,
      }))
    `)

    expect(JSON.parse(output.split('\n').at(-1) ?? '{}')).toEqual({
      routedMessages: 0,
      runPlans: 0,
      totalMessages: 2,
    })
  })

  test('Given an Agent waits for human decisions When routing mentions Then does not start executor early', () => {
    const output = runRoomScript(`
      const { createRoom, getRoomMessages, saveRoomMember } = await import('./room-manager.ts')
      const { replaceRoomMessageContent, routeRoomAgentMentions, sendRoomMessage } = await import('./room-orchestrator.ts')

      const room = createRoom({ title: '需求确认房间' })
      const planner = saveRoomMember({
        roomId: room.id,
        name: 'Planner',
        rolePrompt: '负责规划并向用户澄清需求。',
        channelId: 'planner-channel',
        listenMode: 'listen-and-score',
      })
      saveRoomMember({
        roomId: room.id,
        name: 'Coder',
        rolePrompt: '负责实现代码。',
        channelId: 'coder-channel',
        listenMode: 'mention-only',
      })

      const first = sendRoomMessage({ roomId: room.id, content: '@Planner 请规划热点日报页面' })
      const plannerOutputId = first.routedMessages[0]?.id
      const plan = first.runPlans[0]
      replaceRoomMessageContent(
        room.id,
        plannerOutputId,
        '我需要 @Human 回答 5 个问题确认工作方案。你先给个方向，我来出方案再派活给 @Coder 执行。',
        'final',
      )
      const routed = routeRoomAgentMentions({
        roomId: room.id,
        sourceMessageId: plannerOutputId,
        excludeMemberId: planner.id,
      })
      console.log(JSON.stringify({
        routedMessages: routed.routedMessages.length,
        runPlans: routed.runPlans.length,
        totalMessages: getRoomMessages(room.id).length,
        promptRequiresAskUser: plan?.systemPrompt.includes('必须调用 AskUserQuestion'),
        promptBlocksExecutorWhileWaiting: plan?.systemPrompt.includes('等待用户回答期间，不要派发执行成员'),
      }))
    `)

    expect(JSON.parse(output.split('\n').at(-1) ?? '{}')).toEqual({
      routedMessages: 0,
      runPlans: 0,
      totalMessages: 2,
      promptRequiresAskUser: true,
      promptBlocksExecutorWhileWaiting: true,
    })
  })

  test('Given an Agent mentions future handoff in plain text When routing mentions Then does not start executor', () => {
    const output = runRoomScript(`
      const { createRoom, getRoomMessages, saveRoomMember } = await import('./room-manager.ts')
      const { replaceRoomMessageContent, routeRoomAgentMentions, sendRoomMessage } = await import('./room-orchestrator.ts')

      const room = createRoom({ title: '显式编排房间' })
      const planner = saveRoomMember({
        roomId: room.id,
        name: 'Planner',
        rolePrompt: '负责规划并派发任务。',
        channelId: 'planner-channel',
        listenMode: 'listen-and-score',
      })
      saveRoomMember({
        roomId: room.id,
        name: 'Coder',
        rolePrompt: '负责实现代码。',
        channelId: 'coder-channel',
        listenMode: 'mention-only',
      })

      const first = sendRoomMessage({ roomId: room.id, content: '@Planner 请规划热点日报页面' })
      const plannerOutputId = first.routedMessages[0]?.id
      replaceRoomMessageContent(
        room.id,
        plannerOutputId,
        '我会先等待用户确认方案。收到确认后，我再 @Coder 执行动作。',
        'final',
      )
      const routed = routeRoomAgentMentions({
        roomId: room.id,
        sourceMessageId: plannerOutputId,
        excludeMemberId: planner.id,
      })
      console.log(JSON.stringify({
        routedMessages: routed.routedMessages.length,
        runPlans: routed.runPlans.length,
        totalMessages: getRoomMessages(room.id).length,
      }))
    `)

    expect(JSON.parse(output.split('\n').at(-1) ?? '{}')).toEqual({
      routedMessages: 0,
      runPlans: 0,
      totalMessages: 2,
    })
  })

  test('Given executor has coordinator and tester When building run plan Then prompt requires explicit review handoff', () => {
    const output = runRoomScript(`
      const { createRoom, saveRoomMember } = await import('./room-manager.ts')
      const { sendRoomMessage } = await import('./room-orchestrator.ts')

      const room = createRoom({ title: '交付验收房间' })
      const coder = saveRoomMember({
        roomId: room.id,
        name: 'Linus',
        rolePrompt: '负责代码实现。',
        channelId: 'coder-channel',
        listenMode: 'mention-only',
      })
      saveRoomMember({
        roomId: room.id,
        name: 'Elon',
        rolePrompt: '你是 Room 中的主 Agent，负责规划、编排和验收。',
        channelId: 'planner-channel',
        listenMode: 'mention-only',
      })
      saveRoomMember({
        roomId: room.id,
        name: 'Turing',
        rolePrompt: '负责测试验收与质量检查。',
        channelId: 'tester-channel',
        listenMode: 'mention-only',
      })

      const first = sendRoomMessage({ roomId: room.id, content: '@Linus 请实现页面，完成后让主 Agent 和测试 Agent 验收' })
      const plan = first.runPlans[0]
      console.log(JSON.stringify({
        memberId: plan?.memberId,
        hasPlainAtInstruction: plan?.systemPrompt.includes('回复末尾 @原协调成员 请求验收'),
        hasExplicitHandoffInstruction: plan?.systemPrompt.includes('完成后需要验收') && plan.systemPrompt.includes('room-handoff'),
        mentionsMultipleHandoff: plan?.systemPrompt.includes('多个成员都需要继续时'),
      }))
    `)

    expect(JSON.parse(output.split('\n').at(-1) ?? '{}')).toEqual({
      memberId: expect.any(String),
      hasPlainAtInstruction: false,
      hasExplicitHandoffInstruction: true,
      mentionsMultipleHandoff: true,
    })
  })

  test('Given tester validates successfully When building run plan Then prompt requires final coordinator confirmation', () => {
    const output = runRoomScript(`
      const { createRoom, saveRoomMember } = await import('./room-manager.ts')
      const { sendRoomMessage } = await import('./room-orchestrator.ts')

      const room = createRoom({ title: '最终确认房间' })
      saveRoomMember({
        roomId: room.id,
        name: 'Elon',
        rolePrompt: '你是 Room 中的主 Agent，负责最终确认和对用户总结。',
        channelId: 'planner-channel',
        listenMode: 'mention-only',
      })
      const tester = saveRoomMember({
        roomId: room.id,
        name: 'Turing',
        rolePrompt: '负责测试验收与质量检查。',
        channelId: 'tester-channel',
        listenMode: 'mention-only',
      })

      const first = sendRoomMessage({ roomId: room.id, content: '@Turing 请测试验收，完成后交给主 Agent 最终确认' })
      const plan = first.runPlans[0]
      console.log(JSON.stringify({
        memberId: plan?.memberId,
        memberName: plan?.memberName,
        requiresFinalCoordinatorHandoff: plan?.systemPrompt.includes('验收通过') && plan.systemPrompt.includes('最终确认') && plan.systemPrompt.includes('room-handoff'),
      }))
    `)

    expect(JSON.parse(output.split('\n').at(-1) ?? '{}')).toEqual({
      memberId: expect.any(String),
      memberName: 'Turing',
      requiresFinalCoordinatorHandoff: true,
    })
  })

  test('Given executor asks current review with plain mentions When routing mentions Then compatibility handoff wakes mentioned reviewers', () => {
    const output = runRoomScript(`
      const { createRoom, getRoomMessages, saveRoomMember } = await import('./room-manager.ts')
      const { replaceRoomMessageContent, routeRoomAgentMentions, sendRoomMessage } = await import('./room-orchestrator.ts')

      const room = createRoom({ title: '验收兼容房间' })
      const coder = saveRoomMember({
        roomId: room.id,
        name: 'Linus',
        rolePrompt: '负责代码实现。',
        channelId: 'coder-channel',
        listenMode: 'mention-only',
      })
      const elon = saveRoomMember({
        roomId: room.id,
        name: 'Elon',
        rolePrompt: '你是 Room 中的主 Agent，负责规划、编排和验收。',
        channelId: 'planner-channel',
        listenMode: 'mention-only',
      })
      const turing = saveRoomMember({
        roomId: room.id,
        name: 'Turing',
        rolePrompt: '负责测试验收与质量检查。',
        channelId: 'tester-channel',
        listenMode: 'mention-only',
      })

      const first = sendRoomMessage({ roomId: room.id, content: '@Linus 请实现页面' })
      const coderOutputId = first.routedMessages[0]?.id
      replaceRoomMessageContent(
        room.id,
        coderOutputId,
        ${JSON.stringify('完成。已生成 workspace-files/room-org.html。\n\n@Elon 请 @Turing 进行测试验收。')},
        'final',
      )
      const routed = routeRoomAgentMentions({
        roomId: room.id,
        sourceMessageId: coderOutputId,
        excludeMemberId: coder.id,
      })
      console.log(JSON.stringify({
        routedMessages: routed.routedMessages.length,
        runPlans: routed.runPlans.length,
        memberNames: routed.runPlans.map((plan) => plan.memberName).sort(),
        statuses: getRoomMessages(room.id).filter((message) => [elon.id, turing.id].includes(message.authorId)).map((message) => message.status).sort(),
      }))
    `)

    expect(JSON.parse(output.split('\n').at(-1) ?? '{}')).toEqual({
      routedMessages: 2,
      runPlans: 2,
      memberNames: ['Elon', 'Turing'],
      statuses: ['streaming', 'streaming'],
    })
  })

  test('Given an Agent emits a handoff directive When routing mentions Then starts target member', () => {
    const output = runRoomScript(`
      const { createRoom, getRoomMessages, saveRoomMember } = await import('./room-manager.ts')
      const { replaceRoomMessageContent, routeRoomAgentMentions, sendRoomMessage } = await import('./room-orchestrator.ts')

      const room = createRoom({ title: '显式派发房间' })
      const planner = saveRoomMember({
        roomId: room.id,
        name: 'Planner',
        rolePrompt: '负责规划并派发任务。',
        channelId: 'planner-channel',
        listenMode: 'listen-and-score',
      })
      const coder = saveRoomMember({
        roomId: room.id,
        name: 'Coder',
        rolePrompt: '负责实现代码。',
        channelId: 'coder-channel',
        modelId: 'coder-model',
        listenMode: 'mention-only',
      })

      const first = sendRoomMessage({ roomId: room.id, content: '@Planner 请规划热点日报页面' })
      const plannerOutputId = first.routedMessages[0]?.id
      replaceRoomMessageContent(
        room.id,
        plannerOutputId,
        \`方案已经确认，现在派发实现。

::room-handoff{to="Coder" reason="实现热点日报页面"}\\n请实现热点日报页面，完成后请求 Planner 验收。
::\`,
        'final',
      )
      const routed = routeRoomAgentMentions({
        roomId: room.id,
        sourceMessageId: plannerOutputId,
        excludeMemberId: planner.id,
      })
      const coderMessage = getRoomMessages(room.id).find((message) => message.authorId === coder.id)
      const plan = routed.runPlans[0]
      console.log(JSON.stringify({
        routedMessages: routed.routedMessages.length,
        runPlans: routed.runPlans.length,
        memberId: plan?.memberId,
        promptHasDirectiveBody: plan?.prompt.includes('请实现热点日报页面，完成后请求 Planner 验收。'),
        status: coderMessage?.status,
      }))
    `)

    expect(JSON.parse(output.split('\n').at(-1) ?? '{}')).toEqual({
      routedMessages: 1,
      runPlans: 1,
      memberId: expect.any(String),
      promptHasDirectiveBody: true,
      status: 'streaming',
    })
  })

  test('Given an Agent assigns work and says no confirmation is needed When routing mentions Then starts the executor', () => {
    const output = runRoomScript(`
      const { createRoom, getRoomMessages, saveRoomMember } = await import('./room-manager.ts')
      const { replaceRoomMessageContent, routeRoomAgentMentions, sendRoomMessage } = await import('./room-orchestrator.ts')

      const room = createRoom({ title: '直接执行房间' })
      const ceo = saveRoomMember({
        roomId: room.id,
        name: 'CEO',
        rolePrompt: '负责派发任务。',
        channelId: 'ceo-channel',
        listenMode: 'listen-and-score',
      })
      const coder = saveRoomMember({
        roomId: room.id,
        name: 'Coder',
        rolePrompt: '负责实现代码。',
        channelId: 'coder-channel',
        listenMode: 'mention-only',
      })

      const first = sendRoomMessage({ roomId: room.id, content: '@CEO 帮我创建一个每日 AI 热点小报展示页面' })
      const ceoOutputId = first.routedMessages[0]?.id
      replaceRoomMessageContent(
        room.id,
        ceoOutputId,
        \`不需要确认，直接派发执行。\n\n::room-handoff{to="Coder" reason="直接实现"}\\n请实现 React + Vite 页面，完成后请求 Tester 验收。\n::\`,
        'final',
      )
      const routed = routeRoomAgentMentions({
        roomId: room.id,
        sourceMessageId: ceoOutputId,
        excludeMemberId: ceo.id,
      })
      const coderMessage = getRoomMessages(room.id).find((message) => message.authorId === coder.id)
      console.log(JSON.stringify({
        routedMessages: routed.routedMessages.length,
        runPlans: routed.runPlans.length,
        status: coderMessage?.status,
        content: coderMessage?.content,
      }))
    `)

    expect(JSON.parse(output.split('\n').at(-1) ?? '{}')).toEqual({
      routedMessages: 1,
      runPlans: 1,
      status: 'streaming',
      content: 'Coder 正在思考...',
    })
  })

  test('Given an Agent explicitly dismisses a mentioned member When routing mentions Then does not start the member', () => {
    const output = runRoomScript(`
      const { createRoom, getRoomMessages, saveRoomMember } = await import('./room-manager.ts')
      const { replaceRoomMessageContent, routeRoomAgentMentions, sendRoomMessage } = await import('./room-orchestrator.ts')

      const room = createRoom({ title: '无需参与房间' })
      const planner = saveRoomMember({
        roomId: room.id,
        name: 'Planner',
        rolePrompt: '负责验收。',
        channelId: 'planner-channel',
        listenMode: 'listen-and-score',
      })
      saveRoomMember({
        roomId: room.id,
        name: 'Coder',
        rolePrompt: '负责实现代码。',
        channelId: 'coder-channel',
        listenMode: 'mention-only',
      })

      const first = sendRoomMessage({ roomId: room.id, content: '@Planner 请检查任务状态' })
      const plannerOutputId = first.routedMessages[0]?.id
      replaceRoomMessageContent(room.id, plannerOutputId, '@Coder 不需要处理了，我直接向用户总结。', 'final')
      const routed = routeRoomAgentMentions({
        roomId: room.id,
        sourceMessageId: plannerOutputId,
        excludeMemberId: planner.id,
      })
      console.log(JSON.stringify({
        routedMessages: routed.routedMessages.length,
        runPlans: routed.runPlans.length,
        totalMessages: getRoomMessages(room.id).length,
      }))
    `)

    expect(JSON.parse(output.split('\n').at(-1) ?? '{}')).toEqual({
      routedMessages: 0,
      runPlans: 0,
      totalMessages: 2,
    })
  })

  test('Given an Agent mentions a member in history and later assigns work When routing mentions Then uses the assigning mention', () => {
    const output = runRoomScript(`
      const { createRoom, getRoomMessages, saveRoomMember } = await import('./room-manager.ts')
      const { replaceRoomMessageContent, routeRoomAgentMentions, sendRoomMessage } = await import('./room-orchestrator.ts')

      const room = createRoom({ title: '多次提及房间' })
      const planner = saveRoomMember({
        roomId: room.id,
        name: 'Planner',
        rolePrompt: '负责规划。',
        channelId: 'planner-channel',
        listenMode: 'listen-and-score',
      })
      const coder = saveRoomMember({
        roomId: room.id,
        name: 'Coder',
        rolePrompt: '负责实现代码。',
        channelId: 'coder-channel',
        listenMode: 'mention-only',
      })

      const first = sendRoomMessage({ roomId: room.id, content: '@Planner 请处理删除请求' })
      const plannerOutputId = first.routedMessages[0]?.id
      replaceRoomMessageContent(
        room.id,
        plannerOutputId,
        '之前 @Coder 已经完成过一次实现。现在用户要求删除它。\\n\\n::room-handoff{to="Coder" reason="删除文件"}\\n请删除当前工作目录下的 index.html 文件，完成后告知。\\n::',
        'final',
      )
      const routed = routeRoomAgentMentions({
        roomId: room.id,
        sourceMessageId: plannerOutputId,
        excludeMemberId: planner.id,
      })
      const coderMessage = getRoomMessages(room.id).find((message) => message.authorId === coder.id)
      console.log(JSON.stringify({
        routedMessages: routed.routedMessages.length,
        runPlans: routed.runPlans.length,
        status: coderMessage?.status,
        content: coderMessage?.content,
      }))
    `)

    expect(JSON.parse(output.split('\n').at(-1) ?? '{}')).toEqual({
      routedMessages: 1,
      runPlans: 1,
      status: 'streaming',
      content: 'Coder 正在思考...',
    })
  })

  test('Given a review finds issues When routing mentions Then allows one executor rework and final review', () => {
    const output = runRoomScript(`
      const { createRoom, getRoomMessages, saveRoomMember } = await import('./room-manager.ts')
      const { replaceRoomMessageContent, routeRoomAgentMentions, sendRoomMessage } = await import('./room-orchestrator.ts')

      const room = createRoom({ title: '返工房间' })
      const planner = saveRoomMember({
        roomId: room.id,
        name: 'Planner',
        rolePrompt: '负责规划。',
        channelId: 'planner-channel',
        listenMode: 'listen-and-score',
      })
      const coder = saveRoomMember({
        roomId: room.id,
        name: 'Coder',
        rolePrompt: '负责实现代码。',
        channelId: 'coder-channel',
        listenMode: 'mention-only',
      })

      const first = sendRoomMessage({ roomId: room.id, content: '@Planner 请规划 Todo 应用' })
      const plannerOutputId = first.routedMessages[0]?.id
      replaceRoomMessageContent(room.id, plannerOutputId, '::room-handoff{to="Coder" reason="实现 Todo 网页应用"}\\n请按照计划实现 Todo 网页应用。\\n::', 'final')
      const coderRoute = routeRoomAgentMentions({
        roomId: room.id,
        sourceMessageId: plannerOutputId,
        excludeMemberId: planner.id,
      })
      const coderOutputId = coderRoute.routedMessages[0]?.id
      replaceRoomMessageContent(room.id, coderOutputId, '::room-handoff{to="Planner" reason="验收实现结果"}\\n请验收实现结果。\\n::', 'final')
      const plannerRoute = routeRoomAgentMentions({
        roomId: room.id,
        sourceMessageId: coderOutputId,
        excludeMemberId: coder.id,
      })
      const reviewOutputId = plannerRoute.routedMessages[0]?.id
      replaceRoomMessageContent(room.id, reviewOutputId, '::room-handoff{to="Coder" reason="修复剩余问题"}\\n请继续修复剩余问题。\\n::', 'final')
      const reworkRoute = routeRoomAgentMentions({
        roomId: room.id,
        sourceMessageId: reviewOutputId,
        excludeMemberId: planner.id,
      })
      const reworkOutputId = reworkRoute.routedMessages[0]?.id
      replaceRoomMessageContent(room.id, reworkOutputId, '::room-handoff{to="Planner" reason="验收返工结果"}\\n请验收返工结果。\\n::', 'final')
      const finalReviewRoute = routeRoomAgentMentions({
        roomId: room.id,
        sourceMessageId: reworkOutputId,
        excludeMemberId: coder.id,
      })
      console.log(JSON.stringify({
        coderRuns: coderRoute.runPlans.length,
        plannerRuns: plannerRoute.runPlans.length,
        reworkRuns: reworkRoute.runPlans.length,
        finalReviewRuns: finalReviewRoute.runPlans.length,
        totalMessages: getRoomMessages(room.id).length,
      }))
    `)

    expect(JSON.parse(output.split('\n').at(-1) ?? '{}')).toEqual({
      coderRuns: 1,
      plannerRuns: 1,
      reworkRuns: 1,
      finalReviewRuns: 1,
      totalMessages: 6,
    })
  })

  test('Given Agents explicitly continue a long handoff chain When routing mentions Then follows agent loop decisions', () => {
    const output = runRoomScript(`
      const { createRoom, getRoomMessages, saveRoomMember } = await import('./room-manager.ts')
      const { replaceRoomMessageContent, routeRoomAgentMentions, sendRoomMessage } = await import('./room-orchestrator.ts')

      const room = createRoom({ title: '循环保护房间' })
      const planner = saveRoomMember({
        roomId: room.id,
        name: 'Planner',
        rolePrompt: '负责规划。',
        channelId: 'planner-channel',
        listenMode: 'listen-and-score',
      })
      const coder = saveRoomMember({
        roomId: room.id,
        name: 'Coder',
        rolePrompt: '负责实现代码。',
        channelId: 'coder-channel',
        listenMode: 'mention-only',
      })

      const first = sendRoomMessage({ roomId: room.id, content: '@Planner 请规划 Todo 应用' })
      const plannerOutputId = first.routedMessages[0]?.id
      replaceRoomMessageContent(room.id, plannerOutputId, '::room-handoff{to="Coder" reason="实现 Todo 网页应用"}\\n请按照计划实现 Todo 网页应用。\\n::', 'final')
      const coderRoute = routeRoomAgentMentions({ roomId: room.id, sourceMessageId: plannerOutputId, excludeMemberId: planner.id })
      const coderOutputId = coderRoute.routedMessages[0]?.id
      replaceRoomMessageContent(room.id, coderOutputId, '::room-handoff{to="Planner" reason="验收实现结果"}\\n请验收实现结果。\\n::', 'final')
      const plannerRoute = routeRoomAgentMentions({ roomId: room.id, sourceMessageId: coderOutputId, excludeMemberId: coder.id })
      const reviewOutputId = plannerRoute.routedMessages[0]?.id
      replaceRoomMessageContent(room.id, reviewOutputId, '::room-handoff{to="Coder" reason="修复剩余问题"}\\n请继续修复剩余问题。\\n::', 'final')
      const reworkRoute = routeRoomAgentMentions({ roomId: room.id, sourceMessageId: reviewOutputId, excludeMemberId: planner.id })
      const reworkOutputId = reworkRoute.routedMessages[0]?.id
      replaceRoomMessageContent(room.id, reworkOutputId, '::room-handoff{to="Planner" reason="验收返工结果"}\\n请验收返工结果。\\n::', 'final')
      const finalReviewRoute = routeRoomAgentMentions({ roomId: room.id, sourceMessageId: reworkOutputId, excludeMemberId: coder.id })
      const finalReviewOutputId = finalReviewRoute.routedMessages[0]?.id
      replaceRoomMessageContent(room.id, finalReviewOutputId, '::room-handoff{to="Coder" reason="再次返工"}\\n请再次返工。\\n::', 'final')
      const secondReworkRoute = routeRoomAgentMentions({ roomId: room.id, sourceMessageId: finalReviewOutputId, excludeMemberId: planner.id })

      console.log(JSON.stringify({
        secondReworkRuns: secondReworkRoute.runPlans.length,
        totalMessages: getRoomMessages(room.id).length,
      }))
    `)

    expect(JSON.parse(output.split('\n').at(-1) ?? '{}')).toEqual({
      secondReworkRuns: 1,
      totalMessages: 7,
    })
  })

  test('Given the same Agent message is routed twice When routing mentions Then does not duplicate member runs', () => {
    const output = runRoomScript(`
      const { createRoom, getRoomMessages, saveRoomMember } = await import('./room-manager.ts')
      const { replaceRoomMessageContent, routeRoomAgentMentions, sendRoomMessage } = await import('./room-orchestrator.ts')

      const room = createRoom({ title: '幂等房间' })
      const planner = saveRoomMember({
        roomId: room.id,
        name: 'Planner',
        rolePrompt: '负责规划。',
        channelId: 'planner-channel',
        listenMode: 'listen-and-score',
      })
      saveRoomMember({
        roomId: room.id,
        name: 'Coder',
        rolePrompt: '负责实现代码。',
        channelId: 'coder-channel',
        listenMode: 'mention-only',
      })

      const first = sendRoomMessage({ roomId: room.id, content: '@Planner 请规划 Todo 应用' })
      const plannerOutputId = first.routedMessages[0]?.id
      replaceRoomMessageContent(room.id, plannerOutputId, '::room-handoff{to="Coder" reason="实现 Todo 网页应用"}\\n请按照计划实现 Todo 网页应用。\\n::', 'final')
      const firstRoute = routeRoomAgentMentions({ roomId: room.id, sourceMessageId: plannerOutputId, excludeMemberId: planner.id })
      const secondRoute = routeRoomAgentMentions({ roomId: room.id, sourceMessageId: plannerOutputId, excludeMemberId: planner.id })

      console.log(JSON.stringify({
        firstRuns: firstRoute.runPlans.length,
        secondRuns: secondRoute.runPlans.length,
        totalMessages: getRoomMessages(room.id).length,
      }))
    `)

    expect(JSON.parse(output.split('\n').at(-1) ?? '{}')).toEqual({
      firstRuns: 1,
      secondRuns: 0,
      totalMessages: 3,
    })
  })

  test('Given tool result errors When building Room progress items Then includes tool label and error summary', () => {
    const output = runRoomScript(`
      const { buildRoomProgressItemsFromSdkMessages } = await import('./room-orchestrator.ts')

      const messages = [
        {
          type: 'assistant',
          parent_tool_use_id: null,
          message: {
            content: [
              { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'bun run build' } },
              { type: 'tool_use', id: 'tool-2', name: 'Write', input: { file_path: 'src/App.jsx' } },
            ],
          },
        },
        {
          type: 'user',
          parent_tool_use_id: null,
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tool-1',
                content: [{ type: 'text', text: 'Command failed with exit code 1\\nstderr: vite: not found' }],
                is_error: true,
              },
              {
                type: 'tool_result',
                tool_use_id: 'tool-2',
                content: [{ type: 'text', text: '已写入 src/App.jsx' }],
                is_error: false,
              },
            ],
          },
        },
      ]

      console.log(JSON.stringify(buildRoomProgressItemsFromSdkMessages(messages).map((item) => ({
        kind: item.kind,
        content: item.content,
      }))))
    `)

    expect(JSON.parse(output.split('\n').at(-1) ?? '[]')).toEqual([
      { kind: 'tool', content: '开始使用工具：Bash · bun run build' },
      { kind: 'tool', content: '开始使用工具：Write · src/App.jsx' },
      { kind: 'error', content: '工具执行失败：Bash · bun run build — Command failed with exit code 1\nstderr: vite: not found' },
      { kind: 'tool', content: '工具执行完成：Write · src/App.jsx' },
    ])
  })

  test('Given a tool-only Agent run When building Room completion content Then shows an execution summary', () => {
    const output = runRoomScript(`
      const { buildRoomAgentCompletionContent } = await import('./room-orchestrator.ts')

      const messages = [
        {
          type: 'assistant',
          parent_tool_use_id: null,
          message: {
            content: [
              { type: 'tool_use', id: 'tool-1', name: 'Write', input: { file_path: 'index.html' } },
              { type: 'tool_use', id: 'tool-2', name: 'Bash', input: { command: 'ls' } },
            ],
          },
        },
        {
          type: 'user',
          parent_tool_use_id: null,
          message: {
            content: [
              { type: 'tool_result', tool_use_id: 'tool-1', content: [{ type: 'text', text: '已创建 index.html' }], is_error: false },
            ],
          },
        },
        {
          type: 'result',
          subtype: 'success',
          usage: { input_tokens: 10, output_tokens: 20 },
        },
      ]

      console.log(JSON.stringify(buildRoomAgentCompletionContent(messages, 0, 'Coder')))
    `)

    const completion = JSON.parse(output.split('\n').at(-1) ?? '{}')
    expect(completion.status).toBe('final')
    expect(completion.content).toContain('Coder 已完成运行。')
    expect(completion.content).toContain('运行结果：成功。')
    expect(completion.content).toContain('执行了 2 次工具调用')
    expect(completion.content).toContain('Write')
    expect(completion.content).toContain('已创建 index.html')
  })

  test('Given a Pi terminated Agent run When building Room completion content Then marks it as an error', () => {
    const output = runRoomScript(`
      const { buildRoomAgentCompletionContent } = await import('./room-orchestrator.ts')

      const messages = [
        {
          type: 'assistant',
          parent_tool_use_id: null,
          message: {
            content: [{ type: 'text', text: 'Pi provider request failed: terminated' }],
            stop_reason: 'error',
          },
          error: { message: 'Pi provider request failed: terminated', errorType: 'pi_provider_error' },
        },
        {
          type: 'result',
          subtype: 'error',
          usage: { input_tokens: 0, output_tokens: 0 },
          errors: ['Pi provider request failed: terminated'],
        },
      ]

      console.log(JSON.stringify(buildRoomAgentCompletionContent(messages, 0, 'Coder')))
    `)

    const completion = JSON.parse(output.split('\n').at(-1) ?? '{}')
    expect(completion.status).toBe('error')
    expect(completion.error).toBe('Pi provider request failed: terminated')
    expect(completion.content).toContain('运行失败：Pi 请求被中断。')
    expect(completion.content).toContain('原始错误：Pi provider request failed: terminated')
  })

  test('Given a run plan When converting to Agent input Then preserves member runtime bindings', () => {
    const output = runRoomScript(`
      const { createRoom, saveRoomMember } = await import('./room-manager.ts')
      const { sendRoomMessage, createAgentInputFromRoomRunPlan } = await import('./room-orchestrator.ts')

      const room = createRoom({ title: '桥接房间' })
      saveRoomMember({
        roomId: room.id,
        name: 'Builder',
        rolePrompt: '负责实现。',
        channelId: 'channel-1',
        modelId: 'model-1',
        workspaceId: 'workspace-1',
        permissionMode: 'ask',
        listenMode: 'listen-and-score',
      })
      const result = sendRoomMessage({ roomId: room.id, content: '@Builder 请开始' })
      const input = createAgentInputFromRoomRunPlan(result.runPlans[0])
      console.log(JSON.stringify({
        sessionId: input.sessionId,
        channelId: input.channelId,
        modelId: input.modelId,
        workspaceId: input.workspaceId,
        permissionModeOverride: input.permissionModeOverride,
        hasRoomPrompt: input.userMessage.includes('Room 触发上下文'),
      }))
    `)

    expect(JSON.parse(output.split('\n').at(-1) ?? '{}')).toEqual({
      sessionId: expect.stringContaining('room-'),
      channelId: 'channel-1',
      modelId: 'model-1',
      workspaceId: 'workspace-1',
      permissionModeOverride: 'ask',
      hasRoomPrompt: true,
    })
  })

  test('Given a run plan without channel When converting to Agent input Then throws a clear error', () => {
    const output = runRoomScript(`
      const { createRoom, saveRoomMember } = await import('./room-manager.ts')
      const { sendRoomMessage, createAgentInputFromRoomRunPlan } = await import('./room-orchestrator.ts')

      const room = createRoom({ title: '缺渠道房间' })
      saveRoomMember({
        roomId: room.id,
        name: 'Builder',
        rolePrompt: '负责实现。',
        listenMode: 'listen-and-score',
      })
      const result = sendRoomMessage({ roomId: room.id, content: '@Builder 请开始' })
      try {
        createAgentInputFromRoomRunPlan(result.runPlans[0])
      } catch (error) {
        console.log(JSON.stringify({ message: error instanceof Error ? error.message : String(error) }))
      }
    `)

    expect(JSON.parse(output.split('\n').at(-1) ?? '{}').message).toContain('Room 成员缺少渠道配置')
  })

  test('Given a room run plan When ensuring Agent session Then creates and reuses a stable member session', () => {
    const output = runRoomScript(`
      const { createRoom, saveRoomMember } = await import('./room-manager.ts')
      const { sendRoomMessage, createAgentInputFromRoomRunPlan, ensureAgentSessionForRoomRunPlan } = await import('./room-orchestrator.ts')

      const room = createRoom({ title: '稳定会话房间' })
      saveRoomMember({
        roomId: room.id,
        name: 'Builder',
        rolePrompt: '负责实现。',
        channelId: 'channel-1',
        modelId: 'model-1',
        workspaceId: 'workspace-1',
        permissionMode: 'ask',
        listenMode: 'listen-and-score',
      })
      const result = sendRoomMessage({ roomId: room.id, content: '@Builder 请开始' })
      const input = createAgentInputFromRoomRunPlan(result.runPlans[0])
      const created = ensureAgentSessionForRoomRunPlan(result.runPlans[0])
      const reused = ensureAgentSessionForRoomRunPlan(result.runPlans[0])
      const updated = ensureAgentSessionForRoomRunPlan({
        ...result.runPlans[0],
        channelId: 'channel-2',
        workspaceId: 'workspace-2',
        agentEngine: 'pi',
        permissionMode: 'plan',
      })
      console.log(JSON.stringify({
        inputSessionId: input.sessionId,
        createdId: created.id,
        reusedId: reused.id,
        storedTitle: reused.title,
        channelId: reused.channelId,
        workspaceId: reused.workspaceId,
        permissionMode: reused.permissionMode,
        updatedChannelId: updated.channelId,
        updatedWorkspaceId: updated.workspaceId,
        updatedPermissionMode: updated.permissionMode,
        updatedAgentEngine: updated.agentEngine,
      }))
    `)

    const result = JSON.parse(output.split('\n').at(-1) ?? '{}')
    expect(result.createdId).toBe(result.inputSessionId)
    expect(result.reusedId).toBe(result.inputSessionId)
    expect(result.storedTitle).toContain('Room · Builder')
    expect(result.channelId).toBe('channel-1')
    expect(result.workspaceId).toBe('workspace-1')
    expect(result.permissionMode).toBe('ask')
    expect(result.updatedChannelId).toBe('channel-2')
    expect(result.updatedWorkspaceId).toBe('workspace-2')
    expect(result.updatedPermissionMode).toBe('plan')
    expect(result.updatedAgentEngine).toBe('pi')
  })

  test('Given member without workspace When converting run plan Then uses current settings workspace and engine', () => {
    const output = runRoomScript(`
      const { mkdirSync, writeFileSync } = await import('node:fs')
      const { dirname } = await import('node:path')
      const { getAgentWorkspacesIndexPath, getSettingsPath } = await import('./config-paths.ts')
      const { createRoom, saveRoomMember } = await import('./room-manager.ts')
      const { sendRoomMessage, createAgentInputFromRoomRunPlan, ensureAgentSessionForRoomRunPlan } = await import('./room-orchestrator.ts')

      mkdirSync(dirname(getAgentWorkspacesIndexPath()), { recursive: true })
      writeFileSync(getAgentWorkspacesIndexPath(), JSON.stringify({
        version: 2,
        workspaces: [{ id: 'workspace-pi', name: 'Pi 工作区', slug: 'pi-workspace', agentEngine: 'pi', createdAt: 1, updatedAt: 1 }],
      }))
      mkdirSync(dirname(getSettingsPath()), { recursive: true })
      writeFileSync(getSettingsPath(), JSON.stringify({ themeMode: 'system', agentWorkspaceId: 'workspace-pi' }))

      const room = createRoom({ title: '默认工作区房间' })
      saveRoomMember({
        roomId: room.id,
        name: 'Builder',
        rolePrompt: '负责实现。',
        channelId: 'channel-1',
        modelId: 'model-1',
        listenMode: 'listen-and-score',
      })
      const result = sendRoomMessage({ roomId: room.id, content: '@Builder 请开始' })
      const input = createAgentInputFromRoomRunPlan(result.runPlans[0])
      const session = ensureAgentSessionForRoomRunPlan(result.runPlans[0])
      console.log(JSON.stringify({ workspaceId: input.workspaceId, sessionWorkspaceId: session.workspaceId, agentEngine: session.agentEngine }))
    `)

    expect(JSON.parse(output.split('\n').at(-1) ?? '{}')).toEqual({
      workspaceId: 'workspace-pi',
      sessionWorkspaceId: 'workspace-pi',
      agentEngine: 'pi',
    })
  })

  test('Given a listening member When sending unmentioned message Then creates a draft', () => {
    const output = runRoomScript(`
      const { createRoom, listRoomDrafts, saveRoomMember } = await import('./room-manager.ts')
      const { sendRoomMessage } = await import('./room-orchestrator.ts')

      const room = createRoom({ title: '增长房间' })
      saveRoomMember({
        roomId: room.id,
        name: 'Megan',
        rolePrompt: '识别增长信号。',
        listenMode: 'listen-and-score',
      })

      const result = sendRoomMessage({ roomId: room.id, content: '这周用户反馈里付费意愿变强了' })
      const drafts = listRoomDrafts(room.id)
      console.log(JSON.stringify({
        routed: result.routedMessages.length,
        resultDrafts: result.drafts.length,
        storedDrafts: drafts.length,
        status: drafts[0]?.status,
      }))
    `)

    expect(JSON.parse(output.split('\n').at(-1) ?? '{}')).toEqual({
      routed: 0,
      resultDrafts: 1,
      storedDrafts: 1,
      status: 'pending',
    })
  })

  test('Given a runtime-ready listening member When sending unmentioned message Then starts one Agent run plan', () => {
    const output = runRoomScript(`
      const { createRoom, getRoomMessages, listRoomDrafts, saveRoomMember } = await import('./room-manager.ts')
      const { sendRoomMessage } = await import('./room-orchestrator.ts')

      const room = createRoom({ title: '自动响应房间' })
      const member = saveRoomMember({
        roomId: room.id,
        name: 'Planner',
        rolePrompt: '负责把开放问题拆成计划。',
        channelId: 'channel-1',
        modelId: 'model-1',
        listenMode: 'listen-and-score',
      })
      saveRoomMember({
        roomId: room.id,
        name: 'Reviewer',
        rolePrompt: '负责审查风险。',
        channelId: 'channel-2',
        listenMode: 'listen-and-score',
      })

      const result = sendRoomMessage({ roomId: room.id, content: '看看你们是否能够很好地组织工作' })
      const messages = getRoomMessages(room.id)
      const agentMessage = messages.find((message) => message.role === 'agent')
      console.log(JSON.stringify({
        routed: result.routedMessages.length,
        drafts: result.drafts.length,
        storedDrafts: listRoomDrafts(room.id).length,
        runPlans: result.runPlans.length,
        triggerType: result.runPlans[0]?.triggerType,
        memberId: result.runPlans[0]?.memberId,
        channelId: result.runPlans[0]?.channelId,
        status: agentMessage?.status,
        content: agentMessage?.content,
        hasMemberList: result.runPlans[0]?.systemPrompt.includes('@Reviewer'),
        hasCoordinatorRule: result.runPlans[0]?.systemPrompt.includes('不要直接修改文件'),
      }))
    `)

    const result = JSON.parse(output.split('\n').at(-1) ?? '{}')
    expect(result).toEqual({
      routed: 1,
      drafts: 0,
      storedDrafts: 0,
      runPlans: 1,
      triggerType: 'routing-send',
      memberId: expect.any(String),
      channelId: 'channel-1',
      status: 'streaming',
      content: 'Planner 正在思考...',
      hasMemberList: true,
      hasCoordinatorRule: true,
    })
  })

  test('Given a high-confidence listening decision When sending unmentioned message Then sends an agent message directly', () => {
    const output = runRoomScript(`
      const { createRoom, getRoomMessages, listRoomDrafts, saveRoomMember } = await import('./room-manager.ts')
      const { sendRoomMessage } = await import('./room-orchestrator.ts')

      const room = createRoom({ title: '高置信房间' })
      const member = saveRoomMember({
        roomId: room.id,
        name: 'Ops',
        rolePrompt: '识别运维事故。',
        listenMode: 'listen-and-score',
      })

      const result = sendRoomMessage({
        roomId: room.id,
        content: '生产环境报警一直在重启',
        routingDecisions: {
          [member.id]: {
            action: 'send',
            score: 0.92,
            reason: '明确命中运维职责',
            content: '我先帮你梳理排障步骤。',
          },
        },
      })
      const messages = getRoomMessages(room.id)
      console.log(JSON.stringify({
        routed: result.routedMessages.length,
        runPlans: result.runPlans.length,
        triggerType: result.runPlans[0]?.triggerType,
        drafts: result.drafts.length,
        storedDrafts: listRoomDrafts(room.id).length,
        agentContent: messages.find((message) => message.role === 'agent')?.content,
      }))
    `)

    expect(JSON.parse(output.split('\n').at(-1) ?? '{}')).toEqual({
      routed: 1,
      runPlans: 1,
      triggerType: 'routing-send',
      drafts: 0,
      storedDrafts: 0,
      agentContent: '我先帮你梳理排障步骤。',
    })
  })

  test('Given a low-confidence listening decision When sending unmentioned message Then stores a draft with score and reason', () => {
    const output = runRoomScript(`
      const { createRoom, listRoomDrafts, saveRoomMember } = await import('./room-manager.ts')
      const { sendRoomMessage } = await import('./room-orchestrator.ts')

      const room = createRoom({ title: '低置信房间' })
      const member = saveRoomMember({
        roomId: room.id,
        name: 'PM',
        rolePrompt: '整理产品需求。',
        listenMode: 'listen-and-score',
      })

      const result = sendRoomMessage({
        roomId: room.id,
        content: '用户说这里有点怪',
        routingDecisions: {
          [member.id]: {
            action: 'draft',
            score: 0.47,
            reason: '可能相关但信息不足',
            content: '我可以先追问用户具体哪里怪。',
          },
        },
      })
      const draft = listRoomDrafts(room.id)[0]
      console.log(JSON.stringify({
        routed: result.routedMessages.length,
        resultDrafts: result.drafts.length,
        score: draft?.score,
        reason: draft?.reason,
        content: draft?.content,
      }))
    `)

    expect(JSON.parse(output.split('\n').at(-1) ?? '{}')).toEqual({
      routed: 0,
      resultDrafts: 1,
      score: 0.47,
      reason: '可能相关但信息不足',
      content: '我可以先追问用户具体哪里怪。',
    })
  })

  test('Given a silent listening decision When sending unmentioned message Then does not send or draft', () => {
    const output = runRoomScript(`
      const { createRoom, getRoomMessages, listRoomDrafts, saveRoomMember } = await import('./room-manager.ts')
      const { sendRoomMessage } = await import('./room-orchestrator.ts')

      const room = createRoom({ title: '静默房间' })
      const member = saveRoomMember({
        roomId: room.id,
        name: 'Legal',
        rolePrompt: '审查法律风险。',
        listenMode: 'listen-and-score',
      })

      const result = sendRoomMessage({
        roomId: room.id,
        content: '今天午饭吃什么',
        routingDecisions: {
          [member.id]: {
            action: 'silent',
            score: 0.08,
            reason: '与法律职责无关',
          },
        },
      })
      console.log(JSON.stringify({
        routed: result.routedMessages.length,
        drafts: result.drafts.length,
        storedDrafts: listRoomDrafts(room.id).length,
        totalMessages: getRoomMessages(room.id).length,
      }))
    `)

    expect(JSON.parse(output.split('\n').at(-1) ?? '{}')).toEqual({
      routed: 0,
      drafts: 0,
      storedDrafts: 0,
      totalMessages: 1,
    })
  })

  test('Given a draft When sending it Then appends an agent message', () => {
    const output = runRoomScript(`
      const { createRoom, getRoomMessages, listRoomDrafts, saveRoomMember } = await import('./room-manager.ts')
      const { sendRoomMessage, updateRoomDraft } = await import('./room-orchestrator.ts')

      const room = createRoom({ title: '草稿房间' })
      saveRoomMember({
        roomId: room.id,
        name: 'Rin',
        rolePrompt: '做审查。',
        listenMode: 'listen-and-score',
      })
      sendRoomMessage({ roomId: room.id, content: '这个 diff 需要 review' })
      const draft = listRoomDrafts(room.id)[0]
      updateRoomDraft({ roomId: room.id, draftId: draft.id, action: 'send', content: '我建议先检查测试覆盖。' })
      const messages = getRoomMessages(room.id)
      console.log(JSON.stringify({
        draftStatus: listRoomDrafts(room.id)[0]?.status,
        agentContent: messages.find((message) => message.role === 'agent')?.content,
      }))
    `)

    expect(JSON.parse(output.split('\n').at(-1) ?? '{}')).toEqual({
      draftStatus: 'sent',
      agentContent: '我建议先检查测试覆盖。',
    })
  })
})
