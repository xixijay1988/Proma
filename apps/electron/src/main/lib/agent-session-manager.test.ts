import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

function runSessionManagerScript(script: string): string {
  const homeDir = mkdtempSync(join(tmpdir(), 'proma-agent-session-'))
  try {
    const result = Bun.spawnSync({
      cmd: [process.execPath, '--eval', script],
      cwd: import.meta.dir,
      env: {
        ...process.env,
        HOME: homeDir,
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

describe('Agent 会话引擎持久化', () => {
  test('Given pi workspace When creating session without explicit engine Then session persists pi engine', () => {
    const output = runSessionManagerScript(`
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

      const { createAgentSession } = await import('./agent-session-manager.ts')
      const session = createAgentSession(undefined, 'channel-1', 'workspace-pi')

      console.log(JSON.stringify({ agentEngine: session.agentEngine }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('agentEngine'))
    expect(JSON.parse(jsonLine ?? '{}').agentEngine).toBe('pi')
  })
})
