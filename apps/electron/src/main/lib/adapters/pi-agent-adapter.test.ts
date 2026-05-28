import { describe, expect, test } from 'bun:test'

function runPiAdapterScript(script: string): string {
  const result = Bun.spawnSync({
    cmd: [process.execPath, '--eval', script],
    cwd: import.meta.dir,
    env: {
      ...process.env,
      PROMA_PI_AGENT_ENABLED: '1',
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
  test('Given enabled pi bridge When process is still running Then query waits before yielding protocol error', () => {
    const output = runPiAdapterScript(`
      import { mock } from 'bun:test'

      let resolveProcess
      let killCount = 0
      const done = new Promise((resolve) => {
        resolveProcess = resolve
      })

      mock.module('./pi-process', () => ({
        startPiProcessBridgeProbe: () => ({
          child: {},
          done,
          kill: () => { killCount += 1 },
        }),
      }))

      const { PiAgentAdapter } = await import('./pi-agent-adapter.ts')
      const adapter = new PiAgentAdapter()

      const iterator = adapter.query({
        sessionId: 'session-pi-adapter',
        prompt: 'hello',
        model: 'pi-model',
      })[Symbol.asyncIterator]()

      const firstMessage = iterator.next()
      const yieldedBeforeDone = await Promise.race([
        firstMessage.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 20)),
      ])

      resolveProcess({
        exitCode: 0,
        signal: null,
        stdoutSnippet: 'usage: pi',
        stderrSnippet: '',
        aborted: false,
      })

      const firstResult = await firstMessage
      const secondResult = await iterator.next()
      const doneResult = await iterator.next()

      console.log(JSON.stringify({
        yieldedBeforeDone,
        firstDone: firstResult.done ?? false,
        firstType: firstResult.value?.type,
        firstErrorType: firstResult.value?.error?.errorType,
        firstPayload: JSON.stringify(firstResult.value),
        secondDone: secondResult.done ?? false,
        secondType: secondResult.value?.type,
        secondSubtype: secondResult.value?.subtype,
        done: doneResult.done ?? false,
        killCount,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('yieldedBeforeDone'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      yieldedBeforeDone?: boolean
      firstDone?: boolean
      firstType?: string
      firstErrorType?: string
      firstPayload?: string
      secondDone?: boolean
      secondType?: string
      secondSubtype?: string
      done?: boolean
      killCount?: number
    }

    expect(result.yieldedBeforeDone).toBe(false)
    expect(result.firstDone).toBe(false)
    expect(result.firstType).toBe('assistant')
    expect(result.firstErrorType).toBe('pi_protocol_not_implemented')
    expect(result.firstPayload).toContain('exitCode=0')
    expect(result.secondDone).toBe(false)
    expect(result.secondType).toBe('result')
    expect(result.secondSubtype).toBe('error')
    expect(result.done).toBe(true)
    expect(result.killCount).toBe(1)
  })
})
