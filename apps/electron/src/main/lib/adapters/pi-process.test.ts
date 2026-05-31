import { describe, expect, test } from 'bun:test'
import { buildPiRpcArgsForTest, createPiJsonlLineSplitterForTest, resolvePiCliEntrypointForTest } from './pi-process'

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
})
