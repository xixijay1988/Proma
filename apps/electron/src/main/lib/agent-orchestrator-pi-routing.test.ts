import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, test } from 'bun:test'

function runOrchestratorScript(script: string): string {
  const homeDir = mkdtempSync(join(tmpdir(), 'proma-agent-orchestrator-'))
  try {
    const result = spawnSync(process.execPath, ['--eval', script], {
      cwd: import.meta.dir,
      env: {
        ...process.env,
        HOME: homeDir,
        PROMA_DEV: undefined,
        CLAUDE_CONFIG_DIR: undefined,
      },
      encoding: 'utf-8',
      timeout: 15_000,
      killSignal: 'SIGKILL',
    })

    const stdout = result.stdout.toString()
    const stderr = result.stderr.toString()
    expect(result.error, stderr || stdout).toBeUndefined()
    expect(result.status, stderr || stdout).toBe(0)
    return stdout.trim()
  } finally {
    rmSync(homeDir, { recursive: true, force: true })
  }
}

describe('AgentOrchestrator pi routing', () => {
  test('Given pi engine and missing channel When sending message Then routes to adapter without Claude preflight', () => {
    const output = runOrchestratorScript(`
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: { getFocusedWindow: () => null },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')

      class FakePiAdapter {
        queryCalls = 0
        abortCalls = 0

        async *query(input) {
          this.queryCalls += 1
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'pi-ok' }] },
            parent_tool_use_id: null,
            session_id: input.sessionId,
          }
          yield {
            type: 'result',
            subtype: 'error',
            usage: { input_tokens: 0, output_tokens: 0 },
            session_id: input.sessionId,
          }
        }

        abort() {
          this.abortCalls += 1
        }

        dispose() {}
      }

      const adapter = new FakePiAdapter()
      const eventBus = new AgentEventBus()
      let eventCount = 0
      eventBus.use((_sessionId, _payload, next) => {
        eventCount += 1
        next()
      })

      const orchestrator = new AgentOrchestrator(adapter, eventBus, 'pi')
      let errorMessage = null
      let completeStartedAt = null
      let completeResultSubtype = null
      let runStartedAt = null

      await orchestrator.sendMessage({
        sessionId: 'session-pi-routing',
        userMessage: 'hello',
        channelId: 'missing-channel',
        modelId: 'pi-model',
        startedAt: 123,
      }, {
        onError: (error) => { errorMessage = error },
        onComplete: (_messages, opts) => {
          completeStartedAt = opts?.startedAt ?? null
          completeResultSubtype = opts?.resultSubtype ?? null
        },
        onTitleUpdated: () => {},
        onRunStarted: ({ startedAt }) => { runStartedAt = startedAt },
      })

      console.log(JSON.stringify({
        queryCalls: adapter.queryCalls,
        abortCalls: adapter.abortCalls,
        errorMessage,
        completeStartedAt,
        completeResultSubtype,
        runStartedAt,
        eventCount,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('queryCalls'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      queryCalls?: number
      abortCalls?: number
      errorMessage?: string | null
      completeStartedAt?: number | null
      completeResultSubtype?: string | null
      runStartedAt?: number | null
      eventCount?: number
    }

    expect(result.queryCalls).toBe(1)
    expect(result.abortCalls).toBe(1)
    expect(result.errorMessage).toBeNull()
    expect(result.completeStartedAt).toBe(123)
    expect(result.completeResultSubtype).toBe('error')
    expect(result.runStartedAt).toBe(123)
    expect(result.eventCount).toBe(2)
  })

  test('Given pi engine and configured channel When sending message Then injects Pi runtime provider env', () => {
    const output = runOrchestratorScript(`
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: { getFocusedWindow: () => null },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      mock.module('./channel-manager.ts', () => ({
        getChannelById: (id) => id === 'channel-qwen'
          ? {
              id,
              name: 'Qwen',
              provider: 'qwen',
              baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
              apiKey: '',
              models: [],
              enabled: true,
              createdAt: 0,
              updatedAt: 0,
            }
          : undefined,
        decryptApiKey: () => 'sk-qwen',
        listChannels: () => [],
      }))

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')

      class FakePiAdapter {
        lastInput = null

        async *query(input) {
          this.lastInput = input
          yield {
            type: 'result',
            subtype: 'success',
            usage: { input_tokens: 0, output_tokens: 0 },
            session_id: input.sessionId,
          }
        }

        abort() {}
        dispose() {}
      }

      const adapter = new FakePiAdapter()
      const orchestrator = new AgentOrchestrator(adapter, new AgentEventBus(), 'pi')

      await orchestrator.sendMessage({
        sessionId: 'session-pi-qwen',
        userMessage: 'hello',
        channelId: 'channel-qwen',
        modelId: 'qwen-plus',
        startedAt: 321,
      }, {
        onError: () => {},
        onComplete: () => {},
        onTitleUpdated: () => {},
        onRunStarted: () => {},
      })

      console.log(JSON.stringify({
        provider: adapter.lastInput?.provider ?? null,
        openaiKey: adapter.lastInput?.runtimeEnv?.OPENAI_API_KEY ?? null,
        piDirEndsWithSession: adapter.lastInput?.runtimeEnv?.PI_CODING_AGENT_DIR?.endsWith('/pi-agent/session-pi-qwen') ?? false,
        piSessionDirEndsWith: adapter.lastInput?.runtimeEnv?.PI_CODING_AGENT_SESSION_DIR?.endsWith('/pi-agent-sessions') ?? false,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('provider'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      provider?: string | null
      openaiKey?: string | null
      piDirEndsWithSession?: boolean
      piSessionDirEndsWith?: boolean
    }

    expect(result.provider).toBe('openai')
    expect(result.openaiKey).toBe('sk-qwen')
    expect(result.piDirEndsWithSession).toBe(true)
    expect(result.piSessionDirEndsWith).toBe(true)
  })

  test('Given cloned pi session with native session path When sending message Then passes runtime session path to adapter', () => {
    const output = runOrchestratorScript(`
      import { mkdirSync, writeFileSync } from 'node:fs'
      import { join } from 'node:path'
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: { getFocusedWindow: () => null },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      const configDir = join(process.env.HOME, '.proma')
      mkdirSync(configDir, { recursive: true })
      writeFileSync(join(configDir, 'agent-workspaces.json'), JSON.stringify({
        version: 2,
        workspaces: [{
          id: 'workspace-pi',
          name: 'Pi',
          slug: 'pi',
          agentEngine: 'pi',
          createdAt: 1,
          updatedAt: 1,
        }],
      }))

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')
      const { createAgentSession, updateAgentSessionMeta } = await import('./agent-session-manager.ts')

      class FakePiAdapter {
        lastInput = null

        async *query(input) {
          this.lastInput = input
          yield {
            type: 'result',
            subtype: 'success',
            usage: { input_tokens: 0, output_tokens: 0 },
            session_id: input.sessionId,
          }
        }

        abort() {}
        dispose() {}
      }

      const source = createAgentSession('Pi clone', 'missing-channel', 'workspace-pi', 'pi')
      updateAgentSessionMeta(source.id, {
        forkSourcePiSessionId: 'pi-native-clone-id',
        forkSourcePiSessionPath: '/tmp/pi-native-clone.jsonl',
      })

      const adapter = new FakePiAdapter()
      const orchestrator = new AgentOrchestrator(adapter, new AgentEventBus(), 'pi')

      await orchestrator.sendMessage({
        sessionId: source.id,
        userMessage: 'continue from clone',
        channelId: 'missing-channel',
        modelId: 'pi-model',
        workspaceId: 'workspace-pi',
        startedAt: 654,
      }, {
        onError: () => {},
        onComplete: () => {},
        onTitleUpdated: () => {},
        onRunStarted: () => {},
      })

      console.log(JSON.stringify({
        runtimeSessionPath: adapter.lastInput?.runtimeSessionPath ?? null,
        sessionDirEndsWith: adapter.lastInput?.runtimeSessionDir?.endsWith('/pi-agent-sessions') ?? false,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('runtimeSessionPath'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      runtimeSessionPath?: string | null
      sessionDirEndsWith?: boolean
    }

    expect(result.runtimeSessionPath).toBe('/tmp/pi-native-clone.jsonl')
    expect(result.sessionDirEndsWith).toBe(true)
  })

  test('Given new pi session When first message runs Then generates title from the first user message', () => {
    const output = runOrchestratorScript(`
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: { getFocusedWindow: () => null },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      mock.module('@proma/core', () => ({
        getAdapter: () => ({
          providerType: 'openai',
          buildTitleRequest: ({ prompt }) => ({
            url: 'https://title.example.test',
            headers: {},
            body: prompt,
          }),
          parseTitleResponse: () => 'unused',
        }),
        fetchTitle: async (request) => request.body.includes('帮我分析项目结构')
          ? '项目结构分析'
          : null,
        normalizeAnthropicBaseUrlForSdk: (baseUrl) => baseUrl,
      }))

      mock.module('./channel-manager.ts', () => ({
        getChannelById: (id) => id === 'title-channel'
          ? {
              id,
              name: 'Title Channel',
              provider: 'openai',
              baseUrl: 'https://api.openai.com/v1',
              apiKey: '',
              models: [],
              enabled: true,
              createdAt: 0,
              updatedAt: 0,
            }
          : undefined,
        decryptApiKey: () => 'sk-title',
        listChannels: () => [{
          id: 'title-channel',
          name: 'Title Channel',
          provider: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: '',
          models: [],
          enabled: true,
          createdAt: 0,
          updatedAt: 0,
        }],
      }))

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')
      const { createAgentSession, getAgentSessionMeta } = await import('./agent-session-manager.ts')

      class FakePiAdapter {
        sessionNameCalls = []

        async *query(input) {
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: '可以，我来分析。' }] },
            parent_tool_use_id: null,
            session_id: input.sessionId,
          }
          yield {
            type: 'result',
            subtype: 'success',
            usage: { input_tokens: 0, output_tokens: 0 },
            session_id: input.sessionId,
          }
        }

        async setSessionName(sessionId, name) {
          this.sessionNameCalls.push({ sessionId, name })
        }

        abort() {}
        dispose() {}
      }

      const session = createAgentSession(undefined, 'title-channel', undefined, 'pi')
      const adapter = new FakePiAdapter()
      const orchestrator = new AgentOrchestrator(adapter, new AgentEventBus(), 'pi')
      const titlePromise = new Promise((resolve) => {
        globalThis.resolveTitle = resolve
      })
      let callbackTitle = null

      await orchestrator.sendMessage({
        sessionId: session.id,
        userMessage: '帮我分析项目结构并给出改进建议',
        channelId: 'title-channel',
        modelId: 'gpt-4.1-mini',
        startedAt: 987,
      }, {
        onError: () => {},
        onComplete: () => {},
        onTitleUpdated: (title) => {
          callbackTitle = title
          globalThis.resolveTitle(title)
        },
        onRunStarted: () => {},
      })

      const titleFromCallback = await Promise.race([
        titlePromise,
        new Promise((resolve) => setTimeout(() => resolve(null), 1000)),
      ])
      const updated = getAgentSessionMeta(session.id)

      console.log(JSON.stringify({
        initialTitle: session.title,
        titleFromCallback,
        callbackTitle,
        storedTitle: updated?.title ?? null,
        sessionNameCalls: adapter.sessionNameCalls,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('storedTitle'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      initialTitle?: string
      titleFromCallback?: string | null
      callbackTitle?: string | null
      storedTitle?: string | null
      sessionNameCalls?: Array<{ sessionId?: string; name?: string }>
    }

    expect(result.initialTitle).toBe('新 Agent 会话')
    expect(result.titleFromCallback).toBe('项目结构分析')
    expect(result.callbackTitle).toBe('项目结构分析')
    expect(result.storedTitle).toBe('项目结构分析')
    expect(result.sessionNameCalls).toEqual([{ sessionId: expect.any(String), name: '项目结构分析' }])
  })

  test('Given user renames pi session while title is generating When title returns Then keeps manual title', () => {
    const output = runOrchestratorScript(`
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: { getFocusedWindow: () => null },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      mock.module('@proma/core', () => ({
        getAdapter: () => ({
          providerType: 'openai',
          buildTitleRequest: ({ prompt }) => ({
            url: 'https://title.example.test',
            headers: {},
            body: prompt,
          }),
          parseTitleResponse: () => 'unused',
        }),
        fetchTitle: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20))
          return '自动标题'
        },
        normalizeAnthropicBaseUrlForSdk: (baseUrl) => baseUrl,
      }))

      mock.module('./channel-manager.ts', () => ({
        getChannelById: (id) => id === 'title-channel'
          ? {
              id,
              name: 'Title Channel',
              provider: 'openai',
              baseUrl: 'https://api.openai.com/v1',
              apiKey: '',
              models: [],
              enabled: true,
              createdAt: 0,
              updatedAt: 0,
            }
          : undefined,
        decryptApiKey: () => 'sk-title',
        listChannels: () => [{
          id: 'title-channel',
          name: 'Title Channel',
          provider: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: '',
          models: [],
          enabled: true,
          createdAt: 0,
          updatedAt: 0,
        }],
      }))

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')
      const { createAgentSession, getAgentSessionMeta, updateAgentSessionMeta } = await import('./agent-session-manager.ts')

      class FakePiAdapter {
        async *query(input) {
          yield {
            type: 'result',
            subtype: 'success',
            usage: { input_tokens: 0, output_tokens: 0 },
            session_id: input.sessionId,
          }
        }

        abort() {}
        dispose() {}
      }

      const session = createAgentSession(undefined, 'title-channel', undefined, 'pi')
      const orchestrator = new AgentOrchestrator(new FakePiAdapter(), new AgentEventBus(), 'pi')
      let callbackTitle = null

      await orchestrator.sendMessage({
        sessionId: session.id,
        userMessage: '帮我生成标题',
        channelId: 'title-channel',
        modelId: 'gpt-4.1-mini',
        startedAt: 988,
      }, {
        onError: () => {},
        onComplete: () => {},
        onTitleUpdated: (title) => { callbackTitle = title },
        onRunStarted: () => {
          updateAgentSessionMeta(session.id, { title: '手动标题' })
        },
      })

      await new Promise((resolve) => setTimeout(resolve, 80))
      const updated = getAgentSessionMeta(session.id)

      console.log(JSON.stringify({
        callbackTitle,
        storedTitle: updated?.title ?? null,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('storedTitle'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      callbackTitle?: string | null
      storedTitle?: string | null
    }

    expect(result.callbackTitle).toBeNull()
    expect(result.storedTitle).toBe('手动标题')
  })

  test('Given pi engine When sending message Then prompt declares Pi runtime identity', () => {
    const output = runOrchestratorScript(`
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: { getFocusedWindow: () => null },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')

      class FakePiAdapter {
        lastPrompt = ''

        async *query(input) {
          this.lastPrompt = input.prompt
          yield {
            type: 'result',
            subtype: 'success',
            usage: { input_tokens: 0, output_tokens: 0 },
            session_id: input.sessionId,
          }
        }

        abort() {}
        dispose() {}
      }

      const adapter = new FakePiAdapter()
      const orchestrator = new AgentOrchestrator(adapter, new AgentEventBus(), 'pi')

      await orchestrator.sendMessage({
        sessionId: 'session-pi-identity',
        userMessage: '你背后是什么 Agent SDK？',
        channelId: 'missing-channel',
        modelId: 'deepseek-v4-flash',
        startedAt: 654,
      }, {
        onError: () => {},
        onComplete: () => {},
        onTitleUpdated: () => {},
        onRunStarted: () => {},
      })

      console.log(JSON.stringify({
        prompt: adapter.lastPrompt,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('prompt'))
    const result = JSON.parse(jsonLine ?? '{}') as { prompt?: string }

    expect(result.prompt).toContain('<runtime_identity>')
    expect(result.prompt).toContain('Pi Agent')
    expect(result.prompt).toContain('@earendil-works/pi-coding-agent')
    expect(result.prompt).toContain('不是 Claude Agent SDK')
    expect(result.prompt).toContain('deepseek-v4-flash')
    expect(result.prompt).toContain('你背后是什么 Agent SDK？')
  })

  test('Given pi engine When compact command is sent Then delegates to runtime compact and persists boundary', () => {
    const output = runOrchestratorScript(`
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: { getFocusedWindow: () => null },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')
      const { getAgentSessionSDKMessages } = await import('./agent-session-manager.ts')

      class FakePiAdapter {
        queryCalls = 0
        compactCalls = []

        async *query(input) {
          this.queryCalls += 1
          yield {
            type: 'result',
            subtype: 'success',
            usage: { input_tokens: 0, output_tokens: 0 },
            session_id: input.sessionId,
          }
        }

        async compact(sessionId, customInstructions) {
          this.compactCalls.push({ sessionId, customInstructions: customInstructions ?? null })
          return [
            { type: 'system', subtype: 'compacting', session_id: sessionId },
            { type: 'system', subtype: 'compact_boundary', summary: 'Pi 压缩摘要', tokens_before: 42, session_id: sessionId },
          ]
        }

        abort() {}
        dispose() {}
      }

      const adapter = new FakePiAdapter()
      const eventBus = new AgentEventBus()
      const streamedMessages = []
      eventBus.use((sessionId, payload, next) => {
        if (payload.kind === 'sdk_message') streamedMessages.push(payload.message)
        next()
      })

      const orchestrator = new AgentOrchestrator(adapter, eventBus, 'pi')
      let completeResultSubtype = null

      await orchestrator.sendMessage({
        sessionId: 'session-pi-compact-route',
        userMessage: '/compact',
        channelId: 'missing-channel',
        modelId: 'pi-model',
        startedAt: 801,
      }, {
        onError: () => {},
        onComplete: (_messages, opts) => { completeResultSubtype = opts?.resultSubtype ?? null },
        onTitleUpdated: () => {},
        onRunStarted: () => {},
      })

      const persisted = getAgentSessionSDKMessages('session-pi-compact-route')

      console.log(JSON.stringify({
        queryCalls: adapter.queryCalls,
        compactCalls: adapter.compactCalls,
        streamedSystemSubtypes: streamedMessages.filter((message) => message.type === 'system').map((message) => message.subtype),
        persistedSystemSubtypes: persisted.filter((message) => message.type === 'system').map((message) => message.subtype),
        persistedUserTexts: persisted.filter((message) => message.type === 'user').map((message) => message.message?.content?.[0]?.text ?? ''),
        completeResultSubtype,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('compactCalls'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      queryCalls?: number
      compactCalls?: Array<{ sessionId?: string; customInstructions?: string | null }>
      streamedSystemSubtypes?: string[]
      persistedSystemSubtypes?: string[]
      persistedUserTexts?: string[]
      completeResultSubtype?: string | null
    }

    expect(result.queryCalls).toBe(0)
    expect(result.compactCalls).toEqual([{ sessionId: 'session-pi-compact-route', customInstructions: null }])
    expect(result.streamedSystemSubtypes).toEqual(['compacting', 'compact_boundary'])
    expect(result.persistedSystemSubtypes).toEqual(['compact_boundary'])
    expect(result.persistedUserTexts).toEqual(['/compact'])
    expect(result.completeResultSubtype).toBe('success')
  })

  test('Given pi engine and adaptive thinking enabled When sending message Then passes Pi thinking level to runtime', () => {
    const output = runOrchestratorScript(`
      import { mkdirSync, writeFileSync } from 'node:fs'
      import { join } from 'node:path'
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: { getFocusedWindow: () => null },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      const promaDir = join(process.env.HOME, '.proma')
      mkdirSync(promaDir, { recursive: true })
      writeFileSync(join(promaDir, 'settings.json'), JSON.stringify({
        themeMode: 'system',
        agentThinking: { type: 'adaptive' },
        agentEffort: 'high',
      }))

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')

      class FakePiAdapter {
        queryInputs = []

        async *query(input) {
          this.queryInputs.push(input)
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'pi-ok' }] },
            parent_tool_use_id: null,
            session_id: input.sessionId,
          }
          yield {
            type: 'result',
            subtype: 'success',
            usage: { input_tokens: 0, output_tokens: 0 },
            session_id: input.sessionId,
          }
        }

        abort() {}
        dispose() {}
      }

      const adapter = new FakePiAdapter()
      const orchestrator = new AgentOrchestrator(adapter, new AgentEventBus(), 'pi')

      await orchestrator.sendMessage({
        sessionId: 'session-pi-thinking-sync',
        userMessage: 'hello',
        channelId: 'missing-channel',
        modelId: 'pi-model',
        startedAt: 802,
      }, {
        onError: () => {},
        onComplete: () => {},
        onTitleUpdated: () => {},
        onRunStarted: () => {},
      })

      console.log(JSON.stringify({
        runtimeThinkingLevels: adapter.queryInputs.map((input) => input.runtimeThinkingLevel ?? null),
        queryCount: adapter.queryInputs.length,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('runtimeThinkingLevels'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      runtimeThinkingLevels?: Array<string | null>
      queryCount?: number
    }

    expect(result.runtimeThinkingLevels).toEqual(['high'])
    expect(result.queryCount).toBe(1)
  })

  test('Given pi engine When sending message Then enables Pi auto compaction for the runtime', () => {
    const output = runOrchestratorScript(`
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: { getFocusedWindow: () => null },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')

      class FakePiAdapter {
        queryInputs = []

        async *query(input) {
          this.queryInputs.push(input)
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'pi-ok' }] },
            parent_tool_use_id: null,
            session_id: input.sessionId,
          }
          yield {
            type: 'result',
            subtype: 'success',
            usage: { input_tokens: 0, output_tokens: 0 },
            session_id: input.sessionId,
          }
        }

        abort() {}
        dispose() {}
      }

      const adapter = new FakePiAdapter()
      const orchestrator = new AgentOrchestrator(adapter, new AgentEventBus(), 'pi')

      await orchestrator.sendMessage({
        sessionId: 'session-pi-auto-compaction-sync',
        userMessage: 'hello',
        channelId: 'missing-channel',
        modelId: 'pi-model',
        startedAt: 804,
      }, {
        onError: () => {},
        onComplete: () => {},
        onTitleUpdated: () => {},
        onRunStarted: () => {},
      })

      console.log(JSON.stringify({
        autoCompactionFlags: adapter.queryInputs.map((input) => input.runtimeAutoCompactionEnabled ?? null),
        queryCount: adapter.queryInputs.length,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('autoCompactionFlags'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      autoCompactionFlags?: Array<boolean | null>
      queryCount?: number
    }

    expect(result.autoCompactionFlags).toEqual([true])
    expect(result.queryCount).toBe(1)
  })

  test('Given pi engine When sending message Then enables Pi auto retry for the runtime', () => {
    const output = runOrchestratorScript(`
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: { getFocusedWindow: () => null },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')

      class FakePiAdapter {
        queryInputs = []

        async *query(input) {
          this.queryInputs.push(input)
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'pi-ok' }] },
            parent_tool_use_id: null,
            session_id: input.sessionId,
          }
          yield {
            type: 'result',
            subtype: 'success',
            usage: { input_tokens: 0, output_tokens: 0 },
            session_id: input.sessionId,
          }
        }

        abort() {}
        dispose() {}
      }

      const adapter = new FakePiAdapter()
      const orchestrator = new AgentOrchestrator(adapter, new AgentEventBus(), 'pi')

      await orchestrator.sendMessage({
        sessionId: 'session-pi-auto-retry-sync',
        userMessage: 'hello',
        channelId: 'missing-channel',
        modelId: 'pi-model',
        startedAt: 805,
      }, {
        onError: () => {},
        onComplete: () => {},
        onTitleUpdated: () => {},
        onRunStarted: () => {},
      })

      console.log(JSON.stringify({
        autoRetryFlags: adapter.queryInputs.map((input) => input.runtimeAutoRetryEnabled ?? null),
        queryCount: adapter.queryInputs.length,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('autoRetryFlags'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      autoRetryFlags?: Array<boolean | null>
      queryCount?: number
    }

    expect(result.autoRetryFlags).toEqual([true])
    expect(result.queryCount).toBe(1)
  })

  test('Given active pi session When runtime state is requested Then delegates to adapter getRuntimeState', () => {
    const output = runOrchestratorScript(`
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: { getFocusedWindow: () => null },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')

      let releaseQuery
      const waitForRelease = new Promise((resolve) => { releaseQuery = resolve })

      class FakePiAdapter {
        stateCalls = []

        async *query(input) {
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'running' }] },
            parent_tool_use_id: null,
            session_id: input.sessionId,
          }
          await waitForRelease
          yield {
            type: 'result',
            subtype: 'success',
            usage: { input_tokens: 0, output_tokens: 0 },
            session_id: input.sessionId,
          }
        }

        async getRuntimeState(sessionId) {
          this.stateCalls.push(sessionId)
          return {
            provider: 'deepseek',
            modelId: 'deepseek-v4-flash',
            thinkingLevel: 'high',
            isStreaming: true,
            isCompacting: false,
            nativeSessionId: 'pi-native-state',
            messageCount: 4,
            pendingMessageCount: 1,
            stats: {
              totalMessages: 9,
              tokens: { input: 300, output: 120, total: 420 },
              costUsd: 0.045,
            },
            commands: [
              {
                name: 'proma_mcp_status',
                description: 'Inspect configured MCP servers',
                source: 'extension',
                sourceInfo: { name: 'proma-mcp-bridge' },
              },
            ],
          }
        }

        abort() {}
        dispose() {}
      }

      const adapter = new FakePiAdapter()
      const orchestrator = new AgentOrchestrator(adapter, new AgentEventBus(), 'pi')
      const runPromise = orchestrator.sendMessage({
        sessionId: 'session-pi-state-route',
        userMessage: 'hello',
        channelId: 'missing-channel',
        modelId: 'pi-model',
        startedAt: 803,
      }, {
        onError: () => {},
        onComplete: () => {},
        onTitleUpdated: () => {},
        onRunStarted: () => {},
      })

      await new Promise((resolve) => setTimeout(resolve, 0))
      const runtimeState = await orchestrator.getActiveRuntimeState('session-pi-state-route')
      releaseQuery()
      await runPromise

      console.log(JSON.stringify({
        runtimeState,
        stateCalls: adapter.stateCalls,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('runtimeState'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      runtimeState?: {
        provider?: string
        modelId?: string
        nativeSessionId?: string
        pendingMessageCount?: number
        stats?: { totalMessages?: number; tokens?: { total?: number }; costUsd?: number }
        commands?: Array<{ name?: string; source?: string; sourceInfo?: { name?: string } }>
      }
      stateCalls?: string[]
    }

    expect(result.stateCalls).toEqual(['session-pi-state-route'])
    expect(result.runtimeState).toMatchObject({
      provider: 'deepseek',
      modelId: 'deepseek-v4-flash',
      nativeSessionId: 'pi-native-state',
      pendingMessageCount: 1,
      stats: {
        totalMessages: 9,
        tokens: { input: 300, output: 120, total: 420 },
        costUsd: 0.045,
      },
      commands: [
        {
          name: 'proma_mcp_status',
          description: 'Inspect configured MCP servers',
          source: 'extension',
          sourceInfo: { name: 'proma-mcp-bridge' },
        },
      ],
    })
  })

  test('Given pi transient deltas When run completes Then persists only final assistant content', () => {
    const output = runOrchestratorScript(`
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: { getFocusedWindow: () => null },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')
      const { getAgentSessionSDKMessages } = await import('./agent-session-manager.ts')

      class FakePiAdapter {
        async *query(input) {
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: '你' }] },
            parent_tool_use_id: null,
            session_id: input.sessionId,
            _promaTransient: true,
            _promaTextDelta: true,
          }
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: '好' }] },
            parent_tool_use_id: null,
            session_id: input.sessionId,
            _promaTransient: true,
            _promaTextDelta: true,
          }
          yield {
            type: 'assistant',
            message: { content: [{ type: 'thinking', thinking: '分析' }] },
            parent_tool_use_id: null,
            session_id: input.sessionId,
            _promaTransient: true,
            _promaThinkingDelta: true,
          }
          yield {
            type: 'assistant',
            message: {
              content: [
                { type: 'thinking', thinking: '分析' },
                { type: 'text', text: '你好' },
              ],
            },
            parent_tool_use_id: null,
            session_id: input.sessionId,
          }
          yield {
            type: 'result',
            subtype: 'success',
            usage: { input_tokens: 0, output_tokens: 0 },
            session_id: input.sessionId,
          }
        }

        abort() {}
        dispose() {}
      }

      const orchestrator = new AgentOrchestrator(new FakePiAdapter(), new AgentEventBus(), 'pi')

      await orchestrator.sendMessage({
        sessionId: 'session-pi-transient-persist',
        userMessage: 'hello',
        channelId: 'missing-channel',
        modelId: 'pi-model',
        startedAt: 456,
      }, {
        onError: () => {},
        onComplete: () => {},
        onTitleUpdated: () => {},
        onRunStarted: () => {},
      })

      const messages = getAgentSessionSDKMessages('session-pi-transient-persist')
      const assistantTexts = messages
        .filter((message) => message.type === 'assistant')
        .flatMap((message) => message.message.content)
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
      const assistantThinking = messages
        .filter((message) => message.type === 'assistant')
        .flatMap((message) => message.message.content)
        .filter((block) => block.type === 'thinking')
        .map((block) => block.thinking)

      console.log(JSON.stringify({
        assistantTexts,
        assistantThinking,
        persistedCount: messages.length,
        hasTransient: messages.some((message) => message._promaTransient === true),
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('assistantTexts'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      assistantTexts?: string[]
      assistantThinking?: string[]
      persistedCount?: number
      hasTransient?: boolean
    }

    expect(result.assistantTexts).toEqual(['你好'])
    expect(result.assistantThinking).toEqual(['分析'])
    expect(result.persistedCount).toBe(3)
    expect(result.hasTransient).toBe(false)
  })

  test('Given pi adapter emits Proma retry events When run completes Then forwards without persisting transient messages', () => {
    const output = runOrchestratorScript(`
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: { getFocusedWindow: () => null },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')
      const { getAgentSessionSDKMessages } = await import('./agent-session-manager.ts')

      class FakePiAdapter {
        async *query(input) {
          yield {
            type: 'system',
            subtype: 'pi_retry_event',
            session_id: input.sessionId,
            _promaTransient: true,
            _promaEvent: {
              type: 'retry',
              status: 'starting',
              attempt: 1,
              maxAttempts: 3,
              delaySeconds: 2,
              reason: 'provider timeout',
            },
          }
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'pi recovered' }] },
            parent_tool_use_id: null,
            session_id: input.sessionId,
          }
          yield {
            type: 'system',
            subtype: 'pi_retry_event',
            session_id: input.sessionId,
            _promaTransient: true,
            _promaEvent: { type: 'retry', status: 'cleared' },
          }
          yield {
            type: 'result',
            subtype: 'success',
            usage: { input_tokens: 0, output_tokens: 0 },
            session_id: input.sessionId,
          }
        }

        abort() {}
        dispose() {}
      }

      const eventBus = new AgentEventBus()
      const forwardedRetryEvents = []
      const forwardedSdkSubtypes = []
      eventBus.use((_sessionId, payload, next) => {
        if (payload.kind === 'proma_event' && payload.event.type === 'retry') {
          forwardedRetryEvents.push(payload.event)
        }
        if (payload.kind === 'sdk_message') {
          forwardedSdkSubtypes.push(payload.message.subtype ?? payload.message.type)
        }
        next()
      })

      const orchestrator = new AgentOrchestrator(new FakePiAdapter(), eventBus, 'pi')

      await orchestrator.sendMessage({
        sessionId: 'session-pi-retry-event-forward',
        userMessage: 'hello',
        channelId: 'missing-channel',
        modelId: 'pi-model',
        startedAt: 457,
      }, {
        onError: () => {},
        onComplete: () => {},
        onTitleUpdated: () => {},
        onRunStarted: () => {},
      })

      const messages = getAgentSessionSDKMessages('session-pi-retry-event-forward')

      console.log(JSON.stringify({
        forwardedRetryEvents,
        forwardedSdkSubtypes,
        persistedCount: messages.length,
        hasRetrySystemMessage: messages.some((message) => message.subtype === 'pi_retry_event'),
        hasTransient: messages.some((message) => message._promaTransient === true),
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('forwardedRetryEvents'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      forwardedRetryEvents?: Array<{ type?: string; status?: string; reason?: string }>
      forwardedSdkSubtypes?: string[]
      persistedCount?: number
      hasRetrySystemMessage?: boolean
      hasTransient?: boolean
    }

    expect(result.forwardedRetryEvents?.map((event) => event.status)).toEqual(['starting', 'cleared'])
    expect(result.forwardedRetryEvents?.[0]?.reason).toBe('provider timeout')
    expect(result.forwardedSdkSubtypes).toEqual(['assistant', 'success'])
    expect(result.persistedCount).toBe(3)
    expect(result.hasRetrySystemMessage).toBe(false)
    expect(result.hasTransient).toBe(false)
  })

  test('Given pi adapter emits Proma compaction events When run completes Then forwards events and persists only boundary', () => {
    const output = runOrchestratorScript(`
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: { getFocusedWindow: () => null },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')
      const { getAgentSessionSDKMessages } = await import('./agent-session-manager.ts')

      class FakePiAdapter {
        async *query(input) {
          yield {
            type: 'system',
            subtype: 'pi_runtime_event',
            session_id: input.sessionId,
            _promaTransient: true,
            _promaEvent: {
              type: 'compaction',
              status: 'starting',
              reason: 'threshold',
            },
          }
          yield {
            type: 'system',
            subtype: 'compact_boundary',
            summary: 'Pi 自动压缩摘要',
            tokens_before: 4096,
            session_id: input.sessionId,
          }
          yield {
            type: 'system',
            subtype: 'pi_runtime_event',
            session_id: input.sessionId,
            _promaTransient: true,
            _promaEvent: {
              type: 'compaction',
              status: 'cleared',
              reason: 'threshold',
            },
          }
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'pi compacted and continued' }] },
            parent_tool_use_id: null,
            session_id: input.sessionId,
          }
          yield {
            type: 'result',
            subtype: 'success',
            usage: { input_tokens: 0, output_tokens: 0 },
            session_id: input.sessionId,
          }
        }

        abort() {}
        dispose() {}
      }

      const eventBus = new AgentEventBus()
      const forwardedCompactionEvents = []
      const forwardedSdkSubtypes = []
      eventBus.use((_sessionId, payload, next) => {
        if (payload.kind === 'proma_event' && payload.event.type === 'compaction') {
          forwardedCompactionEvents.push(payload.event)
        }
        if (payload.kind === 'sdk_message') {
          forwardedSdkSubtypes.push(payload.message.subtype ?? payload.message.type)
        }
        next()
      })

      const orchestrator = new AgentOrchestrator(new FakePiAdapter(), eventBus, 'pi')

      await orchestrator.sendMessage({
        sessionId: 'session-pi-compaction-event-forward',
        userMessage: 'hello',
        channelId: 'missing-channel',
        modelId: 'pi-model',
        startedAt: 458,
      }, {
        onError: () => {},
        onComplete: () => {},
        onTitleUpdated: () => {},
        onRunStarted: () => {},
      })

      const messages = getAgentSessionSDKMessages('session-pi-compaction-event-forward')

      console.log(JSON.stringify({
        forwardedCompactionEvents,
        forwardedSdkSubtypes,
        persistedSystemSubtypes: messages
          .filter((message) => message.type === 'system')
          .map((message) => message.subtype),
        persistedCount: messages.length,
        hasRuntimeEventSystemMessage: messages.some((message) => message.subtype === 'pi_runtime_event'),
        hasTransient: messages.some((message) => message._promaTransient === true),
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('forwardedCompactionEvents'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      forwardedCompactionEvents?: Array<{ type?: string; status?: string; reason?: string }>
      forwardedSdkSubtypes?: string[]
      persistedSystemSubtypes?: string[]
      persistedCount?: number
      hasRuntimeEventSystemMessage?: boolean
      hasTransient?: boolean
    }

    expect(result.forwardedCompactionEvents).toEqual([
      { type: 'compaction', status: 'starting', reason: 'threshold' },
      { type: 'compaction', status: 'cleared', reason: 'threshold' },
    ])
    expect(result.forwardedSdkSubtypes).toEqual(['compact_boundary', 'assistant', 'success'])
    expect(result.persistedSystemSubtypes).toEqual(['compact_boundary'])
    expect(result.persistedCount).toBe(4)
    expect(result.hasRuntimeEventSystemMessage).toBe(false)
    expect(result.hasTransient).toBe(false)
  })

  test('Given pi extension confirm request When user allows permission Then returns confirmed response', () => {
    const output = runOrchestratorScript(`
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: { getFocusedWindow: () => null },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')
      const { permissionService } = await import('./agent-permission-service.ts')

      class FakePiAdapter {
        extensionResult = null

        async *query(input) {
          this.extensionResult = await input.handleExtensionUiRequest?.({
            type: 'extension_ui_request',
            id: 'pi-confirm-1',
            method: 'confirm',
            title: '允许 Pi 执行命令？',
            message: 'pwd',
          })
          yield {
            type: 'result',
            subtype: 'success',
            usage: { input_tokens: 0, output_tokens: 0 },
            session_id: input.sessionId,
          }
        }

        abort() {}
        dispose() {}
      }

      const adapter = new FakePiAdapter()
      const eventBus = new AgentEventBus()
      let permissionRequest = null
      let resolvedSessionId = null

      eventBus.use((sessionId, payload, next) => {
        if (payload.kind === 'proma_event' && payload.event.type === 'permission_request') {
          permissionRequest = payload.event.request
          queueMicrotask(() => {
            resolvedSessionId = permissionService.respondToPermission(permissionRequest.requestId, 'allow', false)
          })
        }
        next()
      })

      const orchestrator = new AgentOrchestrator(adapter, eventBus, 'pi')
      let completeResultSubtype = null

      await orchestrator.sendMessage({
        sessionId: 'session-pi-confirm',
        userMessage: 'hello',
        channelId: 'missing-channel',
        modelId: 'pi-model',
        startedAt: 789,
      }, {
        onError: () => {},
        onComplete: (_messages, opts) => { completeResultSubtype = opts?.resultSubtype ?? null },
        onTitleUpdated: () => {},
        onRunStarted: () => {},
      })

      console.log(JSON.stringify({
        extensionResult: adapter.extensionResult,
        permissionToolName: permissionRequest?.toolName ?? null,
        permissionTitle: permissionRequest?.sdkTitle ?? null,
        permissionDescription: permissionRequest?.sdkDescription ?? null,
        resolvedSessionId,
        completeResultSubtype,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('extensionResult'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      extensionResult?: { confirmed?: boolean }
      permissionToolName?: string | null
      permissionTitle?: string | null
      permissionDescription?: string | null
      resolvedSessionId?: string | null
      completeResultSubtype?: string | null
    }

    expect(result.extensionResult).toEqual({ confirmed: true })
    expect(result.permissionToolName).toBe('PiExtensionUi:confirm')
    expect(result.permissionTitle).toBe('允许 Pi 执行命令？')
    expect(result.permissionDescription).toBe('pwd')
    expect(result.resolvedSessionId).toBe('session-pi-confirm')
    expect(result.completeResultSubtype).toBe('success')
  })

  test('Given pi extension select request When user answers AskUser prompt Then returns selected value', () => {
    const output = runOrchestratorScript(`
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: { getFocusedWindow: () => null },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')
      const { askUserService } = await import('./agent-ask-user-service.ts')

      class FakePiAdapter {
        extensionResult = null

        async *query(input) {
          this.extensionResult = await input.handleExtensionUiRequest?.({
            type: 'extension_ui_request',
            id: 'pi-select-1',
            method: 'select',
            title: '选择执行策略',
            message: '请选择 Pi 下一步策略',
            options: ['直接执行', '先解释'],
          })
          yield {
            type: 'result',
            subtype: 'success',
            usage: { input_tokens: 0, output_tokens: 0 },
            session_id: input.sessionId,
          }
        }

        abort() {}
        dispose() {}
      }

      const adapter = new FakePiAdapter()
      const eventBus = new AgentEventBus()
      let askUserRequest = null
      let resolvedSessionId = null

      eventBus.use((sessionId, payload, next) => {
        if (payload.kind === 'proma_event' && payload.event.type === 'ask_user_request') {
          askUserRequest = payload.event.request
          queueMicrotask(() => {
            const question = askUserRequest.questions[0]?.question ?? ''
            resolvedSessionId = askUserService.respondToAskUser(askUserRequest.requestId, {
              [question]: '先解释',
            })
          })
        }
        next()
      })

      const orchestrator = new AgentOrchestrator(adapter, eventBus, 'pi')
      let completeResultSubtype = null

      await orchestrator.sendMessage({
        sessionId: 'session-pi-select',
        userMessage: 'hello',
        channelId: 'missing-channel',
        modelId: 'pi-model',
        startedAt: 790,
      }, {
        onError: () => {},
        onComplete: (_messages, opts) => { completeResultSubtype = opts?.resultSubtype ?? null },
        onTitleUpdated: () => {},
        onRunStarted: () => {},
      })

      console.log(JSON.stringify({
        extensionResult: adapter.extensionResult,
        askUserQuestion: askUserRequest?.questions[0]?.question ?? null,
        askUserOptions: askUserRequest?.questions[0]?.options?.map((option) => option.label) ?? [],
        resolvedSessionId,
        completeResultSubtype,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('extensionResult'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      extensionResult?: { value?: string; cancelled?: boolean }
      askUserQuestion?: string | null
      askUserOptions?: string[]
      resolvedSessionId?: string | null
      completeResultSubtype?: string | null
    }

    expect(result.extensionResult).toEqual({ value: '先解释' })
    expect(result.askUserQuestion).toBe('请选择 Pi 下一步策略')
    expect(result.askUserOptions).toEqual(['直接执行', '先解释'])
    expect(result.resolvedSessionId).toBe('session-pi-select')
    expect(result.completeResultSubtype).toBe('success')
  })

  test('Given pi extension input request When user submits text Then preserves placeholder and prefill', () => {
    const output = runOrchestratorScript(`
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: { getFocusedWindow: () => null },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')
      const { askUserService } = await import('./agent-ask-user-service.ts')

      class FakePiAdapter {
        extensionResult = null

        async *query(input) {
          this.extensionResult = await input.handleExtensionUiRequest?.({
            type: 'extension_ui_request',
            id: 'pi-input-1',
            method: 'input',
            title: '输入路径',
            message: '请输入输出目录',
            placeholder: '例如 /tmp/out',
            prefill: '/tmp/start',
          })
          yield {
            type: 'result',
            subtype: 'success',
            usage: { input_tokens: 0, output_tokens: 0 },
            session_id: input.sessionId,
          }
        }

        abort() {}
        dispose() {}
      }

      const adapter = new FakePiAdapter()
      const eventBus = new AgentEventBus()
      let askUserRequest = null
      let resolvedSessionId = null

      eventBus.use((sessionId, payload, next) => {
        if (payload.kind === 'proma_event' && payload.event.type === 'ask_user_request') {
          askUserRequest = payload.event.request
          queueMicrotask(() => {
            const question = askUserRequest.questions[0]?.question ?? ''
            resolvedSessionId = askUserService.respondToAskUser(askUserRequest.requestId, {
              [question]: '/tmp/finished',
            })
          })
        }
        next()
      })

      const orchestrator = new AgentOrchestrator(adapter, eventBus, 'pi')
      let completeResultSubtype = null

      await orchestrator.sendMessage({
        sessionId: 'session-pi-input',
        userMessage: 'hello',
        channelId: 'missing-channel',
        modelId: 'pi-model',
        startedAt: 791,
      }, {
        onError: () => {},
        onComplete: (_messages, opts) => { completeResultSubtype = opts?.resultSubtype ?? null },
        onTitleUpdated: () => {},
        onRunStarted: () => {},
      })

      console.log(JSON.stringify({
        extensionResult: adapter.extensionResult,
        askUserQuestion: askUserRequest?.questions[0]?.question ?? null,
        askUserPlaceholder: askUserRequest?.questions[0]?.placeholder ?? null,
        askUserPrefill: askUserRequest?.questions[0]?.prefill ?? null,
        resolvedSessionId,
        completeResultSubtype,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('askUserPlaceholder'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      extensionResult?: { value?: string; cancelled?: boolean }
      askUserQuestion?: string | null
      askUserPlaceholder?: string | null
      askUserPrefill?: string | null
      resolvedSessionId?: string | null
      completeResultSubtype?: string | null
    }

    expect(result.extensionResult).toEqual({ value: '/tmp/finished' })
    expect(result.askUserQuestion).toBe('请输入输出目录')
    expect(result.askUserPlaceholder).toBe('例如 /tmp/out')
    expect(result.askUserPrefill).toBe('/tmp/start')
    expect(result.resolvedSessionId).toBe('session-pi-input')
    expect(result.completeResultSubtype).toBe('success')
  })

  test('Given pi engine and message persistence fails When sending message Then releases active session', () => {
    const output = runOrchestratorScript(`
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: { getFocusedWindow: () => null },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      mock.module('./agent-session-manager.ts', () => ({
        appendSDKMessages: () => { throw new Error('disk full') },
        getAgentSessionMessages: () => [],
        getAgentSessionSDKMessages: () => [],
        truncateSDKMessages: () => {},
        resolveUserUuidFromSDK: () => undefined,
        rewindFilesFromSnapshot: () => ({ restoredFiles: [], failedFiles: [] }),
        createPiNativeRewindSession: () => null,
        updateAgentSessionMeta: () => {},
        getAgentSessionMeta: () => undefined,
      }))

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')

      class FakePiAdapter {
        abortCalls = 0
        async *query() {}
        abort() { this.abortCalls += 1 }
        dispose() {}
      }

      const adapter = new FakePiAdapter()
      const orchestrator = new AgentOrchestrator(adapter, new AgentEventBus(), 'pi')
      let errorMessage = null
      let completeCalled = false

      await orchestrator.sendMessage({
        sessionId: 'session-pi-persist-fail',
        userMessage: 'hello',
        channelId: 'missing-channel',
        modelId: 'pi-model',
        startedAt: 456,
      }, {
        onError: (error) => { errorMessage = error },
        onComplete: () => { completeCalled = true },
        onTitleUpdated: () => {},
        onRunStarted: () => {},
      })

      console.log(JSON.stringify({
        active: orchestrator.isActive('session-pi-persist-fail'),
        abortCalls: adapter.abortCalls,
        errorMessage,
        completeCalled,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('active'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      active?: boolean
      abortCalls?: number
      errorMessage?: string | null
      completeCalled?: boolean
    }

    expect(result.active).toBe(false)
    expect(result.abortCalls).toBe(1)
    expect(result.errorMessage).toBe('disk full')
    expect(result.completeCalled).toBe(true)
  })

  test('Given pi engine active session When queueing message Then delegates to Pi adapter and persists user message', () => {
    const output = runOrchestratorScript(`
      import { mock } from 'bun:test'

      const persisted = []

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: { getFocusedWindow: () => null },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      mock.module('./agent-session-manager.ts', () => ({
        appendSDKMessages: (_sessionId, messages) => { persisted.push(...messages) },
        getAgentSessionMessages: () => [],
        getAgentSessionSDKMessages: () => [],
        truncateSDKMessages: () => {},
        resolveUserUuidFromSDK: () => undefined,
        rewindFilesFromSnapshot: () => ({ restoredFiles: [], failedFiles: [] }),
        createPiNativeRewindSession: () => null,
        updateAgentSessionMeta: () => {},
        getAgentSessionMeta: () => undefined,
      }))

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')

      class FakePiAdapter {
        queuedMessages = []
        release = null

        async *query() {
          await new Promise((resolve) => { this.release = resolve })
          yield {
            type: 'result',
            subtype: 'success',
            usage: { input_tokens: 0, output_tokens: 0 },
            session_id: 'session-pi-queue-orchestrator',
          }
        }

        abort() {}
        dispose() {}
        async sendQueuedMessage(sessionId, message) {
          this.queuedMessages.push({ sessionId, message })
        }
      }

      const adapter = new FakePiAdapter()
      const orchestrator = new AgentOrchestrator(adapter, new AgentEventBus(), 'pi')

      const runPromise = orchestrator.sendMessage({
        sessionId: 'session-pi-queue-orchestrator',
        userMessage: 'hello',
        channelId: 'missing-channel',
        modelId: 'pi-model',
        startedAt: 901,
      }, {
        onError: () => {},
        onComplete: () => {},
        onTitleUpdated: () => {},
        onRunStarted: () => {},
      })

      await new Promise((resolve) => setTimeout(resolve, 0))
      const queuedUuid = await orchestrator.queueMessage(
        'session-pi-queue-orchestrator',
        'continue now',
        undefined,
        'queued-pi-1',
        { interrupt: true },
      )

      adapter.release()
      await runPromise

      console.log(JSON.stringify({
        queuedUuid,
        queuedCount: adapter.queuedMessages.length,
        queuedText: adapter.queuedMessages[0]?.message?.message?.content ?? null,
        queuedPriority: adapter.queuedMessages[0]?.message?.priority ?? null,
        persistedTexts: persisted.map((message) => message.message?.content?.[0]?.text ?? null),
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('queuedCount'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      queuedUuid?: string
      queuedCount?: number
      queuedText?: string | null
      queuedPriority?: string | null
      persistedTexts?: Array<string | null>
    }

    expect(result.queuedUuid).toBe('queued-pi-1')
    expect(result.queuedCount).toBe(1)
    expect(result.queuedText).toBe('continue now')
    expect(result.queuedPriority).toBe('now')
    expect(result.persistedTexts).toContain('continue now')
  })

  test('Given pi engine active session When queueing interrupting message Then interrupts before injecting message', () => {
    const output = runOrchestratorScript(`
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: { getFocusedWindow: () => null },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      mock.module('./agent-session-manager.ts', () => ({
        appendSDKMessages: () => {},
        getAgentSessionMessages: () => [],
        getAgentSessionSDKMessages: () => [],
        truncateSDKMessages: () => {},
        resolveUserUuidFromSDK: () => undefined,
        rewindFilesFromSnapshot: () => ({ restoredFiles: [], failedFiles: [] }),
        createPiNativeRewindSession: () => null,
        updateAgentSessionMeta: () => {},
        getAgentSessionMeta: () => undefined,
      }))

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')

      class FakePiAdapter {
        calls = []
        release = null

        async *query() {
          await new Promise((resolve) => { this.release = resolve })
          yield {
            type: 'result',
            subtype: 'success',
            usage: { input_tokens: 0, output_tokens: 0 },
            session_id: 'session-pi-interrupt-queue-orchestrator',
          }
        }

        abort() {}
        dispose() {}
        async interruptQuery(sessionId) {
          this.calls.push({ method: 'interruptQuery', sessionId })
        }
        async sendQueuedMessage(sessionId, message) {
          this.calls.push({ method: 'sendQueuedMessage', sessionId, text: message.message.content })
        }
      }

      const adapter = new FakePiAdapter()
      const orchestrator = new AgentOrchestrator(adapter, new AgentEventBus(), 'pi')

      const runPromise = orchestrator.sendMessage({
        sessionId: 'session-pi-interrupt-queue-orchestrator',
        userMessage: 'hello',
        channelId: 'missing-channel',
        modelId: 'pi-model',
        startedAt: 904,
      }, {
        onError: () => {},
        onComplete: () => {},
        onTitleUpdated: () => {},
        onRunStarted: () => {},
      })

      await new Promise((resolve) => setTimeout(resolve, 0))
      await orchestrator.queueMessage(
        'session-pi-interrupt-queue-orchestrator',
        'interrupt and continue',
        undefined,
        'queued-pi-interrupt-1',
        { interrupt: true },
      )

      adapter.release()
      await runPromise

      console.log(JSON.stringify({
        calls: adapter.calls,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('calls'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      calls?: Array<{ method?: string; sessionId?: string; text?: string }>
    }

    expect(result.calls).toEqual([
      { method: 'interruptQuery', sessionId: 'session-pi-interrupt-queue-orchestrator' },
      { method: 'sendQueuedMessage', sessionId: 'session-pi-interrupt-queue-orchestrator', text: 'interrupt and continue' },
    ])
  })

  test('Given pi engine active session and queued image input When queueing message Then passes images to Pi adapter', () => {
    const output = runOrchestratorScript(`
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: { getFocusedWindow: () => null },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      mock.module('./agent-session-manager.ts', () => ({
        appendSDKMessages: () => {},
        getAgentSessionMessages: () => [],
        getAgentSessionSDKMessages: () => [],
        truncateSDKMessages: () => {},
        resolveUserUuidFromSDK: () => undefined,
        rewindFilesFromSnapshot: () => ({ restoredFiles: [], failedFiles: [] }),
        createPiNativeRewindSession: () => null,
        updateAgentSessionMeta: () => {},
        getAgentSessionMeta: () => undefined,
      }))

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')

      class FakePiAdapter {
        queuedMessages = []
        release = null

        async *query() {
          await new Promise((resolve) => { this.release = resolve })
          yield {
            type: 'result',
            subtype: 'success',
            usage: { input_tokens: 0, output_tokens: 0 },
            session_id: 'session-pi-queued-image-orchestrator',
          }
        }

        abort() {}
        dispose() {}
        async sendQueuedMessage(sessionId, message) {
          this.queuedMessages.push({ sessionId, message })
        }
      }

      const adapter = new FakePiAdapter()
      const orchestrator = new AgentOrchestrator(adapter, new AgentEventBus(), 'pi')

      const runPromise = orchestrator.sendMessage({
        sessionId: 'session-pi-queued-image-orchestrator',
        userMessage: 'hello',
        channelId: 'missing-channel',
        modelId: 'pi-model',
        startedAt: 902,
      }, {
        onError: () => {},
        onComplete: () => {},
        onTitleUpdated: () => {},
        onRunStarted: () => {},
      })

      await new Promise((resolve) => setTimeout(resolve, 0))
      await orchestrator.queueMessage(
        'session-pi-queued-image-orchestrator',
        'continue with image',
        undefined,
        'queued-pi-image-1',
        {
          interrupt: true,
          images: [
            {
              type: 'image',
              data: 'iVBORw0KGgo=',
              mimeType: 'image/png',
              filename: 'diagram.png',
            },
          ],
        },
      )

      adapter.release()
      await runPromise

      console.log(JSON.stringify({
        images: adapter.queuedMessages[0]?.message?.images ?? [],
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('images'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      images?: Array<{ type?: string; data?: string; mimeType?: string; filename?: string }>
    }

    expect(result.images).toEqual([
      {
        type: 'image',
        data: 'iVBORw0KGgo=',
        mimeType: 'image/png',
        filename: 'diagram.png',
      },
    ])
  })

  test('Given pi engine active session When queued adapter rejects Then queueing message does not persist user message', () => {
    const output = runOrchestratorScript(`
      import { mock } from 'bun:test'

      const persisted = []

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: { getFocusedWindow: () => null },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      mock.module('./agent-session-manager.ts', () => ({
        appendSDKMessages: (_sessionId, messages) => { persisted.push(...messages) },
        getAgentSessionMessages: () => [],
        getAgentSessionSDKMessages: () => [],
        truncateSDKMessages: () => {},
        resolveUserUuidFromSDK: () => undefined,
        rewindFilesFromSnapshot: () => ({ restoredFiles: [], failedFiles: [] }),
        createPiNativeRewindSession: () => null,
        updateAgentSessionMeta: () => {},
        getAgentSessionMeta: () => undefined,
      }))

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')

      class RejectingPiAdapter {
        release = null

        async *query() {
          await new Promise((resolve) => { this.release = resolve })
          yield {
            type: 'result',
            subtype: 'success',
            usage: { input_tokens: 0, output_tokens: 0 },
            session_id: 'session-pi-queue-reject-orchestrator',
          }
        }

        abort() {}
        dispose() {}
        async sendQueuedMessage() {
          throw new Error('Pi prompt rejected before acceptance')
        }
      }

      const adapter = new RejectingPiAdapter()
      const orchestrator = new AgentOrchestrator(adapter, new AgentEventBus(), 'pi')

      const runPromise = orchestrator.sendMessage({
        sessionId: 'session-pi-queue-reject-orchestrator',
        userMessage: 'hello',
        channelId: 'missing-channel',
        modelId: 'pi-model',
        startedAt: 903,
      }, {
        onError: () => {},
        onComplete: () => {},
        onTitleUpdated: () => {},
        onRunStarted: () => {},
      })

      await new Promise((resolve) => setTimeout(resolve, 0))
      let errorMessage = null
      try {
        await orchestrator.queueMessage(
          'session-pi-queue-reject-orchestrator',
          'continue rejected',
          undefined,
          'queued-pi-reject-1',
          { interrupt: true },
        )
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error)
      }

      adapter.release()
      await runPromise

      console.log(JSON.stringify({
        errorMessage,
        persistedTexts: persisted.map((message) => message.message?.content?.[0]?.text ?? null),
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('errorMessage'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      errorMessage?: string | null
      persistedTexts?: Array<string | null>
    }

    expect(result.errorMessage).toBe('Pi prompt rejected before acceptance')
    expect(result.persistedTexts).not.toContain('continue rejected')
  })

  test('Given pi engine active session When stopping Then aborts Pi adapter and completes as stopped by user', () => {
    const output = runOrchestratorScript(`
      import { mock } from 'bun:test'

      const metaUpdates = []

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: { getFocusedWindow: () => null },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      mock.module('./agent-session-manager.ts', () => ({
        appendSDKMessages: () => {},
        getAgentSessionMessages: () => [],
        getAgentSessionSDKMessages: () => [],
        truncateSDKMessages: () => {},
        resolveUserUuidFromSDK: () => undefined,
        rewindFilesFromSnapshot: () => ({ restoredFiles: [], failedFiles: [] }),
        createPiNativeRewindSession: () => null,
        updateAgentSessionMeta: (sessionId, patch) => { metaUpdates.push({ sessionId, patch }) },
        getAgentSessionMeta: () => undefined,
      }))

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')

      class FakePiAdapter {
        abortCalls = 0
        release = null
        running = true

        async *query() {
          await new Promise((resolve) => { this.release = resolve })
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'late text after abort' }] },
            parent_tool_use_id: null,
            session_id: 'session-pi-stop',
          }
        }

        abort() {
          if (!this.running) return
          this.running = false
          this.abortCalls += 1
          this.release?.()
        }

        dispose() {}
      }

      const adapter = new FakePiAdapter()
      const orchestrator = new AgentOrchestrator(adapter, new AgentEventBus(), 'pi')
      let completeStoppedByUser = null
      let completeStartedAt = null

      const runPromise = orchestrator.sendMessage({
        sessionId: 'session-pi-stop',
        userMessage: 'long task',
        channelId: 'missing-channel',
        modelId: 'pi-model',
        startedAt: 902,
      }, {
        onError: () => {},
        onComplete: (_messages, opts) => {
          completeStoppedByUser = opts?.stoppedByUser ?? null
          completeStartedAt = opts?.startedAt ?? null
        },
        onTitleUpdated: () => {},
        onRunStarted: () => {},
      })

      await new Promise((resolve) => setTimeout(resolve, 0))
      const activeBeforeStop = orchestrator.isActive('session-pi-stop')
      orchestrator.stop('session-pi-stop')
      await runPromise

      console.log(JSON.stringify({
        activeBeforeStop,
        activeAfterStop: orchestrator.isActive('session-pi-stop'),
        abortCalls: adapter.abortCalls,
        completeStoppedByUser,
        completeStartedAt,
        stoppedPatch: metaUpdates.find((item) => item.patch?.stoppedByUser === true)?.patch ?? null,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('abortCalls'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      activeBeforeStop?: boolean
      activeAfterStop?: boolean
      abortCalls?: number
      completeStoppedByUser?: boolean | null
      completeStartedAt?: number | null
      stoppedPatch?: { stoppedByUser?: boolean } | null
    }

    expect(result.activeBeforeStop).toBe(true)
    expect(result.activeAfterStop).toBe(false)
    expect(result.abortCalls).toBe(1)
    expect(result.completeStoppedByUser).toBe(true)
    expect(result.completeStartedAt).toBe(902)
    expect(result.stoppedPatch).toEqual({ stoppedByUser: true })
  })

  test('Given pi workspace When sending message Then prompt declares MCP Skill boundary and loads Pi extensions plus skills', () => {
    const output = runOrchestratorScript(`
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: { getFocusedWindow: () => null },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      mock.module('./agent-workspace-manager.ts', () => ({
        getAgentWorkspace: (id) => id === 'workspace-pi'
          ? { id, name: 'Pi Workspace', slug: 'pi-workspace', agentEngine: 'pi', createdAt: 0, updatedAt: 0 }
          : undefined,
        getWorkspaceMcpConfig: () => ({
          servers: {
            docs: { type: 'stdio', command: 'mcp-docs', enabled: true },
            disabled: { type: 'stdio', command: 'mcp-disabled', enabled: false },
          },
        }),
        getWorkspaceSkills: () => [
          { slug: 'code-review', name: 'Code Review', description: '审查代码', enabled: true },
          { slug: 'disabled-skill', name: 'Disabled Skill', enabled: false },
        ],
        getWorkspaceAttachedDirectories: () => [],
        getWorkspaceAttachedFiles: () => [],
        ensurePluginManifest: () => {},
      }))

      const { mkdirSync, writeFileSync } = await import('node:fs')
      const { join } = await import('node:path')
      const globalSkillsDir = join(process.env.HOME, '.agents', 'skills')
      const workspaceSkillsDir = join(process.env.HOME, '.proma', 'agent-workspaces', 'pi-workspace', 'skills')
      mkdirSync(join(globalSkillsDir, 'using-superpowers'), { recursive: true })
      writeFileSync(join(globalSkillsDir, 'using-superpowers', 'SKILL.md'), [
        '---',
        'name: using-superpowers',
        'description: 使用指南',
        '---',
        '',
        '# Using Superpowers',
        'Always load relevant skills first.',
      ].join('\\n'))
      mkdirSync(join(workspaceSkillsDir, 'code-review'), { recursive: true })
      writeFileSync(join(workspaceSkillsDir, 'code-review', 'SKILL.md'), [
        '---',
        'name: Code Review',
        'description: 审查代码',
        '---',
        '',
        '# Code Review',
        'Find bugs before summaries.',
      ].join('\\n'))

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')

      class FakePiAdapter {
        lastInput = null

        async *query(input) {
          this.lastInput = input
          yield {
            type: 'result',
            subtype: 'success',
            usage: { input_tokens: 0, output_tokens: 0 },
            session_id: input.sessionId,
          }
        }

        abort() {}
        dispose() {}
      }

      const adapter = new FakePiAdapter()
      const orchestrator = new AgentOrchestrator(adapter, new AgentEventBus(), 'pi')

      await orchestrator.sendMessage({
        sessionId: 'session-pi-boundary',
        userMessage: '请使用 /skill:code-review 和 /skill:using-superpowers #mcp:docs 帮我检查',
        channelId: 'missing-channel',
        modelId: 'pi-model',
        workspaceId: 'workspace-pi',
        mentionedSkills: ['code-review', 'using-superpowers'],
        mentionedMcpServers: ['docs'],
        startedAt: 777,
      }, {
        onError: () => {},
        onComplete: () => {},
        onTitleUpdated: () => {},
        onRunStarted: () => {},
      })

      console.log(JSON.stringify({
        prompt: adapter.lastInput?.prompt ?? '',
        extensionCount: adapter.lastInput?.runtimeExtensionPaths?.length ?? 0,
        extensionPaths: adapter.lastInput?.runtimeExtensionPaths ?? [],
        skillPaths: adapter.lastInput?.runtimeSkillPaths ?? [],
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('extensionCount'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      prompt?: string
      extensionCount?: number
      extensionPaths?: string[]
      skillPaths?: string[]
    }

    expect(result.prompt).toContain('<pi_capability_boundary>')
    expect(result.prompt).toContain('Proma 会通过 Pi MCP bridge extension 将已启用 MCP 服务器暴露为 Pi 原生桥接工具')
    expect(result.prompt).toContain('优先使用逐工具注册的 mcp__<server>__<tool>')
    expect(result.prompt).toContain('逐工具枚举失败或不确定工具名时再调用 list_tools / call_tool')
    expect(result.prompt).toContain('mcp__docs__list_tools')
    expect(result.prompt).toContain('mcp__docs__call_tool')
    expect(result.prompt).toContain('Pi native skill paths:')
    expect(result.prompt).toContain('docs')
    expect(result.prompt).toContain('code-review: Code Review')
    expect(result.prompt).toContain('Pi 原生 --skill loader')
    expect(result.prompt).toContain('<mentioned_pi_skills>')
    expect(result.prompt).toContain('<skill name="code-review"')
    expect(result.prompt).toContain('Find bugs before summaries.')
    expect(result.prompt).toContain('<skill name="using-superpowers"')
    expect(result.prompt).toContain('Always load relevant skills first.')
    expect(result.extensionCount).toBe(4)
    expect(result.extensionPaths?.some((path) => path.includes('proma-permission-bridge.mjs'))).toBe(true)
    expect(result.extensionPaths?.some((path) => path.includes('proma-task-bridge.mjs'))).toBe(true)
    expect(result.extensionPaths?.some((path) => path.includes('proma-mcp-bridge.mjs'))).toBe(true)
    expect(result.extensionPaths?.some((path) => path.includes('proma-git-checkpoint.mjs'))).toBe(true)
    expect(result.skillPaths?.some((path) => path.endsWith('/agent-workspaces/pi-workspace/skills'))).toBe(true)
    expect(result.skillPaths?.some((path) => path.endsWith('/.agents/skills'))).toBe(true)
  })

  test('Given pi workspace and enabled memory When sending message Then loads Pi memory extension and advertises memory tools', () => {
    const output = runOrchestratorScript(`
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: { getFocusedWindow: () => null },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      mock.module('./memory-service.ts', () => ({
        getMemoryConfig: () => ({
          enabled: true,
          apiKey: 'sk-memory-secret',
          userId: 'proma-user',
          baseUrl: 'https://memory.example.test/api',
        }),
      }))

      mock.module('./agent-workspace-manager.ts', () => ({
        getAgentWorkspace: (id) => id === 'workspace-pi'
          ? { id, name: 'Pi Workspace', slug: 'pi-workspace', agentEngine: 'pi', createdAt: 0, updatedAt: 0 }
          : undefined,
        getWorkspaceMcpConfig: () => ({ servers: {} }),
        getWorkspaceSkills: () => [],
        getWorkspaceAttachedDirectories: () => [],
        getWorkspaceAttachedFiles: () => [],
        ensurePluginManifest: () => {},
      }))

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')

      class FakePiAdapter {
        lastInput = null

        async *query(input) {
          this.lastInput = input
          yield {
            type: 'result',
            subtype: 'success',
            usage: { input_tokens: 0, output_tokens: 0 },
            session_id: input.sessionId,
          }
        }

        abort() {}
        dispose() {}
      }

      const adapter = new FakePiAdapter()
      const orchestrator = new AgentOrchestrator(adapter, new AgentEventBus(), 'pi')

      await orchestrator.sendMessage({
        sessionId: 'session-pi-memory',
        userMessage: '请回忆一下我的偏好',
        channelId: 'missing-channel',
        modelId: 'pi-model',
        workspaceId: 'workspace-pi',
        startedAt: 888,
      }, {
        onError: () => {},
        onComplete: () => {},
        onTitleUpdated: () => {},
        onRunStarted: () => {},
      })

      console.log(JSON.stringify({
        prompt: adapter.lastInput?.prompt ?? '',
        extensionCount: adapter.lastInput?.runtimeExtensionPaths?.length ?? 0,
        extensionPaths: adapter.lastInput?.runtimeExtensionPaths ?? [],
        memoryKey: adapter.lastInput?.runtimeEnv?.PROMA_MEMOS_API_KEY ?? null,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('memoryKey'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      prompt?: string
      extensionCount?: number
      extensionPaths?: string[]
      memoryKey?: string | null
    }

    expect(result.extensionCount).toBe(4)
    expect(result.extensionPaths?.some((path) => path.includes('proma-task-bridge.mjs'))).toBe(true)
    expect(result.extensionPaths?.some((path) => path.includes('proma-memory-bridge.mjs'))).toBe(true)
    expect(result.memoryKey).toBe('sk-memory-secret')
    expect(result.prompt).toContain('mcp__mem__recall_memory')
    expect(result.prompt).toContain('mcp__mem__add_memory')
    expect(result.prompt).not.toContain('sk-memory-secret')
  })

  test('Given pi engine and image input When sending message Then passes images to Pi adapter', () => {
    const output = runOrchestratorScript(`
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: { getFocusedWindow: () => null },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      mock.module('./agent-workspace-manager.ts', () => ({
        getAgentWorkspace: (id) => id === 'workspace-pi'
          ? { id, name: 'Pi Workspace', slug: 'pi-workspace', agentEngine: 'pi', createdAt: 0, updatedAt: 0 }
          : undefined,
        getWorkspaceMcpConfig: () => ({ servers: {} }),
        getWorkspaceSkills: () => [],
        getWorkspaceAttachedDirectories: () => [],
        getWorkspaceAttachedFiles: () => [],
        ensurePluginManifest: () => {},
      }))

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')

      class FakePiAdapter {
        lastInput = null

        async *query(input) {
          this.lastInput = input
          yield {
            type: 'result',
            subtype: 'success',
            usage: { input_tokens: 0, output_tokens: 0 },
            session_id: input.sessionId,
          }
        }

        abort() {}
        dispose() {}
      }

      const adapter = new FakePiAdapter()
      const orchestrator = new AgentOrchestrator(adapter, new AgentEventBus(), 'pi')

      await orchestrator.sendMessage({
        sessionId: 'session-pi-image-input',
        userMessage: '请看这张图',
        channelId: 'missing-channel',
        modelId: 'pi-model',
        workspaceId: 'workspace-pi',
        images: [
          {
            type: 'image',
            data: 'iVBORw0KGgo=',
            mimeType: 'image/png',
            filename: 'diagram.png',
          },
        ],
        startedAt: 890,
      }, {
        onError: () => {},
        onComplete: () => {},
        onTitleUpdated: () => {},
        onRunStarted: () => {},
      })

      console.log(JSON.stringify({
        images: adapter.lastInput?.images ?? [],
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('images'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      images?: Array<{ type?: string; data?: string; mimeType?: string; filename?: string }>
    }

    expect(result.images).toEqual([
      {
        type: 'image',
        data: 'iVBORw0KGgo=',
        mimeType: 'image/png',
        filename: 'diagram.png',
      },
    ])
  })

  test('Given pi workspace and enabled nano banana When sending message Then loads Pi image extension and advertises image tool', () => {
    const output = runOrchestratorScript(`
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: { getFocusedWindow: () => null },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      mock.module('./chat-tool-config.ts', () => ({
        getToolState: (toolId) => toolId === 'nano-banana' ? { enabled: true } : { enabled: false },
        getToolCredentials: (toolId) => toolId === 'nano-banana'
          ? {
              apiKey: 'sk-nano-secret',
              baseUrl: 'https://gemini.example.test',
              model: 'gemini-image-test',
            }
          : {},
      }))

      mock.module('./agent-workspace-manager.ts', () => ({
        getAgentWorkspace: (id) => id === 'workspace-pi'
          ? { id, name: 'Pi Workspace', slug: 'pi-workspace', agentEngine: 'pi', createdAt: 0, updatedAt: 0 }
          : undefined,
        getWorkspaceMcpConfig: () => ({ servers: {} }),
        getWorkspaceSkills: () => [],
        getWorkspaceAttachedDirectories: () => [],
        getWorkspaceAttachedFiles: () => [],
        ensurePluginManifest: () => {},
      }))

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')

      class FakePiAdapter {
        lastInput = null

        async *query(input) {
          this.lastInput = input
          yield {
            type: 'result',
            subtype: 'success',
            usage: { input_tokens: 0, output_tokens: 0 },
            session_id: input.sessionId,
          }
        }

        abort() {}
        dispose() {}
      }

      const adapter = new FakePiAdapter()
      const orchestrator = new AgentOrchestrator(adapter, new AgentEventBus(), 'pi')

      await orchestrator.sendMessage({
        sessionId: 'session-pi-nano',
        userMessage: '帮我生成一张图',
        channelId: 'missing-channel',
        modelId: 'pi-model',
        workspaceId: 'workspace-pi',
        startedAt: 889,
      }, {
        onError: () => {},
        onComplete: () => {},
        onTitleUpdated: () => {},
        onRunStarted: () => {},
      })

      console.log(JSON.stringify({
        prompt: adapter.lastInput?.prompt ?? '',
        extensionCount: adapter.lastInput?.runtimeExtensionPaths?.length ?? 0,
        extensionPaths: adapter.lastInput?.runtimeExtensionPaths ?? [],
        nanoKey: adapter.lastInput?.runtimeEnv?.PROMA_NANO_BANANA_API_KEY ?? null,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('nanoKey'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      prompt?: string
      extensionCount?: number
      extensionPaths?: string[]
      nanoKey?: string | null
    }

    expect(result.extensionCount).toBe(4)
    expect(result.extensionPaths?.some((path) => path.includes('proma-task-bridge.mjs'))).toBe(true)
    expect(result.extensionPaths?.some((path) => path.includes('proma-nano-banana-bridge.mjs'))).toBe(true)
    expect(result.nanoKey).toBe('sk-nano-secret')
    expect(result.prompt).toContain('mcp__nano_banana__generate_image')
    expect(result.prompt).not.toContain('sk-nano-secret')
  })

  test('Given pi workspace When sending message Then loads Pi task extension and advertises task tools', () => {
    const output = runOrchestratorScript(`
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: { getFocusedWindow: () => null },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      mock.module('./agent-workspace-manager.ts', () => ({
        getAgentWorkspace: (id) => id === 'workspace-pi'
          ? { id, name: 'Pi Workspace', slug: 'pi-workspace', agentEngine: 'pi', createdAt: 0, updatedAt: 0 }
          : undefined,
        getWorkspaceMcpConfig: () => ({ servers: {} }),
        getWorkspaceSkills: () => [],
        getWorkspaceAttachedDirectories: () => [],
        getWorkspaceAttachedFiles: () => [],
        ensurePluginManifest: () => {},
      }))

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')

      class FakePiAdapter {
        lastInput = null

        async *query(input) {
          this.lastInput = input
          yield {
            type: 'result',
            subtype: 'success',
            usage: { input_tokens: 0, output_tokens: 0 },
            session_id: input.sessionId,
          }
        }

        abort() {}
        dispose() {}
      }

      const adapter = new FakePiAdapter()
      const orchestrator = new AgentOrchestrator(adapter, new AgentEventBus(), 'pi')

      await orchestrator.sendMessage({
        sessionId: 'session-pi-task-tools',
        userMessage: '请分步骤完成这个任务',
        channelId: 'missing-channel',
        modelId: 'pi-model',
        workspaceId: 'workspace-pi',
        startedAt: 890,
      }, {
        onError: () => {},
        onComplete: () => {},
        onTitleUpdated: () => {},
        onRunStarted: () => {},
      })

      console.log(JSON.stringify({
        prompt: adapter.lastInput?.prompt ?? '',
        extensionCount: adapter.lastInput?.runtimeExtensionPaths?.length ?? 0,
        extensionPaths: adapter.lastInput?.runtimeExtensionPaths ?? [],
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('extensionCount'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      prompt?: string
      extensionCount?: number
      extensionPaths?: string[]
    }

    expect(result.extensionPaths?.some((path) => path.includes('proma-task-bridge.mjs'))).toBe(true)
    expect(result.prompt).toContain('TaskCreate')
    expect(result.prompt).toContain('TaskUpdate')
    expect(result.prompt).toContain('TaskGet')
    expect(result.prompt).toContain('TaskList')
  })

  test('Given pi permission request is always allowed When requested again Then skips second prompt', () => {
    const output = runOrchestratorScript(`
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: { getFocusedWindow: () => null },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')
      const { permissionService } = await import('./agent-permission-service.ts')

      const permissionPayload = {
        promaPermissionRequest: true,
        toolName: 'write',
        toolInput: { path: '/tmp/file.txt', content: 'hello' },
        description: '写入文件: /tmp/file.txt',
        dangerLevel: 'normal',
        toolCallId: 'tool-1',
      }

      class FakePiAdapter {
        async *query(input) {
          const first = await input.handleExtensionUiRequest({
            type: 'extension_ui_request',
            id: 'perm-1',
            method: 'confirm',
            title: 'Proma Pi 权限确认',
            message: JSON.stringify(permissionPayload),
          })
          const second = await input.handleExtensionUiRequest({
            type: 'extension_ui_request',
            id: 'perm-2',
            method: 'confirm',
            title: 'Proma Pi 权限确认',
            message: JSON.stringify({ ...permissionPayload, toolCallId: 'tool-2' }),
          })
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: JSON.stringify({ first, second }) }] },
            parent_tool_use_id: null,
            session_id: input.sessionId,
          }
          yield {
            type: 'result',
            subtype: 'success',
            usage: { input_tokens: 0, output_tokens: 0 },
            session_id: input.sessionId,
          }
        }

        abort() {}
        dispose() {}
      }

      const eventBus = new AgentEventBus()
      const permissionRequestIds = []
      eventBus.use((sessionId, payload, next) => {
        if (payload.kind === 'proma_event' && payload.event.type === 'permission_request') {
          permissionRequestIds.push(payload.event.request.requestId)
          permissionService.respondToPermission(payload.event.request.requestId, 'allow', true)
        }
        next()
      })

      const orchestrator = new AgentOrchestrator(new FakePiAdapter(), eventBus, 'pi')

      await orchestrator.sendMessage({
        sessionId: 'session-pi-whitelist',
        userMessage: 'write twice',
        channelId: 'missing-channel',
        modelId: 'pi-model',
        startedAt: 778,
      }, {
        onError: () => {},
        onComplete: () => {},
        onTitleUpdated: () => {},
        onRunStarted: () => {},
      })

      console.log(JSON.stringify({
        permissionRequestIds,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('permissionRequestIds'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      permissionRequestIds?: string[]
    }

    expect(result.permissionRequestIds).toEqual(['perm-1'])
  })

  test('Given active session When stopping background task Then delegates to adapter stopTask', () => {
    const output = runOrchestratorScript(`
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: { getFocusedWindow: () => null },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')

      let releaseAgentEnd
      const waitForRelease = new Promise((resolve) => { releaseAgentEnd = resolve })

      class FakeAdapter {
        stopTaskCalls = []

        async *query(input) {
          await waitForRelease
          yield {
            type: 'result',
            subtype: 'success',
            usage: { input_tokens: 0, output_tokens: 0 },
            session_id: input.sessionId,
          }
        }

        async stopTask(sessionId, taskId) {
          this.stopTaskCalls.push({ sessionId, taskId })
        }

        abort() {}
        dispose() {}
      }

      const adapter = new FakeAdapter()
      const orchestrator = new AgentOrchestrator(adapter, new AgentEventBus(), 'pi')
      const runPromise = orchestrator.sendMessage({
        sessionId: 'session-stop-task',
        userMessage: 'run task',
        channelId: 'missing-channel',
        modelId: 'model',
        startedAt: 991,
      }, {
        onError: () => {},
        onComplete: () => {},
        onTitleUpdated: () => {},
        onRunStarted: () => {},
      })

      await new Promise((resolve) => setTimeout(resolve, 0))
      await orchestrator.stopTask('session-stop-task', 'task-123')
      releaseAgentEnd()
      await runPromise

      console.log(JSON.stringify({
        stopTaskCalls: adapter.stopTaskCalls,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('stopTaskCalls'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      stopTaskCalls?: Array<{ sessionId?: string; taskId?: string }>
    }

    expect(result.stopTaskCalls).toEqual([{ sessionId: 'session-stop-task', taskId: 'task-123' }])
  })

  test('Given active session When aborting runtime retry Then delegates to adapter abortRetry', () => {
    const output = runOrchestratorScript(`
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: { getFocusedWindow: () => null },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')

      let releaseAgentEnd
      const waitForRelease = new Promise((resolve) => { releaseAgentEnd = resolve })

      class FakeAdapter {
        abortRetryCalls = []

        async *query(input) {
          await waitForRelease
          yield {
            type: 'result',
            subtype: 'success',
            usage: { input_tokens: 0, output_tokens: 0 },
            session_id: input.sessionId,
          }
        }

        async abortRetry(sessionId) {
          this.abortRetryCalls.push({ sessionId })
        }

        abort() {}
        dispose() {}
      }

      const adapter = new FakeAdapter()
      const orchestrator = new AgentOrchestrator(adapter, new AgentEventBus(), 'pi')
      const runPromise = orchestrator.sendMessage({
        sessionId: 'session-abort-runtime-retry',
        userMessage: 'run task',
        channelId: 'missing-channel',
        modelId: 'model',
        startedAt: 993,
      }, {
        onError: () => {},
        onComplete: () => {},
        onTitleUpdated: () => {},
        onRunStarted: () => {},
      })

      await new Promise((resolve) => setTimeout(resolve, 0))
      await orchestrator.abortRuntimeRetry('session-abort-runtime-retry')
      releaseAgentEnd()
      await runPromise

      console.log(JSON.stringify({
        abortRetryCalls: adapter.abortRetryCalls,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('abortRetryCalls'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      abortRetryCalls?: Array<{ sessionId?: string }>
    }

    expect(result.abortRetryCalls).toEqual([{ sessionId: 'session-abort-runtime-retry' }])
  })

  test('Given active session When auto controls are changed Then delegates to adapter auto control commands', () => {
    const output = runOrchestratorScript(`
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: { getFocusedWindow: () => null },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')

      let releaseAgentEnd
      const waitForRelease = new Promise((resolve) => { releaseAgentEnd = resolve })

      class FakeAdapter {
        autoCompactionCalls = []
        autoRetryCalls = []

        async *query(input) {
          await waitForRelease
          yield {
            type: 'result',
            subtype: 'success',
            usage: { input_tokens: 0, output_tokens: 0 },
            session_id: input.sessionId,
          }
        }

        async setAutoCompaction(sessionId, enabled) {
          this.autoCompactionCalls.push({ sessionId, enabled })
        }

        async setAutoRetry(sessionId, enabled) {
          this.autoRetryCalls.push({ sessionId, enabled })
        }

        abort() {}
        dispose() {}
      }

      const adapter = new FakeAdapter()
      const orchestrator = new AgentOrchestrator(adapter, new AgentEventBus(), 'pi')
      const runPromise = orchestrator.sendMessage({
        sessionId: 'session-set-auto-controls',
        userMessage: 'run task',
        channelId: 'missing-channel',
        modelId: 'model',
        startedAt: 994,
      }, {
        onError: () => {},
        onComplete: () => {},
        onTitleUpdated: () => {},
        onRunStarted: () => {},
      })

      await new Promise((resolve) => setTimeout(resolve, 0))
      await orchestrator.updateRuntimeAutoControls('session-set-auto-controls', {
        autoCompactionEnabled: false,
        autoRetryEnabled: true,
      })
      releaseAgentEnd()
      await runPromise

      console.log(JSON.stringify({
        autoCompactionCalls: adapter.autoCompactionCalls,
        autoRetryCalls: adapter.autoRetryCalls,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('autoCompactionCalls'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      autoCompactionCalls?: Array<{ sessionId?: string; enabled?: boolean }>
      autoRetryCalls?: Array<{ sessionId?: string; enabled?: boolean }>
    }

    expect(result.autoCompactionCalls).toEqual([{ sessionId: 'session-set-auto-controls', enabled: false }])
    expect(result.autoRetryCalls).toEqual([{ sessionId: 'session-set-auto-controls', enabled: true }])
  })

  test('Given active session When runtime model is changed Then delegates to adapter model command', () => {
    const output = runOrchestratorScript(`
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: { getFocusedWindow: () => null },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')

      let releaseAgentEnd
      const waitForRelease = new Promise((resolve) => { releaseAgentEnd = resolve })

      class FakeAdapter {
        modelCalls = []

        async *query(input) {
          await waitForRelease
          yield {
            type: 'result',
            subtype: 'success',
            usage: { input_tokens: 0, output_tokens: 0 },
            session_id: input.sessionId,
          }
        }

        async setModel(sessionId, input) {
          this.modelCalls.push({ sessionId, ...input })
        }

        abort() {}
        dispose() {}
      }

      const adapter = new FakeAdapter()
      const orchestrator = new AgentOrchestrator(adapter, new AgentEventBus(), 'pi')
      const runPromise = orchestrator.sendMessage({
        sessionId: 'session-set-runtime-model',
        userMessage: 'run task',
        channelId: 'missing-channel',
        modelId: 'model',
        startedAt: 996,
      }, {
        onError: () => {},
        onComplete: () => {},
        onTitleUpdated: () => {},
        onRunStarted: () => {},
      })

      await new Promise((resolve) => setTimeout(resolve, 0))
      await orchestrator.updateRuntimeModel('session-set-runtime-model', {
        provider: 'openai',
        modelId: 'qwen-plus',
      })
      releaseAgentEnd()
      await runPromise

      console.log(JSON.stringify({
        modelCalls: adapter.modelCalls,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('modelCalls'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      modelCalls?: Array<{ sessionId?: string; provider?: string; modelId?: string }>
    }

    expect(result.modelCalls).toEqual([{ sessionId: 'session-set-runtime-model', provider: 'openai', modelId: 'qwen-plus' }])
  })

  test('Given active session When queue modes are changed Then delegates to adapter queue mode commands', () => {
    const output = runOrchestratorScript(`
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: { getFocusedWindow: () => null },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')

      let releaseAgentEnd
      const waitForRelease = new Promise((resolve) => { releaseAgentEnd = resolve })

      class FakeAdapter {
        steeringModeCalls = []
        followUpModeCalls = []

        async *query(input) {
          await waitForRelease
          yield {
            type: 'result',
            subtype: 'success',
            usage: { input_tokens: 0, output_tokens: 0 },
            session_id: input.sessionId,
          }
        }

        async setSteeringMode(sessionId, mode) {
          this.steeringModeCalls.push({ sessionId, mode })
        }

        async setFollowUpMode(sessionId, mode) {
          this.followUpModeCalls.push({ sessionId, mode })
        }

        abort() {}
        dispose() {}
      }

      const adapter = new FakeAdapter()
      const orchestrator = new AgentOrchestrator(adapter, new AgentEventBus(), 'pi')
      const runPromise = orchestrator.sendMessage({
        sessionId: 'session-set-queue-modes',
        userMessage: 'run task',
        channelId: 'missing-channel',
        modelId: 'model',
        startedAt: 994,
      }, {
        onError: () => {},
        onComplete: () => {},
        onTitleUpdated: () => {},
        onRunStarted: () => {},
      })

      await new Promise((resolve) => setTimeout(resolve, 0))
      await orchestrator.updateRuntimeQueueModes('session-set-queue-modes', {
        steeringMode: 'all',
        followUpMode: 'one-at-a-time',
      })
      releaseAgentEnd()
      await runPromise

      console.log(JSON.stringify({
        steeringModeCalls: adapter.steeringModeCalls,
        followUpModeCalls: adapter.followUpModeCalls,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('steeringModeCalls'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      steeringModeCalls?: Array<{ sessionId?: string; mode?: string }>
      followUpModeCalls?: Array<{ sessionId?: string; mode?: string }>
    }

    expect(result.steeringModeCalls).toEqual([{ sessionId: 'session-set-queue-modes', mode: 'all' }])
    expect(result.followUpModeCalls).toEqual([{ sessionId: 'session-set-queue-modes', mode: 'one-at-a-time' }])
  })

  test('Given active session When thinking level is changed Then delegates to adapter thinking command', () => {
    const output = runOrchestratorScript(`
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: { getFocusedWindow: () => null },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')

      let releaseAgentEnd
      const waitForRelease = new Promise((resolve) => { releaseAgentEnd = resolve })

      class FakeAdapter {
        thinkingLevelCalls = []

        async *query(input) {
          await waitForRelease
          yield {
            type: 'result',
            subtype: 'success',
            usage: { input_tokens: 0, output_tokens: 0 },
            session_id: input.sessionId,
          }
        }

        async setThinkingLevel(sessionId, level) {
          this.thinkingLevelCalls.push({ sessionId, level })
        }

        abort() {}
        dispose() {}
      }

      const adapter = new FakeAdapter()
      const orchestrator = new AgentOrchestrator(adapter, new AgentEventBus(), 'pi')
      const runPromise = orchestrator.sendMessage({
        sessionId: 'session-set-thinking-level',
        userMessage: 'run task',
        channelId: 'missing-channel',
        modelId: 'model',
        startedAt: 995,
      }, {
        onError: () => {},
        onComplete: () => {},
        onTitleUpdated: () => {},
        onRunStarted: () => {},
      })

      await new Promise((resolve) => setTimeout(resolve, 0))
      await orchestrator.updateRuntimeThinkingLevel('session-set-thinking-level', 'xhigh')
      releaseAgentEnd()
      await runPromise

      console.log(JSON.stringify({
        thinkingLevelCalls: adapter.thinkingLevelCalls,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('thinkingLevelCalls'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      thinkingLevelCalls?: Array<{ sessionId?: string; level?: string }>
    }

    expect(result.thinkingLevelCalls).toEqual([{ sessionId: 'session-set-thinking-level', level: 'xhigh' }])
  })

  test('Given active session When stopping shell task Then delegates to adapter stopShellTask', () => {
    const output = runOrchestratorScript(`
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: { getFocusedWindow: () => null },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')

      let releaseAgentEnd
      const waitForRelease = new Promise((resolve) => { releaseAgentEnd = resolve })

      class FakeAdapter {
        stopShellTaskCalls = []

        async *query(input) {
          await waitForRelease
          yield {
            type: 'result',
            subtype: 'success',
            usage: { input_tokens: 0, output_tokens: 0 },
            session_id: input.sessionId,
          }
        }

        async stopShellTask(sessionId, taskId) {
          this.stopShellTaskCalls.push({ sessionId, taskId })
        }

        abort() {}
        dispose() {}
      }

      const adapter = new FakeAdapter()
      const orchestrator = new AgentOrchestrator(adapter, new AgentEventBus(), 'pi')
      const runPromise = orchestrator.sendMessage({
        sessionId: 'session-stop-shell-task',
        userMessage: 'run shell',
        channelId: 'missing-channel',
        modelId: 'model',
        startedAt: 992,
      }, {
        onError: () => {},
        onComplete: () => {},
        onTitleUpdated: () => {},
        onRunStarted: () => {},
      })

      await new Promise((resolve) => setTimeout(resolve, 0))
      await orchestrator.stopShellTask('session-stop-shell-task', 'shell-123')
      releaseAgentEnd()
      await runPromise

      console.log(JSON.stringify({
        stopShellTaskCalls: adapter.stopShellTaskCalls,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('stopShellTaskCalls'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      stopShellTaskCalls?: Array<{ sessionId?: string; taskId?: string }>
    }

    expect(result.stopShellTaskCalls).toEqual([{ sessionId: 'session-stop-shell-task', taskId: 'shell-123' }])
  })
})
