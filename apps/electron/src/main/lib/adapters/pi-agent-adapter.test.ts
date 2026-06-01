import { describe, expect, test } from 'bun:test'

function runPiAdapterScript(
  script: string,
  envOverrides: Record<string, string | undefined> = { PROMA_PI_AGENT_ENABLED: '1' },
): string {
  const result = Bun.spawnSync({
    cmd: [process.execPath, '--eval', script],
    cwd: import.meta.dir,
    env: {
      ...process.env,
      ...envOverrides,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const stdout = result.stdout.toString()
  const stderr = result.stderr.toString()
  expect(result.exitCode, stderr || stdout).toBe(0)
  return stdout.trim()
}

describe('PiAgentAdapter', () => {
  test('Given pi engine selected without hidden env flag When query runs Then starts RPC session', () => {
    const output = runPiAdapterScript(`
      import { mock } from 'bun:test'

      let startCount = 0

      mock.module('./pi-process', () => ({
        startPiRpcSession: () => {
          startCount += 1
          return {
            send: () => {},
            abort: () => {},
            kill: () => {},
            done: Promise.resolve({
              exitCode: 0,
              signal: null,
              stdoutSnippet: '',
              stderrSnippet: '',
              aborted: false,
            }),
            events: (async function* () {
              yield { type: 'agent_end', messages: [] }
            })(),
          }
        },
      }))

      const { PiAgentAdapter } = await import('./pi-agent-adapter.ts')
      const adapter = new PiAgentAdapter()
      const messages = []

      for await (const message of adapter.query({
        sessionId: 'session-pi-no-hidden-env',
        prompt: 'hello',
        model: 'pi-model',
      })) {
        messages.push(message)
      }

      console.log(JSON.stringify({
        startCount,
        messageTypes: messages.map((message) => message.type),
        resultSubtype: messages.at(-1)?.subtype,
        errorType: messages[0]?.error?.errorType ?? null,
      }))
    `, { PROMA_PI_AGENT_ENABLED: undefined })

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('startCount'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      startCount?: number
      messageTypes?: string[]
      resultSubtype?: string
      errorType?: string | null
    }

    expect(result.startCount).toBe(1)
    expect(result.messageTypes).toEqual(['result'])
    expect(result.resultSubtype).toBe('success')
    expect(result.errorType).toBeNull()
  })

  test('Given rpc text and tool events When query runs Then yields Proma SDK-shaped messages', () => {
    const output = runPiAdapterScript(`
      import { mock } from 'bun:test'

      const sentCommands = []
      let killCount = 0

      mock.module('./pi-process', () => ({
        startPiRpcSession: () => ({
          send: (command) => { sentCommands.push(command) },
          abort: () => {},
          kill: () => { killCount += 1 },
          done: Promise.resolve({
            exitCode: 0,
            signal: null,
            stdoutSnippet: '',
            stderrSnippet: '',
            aborted: false,
          }),
          events: (async function* () {
            yield {
              type: 'message_update',
              assistantMessageEvent: {
                type: 'text_delta',
                delta: 'hello pi',
              },
            }
            yield {
              type: 'tool_execution_start',
              toolCallId: 'call-1',
              toolName: 'bash',
              args: { command: 'pwd' },
            }
            yield {
              type: 'tool_execution_end',
              toolCallId: 'call-1',
              toolName: 'bash',
              result: { content: [{ type: 'text', text: '/tmp/project' }] },
              isError: false,
            }
            yield { type: 'agent_end', messages: [] }
          })(),
        }),
      }))

      const { PiAgentAdapter } = await import('./pi-agent-adapter.ts')
      const adapter = new PiAgentAdapter()
      const messages = []

      for await (const message of adapter.query({
        sessionId: 'session-pi-adapter',
        prompt: 'hello',
        model: 'pi-model',
      })) {
        messages.push(message)
      }

      console.log(JSON.stringify({
        sentCommands,
        killCount,
        messageTypes: messages.map((message) => message.type),
        firstText: messages[0]?.message?.content?.[0]?.text,
        secondTool: messages[1]?.message?.content?.[0],
        thirdToolResult: messages[2]?.message?.content?.[0],
        resultSubtype: messages[3]?.subtype,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('sentCommands'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      sentCommands?: Array<{ type?: string; message?: string }>
      killCount?: number
      messageTypes?: string[]
      firstText?: string
      secondTool?: { type?: string; id?: string; name?: string; input?: { command?: string } }
      thirdToolResult?: { type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean }
      resultSubtype?: string
    }

    expect(result.sentCommands?.[0]).toMatchObject({ type: 'prompt', message: 'hello' })
    expect(result.killCount).toBe(1)
    expect(result.messageTypes).toEqual(['assistant', 'assistant', 'user', 'result'])
    expect(result.firstText).toBe('hello pi')
    expect(result.secondTool).toEqual({
      type: 'tool_use',
      id: 'call-1',
      name: 'bash',
      input: { command: 'pwd' },
    })
    expect(result.thirdToolResult).toEqual({
      type: 'tool_result',
      tool_use_id: 'call-1',
      content: [{ type: 'text', text: '/tmp/project' }],
      is_error: false,
    })
    expect(result.resultSubtype).toBe('success')
  })

  test('Given Pi tool update When query runs Then emits transient tool result progress', () => {
    const output = runPiAdapterScript(`
      import { mock } from 'bun:test'

      mock.module('./pi-process', () => ({
        startPiRpcSession: () => ({
          send: () => {},
          abort: () => {},
          kill: () => {},
          done: Promise.resolve({
            exitCode: 0,
            signal: null,
            stdoutSnippet: '',
            stderrSnippet: '',
            aborted: false,
          }),
          events: (async function* () {
            yield {
              type: 'tool_execution_start',
              toolCallId: 'call-progress',
              toolName: 'bash',
              args: { command: 'printf hello' },
            }
            yield {
              type: 'tool_execution_update',
              toolCallId: 'call-progress',
              toolName: 'bash',
              partialResult: { content: [{ type: 'text', text: 'hel' }] },
            }
            yield {
              type: 'tool_execution_end',
              toolCallId: 'call-progress',
              toolName: 'bash',
              result: { content: [{ type: 'text', text: 'hello' }] },
              isError: false,
            }
            yield { type: 'agent_end', messages: [] }
          })(),
        }),
      }))

      const { PiAgentAdapter } = await import('./pi-agent-adapter.ts')
      const adapter = new PiAgentAdapter()
      const messages = []

      for await (const message of adapter.query({
        sessionId: 'session-pi-tool-progress',
        prompt: 'hello',
        model: 'deepseek-v4-flash',
      })) {
        messages.push(message)
      }

      const toolResults = messages
        .filter((message) => message.type === 'user')
        .map((message) => ({
          block: message.message.content[0],
          transient: message._promaTransient === true,
          progress: message._promaToolProgress === true,
        }))

      console.log(JSON.stringify({
        messageTypes: messages.map((message) => message.type),
        toolResults,
        resultSubtype: messages.at(-1)?.subtype,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('toolResults'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      messageTypes?: string[]
      toolResults?: Array<{
        block?: { type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean }
        transient?: boolean
        progress?: boolean
      }>
      resultSubtype?: string
    }

    expect(result.messageTypes).toEqual(['assistant', 'user', 'user', 'result'])
    expect(result.toolResults?.[0]).toEqual({
      block: {
        type: 'tool_result',
        tool_use_id: 'call-progress',
        content: [{ type: 'text', text: 'hel' }],
        is_error: false,
      },
      transient: true,
      progress: true,
    })
    expect(result.toolResults?.[1]).toEqual({
      block: {
        type: 'tool_result',
        tool_use_id: 'call-progress',
        content: [{ type: 'text', text: 'hello' }],
        is_error: false,
      },
      transient: false,
      progress: false,
    })
    expect(result.resultSubtype).toBe('success')
  })

  test('Given Pi text deltas and message end When query runs Then emits transient deltas and final assistant text', () => {
    const output = runPiAdapterScript(`
      import { mock } from 'bun:test'

      mock.module('./pi-process', () => ({
        startPiRpcSession: () => ({
          send: () => {},
          abort: () => {},
          kill: () => {},
          done: Promise.resolve({
            exitCode: 0,
            signal: null,
            stdoutSnippet: '',
            stderrSnippet: '',
            aborted: false,
          }),
          events: (async function* () {
            yield {
              type: 'message_update',
              assistantMessageEvent: { type: 'text_delta', delta: '你' },
            }
            yield {
              type: 'message_update',
              assistantMessageEvent: { type: 'text_delta', delta: '好' },
            }
            yield {
              type: 'message_end',
              message: {
                role: 'assistant',
                content: [{ type: 'text', text: '你好' }],
                stopReason: 'stop',
              },
            }
            yield { type: 'agent_end', messages: [] }
          })(),
        }),
      }))

      const { PiAgentAdapter } = await import('./pi-agent-adapter.ts')
      const adapter = new PiAgentAdapter()
      const messages = []

      for await (const message of adapter.query({
        sessionId: 'session-pi-final-text',
        prompt: 'hello',
        model: 'deepseek-v4-flash',
      })) {
        messages.push(message)
      }

      console.log(JSON.stringify({
        messageTypes: messages.map((message) => message.type),
        texts: messages
          .filter((message) => message.type === 'assistant')
          .map((message) => message.message.content[0]?.text),
        transientFlags: messages
          .filter((message) => message.type === 'assistant')
          .map((message) => message._promaTransient === true),
        deltaFlags: messages
          .filter((message) => message.type === 'assistant')
          .map((message) => message._promaTextDelta === true),
        resultSubtype: messages.at(-1)?.subtype,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('transientFlags'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      messageTypes?: string[]
      texts?: string[]
      transientFlags?: boolean[]
      deltaFlags?: boolean[]
      resultSubtype?: string
    }

    expect(result.messageTypes).toEqual(['assistant', 'assistant', 'assistant', 'result'])
    expect(result.texts).toEqual(['你', '好', '你好'])
    expect(result.transientFlags).toEqual([true, true, false])
    expect(result.deltaFlags).toEqual([true, true, false])
    expect(result.resultSubtype).toBe('success')
  })

  test('Given Pi thinking delta and message end When query runs Then preserves final thinking block without warning', () => {
    const output = runPiAdapterScript(`
      import { mock } from 'bun:test'

      const warnings = []
      const originalWarn = console.warn
      console.warn = (...args) => {
        warnings.push(args.map((arg) => String(arg)).join(' '))
      }

      mock.module('./pi-process', () => ({
        startPiRpcSession: () => ({
          send: () => {},
          abort: () => {},
          kill: () => {},
          done: Promise.resolve({
            exitCode: 0,
            signal: null,
            stdoutSnippet: '',
            stderrSnippet: '',
            aborted: false,
          }),
          events: (async function* () {
            yield {
              type: 'message_update',
              assistantMessageEvent: { type: 'thinking_delta', delta: '先分析' },
            }
            yield {
              type: 'message_end',
              message: {
                role: 'assistant',
                content: [
                  { type: 'thinking', thinking: '先分析' },
                  { type: 'text', text: '最终回答' },
                ],
                stopReason: 'stop',
              },
            }
            yield { type: 'agent_end', messages: [] }
          })(),
        }),
      }))

      const { PiAgentAdapter } = await import('./pi-agent-adapter.ts')
      const adapter = new PiAgentAdapter()
      const messages = []

      for await (const message of adapter.query({
        sessionId: 'session-pi-thinking',
        prompt: 'hello',
        model: 'deepseek-v4-flash',
      })) {
        messages.push(message)
      }

      console.warn = originalWarn
      console.log(JSON.stringify({
        warnings,
        messageTypes: messages.map((message) => message.type),
        assistantBlocks: messages
          .filter((message) => message.type === 'assistant')
          .map((message) => message.message.content),
        transientFlags: messages
          .filter((message) => message.type === 'assistant')
          .map((message) => message._promaTransient === true),
        thinkingDeltaFlags: messages
          .filter((message) => message.type === 'assistant')
          .map((message) => message._promaThinkingDelta === true),
        resultSubtype: messages.at(-1)?.subtype,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('assistantBlocks'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      warnings?: string[]
      messageTypes?: string[]
      assistantBlocks?: Array<Array<{ type?: string; thinking?: string; text?: string }>>
      transientFlags?: boolean[]
      thinkingDeltaFlags?: boolean[]
      resultSubtype?: string
    }

    expect(result.messageTypes).toEqual(['assistant', 'assistant', 'result'])
    expect(result.assistantBlocks?.[0]).toEqual([{ type: 'thinking', thinking: '先分析' }])
    expect(result.assistantBlocks?.[1]).toEqual([
      { type: 'thinking', thinking: '先分析' },
      { type: 'text', text: '最终回答' },
    ])
    expect(result.transientFlags).toEqual([true, false])
    expect(result.thinkingDeltaFlags).toEqual([true, false])
    expect(result.resultSubtype).toBe('success')
    expect(result.warnings).toEqual([])
  })

  test('Given extension confirm request When permission handler allows Then writes extension response', () => {
    const output = runPiAdapterScript(`
      import { mock } from 'bun:test'

      const sentCommands = []

      mock.module('./pi-process', () => ({
        startPiRpcSession: () => ({
          send: (command) => { sentCommands.push(command) },
          abort: () => {},
          kill: () => {},
          done: Promise.resolve({
            exitCode: 0,
            signal: null,
            stdoutSnippet: '',
            stderrSnippet: '',
            aborted: false,
          }),
          events: (async function* () {
            yield {
              type: 'extension_ui_request',
              id: 'perm-1',
              method: 'confirm',
              title: 'Allow bash?',
              message: 'pwd',
            }
            yield { type: 'agent_end', messages: [] }
          })(),
        }),
      }))

      const { PiAgentAdapter } = await import('./pi-agent-adapter.ts')
      const adapter = new PiAgentAdapter()
      const handledRequests = []

      for await (const _message of adapter.query({
        sessionId: 'session-pi-adapter',
        prompt: 'hello',
        model: 'pi-model',
        handleExtensionUiRequest: async (request) => {
          handledRequests.push(request)
          return { confirmed: true }
        },
      })) {}

      console.log(JSON.stringify({
        handledRequests,
        sentCommands,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('handledRequests'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      handledRequests?: Array<{ id?: string; method?: string; title?: string; message?: string }>
      sentCommands?: Array<{ type?: string; id?: string; confirmed?: boolean; message?: string }>
    }

    expect(result.handledRequests?.[0]).toMatchObject({
      id: 'perm-1',
      method: 'confirm',
      title: 'Allow bash?',
      message: 'pwd',
    })
    expect(result.sentCommands?.[1]).toEqual({
      type: 'extension_ui_response',
      id: 'perm-1',
      confirmed: true,
    })
  })

  test('Given Pi assistant provider error When query runs Then surfaces visible error instead of success', () => {
    const output = runPiAdapterScript(`
      import { mock } from 'bun:test'

      mock.module('./pi-process', () => ({
        startPiRpcSession: () => ({
          send: () => {},
          abort: () => {},
          kill: () => {},
          done: Promise.resolve({
            exitCode: 0,
            signal: null,
            stdoutSnippet: '',
            stderrSnippet: '',
            aborted: false,
          }),
          events: (async function* () {
            yield {
              type: 'message_end',
              message: {
                role: 'assistant',
                content: [],
                stopReason: 'error',
                errorMessage: '404 status code (no body)',
              },
            }
            yield {
              type: 'agent_end',
              messages: [
                {
                  role: 'assistant',
                  content: [],
                  stopReason: 'error',
                  errorMessage: '404 status code (no body)',
                },
              ],
            }
          })(),
        }),
      }))

      const { PiAgentAdapter } = await import('./pi-agent-adapter.ts')
      const adapter = new PiAgentAdapter()
      const messages = []

      for await (const message of adapter.query({
        sessionId: 'session-pi-provider-error',
        prompt: 'hello',
        model: 'deepseek-v4-flash',
      })) {
        messages.push(message)
      }

      console.log(JSON.stringify({
        messageTypes: messages.map((message) => message.type),
        firstText: messages[0]?.message?.content?.[0]?.text,
        firstStopReason: messages[0]?.message?.stop_reason,
        firstErrorType: messages[0]?.error?.errorType,
        resultSubtype: messages[1]?.subtype,
        resultErrors: messages[1]?.errors,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('messageTypes'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      messageTypes?: string[]
      firstText?: string
      firstStopReason?: string
      firstErrorType?: string
      resultSubtype?: string
      resultErrors?: string[]
    }

    expect(result.messageTypes).toEqual(['assistant', 'result'])
    expect(result.firstText).toContain('404 status code')
    expect(result.firstStopReason).toBe('error')
    expect(result.firstErrorType).toBe('pi_provider_error')
    expect(result.resultSubtype).toBe('error')
    expect(result.resultErrors?.[0]).toContain('404 status code')
  })

  test('Given unknown Pi RPC event When query runs Then logs diagnostic and continues', () => {
    const output = runPiAdapterScript(`
      import { mock } from 'bun:test'

      const warnings = []
      const originalWarn = console.warn
      console.warn = (...args) => {
        warnings.push(args.map((arg) => String(arg)).join(' '))
      }

      mock.module('./pi-process', () => ({
        startPiRpcSession: () => ({
          send: () => {},
          abort: () => {},
          kill: () => {},
          done: Promise.resolve({
            exitCode: 0,
            signal: null,
            stdoutSnippet: '',
            stderrSnippet: '',
            aborted: false,
          }),
          events: (async function* () {
            yield {
              type: 'future_pi_event',
              requestId: 'event-1',
              payload: { ok: true },
            }
            yield { type: 'agent_end', messages: [] }
          })(),
        }),
      }))

      const { PiAgentAdapter } = await import('./pi-agent-adapter.ts')
      const adapter = new PiAgentAdapter()
      const messages = []

      for await (const message of adapter.query({
        sessionId: 'session-pi-unknown-event',
        prompt: 'hello',
        model: 'deepseek-v4-flash',
      })) {
        messages.push(message)
      }

      console.warn = originalWarn
      console.log(JSON.stringify({
        warnings,
        messageTypes: messages.map((message) => message.type),
        resultSubtype: messages.at(-1)?.subtype,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('warnings'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      warnings?: string[]
      messageTypes?: string[]
      resultSubtype?: string
    }

    expect(result.messageTypes).toEqual(['result'])
    expect(result.resultSubtype).toBe('success')
    expect(result.warnings?.[0]).toContain('未识别 Pi RPC 事件')
    expect(result.warnings?.[0]).toContain('future_pi_event')
  })

  test('Given known Pi lifecycle events When query runs Then skips them without unknown diagnostics', () => {
    const output = runPiAdapterScript(`
      import { mock } from 'bun:test'

      const warnings = []
      const originalWarn = console.warn
      console.warn = (...args) => {
        warnings.push(args.map((arg) => String(arg)).join(' '))
      }

      mock.module('./pi-process', () => ({
        startPiRpcSession: () => ({
          send: () => {},
          abort: () => {},
          kill: () => {},
          done: Promise.resolve({
            exitCode: 0,
            signal: null,
            stdoutSnippet: '',
            stderrSnippet: '',
            aborted: false,
          }),
          events: (async function* () {
            yield { type: 'agent_start' }
            yield { type: 'turn_start' }
            yield { type: 'message_start', message: { role: 'assistant', content: [] } }
            yield {
              type: 'tool_execution_update',
              toolCallId: 'call-1',
              toolName: 'bash',
              args: { command: 'pwd' },
              partialResult: 'running',
            }
            yield { type: 'turn_end', message: { role: 'assistant', content: [] }, toolResults: [] }
            yield { type: 'queue_update', steering: [], followUp: [] }
            yield { type: 'agent_end', messages: [] }
          })(),
        }),
      }))

      const { PiAgentAdapter } = await import('./pi-agent-adapter.ts')
      const adapter = new PiAgentAdapter()
      const messages = []

      for await (const message of adapter.query({
        sessionId: 'session-pi-known-lifecycle-events',
        prompt: 'hello',
        model: 'deepseek-v4-flash',
      })) {
        messages.push(message)
      }

      console.warn = originalWarn
      console.log(JSON.stringify({
        warnings,
        messageTypes: messages.map((message) => message.type),
        resultSubtype: messages.at(-1)?.subtype,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('warnings'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      warnings?: string[]
      messageTypes?: string[]
      resultSubtype?: string
    }

    expect(result.messageTypes).toEqual(['user', 'result'])
    expect(result.resultSubtype).toBe('success')
    expect(result.warnings).toEqual([])
  })

  test('Given unknown Pi message update child event When query runs Then logs diagnostic and continues', () => {
    const output = runPiAdapterScript(`
      import { mock } from 'bun:test'

      const warnings = []
      const originalWarn = console.warn
      console.warn = (...args) => {
        warnings.push(args.map((arg) => String(arg)).join(' '))
      }

      mock.module('./pi-process', () => ({
        startPiRpcSession: () => ({
          send: () => {},
          abort: () => {},
          kill: () => {},
          done: Promise.resolve({
            exitCode: 0,
            signal: null,
            stdoutSnippet: '',
            stderrSnippet: '',
            aborted: false,
          }),
          events: (async function* () {
            yield {
              type: 'message_update',
              assistantMessageEvent: {
                type: 'future_delta',
                delta: 'future stream',
              },
            }
            yield { type: 'agent_end', messages: [] }
          })(),
        }),
      }))

      const { PiAgentAdapter } = await import('./pi-agent-adapter.ts')
      const adapter = new PiAgentAdapter()
      const messages = []

      for await (const message of adapter.query({
        sessionId: 'session-pi-unknown-child-event',
        prompt: 'hello',
        model: 'deepseek-v4-flash',
      })) {
        messages.push(message)
      }

      console.warn = originalWarn
      console.log(JSON.stringify({
        warnings,
        messageTypes: messages.map((message) => message.type),
        resultSubtype: messages.at(-1)?.subtype,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('warnings'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      warnings?: string[]
      messageTypes?: string[]
      resultSubtype?: string
    }

    expect(result.messageTypes).toEqual(['result'])
    expect(result.resultSubtype).toBe('success')
    expect(result.warnings?.[0]).toContain('未识别 Pi message_update 子事件')
    expect(result.warnings?.[0]).toContain('future_delta')
  })

  test('Given malformed Pi tool event When query runs Then logs diagnostic and continues', () => {
    const output = runPiAdapterScript(`
      import { mock } from 'bun:test'

      const warnings = []
      const originalWarn = console.warn
      console.warn = (...args) => {
        warnings.push(args.map((arg) => String(arg)).join(' '))
      }

      mock.module('./pi-process', () => ({
        startPiRpcSession: () => ({
          send: () => {},
          abort: () => {},
          kill: () => {},
          done: Promise.resolve({
            exitCode: 0,
            signal: null,
            stdoutSnippet: '',
            stderrSnippet: '',
            aborted: false,
          }),
          events: (async function* () {
            yield {
              type: 'tool_execution_start',
              toolCallId: 'call-missing-name',
              args: { command: 'pwd' },
            }
            yield { type: 'agent_end', messages: [] }
          })(),
        }),
      }))

      const { PiAgentAdapter } = await import('./pi-agent-adapter.ts')
      const adapter = new PiAgentAdapter()
      const messages = []

      for await (const message of adapter.query({
        sessionId: 'session-pi-malformed-tool-event',
        prompt: 'hello',
        model: 'deepseek-v4-flash',
      })) {
        messages.push(message)
      }

      console.warn = originalWarn
      console.log(JSON.stringify({
        warnings,
        messageTypes: messages.map((message) => message.type),
        resultSubtype: messages.at(-1)?.subtype,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('warnings'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      warnings?: string[]
      messageTypes?: string[]
      resultSubtype?: string
    }

    expect(result.messageTypes).toEqual(['result'])
    expect(result.resultSubtype).toBe('success')
    expect(result.warnings?.[0]).toContain('Pi tool_execution_start 事件缺少字段')
    expect(result.warnings?.[0]).toContain('toolName')
  })

  test('Given provider runtime input When query runs Then passes provider and runtime env to Pi process', () => {
    const output = runPiAdapterScript(`
      import { mock } from 'bun:test'

      let startInput = null

      mock.module('./pi-process', () => ({
        startPiRpcSession: (input) => {
          startInput = input
          return {
            send: () => {},
            abort: () => {},
            kill: () => {},
            done: Promise.resolve({
              exitCode: 0,
              signal: null,
              stdoutSnippet: '',
              stderrSnippet: '',
              aborted: false,
            }),
            events: (async function* () {
              yield { type: 'agent_end', messages: [] }
            })(),
          }
        },
      }))

      const { PiAgentAdapter } = await import('./pi-agent-adapter.ts')
      const adapter = new PiAgentAdapter()

      for await (const _message of adapter.query({
        sessionId: 'session-pi-runtime',
        prompt: 'hello',
        model: 'qwen-plus',
        provider: 'openai',
        runtimeSessionDir: '/tmp/proma-pi-sessions',
        runtimeEnv: { OPENAI_API_KEY: 'sk-test', PI_CODING_AGENT_DIR: '/tmp/proma-pi' },
      })) {}

      console.log(JSON.stringify({ startInput }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('startInput'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      startInput?: {
        provider?: string
        model?: string
        sessionId?: string
        sessionDir?: string
        runtimeEnv?: Record<string, string | undefined>
      }
    }

    expect(result.startInput?.provider).toBe('openai')
    expect(result.startInput?.model).toBe('qwen-plus')
    expect(result.startInput?.sessionId).toBe('session-pi-runtime')
    expect(result.startInput?.sessionDir).toBe('/tmp/proma-pi-sessions')
    expect(result.startInput?.runtimeEnv?.OPENAI_API_KEY).toBe('sk-test')
    expect(result.startInput?.runtimeEnv?.PI_CODING_AGENT_DIR).toBe('/tmp/proma-pi')
  })
})
