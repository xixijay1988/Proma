import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { ensurePiAskUserExtension } from './pi-ask-user-extension'
import { startPiRpcSession, type PiRpcEvent } from './pi-process'

describe('pi ask user extension', () => {
  test('Given config dir When ensuring extension Then exposes Claude-compatible AskUserQuestion tool', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'proma-pi-ask-user-extension-'))
    try {
      const result = ensurePiAskUserExtension({ configDir })
      const source = readFileSync(result.extensionPath, 'utf-8')

      expect(result.toolNames).toEqual(['AskUserQuestion'])
      expect(result.extensionPath).toContain('proma-ask-user-bridge.mjs')
      expect(source).toContain("name: 'AskUserQuestion'")
      expect(source).toContain('Ask the user one or more questions')
      expect(source).toContain('PROMA_ASK_USER_QUESTION_BRIDGE')
      expect(source).toContain('promaAskUserQuestion')
      expect(source).toContain('JSON.parse')
      expect(source).toContain('ctx.ui.editor')
      expect(source).toContain('answers')
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('Given real Pi RPC process When ask user extension loads Then get_commands exposes AskUserQuestion', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'proma-pi-ask-user-rpc-'))
    try {
      const result = ensurePiAskUserExtension({ configDir })
      const rpc = startPiRpcSession({
        cwd: configDir,
        sessionId: 'proma-pi-ask-user-smoke',
        sessionDir: join(configDir, 'sessions'),
        extensionPaths: [result.extensionPath],
      })

      rpc.send({ id: 'ask-user-commands-1', type: 'get_commands' })
      const response = await waitForResponse(rpc.events, 'ask-user-commands-1')
      rpc.kill()
      await rpc.done

      const command = response.commands?.find((item) => item.name === 'proma:ask_user_bridge_status')
      expect(command?.source).toBe('extension')
      expect(command?.description).toContain('Ask the user one or more questions')
      expect(command?.description).toContain('AskUserQuestion')
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })
})

async function waitForResponse(events: AsyncIterable<PiRpcEvent>, id: string): Promise<{
  commands?: Array<{ name?: string; source?: string; description?: string }>
}> {
  for await (const event of events) {
    if (event.type === 'response' && event.id === id) {
      if (!event.success) throw new Error(String(event.error ?? 'Pi RPC response failed'))
      return event.data as { commands?: Array<{ name?: string; source?: string; description?: string }> }
    }
  }
  throw new Error(`No response for ${id}`)
}
