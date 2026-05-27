import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import type { AgentWorkspace } from '@proma/shared'
import { normalizeAgentWorkspaceForTest } from './agent-workspace-manager'

function runWorkspaceManagerScript(script: string): string {
  const homeDir = mkdtempSync(join(tmpdir(), 'proma-agent-workspace-'))
  try {
    const result = Bun.spawnSync({
      cmd: [process.execPath, '--eval', script],
      cwd: import.meta.dir,
      env: {
        ...process.env,
        HOME: homeDir,
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

describe('Agent 工作区引擎持久化', () => {
  test('Given old workspace without agentEngine When normalized Then uses claude-sdk', () => {
    const workspace = { id: 'w1', name: '旧工作区', slug: 'old', createdAt: 1, updatedAt: 1 } satisfies AgentWorkspace

    expect(normalizeAgentWorkspaceForTest(workspace).agentEngine).toBe('claude-sdk')
  })

  test('Given pi workspace When normalized Then preserves pi engine', () => {
    const workspace = { id: 'w1', name: 'Pi', slug: 'pi', agentEngine: 'pi', createdAt: 1, updatedAt: 1 } satisfies AgentWorkspace

    expect(normalizeAgentWorkspaceForTest(workspace).agentEngine).toBe('pi')
  })

  test('Given old workspace When reordered Then returned workspace is normalized', () => {
    const output = runWorkspaceManagerScript(`
      import { mkdirSync, writeFileSync } from 'node:fs'
      import { join } from 'node:path'

      const configDir = join(process.env.HOME, '.proma')
      mkdirSync(configDir, { recursive: true })
      writeFileSync(join(configDir, 'agent-workspaces.json'), JSON.stringify({
        version: 2,
        workspaces: [
          { id: 'w1', name: '旧工作区', slug: 'old', createdAt: 1, updatedAt: 1 },
          { id: 'w2', name: 'Pi', slug: 'pi', agentEngine: 'pi', createdAt: 2, updatedAt: 2 },
        ],
      }))

      const { reorderAgentWorkspaces } = await import('./agent-workspace-manager.ts')
      const workspaces = reorderAgentWorkspaces(['w2', 'w1'])

      console.log(JSON.stringify(workspaces.map((workspace) => ({
        id: workspace.id,
        agentEngine: workspace.agentEngine,
      }))))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('[{'))
    expect(JSON.parse(jsonLine ?? '[]')).toEqual([
      { id: 'w2', agentEngine: 'pi' },
      { id: 'w1', agentEngine: 'claude-sdk' },
    ])
  })
})
