import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { ensurePiTaskExtension } from './pi-task-extension'

describe('pi task extension', () => {
  test('Given config dir When ensuring extension Then exposes Proma task tools for Pi', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'proma-pi-task-extension-'))
    try {
      const result = ensurePiTaskExtension({ configDir })
      const source = readFileSync(result.extensionPath, 'utf-8')

      expect(result.toolNames).toEqual([
        'TaskCreate',
        'TaskUpdate',
        'TaskGet',
        'TaskList',
      ])
      expect(result.extensionPath).toContain('proma-task-bridge.mjs')
      expect(source).toContain("name: 'TaskCreate'")
      expect(source).toContain("name: 'TaskUpdate'")
      expect(source).toContain("name: 'TaskGet'")
      expect(source).toContain("name: 'TaskList'")
      expect(source).toContain('const tasks = new Map()')
      expect(source).toContain('JSON.stringify({ task }, null, 2)')
      expect(source).toContain('JSON.stringify({ tasks:')
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })
})
