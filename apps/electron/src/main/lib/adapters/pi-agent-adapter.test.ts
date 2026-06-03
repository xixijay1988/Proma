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

  test('Given active Pi query When queued message is sent Then steers current RPC session', () => {
    const output = runPiAdapterScript(`
      import { mock } from 'bun:test'

      const sentCommands = []
      let releaseAgentEnd
      const waitForRelease = new Promise((resolve) => { releaseAgentEnd = resolve })

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
            await waitForRelease
            yield { type: 'agent_end', messages: [] }
          })(),
        }),
      }))

      const { PiAgentAdapter } = await import('./pi-agent-adapter.ts')
      const adapter = new PiAgentAdapter()
      const iterator = adapter.query({
        sessionId: 'session-pi-queue',
        prompt: 'initial prompt',
        model: 'pi-model',
      })[Symbol.asyncIterator]()

      const firstYield = iterator.next()
      await new Promise((resolve) => setTimeout(resolve, 0))

      await adapter.sendQueuedMessage('session-pi-queue', {
        type: 'user',
        message: { role: 'user', content: 'queued now' },
        parent_tool_use_id: null,
        priority: 'now',
        uuid: 'queued-1',
        session_id: 'session-pi-queue',
      })

      releaseAgentEnd()
      const resultMessage = await firstYield

      console.log(JSON.stringify({
        sentCommands,
        resultType: resultMessage.value?.type,
        resultSubtype: resultMessage.value?.subtype,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('sentCommands'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      sentCommands?: Array<{ type?: string; message?: string }>
      resultType?: string
      resultSubtype?: string
    }

    expect(result.sentCommands?.map((command) => command.type)).toEqual(['prompt', 'steer'])
    expect(result.sentCommands?.[1]).toMatchObject({ type: 'steer', message: 'queued now' })
    expect(result.resultType).toBe('result')
    expect(result.resultSubtype).toBe('success')
  })

  test('Given active Pi query When fork messages are requested Then returns Pi native fork candidates', () => {
    const output = runPiAdapterScript(`
      import { mock } from 'bun:test'

      const sentCommands = []
      let releaseAgentEnd
      const waitForRelease = new Promise((resolve) => { releaseAgentEnd = resolve })

      mock.module('./pi-process', () => ({
        startPiRpcSession: () => ({
          send: (command) => {
            sentCommands.push(command)
            if (command.type === 'get_fork_messages') {
              queueMicrotask(() => releaseResponse({
                type: 'response',
                id: command.id,
                command: 'get_fork_messages',
                success: true,
                data: {
                  messages: [
                    { id: 'entry-user-1', text: 'first user prompt' },
                    { id: 'entry-user-2', text: 'second user prompt' },
                  ],
                },
              }))
            }
          },
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
            const response = await waitForResponse
            yield response
            await waitForRelease
            yield { type: 'agent_end', messages: [] }
          })(),
        }),
      }))

      let releaseResponse
      const waitForResponse = new Promise((resolve) => { releaseResponse = resolve })

      const { PiAgentAdapter } = await import('./pi-agent-adapter.ts')
      const adapter = new PiAgentAdapter()
      const iterator = adapter.query({
        sessionId: 'session-pi-fork-messages',
        prompt: 'initial prompt',
        model: 'pi-model',
      })[Symbol.asyncIterator]()

      const firstYield = iterator.next()
      await new Promise((resolve) => setTimeout(resolve, 0))

      const forkMessages = await adapter.getForkMessages('session-pi-fork-messages')
      releaseAgentEnd()
      const resultMessage = await firstYield

      console.log(JSON.stringify({
        sentCommands,
        forkMessages,
        resultType: resultMessage.value?.type,
        resultSubtype: resultMessage.value?.subtype,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('forkMessages'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      sentCommands?: Array<{ type?: string; id?: string; message?: string }>
      forkMessages?: Array<{ id?: string; text?: string }>
      resultType?: string
      resultSubtype?: string
    }

    expect(result.sentCommands?.map((command) => command.type)).toEqual(['prompt', 'get_fork_messages'])
    expect(result.sentCommands?.[1]?.id).toStartWith('proma-get-fork-messages-session-pi-fork-messages-')
    expect(result.forkMessages).toEqual([
      { id: 'entry-user-1', text: 'first user prompt' },
      { id: 'entry-user-2', text: 'second user prompt' },
    ])
    expect(result.resultType).toBe('result')
    expect(result.resultSubtype).toBe('success')
  })

  test('Given active Pi query When native fork is requested Then sends fork command and returns selected text', () => {
    const output = runPiAdapterScript(`
      import { mock } from 'bun:test'

      const sentCommands = []
      let releaseAgentEnd
      const responses = []
      let notifyResponse
      const waitForRelease = new Promise((resolve) => { releaseAgentEnd = resolve })
      const waitForResponse = () => new Promise((resolve) => {
        const existing = responses.shift()
        if (existing) {
          resolve(existing)
          return
        }
        notifyResponse = resolve
      })
      const pushResponse = (response) => {
        if (notifyResponse) {
          const resolve = notifyResponse
          notifyResponse = null
          resolve(response)
          return
        }
        responses.push(response)
      }

      mock.module('./pi-process', () => ({
        startPiRpcSession: () => ({
          send: (command) => {
            sentCommands.push(command)
            if (command.type === 'fork') {
              queueMicrotask(() => pushResponse({
                type: 'response',
                id: command.id,
                command: 'fork',
                success: true,
                data: {
                  text: 'selected user prompt',
                  cancelled: false,
                  sessionId: 'pi-native-fork-id',
                  sessionPath: '/tmp/pi-native-fork.jsonl',
                },
              }))
            }
          },
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
            const response = await waitForResponse()
            yield response
            await waitForRelease
            yield { type: 'agent_end', messages: [] }
          })(),
        }),
      }))

      const { PiAgentAdapter } = await import('./pi-agent-adapter.ts')
      const adapter = new PiAgentAdapter()
      const iterator = adapter.query({
        sessionId: 'session-pi-native-fork',
        prompt: 'initial prompt',
        model: 'pi-model',
      })[Symbol.asyncIterator]()

      const firstYield = iterator.next()
      await new Promise((resolve) => setTimeout(resolve, 0))

      const forkResult = await adapter.fork('session-pi-native-fork', 'entry-user-1')
      releaseAgentEnd()
      const resultMessage = await firstYield

      console.log(JSON.stringify({
        sentCommands,
        forkResult,
        resultType: resultMessage.value?.type,
        resultSubtype: resultMessage.value?.subtype,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('forkResult'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      sentCommands?: Array<{ type?: string; id?: string; entryId?: string }>
      forkResult?: { text?: string; cancelled?: boolean; sessionId?: string; sessionPath?: string }
      resultType?: string
      resultSubtype?: string
    }

    expect(result.sentCommands?.map((command) => command.type)).toEqual(['prompt', 'fork'])
    expect(result.sentCommands?.[1]).toMatchObject({ type: 'fork', entryId: 'entry-user-1' })
    expect(result.forkResult).toEqual({
      text: 'selected user prompt',
      cancelled: false,
      sessionId: 'pi-native-fork-id',
      sessionPath: '/tmp/pi-native-fork.jsonl',
    })
    expect(result.resultType).toBe('result')
    expect(result.resultSubtype).toBe('success')
  })

  test('Given active Pi query When native clone is requested Then sends clone command', () => {
    const output = runPiAdapterScript(`
      import { mock } from 'bun:test'

      const sentCommands = []
      let releaseAgentEnd
      let notifyResponse
      const responses = []
      const waitForRelease = new Promise((resolve) => { releaseAgentEnd = resolve })
      const waitForResponse = () => new Promise((resolve) => {
        const existing = responses.shift()
        if (existing) {
          resolve(existing)
          return
        }
        notifyResponse = resolve
      })
      const pushResponse = (response) => {
        if (notifyResponse) {
          const resolve = notifyResponse
          notifyResponse = null
          resolve(response)
          return
        }
        responses.push(response)
      }

      mock.module('./pi-process', () => ({
        startPiRpcSession: () => ({
          send: (command) => {
            sentCommands.push(command)
            if (command.type === 'clone') {
              queueMicrotask(() => pushResponse({
                type: 'response',
                id: command.id,
                command: 'clone',
                success: true,
                data: {
                  cancelled: false,
                  sessionId: 'pi-native-clone-id',
                  sessionPath: '/tmp/pi-native-clone.jsonl',
                },
              }))
            }
          },
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
            const response = await waitForResponse()
            yield response
            await waitForRelease
            yield { type: 'agent_end', messages: [] }
          })(),
        }),
      }))

      const { PiAgentAdapter } = await import('./pi-agent-adapter.ts')
      const adapter = new PiAgentAdapter()
      const iterator = adapter.query({
        sessionId: 'session-pi-native-clone',
        prompt: 'initial prompt',
        model: 'pi-model',
      })[Symbol.asyncIterator]()

      const firstYield = iterator.next()
      await new Promise((resolve) => setTimeout(resolve, 0))

      const cloneResult = await adapter.clone('session-pi-native-clone')
      releaseAgentEnd()
      const resultMessage = await firstYield

      console.log(JSON.stringify({
        sentCommands,
        cloneResult,
        resultType: resultMessage.value?.type,
        resultSubtype: resultMessage.value?.subtype,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('cloneResult'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      sentCommands?: Array<{ type?: string; id?: string }>
      cloneResult?: { cancelled?: boolean; sessionId?: string; sessionPath?: string }
      resultType?: string
      resultSubtype?: string
    }

    expect(result.sentCommands?.map((command) => command.type)).toEqual(['prompt', 'clone'])
    expect(result.sentCommands?.[1]?.id).toStartWith('proma-clone-session-pi-native-clone-')
    expect(result.cloneResult).toEqual({
      cancelled: false,
      sessionId: 'pi-native-clone-id',
      sessionPath: '/tmp/pi-native-clone.jsonl',
    })
    expect(result.resultType).toBe('result')
    expect(result.resultSubtype).toBe('success')
  })

  test('Given active Pi query When native switch session is requested Then sends switch_session command', () => {
    const output = runPiAdapterScript(`
      import { mock } from 'bun:test'

      const sentCommands = []
      let releaseAgentEnd
      let notifyResponse
      const responses = []
      const waitForRelease = new Promise((resolve) => { releaseAgentEnd = resolve })
      const waitForResponse = () => new Promise((resolve) => {
        const existing = responses.shift()
        if (existing) {
          resolve(existing)
          return
        }
        notifyResponse = resolve
      })
      const pushResponse = (response) => {
        if (notifyResponse) {
          const resolve = notifyResponse
          notifyResponse = null
          resolve(response)
          return
        }
        responses.push(response)
      }

      mock.module('./pi-process', () => ({
        startPiRpcSession: () => ({
          send: (command) => {
            sentCommands.push(command)
            if (command.type === 'switch_session') {
              queueMicrotask(() => pushResponse({
                type: 'response',
                id: command.id,
                command: 'switch_session',
                success: true,
                data: {
                  cancelled: false,
                },
              }))
            }
          },
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
            const response = await waitForResponse()
            yield response
            await waitForRelease
            yield { type: 'agent_end', messages: [] }
          })(),
        }),
      }))

      const { PiAgentAdapter } = await import('./pi-agent-adapter.ts')
      const adapter = new PiAgentAdapter()
      const iterator = adapter.query({
        sessionId: 'session-pi-native-switch',
        prompt: 'initial prompt',
        model: 'pi-model',
      })[Symbol.asyncIterator]()

      const firstYield = iterator.next()
      await new Promise((resolve) => setTimeout(resolve, 0))

      const switchResult = await adapter.switchSession('session-pi-native-switch', '/tmp/pi-target-session.jsonl')
      releaseAgentEnd()
      const resultMessage = await firstYield

      console.log(JSON.stringify({
        sentCommands,
        switchResult,
        resultType: resultMessage.value?.type,
        resultSubtype: resultMessage.value?.subtype,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('switchResult'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      sentCommands?: Array<{ type?: string; id?: string; sessionPath?: string }>
      switchResult?: { cancelled?: boolean }
      resultType?: string
      resultSubtype?: string
    }

    expect(result.sentCommands?.map((command) => command.type)).toEqual(['prompt', 'switch_session'])
    expect(result.sentCommands?.[1]).toMatchObject({
      type: 'switch_session',
      sessionPath: '/tmp/pi-target-session.jsonl',
    })
    expect(result.sentCommands?.[1]?.id).toStartWith('proma-switch-session-session-pi-native-switch-')
    expect(result.switchResult).toEqual({ cancelled: false })
    expect(result.resultType).toBe('result')
    expect(result.resultSubtype).toBe('success')
  })

  test('Given active Pi query When shell task is stopped Then sends abort_bash command', () => {
    const output = runPiAdapterScript(`
      import { mock } from 'bun:test'

      const sentCommands = []
      let releaseAgentEnd
      let releaseResponse
      const waitForRelease = new Promise((resolve) => { releaseAgentEnd = resolve })
      const waitForResponse = new Promise((resolve) => { releaseResponse = resolve })

      mock.module('./pi-process', () => ({
        startPiRpcSession: () => ({
          send: (command) => {
            sentCommands.push(command)
            if (command.type === 'abort_bash') {
              queueMicrotask(() => releaseResponse({
                type: 'response',
                id: command.id,
                command: 'abort_bash',
                success: true,
              }))
            }
          },
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
            const response = await waitForResponse
            yield response
            await waitForRelease
            yield { type: 'agent_end', messages: [] }
          })(),
        }),
      }))

      const { PiAgentAdapter } = await import('./pi-agent-adapter.ts')
      const adapter = new PiAgentAdapter()
      const iterator = adapter.query({
        sessionId: 'session-pi-stop-shell',
        prompt: 'initial prompt',
        model: 'pi-model',
      })[Symbol.asyncIterator]()

      const firstYield = iterator.next()
      await new Promise((resolve) => setTimeout(resolve, 0))

      await adapter.stopShellTask('session-pi-stop-shell', 'shell-123')
      releaseAgentEnd()
      const resultMessage = await firstYield

      console.log(JSON.stringify({
        sentCommands,
        resultType: resultMessage.value?.type,
        resultSubtype: resultMessage.value?.subtype,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('sentCommands'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      sentCommands?: Array<{ type?: string; id?: string }>
      resultType?: string
      resultSubtype?: string
    }

    expect(result.sentCommands?.map((command) => command.type)).toEqual(['prompt', 'abort_bash'])
    expect(result.sentCommands?.[1]?.id).toStartWith('proma-abort-bash-session-pi-stop-shell-')
    expect(result.resultType).toBe('result')
    expect(result.resultSubtype).toBe('success')
  })

  test('Given active Pi query When compacting session Then sends compact command and returns compact system messages', () => {
    const output = runPiAdapterScript(`
      import { mock } from 'bun:test'

      const sentCommands = []
      let releaseAgentEnd
      let releaseResponse
      const waitForRelease = new Promise((resolve) => { releaseAgentEnd = resolve })
      const waitForResponse = new Promise((resolve) => { releaseResponse = resolve })

      mock.module('./pi-process', () => ({
        startPiRpcSession: () => ({
          send: (command) => {
            sentCommands.push(command)
            if (command.type === 'compact') {
              queueMicrotask(() => releaseResponse({
                type: 'response',
                id: command.id,
                command: 'compact',
                success: true,
                data: {
                  summary: '压缩后的摘要',
                  firstKeptEntryId: 'entry-2',
                  tokensBefore: 1234,
                },
              }))
            }
          },
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
            const response = await waitForResponse
            yield response
            await waitForRelease
            yield { type: 'agent_end', messages: [] }
          })(),
        }),
      }))

      const { PiAgentAdapter } = await import('./pi-agent-adapter.ts')
      const adapter = new PiAgentAdapter()
      const iterator = adapter.query({
        sessionId: 'session-pi-compact',
        prompt: 'initial prompt',
        model: 'pi-model',
      })[Symbol.asyncIterator]()

      const firstYield = iterator.next()
      await new Promise((resolve) => setTimeout(resolve, 0))

      const compactMessages = await adapter.compact('session-pi-compact')
      releaseAgentEnd()
      const resultMessage = await firstYield

      console.log(JSON.stringify({
        sentCommands,
        compactMessages,
        resultType: resultMessage.value?.type,
        resultSubtype: resultMessage.value?.subtype,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('compactMessages'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      sentCommands?: Array<{ type?: string; id?: string }>
      compactMessages?: Array<{ type?: string; subtype?: string; summary?: string; tokens_before?: number }>
      resultType?: string
      resultSubtype?: string
    }

    expect(result.sentCommands?.map((command) => command.type)).toEqual(['prompt', 'compact'])
    expect(result.sentCommands?.[1]?.id).toStartWith('proma-compact-session-pi-compact-')
    expect(result.compactMessages?.map((message) => `${message.type}:${message.subtype}`)).toEqual([
      'system:compacting',
      'system:compact_boundary',
    ])
    expect(result.compactMessages?.[1]?.summary).toBe('压缩后的摘要')
    expect(result.compactMessages?.[1]?.tokens_before).toBe(1234)
    expect(result.resultType).toBe('result')
    expect(result.resultSubtype).toBe('success')
  })

  test('Given Pi query with thinking level When query starts Then sends thinking command before prompt', () => {
    const output = runPiAdapterScript(`
      import { mock } from 'bun:test'

      const sentCommands = []

      mock.module('./pi-process', () => ({
        startPiRpcSession: () => ({
          send: (command) => {
            sentCommands.push(command)
          },
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
              type: 'response',
              id: sentCommands.find((command) => command.type === 'set_thinking_level')?.id,
              command: 'set_thinking_level',
              success: true,
            }
            yield { type: 'agent_end', messages: [] }
          })(),
        }),
      }))

      const { PiAgentAdapter } = await import('./pi-agent-adapter.ts')
      const adapter = new PiAgentAdapter()
      const messages = []

      for await (const message of adapter.query({
        sessionId: 'session-pi-thinking-level',
        prompt: 'initial prompt',
        model: 'pi-model',
        runtimeThinkingLevel: 'high',
      })) {
        messages.push(message)
      }

      console.log(JSON.stringify({
        sentCommands,
        messageTypes: messages.map((message) => message.type),
        resultSubtype: messages.at(-1)?.subtype,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('sentCommands'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      sentCommands?: Array<{ type?: string; id?: string; level?: string }>
      messageTypes?: string[]
      resultSubtype?: string
    }

    expect(result.sentCommands?.map((command) => command.type)).toEqual(['set_thinking_level', 'prompt'])
    expect(result.sentCommands?.[0]?.id).toStartWith('proma-set-thinking-level-session-pi-thinking-level-')
    expect(result.sentCommands?.[0]?.level).toBe('high')
    expect(result.messageTypes).toEqual(['result'])
    expect(result.resultSubtype).toBe('success')
  })

  test('Given Pi query with auto compaction enabled When query starts Then sends auto compaction command before prompt', () => {
    const output = runPiAdapterScript(`
      import { mock } from 'bun:test'

      const sentCommands = []

      mock.module('./pi-process', () => ({
        startPiRpcSession: () => ({
          send: (command) => {
            sentCommands.push(command)
          },
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
              type: 'response',
              id: sentCommands.find((command) => command.type === 'set_auto_compaction')?.id,
              command: 'set_auto_compaction',
              success: true,
            }
            yield { type: 'agent_end', messages: [] }
          })(),
        }),
      }))

      const { PiAgentAdapter } = await import('./pi-agent-adapter.ts')
      const adapter = new PiAgentAdapter()
      const messages = []

      for await (const message of adapter.query({
        sessionId: 'session-pi-auto-compaction',
        prompt: 'initial prompt',
        model: 'pi-model',
        runtimeAutoCompactionEnabled: true,
      })) {
        messages.push(message)
      }

      console.log(JSON.stringify({
        sentCommands,
        messageTypes: messages.map((message) => message.type),
        resultSubtype: messages.at(-1)?.subtype,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('sentCommands'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      sentCommands?: Array<{ type?: string; id?: string; enabled?: boolean }>
      messageTypes?: string[]
      resultSubtype?: string
    }

    expect(result.sentCommands?.map((command) => command.type)).toEqual(['set_auto_compaction', 'prompt'])
    expect(result.sentCommands?.[0]?.id).toStartWith('proma-set-auto-compaction-session-pi-auto-compaction-')
    expect(result.sentCommands?.[0]?.enabled).toBe(true)
    expect(result.messageTypes).toEqual(['result'])
    expect(result.resultSubtype).toBe('success')
  })

  test('Given Pi query with auto retry enabled When query starts Then sends auto retry command before prompt', () => {
    const output = runPiAdapterScript(`
      import { mock } from 'bun:test'

      const sentCommands = []

      mock.module('./pi-process', () => ({
        startPiRpcSession: () => ({
          send: (command) => {
            sentCommands.push(command)
          },
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
              type: 'response',
              id: sentCommands.find((command) => command.type === 'set_auto_retry')?.id,
              command: 'set_auto_retry',
              success: true,
            }
            yield { type: 'agent_end', messages: [] }
          })(),
        }),
      }))

      const { PiAgentAdapter } = await import('./pi-agent-adapter.ts')
      const adapter = new PiAgentAdapter()
      const messages = []

      for await (const message of adapter.query({
        sessionId: 'session-pi-auto-retry',
        prompt: 'initial prompt',
        model: 'pi-model',
        runtimeAutoRetryEnabled: true,
      })) {
        messages.push(message)
      }

      console.log(JSON.stringify({
        sentCommands,
        messageTypes: messages.map((message) => message.type),
        resultSubtype: messages.at(-1)?.subtype,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('sentCommands'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      sentCommands?: Array<{ type?: string; id?: string; enabled?: boolean }>
      messageTypes?: string[]
      resultSubtype?: string
    }

    expect(result.sentCommands?.map((command) => command.type)).toEqual(['set_auto_retry', 'prompt'])
    expect(result.sentCommands?.[0]?.id).toStartWith('proma-set-auto-retry-session-pi-auto-retry-')
    expect(result.sentCommands?.[0]?.enabled).toBe(true)
    expect(result.messageTypes).toEqual(['result'])
    expect(result.resultSubtype).toBe('success')
  })

  test('Given active Pi query When retry is aborted Then sends abort_retry command', () => {
    const output = runPiAdapterScript(`
      import { mock } from 'bun:test'

      const sentCommands = []
      let releaseAgentEnd
      let releaseResponse
      const waitForRelease = new Promise((resolve) => { releaseAgentEnd = resolve })
      const waitForResponse = new Promise((resolve) => { releaseResponse = resolve })

      mock.module('./pi-process', () => ({
        startPiRpcSession: () => ({
          send: (command) => {
            sentCommands.push(command)
            if (command.type === 'abort_retry') {
              queueMicrotask(() => releaseResponse({
                type: 'response',
                id: command.id,
                command: 'abort_retry',
                success: true,
              }))
            }
          },
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
            const response = await waitForResponse
            yield response
            await waitForRelease
            yield { type: 'agent_end', messages: [] }
          })(),
        }),
      }))

      const { PiAgentAdapter } = await import('./pi-agent-adapter.ts')
      const adapter = new PiAgentAdapter()
      const iterator = adapter.query({
        sessionId: 'session-pi-abort-retry',
        prompt: 'initial prompt',
        model: 'pi-model',
      })[Symbol.asyncIterator]()

      const firstYield = iterator.next()
      await new Promise((resolve) => setTimeout(resolve, 0))

      await adapter.abortRetry('session-pi-abort-retry')
      releaseAgentEnd()
      const resultMessage = await firstYield

      console.log(JSON.stringify({
        sentCommands,
        resultType: resultMessage.value?.type,
        resultSubtype: resultMessage.value?.subtype,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('sentCommands'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      sentCommands?: Array<{ type?: string; id?: string }>
      resultType?: string
      resultSubtype?: string
    }

    expect(result.sentCommands?.map((command) => command.type)).toEqual(['prompt', 'abort_retry'])
    expect(result.sentCommands?.[1]?.id).toStartWith('proma-abort-retry-session-pi-abort-retry-')
    expect(result.resultType).toBe('result')
    expect(result.resultSubtype).toBe('success')
  })

  test('Given Pi auto retry lifecycle events When query runs Then yields Proma retry events', () => {
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
              type: 'auto_retry_start',
              attempt: 2,
              maxAttempts: 5,
              delayMs: 1500,
              errorMessage: 'provider timeout',
            }
            yield {
              type: 'auto_retry_end',
              success: true,
              attempt: 2,
            }
            yield { type: 'agent_end', messages: [] }
          })(),
        }),
      }))

      const { PiAgentAdapter } = await import('./pi-agent-adapter.ts')
      const adapter = new PiAgentAdapter()
      const messages = []

      for await (const message of adapter.query({
        sessionId: 'session-pi-auto-retry-events',
        prompt: 'initial prompt',
        model: 'pi-model',
      })) {
        messages.push(message)
      }

      const retryEvents = messages
        .map((message) => message._promaEvent ?? null)
        .filter((event) => event?.type === 'retry')

      console.log(JSON.stringify({
        retryEvents,
        transientFlags: messages
          .filter((message) => message._promaEvent)
          .map((message) => message._promaTransient === true),
        messageTypes: messages.map((message) => message.type),
        resultSubtype: messages.at(-1)?.subtype,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('retryEvents'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      retryEvents?: Array<{
        type?: string
        status?: string
        attempt?: number
        maxAttempts?: number
        delaySeconds?: number
        reason?: string
        attemptData?: {
          attempt?: number
          reason?: string
          errorMessage?: string
          delaySeconds?: number
        }
      }>
      transientFlags?: boolean[]
      messageTypes?: string[]
      resultSubtype?: string
    }

    expect(result.retryEvents?.map((event) => event.status)).toEqual(['starting', 'attempt', 'cleared'])
    expect(result.retryEvents?.[0]).toMatchObject({
      type: 'retry',
      status: 'starting',
      attempt: 2,
      maxAttempts: 5,
      delaySeconds: 1.5,
      reason: 'provider timeout',
    })
    expect(result.retryEvents?.[1]?.attemptData).toMatchObject({
      attempt: 2,
      reason: 'provider timeout',
      errorMessage: 'provider timeout',
      delaySeconds: 1.5,
    })
    expect(result.transientFlags).toEqual([true, true, true])
    expect(result.messageTypes?.at(-1)).toBe('result')
    expect(result.resultSubtype).toBe('success')
  })

  test('Given Pi auto retry fails When query runs Then yields Proma retry failed event', () => {
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
              type: 'auto_retry_end',
              success: false,
              attempt: 3,
              finalError: 'quota exhausted',
            }
            yield { type: 'agent_end', messages: [] }
          })(),
        }),
      }))

      const { PiAgentAdapter } = await import('./pi-agent-adapter.ts')
      const adapter = new PiAgentAdapter()
      const messages = []

      for await (const message of adapter.query({
        sessionId: 'session-pi-auto-retry-failed-event',
        prompt: 'initial prompt',
        model: 'pi-model',
      })) {
        messages.push(message)
      }

      const retryEvents = messages
        .map((message) => message._promaEvent ?? null)
        .filter((event) => event?.type === 'retry')

      console.log(JSON.stringify({
        retryEvents,
        transientFlags: messages
          .filter((message) => message._promaEvent)
          .map((message) => message._promaTransient === true),
        resultSubtype: messages.at(-1)?.subtype,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('retryEvents'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      retryEvents?: Array<{
        status?: string
        attemptData?: {
          attempt?: number
          reason?: string
          errorMessage?: string
          delaySeconds?: number
        }
      }>
      transientFlags?: boolean[]
      resultSubtype?: string
    }

    expect(result.retryEvents?.map((event) => event.status)).toEqual(['failed'])
    expect(result.retryEvents?.[0]?.attemptData).toMatchObject({
      attempt: 3,
      reason: 'quota exhausted',
      errorMessage: 'quota exhausted',
      delaySeconds: 0,
    })
    expect(result.transientFlags).toEqual([true])
    expect(result.resultSubtype).toBe('success')
  })

  test('Given Pi compaction lifecycle events When query runs Then yields Proma compaction events and boundary', () => {
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
              type: 'compaction_start',
              reason: 'threshold',
            }
            yield {
              type: 'compaction_end',
              reason: 'threshold',
              aborted: false,
              willRetry: false,
              result: {
                summary: 'Pi 自动压缩摘要',
                firstKeptEntryId: 'entry-2',
                tokensBefore: 4096,
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
        sessionId: 'session-pi-compaction-events',
        prompt: 'initial prompt',
        model: 'pi-model',
      })) {
        messages.push(message)
      }

      const compactionEvents = messages
        .map((message) => message._promaEvent ?? null)
        .filter((event) => event?.type === 'compaction')
      const systemMessages = messages.filter((message) => message.type === 'system')

      console.log(JSON.stringify({
        compactionEvents,
        transientFlags: messages
          .filter((message) => message._promaEvent)
          .map((message) => message._promaTransient === true),
        systemMessages,
        resultSubtype: messages.at(-1)?.subtype,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('compactionEvents'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      compactionEvents?: Array<{ type?: string; status?: string; reason?: string }>
      transientFlags?: boolean[]
      systemMessages?: Array<{ type?: string; subtype?: string; summary?: string; first_kept_entry_id?: string; tokens_before?: number }>
      resultSubtype?: string
    }

    expect(result.compactionEvents).toEqual([
      { type: 'compaction', status: 'starting', reason: 'threshold' },
      { type: 'compaction', status: 'cleared', reason: 'threshold' },
    ])
    expect(result.transientFlags).toEqual([true, true])
    expect(result.systemMessages?.map((message) => `${message.type}:${message.subtype}`)).toEqual([
      'system:pi_runtime_event',
      'system:compact_boundary',
      'system:pi_runtime_event',
    ])
    expect(result.systemMessages?.[1]).toMatchObject({
      subtype: 'compact_boundary',
      summary: 'Pi 自动压缩摘要',
      first_kept_entry_id: 'entry-2',
      tokens_before: 4096,
    })
    expect(result.resultSubtype).toBe('success')
  })

  test('Given active Pi query When runtime messages are requested Then sends get_messages command', () => {
    const output = runPiAdapterScript(`
      import { mock } from 'bun:test'

      const sentCommands = []
      let releaseAgentEnd
      let releaseResponse
      const waitForRelease = new Promise((resolve) => { releaseAgentEnd = resolve })
      const waitForResponse = new Promise((resolve) => { releaseResponse = resolve })

      mock.module('./pi-process', () => ({
        startPiRpcSession: () => ({
          send: (command) => {
            sentCommands.push(command)
            if (command.type === 'get_messages') {
              queueMicrotask(() => releaseResponse({
                type: 'response',
                id: command.id,
                command: 'get_messages',
                success: true,
                data: {
                  messages: [
                    {
                      type: 'user',
                      session_id: 'session-pi-runtime-messages',
                      message: { content: [{ type: 'text', text: 'hello from pi' }] },
                    },
                  ],
                },
              }))
            }
          },
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
            const response = await waitForResponse
            yield response
            await waitForRelease
            yield { type: 'agent_end', messages: [] }
          })(),
        }),
      }))

      const { PiAgentAdapter } = await import('./pi-agent-adapter.ts')
      const adapter = new PiAgentAdapter()
      const iterator = adapter.query({
        sessionId: 'session-pi-runtime-messages',
        prompt: 'initial prompt',
        model: 'pi-model',
      })[Symbol.asyncIterator]()

      const firstYield = iterator.next()
      await new Promise((resolve) => setTimeout(resolve, 0))

      const messages = await adapter.getMessages('session-pi-runtime-messages')
      releaseAgentEnd()
      const resultMessage = await firstYield

      console.log(JSON.stringify({
        sentCommands,
        messages,
        resultType: resultMessage.value?.type,
        resultSubtype: resultMessage.value?.subtype,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('messages'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      sentCommands?: Array<{ type?: string; id?: string }>
      messages?: Array<{ type?: string; message?: { content?: Array<{ text?: string }> } }>
      resultType?: string
      resultSubtype?: string
    }

    expect(result.sentCommands?.map((command) => command.type)).toEqual(['prompt', 'get_messages'])
    expect(result.sentCommands?.[1]?.id).toStartWith('proma-get-messages-session-pi-runtime-messages-')
    expect(result.messages?.[0]?.type).toBe('user')
    expect(result.messages?.[0]?.message?.content?.[0]?.text).toBe('hello from pi')
    expect(result.resultType).toBe('result')
    expect(result.resultSubtype).toBe('success')
  })

  test('Given active Pi query When runtime state is requested Then sends get_state command and normalizes diagnostics', () => {
    const output = runPiAdapterScript(`
      import { mock } from 'bun:test'

      const sentCommands = []
      let releaseAgentEnd
      let notifyResponse
      const responses = []
      const waitForRelease = new Promise((resolve) => { releaseAgentEnd = resolve })
      const waitForResponse = () => new Promise((resolve) => {
        const existing = responses.shift()
        if (existing) {
          resolve(existing)
          return
        }
        notifyResponse = resolve
      })
      const pushResponse = (response) => {
        if (notifyResponse) {
          const resolve = notifyResponse
          notifyResponse = null
          resolve(response)
          return
        }
        responses.push(response)
      }

      mock.module('./pi-process', () => ({
        startPiRpcSession: () => ({
          send: (command) => {
            sentCommands.push(command)
            if (command.type === 'get_state') {
              queueMicrotask(() => pushResponse({
                type: 'response',
                id: command.id,
                command: 'get_state',
                success: true,
                data: {
                  model: { provider: 'deepseek', id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
                  thinkingLevel: 'high',
                  isStreaming: true,
                  isCompacting: false,
                  steeringMode: 'all',
                  followUpMode: 'one-at-a-time',
                  sessionFile: '/tmp/pi-session.jsonl',
                  sessionId: 'pi-native-session-1',
                  sessionName: 'Pi Native',
                  autoCompactionEnabled: true,
                  messageCount: 12,
                  pendingMessageCount: 2,
                },
              }))
            }
            if (command.type === 'get_session_stats') {
              queueMicrotask(() => pushResponse({
                type: 'response',
                id: command.id,
                command: 'get_session_stats',
                success: true,
                data: {
                  sessionFile: '/tmp/pi-session.jsonl',
                  sessionId: 'pi-native-session-1',
                  userMessages: 3,
                  assistantMessages: 4,
                  toolCalls: 5,
                  toolResults: 5,
                  totalMessages: 17,
                  tokens: {
                    input: 1000,
                    output: 250,
                    cacheRead: 80,
                    cacheWrite: 40,
                    total: 1370,
                  },
                  cost: 0.1234,
                  contextUsage: {
                    tokens: 1370,
                    maxTokens: 200000,
                    percent: 0.685,
                  },
                },
              }))
            }
            if (command.type === 'get_commands') {
              queueMicrotask(() => pushResponse({
                type: 'response',
                id: command.id,
                command: 'get_commands',
                success: true,
                data: {
                  commands: [
                    {
                      name: 'proma_mcp_status',
                      description: 'Inspect configured MCP servers',
                      source: 'extension',
                      sourceInfo: { name: 'proma-mcp-bridge', path: '/tmp/proma-mcp.js' },
                    },
                    {
                      name: 'plan',
                      description: 'Create a plan',
                      source: 'prompt',
                      sourceInfo: { name: 'default-prompts' },
                    },
                    {
                      name: 'skill:using-superpowers',
                      description: 'Use installed skills',
                      source: 'skill',
                      sourceInfo: { name: 'using-superpowers', path: '/tmp/skills/using-superpowers' },
                    },
                    {
                      name: '',
                      source: 'skill',
                      sourceInfo: { name: 'invalid' },
                    },
                  ],
                },
              }))
            }
          },
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
            yield await waitForResponse()
            const maybeStats = await Promise.race([
              waitForResponse(),
              new Promise((resolve) => setTimeout(() => resolve(null), 20)),
            ])
            if (maybeStats) yield maybeStats
            const maybeCommands = await Promise.race([
              waitForResponse(),
              new Promise((resolve) => setTimeout(() => resolve(null), 20)),
            ])
            if (maybeCommands) yield maybeCommands
            await waitForRelease
            yield { type: 'agent_end', messages: [] }
          })(),
        }),
      }))

      const { PiAgentAdapter } = await import('./pi-agent-adapter.ts')
      const adapter = new PiAgentAdapter()
      const iterator = adapter.query({
        sessionId: 'session-pi-runtime-state',
        prompt: 'initial prompt',
        model: 'pi-model',
      })[Symbol.asyncIterator]()

      const firstYield = iterator.next()
      await new Promise((resolve) => setTimeout(resolve, 0))

      const runtimeState = await adapter.getRuntimeState('session-pi-runtime-state')
      releaseAgentEnd()
      const resultMessage = await firstYield

      console.log(JSON.stringify({
        sentCommands,
        runtimeState,
        resultType: resultMessage.value?.type,
        resultSubtype: resultMessage.value?.subtype,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('runtimeState'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      sentCommands?: Array<{ type?: string; id?: string }>
      runtimeState?: {
        provider?: string
        modelId?: string
        modelName?: string
        thinkingLevel?: string
        isStreaming?: boolean
        isCompacting?: boolean
        steeringMode?: string
        followUpMode?: string
        nativeSessionId?: string
        nativeSessionName?: string
        nativeSessionFile?: string
        autoCompactionEnabled?: boolean
        messageCount?: number
        pendingMessageCount?: number
        stats?: {
          userMessages?: number
          assistantMessages?: number
          toolCalls?: number
          toolResults?: number
          totalMessages?: number
          tokens?: {
            input?: number
            output?: number
            cacheRead?: number
            cacheWrite?: number
            total?: number
          }
          costUsd?: number
          contextUsage?: {
            tokens?: number
            maxTokens?: number
            percent?: number
          }
        }
        commands?: Array<{
          name?: string
          description?: string
          source?: string
          sourceInfo?: { name?: string; path?: string }
        }>
      }
      resultType?: string
      resultSubtype?: string
    }

    expect(result.sentCommands?.map((command) => command.type)).toEqual(['prompt', 'get_state', 'get_session_stats', 'get_commands'])
    expect(result.sentCommands?.[1]?.id).toStartWith('proma-get-state-session-pi-runtime-state-')
    expect(result.sentCommands?.[2]?.id).toStartWith('proma-get-session-stats-session-pi-runtime-state-')
    expect(result.sentCommands?.[3]?.id).toStartWith('proma-get-commands-session-pi-runtime-state-')
    expect(result.runtimeState).toEqual({
      provider: 'deepseek',
      modelId: 'deepseek-v4-flash',
      modelName: 'DeepSeek V4 Flash',
      thinkingLevel: 'high',
      isStreaming: true,
      isCompacting: false,
      steeringMode: 'all',
      followUpMode: 'one-at-a-time',
      nativeSessionId: 'pi-native-session-1',
      nativeSessionName: 'Pi Native',
      nativeSessionFile: '/tmp/pi-session.jsonl',
      autoCompactionEnabled: true,
      messageCount: 12,
      pendingMessageCount: 2,
      stats: {
        userMessages: 3,
        assistantMessages: 4,
        toolCalls: 5,
        toolResults: 5,
        totalMessages: 17,
        tokens: {
          input: 1000,
          output: 250,
          cacheRead: 80,
          cacheWrite: 40,
          total: 1370,
        },
        costUsd: 0.1234,
        contextUsage: {
          tokens: 1370,
          maxTokens: 200000,
          percent: 0.685,
        },
      },
      commands: [
        {
          name: 'proma_mcp_status',
          description: 'Inspect configured MCP servers',
          source: 'extension',
          sourceInfo: { name: 'proma-mcp-bridge', path: '/tmp/proma-mcp.js' },
        },
        {
          name: 'plan',
          description: 'Create a plan',
          source: 'prompt',
          sourceInfo: { name: 'default-prompts' },
        },
        {
          name: 'skill:using-superpowers',
          description: 'Use installed skills',
          source: 'skill',
          sourceInfo: { name: 'using-superpowers', path: '/tmp/skills/using-superpowers' },
        },
      ],
    })
    expect(result.resultType).toBe('result')
    expect(result.resultSubtype).toBe('success')
  })

  test('Given Pi retry lifecycle is active When runtime state is requested Then derives retry diagnostics', () => {
    const output = runPiAdapterScript(`
      import { mock } from 'bun:test'

      const sentCommands = []
      let releaseAgentEnd
      let notifyResponse
      const responses = []
      const waitForRelease = new Promise((resolve) => { releaseAgentEnd = resolve })
      const waitForResponse = () => new Promise((resolve) => {
        const existing = responses.shift()
        if (existing) {
          resolve(existing)
          return
        }
        notifyResponse = resolve
      })
      const pushResponse = (response) => {
        if (notifyResponse) {
          const resolve = notifyResponse
          notifyResponse = null
          resolve(response)
          return
        }
        responses.push(response)
      }

      mock.module('./pi-process', () => ({
        startPiRpcSession: () => ({
          send: (command) => {
            sentCommands.push(command)
            if (command.type === 'set_auto_retry') {
              queueMicrotask(() => pushResponse({
                type: 'response',
                id: command.id,
                command: 'set_auto_retry',
                success: true,
                data: {},
              }))
            }
            if (command.type === 'get_state') {
              queueMicrotask(() => pushResponse({
                type: 'response',
                id: command.id,
                command: 'get_state',
                success: true,
                data: {
                  isStreaming: true,
                  isCompacting: false,
                },
              }))
            }
            if (command.type === 'get_session_stats') {
              queueMicrotask(() => pushResponse({
                type: 'response',
                id: command.id,
                command: 'get_session_stats',
                success: true,
                data: {},
              }))
            }
            if (command.type === 'get_commands') {
              queueMicrotask(() => pushResponse({
                type: 'response',
                id: command.id,
                command: 'get_commands',
                success: true,
                data: { commands: [] },
              }))
            }
          },
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
            yield await waitForResponse()
            yield {
              type: 'auto_retry_start',
              attempt: 1,
              maxAttempts: 3,
              delayMs: 1000,
              errorMessage: 'provider timeout',
            }
            yield await waitForResponse()
            yield await waitForResponse()
            yield await waitForResponse()
            await waitForRelease
            yield { type: 'agent_end', messages: [] }
          })(),
        }),
      }))

      const { PiAgentAdapter } = await import('./pi-agent-adapter.ts')
      const adapter = new PiAgentAdapter()
      const messages = []
      let resolveRetryStarted
      const waitForRetryStarted = new Promise((resolve) => { resolveRetryStarted = resolve })
      const drainPromise = (async () => {
        for await (const message of adapter.query({
          sessionId: 'session-pi-runtime-retry-state',
          prompt: 'initial prompt',
          model: 'pi-model',
          runtimeAutoRetryEnabled: true,
        })) {
          messages.push(message)
          if (message?._promaEvent?.type === 'retry' && message._promaEvent.status === 'starting') {
            resolveRetryStarted()
          }
        }
      })()

      await waitForRetryStarted
      const runtimeState = await adapter.getRuntimeState('session-pi-runtime-retry-state')
      releaseAgentEnd()
      await drainPromise

      console.log(JSON.stringify({
        sentCommands,
        runtimeState,
        messageTypes: messages.map((message) => message?.type),
        messageSubtypes: messages.map((message) => message?.subtype ?? null),
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('runtimeState'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      sentCommands?: Array<{ type?: string; id?: string; enabled?: boolean }>
      runtimeState?: {
        isStreaming?: boolean
        isCompacting?: boolean
        autoRetryEnabled?: boolean
        isRetrying?: boolean
      }
      messageTypes?: string[]
      messageSubtypes?: Array<string | null>
    }

    expect(result.sentCommands?.map((command) => command.type)).toEqual(['set_auto_retry', 'prompt', 'get_state', 'get_session_stats', 'get_commands'])
    expect(result.sentCommands?.[0]).toMatchObject({ type: 'set_auto_retry', enabled: true })
    expect(result.runtimeState).toMatchObject({
      isStreaming: true,
      isCompacting: false,
      autoRetryEnabled: true,
      isRetrying: true,
    })
    expect(result.messageTypes).toEqual(['system', 'system', 'result'])
    expect(result.messageSubtypes).toEqual(['pi_runtime_event', 'pi_runtime_event', 'success'])
  })

  test('Given Pi native command failure When fork messages are requested Then rejects with response error', () => {
    const output = runPiAdapterScript(`
      import { mock } from 'bun:test'

      const sentCommands = []
      let releaseAgentEnd
      let releaseResponse
      const waitForRelease = new Promise((resolve) => { releaseAgentEnd = resolve })
      const waitForResponse = new Promise((resolve) => { releaseResponse = resolve })

      mock.module('./pi-process', () => ({
        startPiRpcSession: () => ({
          send: (command) => {
            sentCommands.push(command)
            if (command.type === 'get_fork_messages') {
              queueMicrotask(() => releaseResponse({
                type: 'response',
                id: command.id,
                command: 'get_fork_messages',
                success: false,
                error: 'Cannot read fork messages',
              }))
            }
          },
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
            const response = await waitForResponse
            yield response
            await waitForRelease
            yield { type: 'agent_end', messages: [] }
          })(),
        }),
      }))

      const { PiAgentAdapter } = await import('./pi-agent-adapter.ts')
      const adapter = new PiAgentAdapter()
      const iterator = adapter.query({
        sessionId: 'session-pi-fork-failure',
        prompt: 'initial prompt',
        model: 'pi-model',
      })[Symbol.asyncIterator]()

      const firstYield = iterator.next()
      await new Promise((resolve) => setTimeout(resolve, 0))

      let errorMessage = ''
      try {
        await adapter.getForkMessages('session-pi-fork-failure')
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error)
      }

      releaseAgentEnd()
      const resultMessage = await firstYield

      console.log(JSON.stringify({
        sentCommands,
        errorMessage,
        resultType: resultMessage.value?.type,
        resultSubtype: resultMessage.value?.subtype,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('errorMessage'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      sentCommands?: Array<{ type?: string }>
      errorMessage?: string
      resultType?: string
      resultSubtype?: string
    }

    expect(result.sentCommands?.map((command) => command.type)).toEqual(['prompt', 'get_fork_messages'])
    expect(result.errorMessage).toContain('Cannot read fork messages')
    expect(result.resultType).toBe('result')
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
              args: { command: 'printf hello' },
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
          toolUseResult: message.toolUseResult,
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
        toolUseResult?: { toolName?: string; input?: Record<string, unknown>; content?: Array<{ type: string; text: string }>; isError?: boolean }
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
      toolUseResult: {
        toolName: 'bash',
        input: { command: 'printf hello' },
        content: [{ type: 'text', text: 'hel' }],
        isError: false,
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
      toolUseResult: {
        content: [{ type: 'text', text: 'hello' }],
        isError: false,
      },
      transient: false,
      progress: false,
    })
    expect(result.resultSubtype).toBe('success')
  })

  test('Given Pi MCP tool result has image resource and structured content When query runs Then preserves display and structured payloads', () => {
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
              toolCallId: 'mcp-call-1',
              toolName: 'mcp__docs__inspect_result',
              args: { topic: 'alpha' },
            }
            yield {
              type: 'tool_execution_end',
              toolCallId: 'mcp-call-1',
              toolName: 'mcp__docs__inspect_result',
              result: {
                content: [
                  { type: 'text', text: 'topic=alpha' },
                  { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
                  { type: 'text', text: '[MCP resource result]\\n{"uri":"file:///alpha.txt"}' },
                ],
                structuredContent: {
                  topic: 'alpha',
                  ok: true,
                },
                details: {
                  server: 'docs',
                  toolName: 'inspect-result',
                },
              },
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
        sessionId: 'session-pi-mcp-result',
        prompt: 'call mcp',
        model: 'deepseek-v4-flash',
      })) {
        messages.push(message)
      }

      const toolResultMessage = messages.find((message) => message.type === 'user')
      const toolResultBlock = toolResultMessage?.message?.content?.[0]

      console.log(JSON.stringify({
        blockContent: toolResultBlock?.content,
        toolUseResult: toolResultMessage?.toolUseResult,
        resultSubtype: messages.at(-1)?.subtype,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('blockContent'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      blockContent?: Array<{ type?: string; text?: string; data?: string; mimeType?: string }>
      toolUseResult?: { structuredContent?: { topic?: string; ok?: boolean }; details?: { server?: string } }
      resultSubtype?: string
    }

    expect(result.blockContent).toEqual([
      { type: 'text', text: 'topic=alpha' },
      { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
      { type: 'text', text: '[MCP resource result]\n{"uri":"file:///alpha.txt"}' },
    ])
    expect(result.toolUseResult?.structuredContent).toEqual({ topic: 'alpha', ok: true })
    expect(result.toolUseResult?.details?.server).toBe('docs')
    expect(result.resultSubtype).toBe('success')
  })

  test('Given Pi final tool result is primitive When query runs Then preserves it as final result metadata', () => {
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
              type: 'tool_execution_end',
              toolCallId: 'call-final-primitive',
              toolName: 'bash',
              result: 'done',
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
        sessionId: 'session-pi-final-primitive',
        prompt: 'hello',
        model: 'deepseek-v4-flash',
      })) {
        messages.push(message)
      }

      const toolResult = messages.find((message) => message.type === 'user')
      console.log(JSON.stringify({
        block: toolResult?.message.content[0],
        toolUseResult: toolResult?.toolUseResult,
        resultSubtype: messages.at(-1)?.subtype,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('toolUseResult'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      block?: { type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean }
      toolUseResult?: { result?: string; partialResult?: string; isError?: boolean }
      resultSubtype?: string
    }

    expect(result.block).toEqual({
      type: 'tool_result',
      tool_use_id: 'call-final-primitive',
      content: 'done',
      is_error: false,
    })
    expect(result.toolUseResult).toEqual({
      result: 'done',
      isError: false,
    })
    expect(result.toolUseResult?.partialResult).toBeUndefined()
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

  test('Given Pi message end with entry id When query runs Then preserves Pi entry id without replacing SDK uuid', () => {
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
              entryId: 'pi-entry-assistant-1',
              message: {
                role: 'assistant',
                id: 'pi-message-assistant-1',
                content: [{ type: 'text', text: 'final answer' }],
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
        sessionId: 'session-pi-entry-id',
        prompt: 'hello',
        model: 'deepseek-v4-flash',
      })) {
        messages.push(message)
      }

      const assistant = messages.find((message) => message.type === 'assistant')
      console.log(JSON.stringify({
        text: assistant?.message?.content?.[0]?.text,
        uuid: assistant?.uuid ?? null,
        piEntryId: assistant?._promaPiEntryId ?? null,
        resultSubtype: messages.at(-1)?.subtype,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('piEntryId'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      text?: string
      uuid?: string | null
      piEntryId?: string | null
      resultSubtype?: string
    }

    expect(result.text).toBe('final answer')
    expect(result.uuid).toBeNull()
    expect(result.piEntryId).toBe('pi-entry-assistant-1')
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

  test('Given runtime extension path When query starts Then passes it to Pi process', () => {
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
        sessionId: 'session-pi-extension-path',
        prompt: 'hello',
        model: 'pi-model',
        runtimeExtensionPaths: ['/tmp/proma-permission-bridge.mjs'],
      })) {}

      console.log(JSON.stringify({
        extensionPaths: startInput?.extensionPaths ?? [],
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('extensionPaths'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      extensionPaths?: string[]
    }

    expect(result.extensionPaths).toEqual(['/tmp/proma-permission-bridge.mjs'])
  })

  test('Given runtime skill paths When query starts Then passes them to Pi process', () => {
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
        sessionId: 'session-pi-skill-path',
        prompt: 'hello',
        model: 'pi-model',
        runtimeSkillPaths: ['/tmp/proma-workspace/skills', '/Users/test/.agents/skills'],
      })) {}

      console.log(JSON.stringify({
        skillPaths: startInput?.skillPaths ?? [],
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('skillPaths'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      skillPaths?: string[]
    }

    expect(result.skillPaths).toEqual(['/tmp/proma-workspace/skills', '/Users/test/.agents/skills'])
  })

  test('Given runtime session path When query starts Then passes it to Pi process', () => {
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
        sessionId: 'session-pi-clone-resume',
        prompt: 'continue',
        model: 'pi-model',
        runtimeSessionDir: '/tmp/proma-pi-sessions',
        runtimeSessionPath: '/tmp/pi-native-clone.jsonl',
      })) {}

      console.log(JSON.stringify({
        sessionId: startInput?.sessionId ?? null,
        sessionDir: startInput?.sessionDir ?? null,
        sessionPath: startInput?.sessionPath ?? null,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('sessionPath'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      sessionId?: string | null
      sessionDir?: string | null
      sessionPath?: string | null
    }

    expect(result.sessionId).toBe('session-pi-clone-resume')
    expect(result.sessionDir).toBe('/tmp/proma-pi-sessions')
    expect(result.sessionPath).toBe('/tmp/pi-native-clone.jsonl')
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
        progressMessage: messages.find((message) => message._promaToolProgress === true),
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
        progressMessage: messages.find((message) => message._promaToolProgress === true),
        messageTypes: messages.map((message) => message.type),
        resultSubtype: messages.at(-1)?.subtype,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('warnings'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      warnings?: string[]
      progressMessage?: {
        toolUseResult?: {
          toolName?: string
          input?: Record<string, unknown>
          partialResult?: string
          isError?: boolean
        }
      }
      messageTypes?: string[]
      resultSubtype?: string
    }

    expect(result.messageTypes).toEqual(['user', 'result'])
    expect(result.progressMessage?.toolUseResult).toEqual({
      toolName: 'bash',
      input: { command: 'pwd' },
      partialResult: 'running',
      isError: false,
    })
    expect(result.resultSubtype).toBe('success')
    expect(result.warnings).toEqual([])
  })

  test('Given Pi queue update When query runs Then emits visible transient queue summary', () => {
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
              type: 'queue_update',
              steering: ['请先检查 diff'],
              followUp: ['然后继续修复测试', '最后总结'],
            }
            yield { type: 'agent_end', messages: [] }
          })(),
        }),
      }))

      const { PiAgentAdapter } = await import('./pi-agent-adapter.ts')
      const adapter = new PiAgentAdapter()
      const messages = []

      for await (const message of adapter.query({
        sessionId: 'session-pi-queue-summary',
        prompt: 'hello',
        model: 'deepseek-v4-flash',
      })) {
        messages.push(message)
      }

      console.log(JSON.stringify({
        messageTypes: messages.map((message) => message.type),
        summaryMessage: messages.find((message) => message.type === 'tool_use_summary'),
        resultSubtype: messages.at(-1)?.subtype,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('summaryMessage'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      messageTypes?: string[]
      summaryMessage?: {
        summary?: string
        preceding_tool_use_ids?: string[]
        _promaTransient?: boolean
        _promaPiQueueSummary?: boolean
      }
      resultSubtype?: string
    }

    expect(result.messageTypes).toEqual(['tool_use_summary', 'result'])
    expect(result.summaryMessage?.summary).toContain('Pi 队列')
    expect(result.summaryMessage?.summary).toContain('steering: 1')
    expect(result.summaryMessage?.summary).toContain('follow-up: 2')
    expect(result.summaryMessage?.summary).toContain('请先检查 diff')
    expect(result.summaryMessage?.preceding_tool_use_ids).toEqual([])
    expect(result.summaryMessage?._promaTransient).toBe(true)
    expect(result.summaryMessage?._promaPiQueueSummary).toBe(true)
    expect(result.resultSubtype).toBe('success')
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
