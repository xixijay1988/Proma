import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { ensurePiNanoBananaExtension } from './pi-nano-banana-extension'

describe('pi nano banana extension', () => {
  test('Given disabled nano banana tool When ensuring extension Then no extension is created', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'proma-pi-nano-extension-'))
    try {
      const result = ensurePiNanoBananaExtension({
        configDir,
        sessionId: 'session-nano',
        cwd: '/tmp/proma-session',
        toolState: { enabled: false },
        credentials: { apiKey: 'sk-nano' },
      })

      expect(result).toBeNull()
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('Given enabled nano banana without api key When ensuring extension Then no extension is created', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'proma-pi-nano-extension-'))
    try {
      const result = ensurePiNanoBananaExtension({
        configDir,
        sessionId: 'session-nano',
        cwd: '/tmp/proma-session',
        toolState: { enabled: true },
        credentials: { baseUrl: 'https://gemini.example.test' },
      })

      expect(result).toBeNull()
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('Given enabled nano banana with api key When ensuring extension Then exposes Pi image tool without serializing api key', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'proma-pi-nano-extension-'))
    try {
      const result = ensurePiNanoBananaExtension({
        configDir,
        sessionId: 'session-nano',
        cwd: '/tmp/proma-session',
        toolState: { enabled: true },
        credentials: {
          apiKey: 'sk-nano-secret',
          baseUrl: 'https://gemini.example.test',
          model: 'gemini-image-test',
        },
      })

      expect(result).not.toBeNull()
      if (!result) throw new Error('Expected Pi nano banana extension result')

      const source = readFileSync(result.extensionPath, 'utf-8')

      expect(result.toolNames).toEqual(['mcp__nano_banana__generate_image'])
      expect(result.env.PROMA_NANO_BANANA_API_KEY).toBe('sk-nano-secret')
      expect(source).toContain('mcp__nano_banana__generate_image')
      expect(source).toContain('process.env.PROMA_NANO_BANANA_API_KEY')
      expect(source).toContain('https://gemini.example.test')
      expect(source).toContain('gemini-image-test')
      expect(source).toContain('generated-images')
      expect(source).toContain('__PROMA_PI_MCP_TOOL_RISK_HINTS__')
      expect(source).not.toContain('sk-nano-secret')
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })
})
