import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
  buildPiRpcArgsForTest,
  createPiJsonlLineSplitterForTest,
  getPiRpcSessionLifetimeTimeoutMsForTest,
  resolvePiCliEntrypointForTest,
  startPiRpcSession,
  type PiRpcEvent,
} from './pi-process'

interface PiRpcResponseEvent extends PiRpcEvent {
  type: 'response'
  command: string
  success: boolean
  data?: unknown
}

async function waitForPiRpcResponse(input: {
  events: AsyncIterable<PiRpcEvent>
  id: string
  timeoutMs?: number
}): Promise<PiRpcResponseEvent> {
  const timeoutMs = input.timeoutMs ?? 10_000
  const startedAt = Date.now()

  for await (const event of input.events) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`等待 Pi RPC response 超时: ${input.id}`)
    }
    if (event.type === 'response' && event.id === input.id) {
      return event as PiRpcResponseEvent
    }
  }

  throw new Error(`Pi RPC 已结束但未返回 response: ${input.id}`)
}

describe('pi process integration', () => {
  test('Given installed pi package When resolving entrypoint Then returns cli path', () => {
    const entrypoint = resolvePiCliEntrypointForTest()

    expect(entrypoint.endsWith('dist/cli.js')).toBe(true)
  })

  test('Given installed pi package When resolving entrypoint Then references the scoped package root', () => {
    const entrypoint = resolvePiCliEntrypointForTest()

    expect(entrypoint).toContain('@earendil-works/pi-coding-agent')
  })

  test('Given rpc stdout chunks When splitting Then only LF terminates records', () => {
    const splitter = createPiJsonlLineSplitterForTest()

    const firstLines = splitter.push(Buffer.from('{"type":"message_update","text":"a\\u2028b"}\n{"type":"agent'))
    const secondLines = splitter.push(Buffer.from('_end"}\r\n'))

    expect(firstLines).toEqual(['{"type":"message_update","text":"a\\u2028b"}'])
    expect(secondLines).toEqual(['{"type":"agent_end"}'])
    expect(splitter.flush()).toEqual([])
  })

  test('Given long running Pi RPC session When no user abort occurs Then Proma does not apply a fixed lifetime timeout', () => {
    expect(getPiRpcSessionLifetimeTimeoutMsForTest()).toBeNull()
  })

  test('Given runtime provider and model When building rpc args Then includes provider without api key', () => {
    const args = buildPiRpcArgsForTest({
      provider: 'openai',
      model: 'gpt-4o',
    })

    expect(args).toContain('--provider')
    expect(args).toContain('openai')
    expect(args).toContain('--model')
    expect(args).toContain('gpt-4o')
    expect(args.some((arg) => arg === '--api-key')).toBe(false)
  })

  test('Given Proma session storage When building rpc args Then uses persistent Pi session id', () => {
    const args = buildPiRpcArgsForTest({
      provider: 'openai',
      model: 'gpt-4o',
      sessionId: 'proma-session-1',
      sessionDir: '/tmp/proma-pi-sessions',
    })

    expect(args).toContain('--session-dir')
    expect(args).toContain('/tmp/proma-pi-sessions')
    expect(args).toContain('--session-id')
    expect(args).toContain('proma-session-1')
    expect(args).not.toContain('--no-session')
  })

  test('Given cloned Pi native session path When building rpc args Then resumes that session file', () => {
    const args = buildPiRpcArgsForTest({
      provider: 'openai',
      model: 'gpt-4o',
      sessionId: 'proma-clone-session',
      sessionDir: '/tmp/proma-pi-sessions',
      sessionPath: '/tmp/pi-native-clone.jsonl',
    })

    expect(args).toContain('--session-dir')
    expect(args).toContain('/tmp/proma-pi-sessions')
    expect(args).toContain('--session')
    expect(args).toContain('/tmp/pi-native-clone.jsonl')
    expect(args).not.toContain('--session-id')
    expect(args).not.toContain('--no-session')
  })

  test('Given Proma extension path When building rpc args Then loads extension explicitly', () => {
    const args = buildPiRpcArgsForTest({
      provider: 'openai',
      model: 'gpt-4o',
      extensionPaths: ['/tmp/proma-permission-bridge.mjs'],
    })

    expect(args).toContain('--extension')
    expect(args).toContain('/tmp/proma-permission-bridge.mjs')
  })

  test('Given Proma skill paths When building rpc args Then loads skills explicitly', () => {
    const args = buildPiRpcArgsForTest({
      provider: 'openai',
      model: 'gpt-4o',
      skillPaths: ['/tmp/proma-workspace/skills', '/Users/test/.agents/skills'],
    })

    expect(args).toContain('--skill')
    expect(args).toContain('/tmp/proma-workspace/skills')
    expect(args).toContain('/Users/test/.agents/skills')
  })

  test('Given Proma skill path When real Pi RPC process starts Then get_commands exposes skill command', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'proma-pi-skill-rpc-'))
    let rpc: ReturnType<typeof startPiRpcSession> | null = null
    try {
      const skillsRoot = join(homeDir, 'skills')
      const skillDir = join(skillsRoot, 'proma-smoke-skill')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        [
          '---',
          'name: proma-smoke-skill',
          'description: Proma smoke skill visible through Pi RPC get_commands.',
          '---',
          '',
          '# Proma Smoke Skill',
          '',
          'Return the phrase PROMA_PI_SKILL_OK when asked.',
          '',
        ].join('\n'),
        'utf-8',
      )

      rpc = startPiRpcSession({
        cwd: homeDir,
        skillPaths: [skillsRoot],
        runtimeEnv: {
          HOME: homeDir,
          PI_AGENT_HOME: join(homeDir, '.pi'),
          PI_TELEMETRY: '0',
        },
      })
      rpc.send({ id: 'skills-commands-1', type: 'get_commands' })

      const response = await waitForPiRpcResponse({
        events: rpc.events,
        id: 'skills-commands-1',
      })
      expect(response.success).toBe(true)
      const data = response.data as { commands?: Array<{ name?: string; description?: string; source?: string }> }
      const skillCommand = data.commands?.find((command) => command.name === 'skill:proma-smoke-skill')
      expect(skillCommand?.source).toBe('skill')
      expect(skillCommand?.description).toBe('Proma smoke skill visible through Pi RPC get_commands.')
    } finally {
      rpc?.kill()
      if (rpc) {
        await rpc.done
      }
      rmSync(homeDir, { recursive: true, force: true })
    }
  })

  test('Given real Pi RPC process When get_messages runs before prompting Then returns an empty message list', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'proma-pi-messages-rpc-'))
    let rpc: ReturnType<typeof startPiRpcSession> | null = null
    try {
      rpc = startPiRpcSession({
        cwd: homeDir,
        runtimeEnv: {
          HOME: homeDir,
          PI_AGENT_HOME: join(homeDir, '.pi'),
          PI_TELEMETRY: '0',
        },
      })
      rpc.send({ id: 'runtime-messages-1', type: 'get_messages' })

      const response = await waitForPiRpcResponse({
        events: rpc.events,
        id: 'runtime-messages-1',
      })
      expect(response.success).toBe(true)
      const data = response.data as { messages?: unknown[] }
      expect(data.messages).toEqual([])
    } finally {
      rpc?.kill()
      if (rpc) {
        await rpc.done
      }
      rmSync(homeDir, { recursive: true, force: true })
    }
  })
})
