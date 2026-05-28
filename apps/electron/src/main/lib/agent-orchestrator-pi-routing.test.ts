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
