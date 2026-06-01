import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

function runOrchestratorScript(script: string): string {
  const homeDir = mkdtempSync(join(tmpdir(), 'proma-agent-orchestrator-'))
  try {
    const result = Bun.spawnSync({
      cmd: [process.execPath, '--eval', script],
      cwd: import.meta.dir,
      env: {
        ...process.env,
        HOME: homeDir,
        PROMA_DEV: undefined,
        CLAUDE_CONFIG_DIR: undefined,
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

        abort() {}
        dispose() {}
      }

      const session = createAgentSession(undefined, 'title-channel', undefined, 'pi')
      const orchestrator = new AgentOrchestrator(new FakePiAdapter(), new AgentEventBus(), 'pi')
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
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('storedTitle'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      initialTitle?: string
      titleFromCallback?: string | null
      callbackTitle?: string | null
      storedTitle?: string | null
    }

    expect(result.initialTitle).toBe('新 Agent 会话')
    expect(result.titleFromCallback).toBe('项目结构分析')
    expect(result.callbackTitle).toBe('项目结构分析')
    expect(result.storedTitle).toBe('项目结构分析')
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
})
