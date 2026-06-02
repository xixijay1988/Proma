import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { ensurePiMemoryExtension } from './pi-memory-extension'

describe('pi memory extension', () => {
  test('Given disabled memory config When ensuring extension Then no extension is created', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'proma-pi-memory-extension-'))
    try {
      const result = ensurePiMemoryExtension({
        configDir,
        memoryConfig: {
          enabled: false,
          apiKey: 'sk-memory',
          userId: 'user-1',
        },
      })

      expect(result).toBeNull()
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('Given enabled memory config When ensuring extension Then exposes Pi MCP memory tools without serializing api key', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'proma-pi-memory-extension-'))
    try {
      const result = ensurePiMemoryExtension({
        configDir,
        memoryConfig: {
          enabled: true,
          apiKey: 'sk-memory-secret',
          userId: 'user-1',
          baseUrl: 'https://memory.example.test/api',
        },
      })

      expect(result).not.toBeNull()
      if (!result) throw new Error('Expected Pi memory extension result')

      const source = readFileSync(result.extensionPath, 'utf-8')

      expect(result.toolNames).toEqual([
        'mcp__mem__recall_memory',
        'mcp__mem__add_memory',
      ])
      expect(result.env.PROMA_MEMOS_API_KEY).toBe('sk-memory-secret')
      expect(source).toContain('mcp__mem__recall_memory')
      expect(source).toContain('mcp__mem__add_memory')
      expect(source).toContain('process.env.PROMA_MEMOS_API_KEY')
      expect(source).toContain('https://memory.example.test/api')
      expect(source).not.toContain('sk-memory-secret')
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })
})
