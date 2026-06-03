import { describe, expect, test } from 'bun:test'

function runClaudeAdapterScript(script: string): string {
  const result = Bun.spawnSync({
    cmd: [process.execPath, '--eval', script],
    cwd: import.meta.dir,
    env: process.env,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const stdout = result.stdout.toString()
  const stderr = result.stderr.toString()
  expect(result.exitCode, stderr || stdout).toBe(0)
  return stdout.trim()
}

describe('ClaudeAgentAdapter', () => {
  test('Given initial image inputs When query starts Then sends Claude content blocks', () => {
    const output = runClaudeAdapterScript(`
      import { mock } from 'bun:test'

      let firstUserMessage = null

      mock.module('@anthropic-ai/claude-agent-sdk', () => ({
        query: ({ prompt }) => (async function* () {
          firstUserMessage = await prompt.next()
          yield {
            type: 'result',
            subtype: 'success',
            is_error: false,
            session_id: 'sdk-session-image',
          }
        })(),
      }))

      const { ClaudeAgentAdapter } = await import('./claude-agent-adapter.ts')
      const adapter = new ClaudeAgentAdapter()

      for await (const message of adapter.query({
        sessionId: 'session-claude-image',
        prompt: '描述这张图',
        images: [
          {
            type: 'image',
            data: 'iVBORw0KGgo=',
            mimeType: 'image/png',
            filename: 'diagram.png',
          },
        ],
        model: 'claude-sonnet-4-6',
        cwd: '/tmp',
        sdkCliPath: '/bin/claude',
        env: {},
        sdkPermissionMode: 'default',
        allowDangerouslySkipPermissions: false,
        systemPrompt: '你是 Proma Agent',
      })) {
        void message
      }

      console.log(JSON.stringify(firstUserMessage.value.message.content))
    `)

    const result = JSON.parse(output) as Array<Record<string, unknown>>

    expect(result).toEqual([
      { type: 'text', text: '描述这张图' },
      {
        type: 'image',
        source: {
          type: 'base64',
          data: 'iVBORw0KGgo=',
          media_type: 'image/png',
        },
      },
    ])
  })

  test('Given queued image inputs When message is injected Then sends Claude content blocks', () => {
    const output = runClaudeAdapterScript(`
      import { mock } from 'bun:test'

      const userMessages = []
      let releaseResult

      mock.module('@anthropic-ai/claude-agent-sdk', () => ({
        query: ({ prompt }) => (async function* () {
          userMessages.push((await prompt.next()).value)
          await new Promise((resolve) => { releaseResult = resolve })
          userMessages.push((await prompt.next()).value)
          yield {
            type: 'result',
            subtype: 'success',
            is_error: false,
            session_id: 'sdk-session-queued-image',
          }
        })(),
      }))

      const { ClaudeAgentAdapter } = await import('./claude-agent-adapter.ts')
      const adapter = new ClaudeAgentAdapter()
      const messages = []
      const iterator = adapter.query({
        sessionId: 'session-claude-queued-image',
        prompt: '先看文字',
        model: 'claude-sonnet-4-6',
        cwd: '/tmp',
        sdkCliPath: '/bin/claude',
        env: {},
        sdkPermissionMode: 'default',
        allowDangerouslySkipPermissions: false,
        systemPrompt: '你是 Proma Agent',
      })

      const reader = (async () => {
        for await (const message of iterator) {
          messages.push(message)
        }
      })()

      await adapter.sendQueuedMessage('session-claude-queued-image', {
        type: 'user',
        session_id: 'session-claude-queued-image',
        message: {
          role: 'user',
          content: '再看这张图',
        },
        images: [
          {
            type: 'image',
            data: '/9j/4AAQSkZJRg==',
            mimeType: 'image/jpeg',
            filename: 'photo.jpg',
          },
        ],
        parent_tool_use_id: null,
        priority: 'next',
        uuid: 'queued-image-1',
      })

      releaseResult()
      await reader

      console.log(JSON.stringify({
        initialContent: userMessages[0].message.content,
        queuedContent: userMessages[1].message.content,
        queuedUuid: userMessages[1].uuid,
        queuedPriority: userMessages[1].priority,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('queuedContent'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      initialContent?: string
      queuedContent?: Array<Record<string, unknown>>
      queuedUuid?: string
      queuedPriority?: string
    }

    expect(result.initialContent).toBe('先看文字')
    expect(result.queuedContent).toEqual([
      { type: 'text', text: '再看这张图' },
      {
        type: 'image',
        source: {
          type: 'base64',
          data: '/9j/4AAQSkZJRg==',
          media_type: 'image/jpeg',
        },
      },
    ])
    expect(result.queuedUuid).toBe('queued-image-1')
    expect(result.queuedPriority).toBe('next')
  })
})
