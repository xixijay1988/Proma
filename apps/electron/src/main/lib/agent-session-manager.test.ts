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
  test('Given persisted task messages When task output is requested Then returns latest matching task result', () => {
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

      const {
        appendSDKMessages,
        createAgentSession,
        getAgentTaskOutput,
      } = await import('./agent-session-manager.ts')

      const session = createAgentSession('Pi task output', 'channel-1', 'workspace-pi', 'pi')
      appendSDKMessages(session.id, [
        {
          type: 'assistant',
          uuid: 'assistant-create',
          message: {
            content: [{
              type: 'tool_use',
              id: 'call-create',
              name: 'TaskCreate',
              input: { subject: '检查 Pi 输出' },
            }],
          },
          parent_tool_use_id: null,
          session_id: session.id,
        },
        {
          type: 'user',
          uuid: 'result-create',
          message: {
            content: [{
              type: 'tool_result',
              tool_use_id: 'call-create',
              content: [{ type: 'text', text: JSON.stringify({ task: { id: 'task-pi-1', subject: '检查 Pi 输出', status: 'in_progress' } }) }],
              is_error: false,
            }],
          },
          parent_tool_use_id: null,
          session_id: session.id,
        },
        {
          type: 'assistant',
          uuid: 'assistant-update',
          message: {
            content: [{
              type: 'tool_use',
              id: 'call-update',
              name: 'TaskUpdate',
              input: { taskId: 'task-pi-1', status: 'completed' },
            }],
          },
          parent_tool_use_id: null,
          session_id: session.id,
        },
        {
          type: 'user',
          uuid: 'result-update',
          message: {
            content: [{
              type: 'tool_result',
              tool_use_id: 'call-update',
              content: [{ type: 'text', text: JSON.stringify({ task: { id: 'task-pi-1', subject: '检查 Pi 输出', status: 'completed', description: '最终输出已归档' } }) }],
              is_error: false,
            }],
          },
          parent_tool_use_id: null,
          session_id: session.id,
        },
      ])

      const taskOutput = getAgentTaskOutput({ taskId: 'task-pi-1' })
      console.log(JSON.stringify(taskOutput))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('task-pi-1'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      output?: string
      isComplete?: boolean
    }

    expect(result.output).toContain('最终输出已归档')
    expect(result.isComplete).toBe(true)
  })

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

  test('Given pi session without Claude sdk id When forking Then copies Proma history and workspace files', () => {
    const output = runSessionManagerScript(`
      import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

      const {
        appendSDKMessages,
        createAgentSession,
        forkAgentSession,
        getAgentSessionSDKMessages,
      } = await import('./agent-session-manager.ts')
      const { getAgentSessionWorkspacePath } = await import('./config-paths.ts')

      const source = createAgentSession('Pi source', 'channel-1', 'workspace-pi', 'pi')
      const sourceDir = getAgentSessionWorkspacePath('pi', source.id)
      mkdirSync(sourceDir, { recursive: true })
      writeFileSync(join(sourceDir, 'note.txt'), 'from pi source')

      appendSDKMessages(source.id, [
        {
          type: 'user',
          uuid: 'user-1',
          message: { content: 'hello pi' },
          parent_tool_use_id: null,
          session_id: source.id,
        },
        {
          type: 'assistant',
          uuid: 'assistant-1',
          message: { content: [{ type: 'text', text: 'hello user' }] },
          parent_tool_use_id: null,
          session_id: source.id,
        },
        {
          type: 'assistant',
          uuid: 'assistant-2',
          message: { content: [{ type: 'text', text: 'after cut' }] },
          parent_tool_use_id: null,
          session_id: source.id,
        },
      ])

      const forked = await forkAgentSession({
        sessionId: source.id,
        upToMessageUuid: 'assistant-1',
      })
      const forkDir = getAgentSessionWorkspacePath('pi', forked.id)
      const forkMessages = getAgentSessionSDKMessages(forked.id)

      console.log(JSON.stringify({
        agentEngine: forked.agentEngine,
        title: forked.title,
        sdkSessionId: forked.sdkSessionId ?? null,
        messageUuids: forkMessages.map((message) => message.uuid),
        fileCopied: existsSync(join(forkDir, 'note.txt')),
        fileContent: readFileSync(join(forkDir, 'note.txt'), 'utf-8'),
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('messageUuids'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      agentEngine?: string
      title?: string
      sdkSessionId?: string | null
      messageUuids?: string[]
      fileCopied?: boolean
      fileContent?: string
    }

    expect(result.agentEngine).toBe('pi')
    expect(result.title).toBe('Pi source (fork)')
    expect(result.sdkSessionId).toBeNull()
    expect(result.messageUuids).toEqual(['user-1', 'assistant-1'])
    expect(result.fileCopied).toBe(true)
    expect(result.fileContent).toBe('from pi source')
  })

  test('Given pi session When IPC fork support is checked Then Pi fork is allowed', () => {
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
      const { assertAgentSessionForkSupported } = await import('./agent-session-capabilities.ts')

      const source = createAgentSession('Pi source', 'channel-1', 'workspace-pi', 'pi')
      let allowed = true
      let message = null
      try {
        assertAgentSessionForkSupported(source.id)
      } catch (error) {
        allowed = false
        message = error instanceof Error ? error.message : String(error)
      }

      console.log(JSON.stringify({ allowed, message }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('allowed'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      allowed?: boolean
      message?: string | null
    }

    expect(result.allowed).toBe(true)
    expect(result.message).toBeNull()
  })

  test('Given pi session messages with Pi entry ids When forking Then accepts Pi entry id as cut point', () => {
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

      const {
        appendSDKMessages,
        createAgentSession,
        forkAgentSession,
        getAgentSessionSDKMessages,
      } = await import('./agent-session-manager.ts')

      const source = createAgentSession('Pi source entry', 'channel-1', 'workspace-pi', 'pi')
      appendSDKMessages(source.id, [
        {
          type: 'user',
          uuid: 'user-1',
          message: { content: 'hello pi' },
          parent_tool_use_id: null,
          session_id: source.id,
        },
        {
          type: 'assistant',
          _promaPiEntryId: 'pi-entry-assistant-1',
          message: { content: [{ type: 'text', text: 'hello user' }] },
          parent_tool_use_id: null,
          session_id: source.id,
        },
        {
          type: 'assistant',
          _promaPiEntryId: 'pi-entry-assistant-2',
          message: { content: [{ type: 'text', text: 'after cut' }] },
          parent_tool_use_id: null,
          session_id: source.id,
        },
      ])

      const forked = await forkAgentSession({
        sessionId: source.id,
        upToMessageUuid: 'pi-entry-assistant-1',
      })
      const forkMessages = getAgentSessionSDKMessages(forked.id)

      console.log(JSON.stringify({
        messageTexts: forkMessages.map((message) => message.message?.content?.[0]?.text ?? message.message?.content),
        piEntryIds: forkMessages.map((message) => message._promaPiEntryId ?? null),
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('piEntryIds'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      messageTexts?: string[]
      piEntryIds?: Array<string | null>
    }

    expect(result.messageTexts).toEqual(['hello pi', 'hello user'])
    expect(result.piEntryIds).toEqual([null, 'pi-entry-assistant-1'])
  })

  test('Given pi native session file exists When forking Then creates Pi native child session for new Proma session', () => {
    const output = runSessionManagerScript(`
      import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
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

      const {
        appendSDKMessages,
        createAgentSession,
        forkAgentSession,
      } = await import('./agent-session-manager.ts')
      const { getAgentSessionWorkspacePath } = await import('./config-paths.ts')

      const source = createAgentSession('Pi native source', 'channel-1', 'workspace-pi', 'pi')
      const sourceCwd = getAgentSessionWorkspacePath('pi', source.id)
      mkdirSync(sourceCwd, { recursive: true })

      const piSessionDir = join(configDir, 'pi-agent-sessions')
      mkdirSync(piSessionDir, { recursive: true })
      const sourcePiSessionFile = join(piSessionDir, '2026-06-02T00-00-00-000Z_' + source.id + '.jsonl')
      writeFileSync(sourcePiSessionFile, [
        JSON.stringify({ type: 'session', version: 3, id: source.id, timestamp: '2026-06-02T00:00:00.000Z', cwd: sourceCwd }),
        JSON.stringify({ type: 'message', id: 'pi-entry-user-1', parentId: null, timestamp: '2026-06-02T00:00:01.000Z', message: { role: 'user', content: 'hello pi' } }),
        JSON.stringify({ type: 'message', id: 'pi-entry-assistant-1', parentId: 'pi-entry-user-1', timestamp: '2026-06-02T00:00:02.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'hello user' }], provider: 'deepseek', model: 'deepseek-v4-flash' } }),
        '',
      ].join('\\n'), 'utf-8')

      appendSDKMessages(source.id, [
        {
          type: 'user',
          uuid: 'user-1',
          message: { content: 'hello pi' },
          parent_tool_use_id: null,
          session_id: source.id,
        },
        {
          type: 'assistant',
          _promaPiEntryId: 'pi-entry-assistant-1',
          message: { content: [{ type: 'text', text: 'hello user' }] },
          parent_tool_use_id: null,
          session_id: source.id,
        },
      ])

      const forked = await forkAgentSession({
        sessionId: source.id,
        upToMessageUuid: 'pi-entry-assistant-1',
      })
      const forkCwd = getAgentSessionWorkspacePath('pi', forked.id)
      const forkFiles = readdirSync(piSessionDir).filter((name) => name.endsWith('_' + forked.id + '.jsonl'))
      const forkPiSessionFile = forkFiles.length === 1 ? join(piSessionDir, forkFiles[0]) : null
      const forkLines = forkPiSessionFile ? readFileSync(forkPiSessionFile, 'utf-8').trim().split('\\n').map((line) => JSON.parse(line)) : []

      console.log(JSON.stringify({
        forkId: forked.id,
        forkSourcePiSessionId: forked.forkSourcePiSessionId ?? null,
        piSessionFileCreated: !!forkPiSessionFile && existsSync(forkPiSessionFile),
        header: forkLines[0] ?? null,
        entryIds: forkLines.slice(1).map((entry) => entry.id),
        forkCwd,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('piSessionFileCreated'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      forkId?: string
      forkSourcePiSessionId?: string | null
      piSessionFileCreated?: boolean
      header?: { id?: string; cwd?: string; parentSession?: string }
      entryIds?: string[]
      forkCwd?: string
    }

    expect(result.piSessionFileCreated).toBe(true)
    expect(result.header?.id).toBe(result.forkId)
    expect(result.header?.cwd).toBe(result.forkCwd)
    expect(result.header?.parentSession).toContain(`${result.forkSourcePiSessionId}.jsonl`)
    expect(result.forkSourcePiSessionId).toBeDefined()
    expect(result.entryIds).toEqual(['pi-entry-user-1', 'pi-entry-assistant-1'])
  })

  test('Given pi native session has later entries When forking to Pi entry id Then native child is truncated at that entry', () => {
    const output = runSessionManagerScript(`
      import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
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

      const {
        appendSDKMessages,
        createAgentSession,
        forkAgentSession,
      } = await import('./agent-session-manager.ts')
      const { getAgentSessionWorkspacePath } = await import('./config-paths.ts')

      const source = createAgentSession('Pi native truncate source', 'channel-1', 'workspace-pi', 'pi')
      const sourceCwd = getAgentSessionWorkspacePath('pi', source.id)
      mkdirSync(sourceCwd, { recursive: true })

      const piSessionDir = join(configDir, 'pi-agent-sessions')
      mkdirSync(piSessionDir, { recursive: true })
      const sourcePiSessionFile = join(piSessionDir, '2026-06-02T00-00-00-000Z_' + source.id + '.jsonl')
      writeFileSync(sourcePiSessionFile, [
        JSON.stringify({ type: 'session', version: 3, id: source.id, timestamp: '2026-06-02T00:00:00.000Z', cwd: sourceCwd }),
        JSON.stringify({ type: 'message', id: 'pi-entry-user-1', parentId: null, timestamp: '2026-06-02T00:00:01.000Z', message: { role: 'user', content: 'hello pi' } }),
        JSON.stringify({ type: 'message', id: 'pi-entry-assistant-1', parentId: 'pi-entry-user-1', timestamp: '2026-06-02T00:00:02.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'hello user' }] } }),
        JSON.stringify({ type: 'message', id: 'pi-entry-user-2', parentId: 'pi-entry-assistant-1', timestamp: '2026-06-02T00:00:03.000Z', message: { role: 'user', content: 'continue' } }),
        JSON.stringify({ type: 'message', id: 'pi-entry-assistant-2', parentId: 'pi-entry-user-2', timestamp: '2026-06-02T00:00:04.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'after cut' }] } }),
        '',
      ].join('\\n'), 'utf-8')

      appendSDKMessages(source.id, [
        {
          type: 'user',
          uuid: 'user-1',
          message: { content: 'hello pi' },
          parent_tool_use_id: null,
          session_id: source.id,
        },
        {
          type: 'assistant',
          _promaPiEntryId: 'pi-entry-assistant-1',
          message: { content: [{ type: 'text', text: 'hello user' }] },
          parent_tool_use_id: null,
          session_id: source.id,
        },
        {
          type: 'user',
          uuid: 'user-2',
          message: { content: 'continue' },
          parent_tool_use_id: null,
          session_id: source.id,
        },
        {
          type: 'assistant',
          _promaPiEntryId: 'pi-entry-assistant-2',
          message: { content: [{ type: 'text', text: 'after cut' }] },
          parent_tool_use_id: null,
          session_id: source.id,
        },
      ])

      const forked = await forkAgentSession({
        sessionId: source.id,
        upToMessageUuid: 'pi-entry-assistant-1',
      })
      const forkFiles = readdirSync(piSessionDir).filter((name) => name.endsWith('_' + forked.id + '.jsonl'))
      const forkPiSessionFile = join(piSessionDir, forkFiles[0])
      const forkLines = readFileSync(forkPiSessionFile, 'utf-8').trim().split('\\n').map((line) => JSON.parse(line))

      console.log(JSON.stringify({
        entryIds: forkLines.slice(1).map((entry) => entry.id),
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('entryIds'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      entryIds?: string[]
    }

    expect(result.entryIds).toEqual(['pi-entry-user-1', 'pi-entry-assistant-1'])
  })

  test('Given pi native session has sibling branch entries When forking to Pi entry id Then native child keeps only ancestor path', () => {
    const output = runSessionManagerScript(`
      import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
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

      const {
        appendSDKMessages,
        createAgentSession,
        forkAgentSession,
      } = await import('./agent-session-manager.ts')
      const { getAgentSessionWorkspacePath } = await import('./config-paths.ts')

      const source = createAgentSession('Pi native tree source', 'channel-1', 'workspace-pi', 'pi')
      const sourceCwd = getAgentSessionWorkspacePath('pi', source.id)
      mkdirSync(sourceCwd, { recursive: true })

      const piSessionDir = join(configDir, 'pi-agent-sessions')
      mkdirSync(piSessionDir, { recursive: true })
      const sourcePiSessionFile = join(piSessionDir, '2026-06-02T00-00-00-000Z_' + source.id + '.jsonl')
      writeFileSync(sourcePiSessionFile, [
        JSON.stringify({ type: 'session', version: 3, id: source.id, timestamp: '2026-06-02T00:00:00.000Z', cwd: sourceCwd }),
        JSON.stringify({ type: 'message', id: 'pi-entry-user-1', parentId: null, timestamp: '2026-06-02T00:00:01.000Z', message: { role: 'user', content: 'root' } }),
        JSON.stringify({ type: 'message', id: 'pi-entry-user-sibling', parentId: 'pi-entry-user-1', timestamp: '2026-06-02T00:00:01.500Z', message: { role: 'user', content: 'sibling branch' } }),
        JSON.stringify({ type: 'message', id: 'pi-entry-assistant-sibling', parentId: 'pi-entry-user-sibling', timestamp: '2026-06-02T00:00:01.700Z', message: { role: 'assistant', content: [{ type: 'text', text: 'sibling answer' }] } }),
        JSON.stringify({ type: 'message', id: 'pi-entry-assistant-target', parentId: 'pi-entry-user-1', timestamp: '2026-06-02T00:00:02.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'target answer' }] } }),
        '',
      ].join('\\n'), 'utf-8')

      appendSDKMessages(source.id, [
        {
          type: 'user',
          uuid: 'user-1',
          message: { content: 'root' },
          parent_tool_use_id: null,
          session_id: source.id,
        },
        {
          type: 'assistant',
          _promaPiEntryId: 'pi-entry-assistant-target',
          message: { content: [{ type: 'text', text: 'target answer' }] },
          parent_tool_use_id: null,
          session_id: source.id,
        },
      ])

      const forked = await forkAgentSession({
        sessionId: source.id,
        upToMessageUuid: 'pi-entry-assistant-target',
      })
      const forkFiles = readdirSync(piSessionDir).filter((name) => name.endsWith('_' + forked.id + '.jsonl'))
      const forkPiSessionFile = join(piSessionDir, forkFiles[0])
      const forkLines = readFileSync(forkPiSessionFile, 'utf-8').trim().split('\\n').map((line) => JSON.parse(line))

      console.log(JSON.stringify({
        entryIds: forkLines.slice(1).map((entry) => entry.id),
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('entryIds'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      entryIds?: string[]
    }

    expect(result.entryIds).toEqual(['pi-entry-user-1', 'pi-entry-assistant-target'])
  })

  test('Given pi session has native session file When deleting Then removes only current Pi session file', () => {
    const output = runSessionManagerScript(`
      import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
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

      const {
        createAgentSession,
        deleteAgentSession,
        updateAgentSessionMeta,
      } = await import('./agent-session-manager.ts')
      const { getAgentSessionWorkspacePath } = await import('./config-paths.ts')

      const source = createAgentSession('Pi delete source', 'channel-1', 'workspace-pi', 'pi')
      const session = createAgentSession('Pi delete child', 'channel-1', 'workspace-pi', 'pi')
      const sessionCwd = getAgentSessionWorkspacePath('pi', session.id)
      mkdirSync(sessionCwd, { recursive: true })

      const piSessionDir = join(configDir, 'pi-agent-sessions')
      mkdirSync(piSessionDir, { recursive: true })
      const sourcePiSessionFile = join(piSessionDir, '2026-06-02T00-00-00-000Z_' + source.id + '.jsonl')
      const childPiSessionFile = join(piSessionDir, '2026-06-02T00-00-01-000Z_' + session.id + '.jsonl')
      writeFileSync(sourcePiSessionFile, JSON.stringify({ type: 'session', version: 3, id: source.id, timestamp: '2026-06-02T00:00:00.000Z', cwd: sessionCwd }) + '\\n', 'utf-8')
      writeFileSync(childPiSessionFile, JSON.stringify({ type: 'session', version: 3, id: session.id, timestamp: '2026-06-02T00:00:01.000Z', cwd: sessionCwd, parentSession: sourcePiSessionFile }) + '\\n', 'utf-8')
      updateAgentSessionMeta(session.id, {
        forkSourcePiSessionId: source.id,
        forkSourcePiSessionPath: sourcePiSessionFile,
      })

      deleteAgentSession(session.id)

      console.log(JSON.stringify({
        sourceExists: existsSync(sourcePiSessionFile),
        childExists: existsSync(childPiSessionFile),
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('childExists'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      sourceExists?: boolean
      childExists?: boolean
    }

    expect(result.sourceExists).toBe(true)
    expect(result.childExists).toBe(false)
  })

  test('Given pi session without Claude sdk id When rewinding Then truncates Proma history without SDK snapshot', () => {
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

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')
      const {
        appendSDKMessages,
        createAgentSession,
        getAgentSessionSDKMessages,
      } = await import('./agent-session-manager.ts')

      const source = createAgentSession('Pi rewind', 'channel-1', 'workspace-pi', 'pi')
      appendSDKMessages(source.id, [
        {
          type: 'user',
          uuid: 'user-1',
          message: { content: 'hello pi' },
          parent_tool_use_id: null,
          session_id: source.id,
        },
        {
          type: 'assistant',
          uuid: 'assistant-1',
          message: { content: [{ type: 'text', text: 'hello user' }] },
          parent_tool_use_id: null,
          session_id: source.id,
        },
        {
          type: 'assistant',
          uuid: 'assistant-2',
          message: { content: [{ type: 'text', text: 'after rewind target' }] },
          parent_tool_use_id: null,
          session_id: source.id,
        },
      ])

      const adapter = {
        name: 'pi',
        query: async function* () {},
        abort: () => {},
        dispose: () => {},
      }
      const orchestrator = new AgentOrchestrator(adapter, new AgentEventBus(), 'pi')
      const rewind = await orchestrator.rewindSession(source.id, 'assistant-1')
      const messages = getAgentSessionSDKMessages(source.id)

      console.log(JSON.stringify({
        remainingMessages: rewind.remainingMessages,
        fileRewind: rewind.fileRewind,
        messageUuids: messages.map((message) => message.uuid),
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('remainingMessages'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      remainingMessages?: number
      fileRewind?: { canRewind?: boolean; error?: string; filesChanged?: string[] }
      messageUuids?: string[]
    }

    expect(result.remainingMessages).toBe(2)
    expect(result.messageUuids).toEqual(['user-1', 'assistant-1'])
    expect(result.fileRewind?.canRewind).toBe(false)
    expect(result.fileRewind?.error).toContain('Pi runtime 暂不支持 Claude SDK 文件快照回退')
  })

  test('Given pi session messages with Pi entry ids When rewinding Then accepts Pi entry id as cut point', () => {
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

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')
      const {
        appendSDKMessages,
        createAgentSession,
        getAgentSessionSDKMessages,
      } = await import('./agent-session-manager.ts')

      const source = createAgentSession('Pi rewind entry', 'channel-1', 'workspace-pi', 'pi')
      appendSDKMessages(source.id, [
        {
          type: 'user',
          uuid: 'user-1',
          message: { content: 'hello pi' },
          parent_tool_use_id: null,
          session_id: source.id,
        },
        {
          type: 'assistant',
          _promaPiEntryId: 'pi-entry-assistant-1',
          message: { content: [{ type: 'text', text: 'hello user' }] },
          parent_tool_use_id: null,
          session_id: source.id,
        },
        {
          type: 'assistant',
          _promaPiEntryId: 'pi-entry-assistant-2',
          message: { content: [{ type: 'text', text: 'after rewind target' }] },
          parent_tool_use_id: null,
          session_id: source.id,
        },
      ])

      const adapter = {
        name: 'pi',
        query: async function* () {},
        abort: () => {},
        dispose: () => {},
      }
      const orchestrator = new AgentOrchestrator(adapter, new AgentEventBus(), 'pi')
      const rewind = await orchestrator.rewindSession(source.id, 'pi-entry-assistant-1')
      const messages = getAgentSessionSDKMessages(source.id)

      console.log(JSON.stringify({
        remainingMessages: rewind.remainingMessages,
        messageTexts: messages.map((message) => message.message?.content?.[0]?.text ?? message.message?.content),
        piEntryIds: messages.map((message) => message._promaPiEntryId ?? null),
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('remainingMessages'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      remainingMessages?: number
      messageTexts?: string[]
      piEntryIds?: Array<string | null>
    }

    expect(result.remainingMessages).toBe(2)
    expect(result.messageTexts).toEqual(['hello pi', 'hello user'])
    expect(result.piEntryIds).toEqual([null, 'pi-entry-assistant-1'])
  })

  test('Given pi native session file When rewinding Then prepares next run from rewound Pi branch', () => {
    const output = runSessionManagerScript(`
      import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')
      const {
        appendSDKMessages,
        createAgentSession,
        getAgentSessionMeta,
        getAgentSessionSDKMessages,
      } = await import('./agent-session-manager.ts')

      const source = createAgentSession('Pi native rewind', 'channel-1', 'workspace-pi', 'pi')
      const piSessionDir = join(configDir, 'pi-agent-sessions')
      mkdirSync(piSessionDir, { recursive: true })
      const sourcePiSessionFile = join(piSessionDir, '2026-06-02T00-00-00-000Z_' + source.id + '.jsonl')
      const nativeEntries = [
        { type: 'session', version: 3, id: source.id, timestamp: '2026-06-02T00:00:00.000Z', cwd: '/tmp/source-cwd' },
        { type: 'message', id: 'pi-entry-user-1', timestamp: '2026-06-02T00:00:01.000Z', message: { role: 'user', content: 'first prompt' } },
        { type: 'custom', id: 'checkpoint-entry-1', parentId: 'pi-entry-user-1', timestamp: '2026-06-02T00:00:01.500Z', customType: 'proma-git-checkpoint', data: { targetEntryId: 'pi-entry-user-1', gitRef: 'abc123', cwd: '/tmp/source-cwd' } },
        { type: 'message', id: 'pi-entry-assistant-1', parentId: 'checkpoint-entry-1', timestamp: '2026-06-02T00:00:02.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'first answer' }] } },
        { type: 'message', id: 'pi-entry-user-2', parentId: 'pi-entry-assistant-1', timestamp: '2026-06-02T00:00:03.000Z', message: { role: 'user', content: 'second prompt' } },
        { type: 'message', id: 'pi-entry-assistant-2', parentId: 'pi-entry-user-2', timestamp: '2026-06-02T00:00:04.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'second answer' }] } },
      ]
      writeFileSync(sourcePiSessionFile, nativeEntries.map((entry) => JSON.stringify(entry)).join('\\n') + '\\n', 'utf-8')

      appendSDKMessages(source.id, [
        {
          type: 'user',
          _promaPiEntryId: 'pi-entry-user-1',
          message: { content: 'first prompt' },
          parent_tool_use_id: null,
          session_id: source.id,
        },
        {
          type: 'assistant',
          _promaPiEntryId: 'pi-entry-assistant-1',
          message: { content: [{ type: 'text', text: 'first answer' }] },
          parent_tool_use_id: null,
          session_id: source.id,
        },
        {
          type: 'user',
          _promaPiEntryId: 'pi-entry-user-2',
          message: { content: 'second prompt' },
          parent_tool_use_id: null,
          session_id: source.id,
        },
        {
          type: 'assistant',
          _promaPiEntryId: 'pi-entry-assistant-2',
          message: { content: [{ type: 'text', text: 'second answer' }] },
          parent_tool_use_id: null,
          session_id: source.id,
        },
      ])

      const adapter = {
        name: 'pi',
        query: async function* () {},
        abort: () => {},
        dispose: () => {},
      }
      const orchestrator = new AgentOrchestrator(adapter, new AgentEventBus(), 'pi')
      const rewind = await orchestrator.rewindSession(source.id, 'pi-entry-assistant-1')
      const updated = getAgentSessionMeta(source.id)
      const nextRunPath = updated?.forkSourcePiSessionPath
      const rewindEntries = nextRunPath && existsSync(nextRunPath)
        ? readFileSync(nextRunPath, 'utf-8').trim().split(/\\r?\\n/).map((line) => JSON.parse(line))
        : []
      const messages = getAgentSessionSDKMessages(source.id)

      console.log(JSON.stringify({
        remainingMessages: rewind.remainingMessages,
        nextRunPath,
        forkSourcePiSessionId: updated?.forkSourcePiSessionId,
        headerParent: rewindEntries[0]?.parentSession,
        entryIds: rewindEntries.filter((entry) => entry.type === 'message').map((entry) => entry.id),
        customEntryIds: rewindEntries.filter((entry) => entry.type === 'custom').map((entry) => entry.id),
        messageEntryIds: messages.map((message) => message._promaPiEntryId ?? null),
        fileRewind: rewind.fileRewind,
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('nextRunPath'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      remainingMessages?: number
      nextRunPath?: string
      forkSourcePiSessionId?: string
      headerParent?: string
      entryIds?: string[]
      customEntryIds?: string[]
      messageEntryIds?: Array<string | null>
      fileRewind?: {
        canRewind?: boolean
        error?: string
        checkpoint?: { entryId?: string; targetEntryId?: string; gitRef?: string; cwd?: string }
      }
    }

    expect(result.remainingMessages).toBe(2)
    expect(result.nextRunPath).toContain('rewind')
    expect(result.forkSourcePiSessionId).toBeDefined()
    expect(result.headerParent).toContain('2026-06-02T00-00-00-000Z')
    expect(result.entryIds).toEqual(['pi-entry-user-1', 'pi-entry-assistant-1'])
    expect(result.customEntryIds).toEqual(['checkpoint-entry-1'])
    expect(result.messageEntryIds).toEqual(['pi-entry-user-1', 'pi-entry-assistant-1'])
    expect(result.fileRewind?.canRewind).toBe(false)
    expect(result.fileRewind?.error).toContain('Proma 已找到 Pi git checkpoint')
    expect(result.fileRewind?.checkpoint).toEqual({
      entryId: 'checkpoint-entry-1',
      targetEntryId: 'pi-entry-user-1',
      gitRef: 'abc123',
      cwd: '/tmp/source-cwd',
    })
  })

  test('Given pi rewind checkpoint When applying through service Then restores using persisted native checkpoint', () => {
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

      const {
        createAgentSession,
        updateAgentSessionMeta,
      } = await import('./agent-session-manager.ts')
      const { applyPiGitCheckpointForSession } = await import('./agent-service.ts')

      const source = createAgentSession('Pi checkpoint restore', 'channel-1', 'workspace-pi', 'pi')
      const piSessionDir = join(configDir, 'pi-agent-sessions')
      mkdirSync(piSessionDir, { recursive: true })
      const sourcePiSessionFile = join(piSessionDir, '2026-06-02T00-00-00-000Z_' + source.id + '.jsonl')
      writeFileSync(sourcePiSessionFile, [
        JSON.stringify({ type: 'session', version: 3, id: source.id, timestamp: '2026-06-02T00:00:00.000Z', cwd: '/tmp/work' }),
        JSON.stringify({ type: 'message', id: 'pi-entry-user-1', parentId: null, message: { role: 'user', content: 'first prompt' } }),
        JSON.stringify({ type: 'custom', id: 'checkpoint-entry-1', parentId: 'pi-entry-user-1', customType: 'proma-git-checkpoint', data: { targetEntryId: 'pi-entry-user-1', gitRef: 'abc123', cwd: '/tmp/work' } }),
        JSON.stringify({ type: 'message', id: 'pi-entry-assistant-1', parentId: 'checkpoint-entry-1', message: { role: 'assistant', content: [] } }),
        '',
      ].join('\\n'), 'utf-8')
      updateAgentSessionMeta(source.id, {
        forkSourcePiSessionPath: sourcePiSessionFile,
        forkSourcePiSessionId: source.id,
      })

      const calls = []
      const result = applyPiGitCheckpointForSession({
        sessionId: source.id,
        targetEntryId: 'pi-entry-assistant-1',
      }, (cwd, args) => {
        calls.push({ cwd, args })
        return { status: 0, stdout: '', stderr: '' }
      })

      console.log(JSON.stringify({ result, calls }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('calls'))
    const parsed = JSON.parse(jsonLine ?? '{}') as {
      result?: {
        restored?: boolean
        checkpoint?: { entryId?: string; targetEntryId?: string; gitRef?: string; cwd?: string }
      }
      calls?: Array<{ cwd: string; args: string[] }>
    }

    expect(parsed.result?.restored).toBe(true)
    expect(parsed.result?.checkpoint).toEqual({
      entryId: 'checkpoint-entry-1',
      targetEntryId: 'pi-entry-user-1',
      gitRef: 'abc123',
      cwd: '/tmp/work',
    })
    expect(parsed.calls).toEqual([
      { cwd: '/tmp/work', args: ['status', '--porcelain'] },
      { cwd: '/tmp/work', args: ['stash', 'apply', 'abc123'] },
      { cwd: '/tmp/work', args: ['diff', '--name-only'] },
    ])
  })

  test('Given pi session When rewinding through agent service Then uses Pi compatible history rewind', () => {
    const output = runSessionManagerScript(`
      import { mkdirSync, writeFileSync } from 'node:fs'
      import { join } from 'node:path'
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: {
          getFocusedWindow: () => null,
          getAllWindows: () => [],
        },
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

      const {
        appendSDKMessages,
        createAgentSession,
        getAgentSessionSDKMessages,
      } = await import('./agent-session-manager.ts')
      const { rewindAgentSession } = await import('./agent-service.ts')

      const source = createAgentSession('Pi service rewind', 'channel-1', 'workspace-pi', 'pi')
      appendSDKMessages(source.id, [
        {
          type: 'user',
          uuid: 'user-1',
          message: { content: 'hello pi' },
          parent_tool_use_id: null,
          session_id: source.id,
        },
        {
          type: 'assistant',
          _promaPiEntryId: 'pi-entry-assistant-1',
          message: { content: [{ type: 'text', text: 'hello user' }] },
          parent_tool_use_id: null,
          session_id: source.id,
        },
        {
          type: 'assistant',
          _promaPiEntryId: 'pi-entry-assistant-2',
          message: { content: [{ type: 'text', text: 'after target' }] },
          parent_tool_use_id: null,
          session_id: source.id,
        },
      ])

      const rewind = await rewindAgentSession(source.id, 'pi-entry-assistant-1')
      const messages = getAgentSessionSDKMessages(source.id)

      console.log(JSON.stringify({
        remainingMessages: rewind.remainingMessages,
        fileRewind: rewind.fileRewind,
        piEntryIds: messages.map((message) => message._promaPiEntryId ?? null),
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('remainingMessages'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      remainingMessages?: number
      fileRewind?: { canRewind?: boolean; error?: string }
      piEntryIds?: Array<string | null>
    }

    expect(result.remainingMessages).toBe(2)
    expect(result.fileRewind?.canRewind).toBe(false)
    expect(result.fileRewind?.error).toContain('Pi runtime 暂不支持 Claude SDK 文件快照回退')
    expect(result.piEntryIds).toEqual([null, 'pi-entry-assistant-1'])
  })

  test('Given active pi session When cloning through agent service Then creates Proma session bound to pi engine', () => {
    const output = runSessionManagerScript(`
      import { mkdirSync, writeFileSync } from 'node:fs'
      import { join } from 'node:path'
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: {
          getFocusedWindow: () => null,
          getAllWindows: () => [],
        },
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

      const { createAgentSession, listAgentSessions } = await import('./agent-session-manager.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')
      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const {
        cloneActiveAgentSession,
        __testTrackActiveSessionOrchestrator,
        __testReleaseActiveSessionOrchestrator,
      } = await import('./agent-service.ts')

      const source = createAgentSession('Pi source', 'channel-1', 'workspace-pi', 'pi')
      const adapter = {
        query: async function* () {},
        abort: () => {},
        dispose: () => {},
        clone: async (sessionId) => {
          if (sessionId !== source.id) throw new Error('unexpected session id')
          return {
            cancelled: false,
            sessionId: 'pi-native-clone-id',
            sessionPath: '/tmp/pi-native-clone.jsonl',
          }
        },
      }
      const orchestrator = new AgentOrchestrator(adapter, new AgentEventBus(), 'pi')
      __testTrackActiveSessionOrchestrator(source.id, orchestrator)

      try {
        const cloned = await cloneActiveAgentSession(source.id)
        const sessions = listAgentSessions()
        console.log(JSON.stringify({
          cloned,
          sessionCount: sessions.length,
        }))
      } finally {
        __testReleaseActiveSessionOrchestrator(source.id, orchestrator)
      }
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('sessionCount'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      cloned?: {
        id?: string
        title?: string
        channelId?: string
        workspaceId?: string
        agentEngine?: string
        forkSourcePiSessionId?: string
        forkSourcePiSessionPath?: string
      }
      sessionCount?: number
    }

    expect(result.sessionCount).toBe(2)
    expect(result.cloned?.id).toBeString()
    expect(result.cloned?.title).toBe('Pi source (clone)')
    expect(result.cloned?.channelId).toBe('channel-1')
    expect(result.cloned?.workspaceId).toBe('workspace-pi')
    expect(result.cloned?.agentEngine).toBe('pi')
    expect(result.cloned?.forkSourcePiSessionId).toBe('pi-native-clone-id')
    expect(result.cloned?.forkSourcePiSessionPath).toBe('/tmp/pi-native-clone.jsonl')
  })

  test('Given active pi session When runtime clone is cancelled Then does not create Proma session', () => {
    const output = runSessionManagerScript(`
      import { mkdirSync, writeFileSync } from 'node:fs'
      import { join } from 'node:path'
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: {
          getFocusedWindow: () => null,
          getAllWindows: () => [],
        },
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

      const { createAgentSession, listAgentSessions } = await import('./agent-session-manager.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')
      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const {
        cloneActiveAgentSession,
        __testTrackActiveSessionOrchestrator,
        __testReleaseActiveSessionOrchestrator,
      } = await import('./agent-service.ts')

      const source = createAgentSession('Pi source', 'channel-1', 'workspace-pi', 'pi')
      const adapter = {
        query: async function* () {},
        abort: () => {},
        dispose: () => {},
        clone: async () => ({ cancelled: true }),
      }
      const orchestrator = new AgentOrchestrator(adapter, new AgentEventBus(), 'pi')
      __testTrackActiveSessionOrchestrator(source.id, orchestrator)

      try {
        await cloneActiveAgentSession(source.id)
      } catch (error) {
        console.log(JSON.stringify({
          errorMessage: error instanceof Error ? error.message : String(error),
          sessionCount: listAgentSessions().length,
        }))
      } finally {
        __testReleaseActiveSessionOrchestrator(source.id, orchestrator)
      }
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('sessionCount'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      errorMessage?: string
      sessionCount?: number
    }

    expect(result.errorMessage).toContain('Pi runtime clone 已取消')
    expect(result.sessionCount).toBe(1)
  })

  test('Given active pi session When forking through agent service Then binds new Proma session to native runtime fork', () => {
    const output = runSessionManagerScript(`
      import { mkdirSync, writeFileSync } from 'node:fs'
      import { join } from 'node:path'
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: {
          getFocusedWindow: () => null,
          getAllWindows: () => [],
        },
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

      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')
      const {
        __testTrackActiveSessionOrchestrator,
        __testReleaseActiveSessionOrchestrator,
        forkAgentSession,
      } = await import('./agent-service.ts')
      const {
        appendSDKMessages,
        createAgentSession,
        listAgentSessions,
      } = await import('./agent-session-manager.ts')

      const source = createAgentSession('Pi source', 'channel-1', 'workspace-pi', 'pi')
      appendSDKMessages(source.id, [
        {
          type: 'user',
          _promaPiEntryId: 'pi-entry-user-1',
          message: { content: 'first prompt' },
          parent_tool_use_id: null,
          session_id: source.id,
        },
        {
          type: 'assistant',
          _promaPiEntryId: 'pi-entry-assistant-1',
          message: { content: [{ type: 'text', text: 'first answer' }] },
          parent_tool_use_id: null,
          session_id: source.id,
        },
        {
          type: 'assistant',
          _promaPiEntryId: 'pi-entry-assistant-2',
          message: { content: [{ type: 'text', text: 'second answer' }] },
          parent_tool_use_id: null,
          session_id: source.id,
        },
      ])

      const forkCalls = []
      const adapter = {
        query: async function* () {},
        abort: () => {},
        dispose: () => {},
        fork: async (sessionId, entryId) => {
          forkCalls.push({ sessionId, entryId })
          return {
            cancelled: false,
            text: 'first answer',
            sessionId: 'pi-native-fork-id',
            sessionPath: '/tmp/pi-native-fork.jsonl',
          }
        },
      }
      const orchestrator = new AgentOrchestrator(adapter, new AgentEventBus(), 'pi')
      __testTrackActiveSessionOrchestrator(source.id, orchestrator)

      try {
        const forked = await forkAgentSession({
          sessionId: source.id,
          upToMessageUuid: 'pi-entry-assistant-1',
        })
        const sessions = listAgentSessions()
        console.log(JSON.stringify({
          forked,
          sessionCount: sessions.length,
          forkCalls,
        }))
      } finally {
        __testReleaseActiveSessionOrchestrator(source.id, orchestrator)
      }
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('forkCalls'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      forked?: {
        id?: string
        title?: string
        agentEngine?: string
        forkSourcePiSessionId?: string
        forkSourcePiSessionPath?: string
      }
      sessionCount?: number
      forkCalls?: Array<{ sessionId?: string; entryId?: string }>
    }

    expect(result.sessionCount).toBe(2)
    expect(result.forkCalls?.[0]?.sessionId).toBeString()
    expect(result.forkCalls?.[0]?.entryId).toBe('pi-entry-assistant-1')
    expect(result.forked?.title).toBe('Pi source (fork)')
    expect(result.forked?.agentEngine).toBe('pi')
    expect(result.forked?.forkSourcePiSessionId).toBe('pi-native-fork-id')
    expect(result.forked?.forkSourcePiSessionPath).toBe('/tmp/pi-native-fork.jsonl')
  })

  test('Given active pi session When switching native session through agent service Then persists Pi session path', () => {
    const output = runSessionManagerScript(`
      import { mkdirSync, writeFileSync } from 'node:fs'
      import { join } from 'node:path'
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: {
          getFocusedWindow: () => null,
          getAllWindows: () => [],
        },
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

      const { createAgentSession, getAgentSessionMeta } = await import('./agent-session-manager.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')
      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const {
        switchActiveAgentSession,
        __testTrackActiveSessionOrchestrator,
        __testReleaseActiveSessionOrchestrator,
      } = await import('./agent-service.ts')

      const source = createAgentSession('Pi source', 'channel-1', 'workspace-pi', 'pi')
      const adapter = {
        query: async function* () {},
        abort: () => {},
        dispose: () => {},
        switchSession: async (sessionId, sessionPath) => {
          if (sessionId !== source.id) throw new Error('unexpected session id')
          if (sessionPath !== '/tmp/pi-target-session.jsonl') throw new Error('unexpected session path')
          return {
            cancelled: false,
          }
        },
      }
      const orchestrator = new AgentOrchestrator(adapter, new AgentEventBus(), 'pi')
      __testTrackActiveSessionOrchestrator(source.id, orchestrator)

      try {
        const switched = await switchActiveAgentSession({
          sessionId: source.id,
          sessionPath: '/tmp/pi-target-session.jsonl',
        })
        const persisted = getAgentSessionMeta(source.id)
        console.log(JSON.stringify({ switched, persisted }))
      } finally {
        __testReleaseActiveSessionOrchestrator(source.id, orchestrator)
      }
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('persisted'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      switched?: {
        id?: string
        forkSourcePiSessionPath?: string
      }
      persisted?: {
        forkSourcePiSessionPath?: string
      }
    }

    expect(result.switched?.id).toBeString()
    expect(result.switched?.forkSourcePiSessionPath).toBe('/tmp/pi-target-session.jsonl')
    expect(result.persisted?.forkSourcePiSessionPath).toBe('/tmp/pi-target-session.jsonl')
  })

  test('Given active pi session file has header When switching native session Then persists Pi native session id', () => {
    const output = runSessionManagerScript(`
      import { mkdirSync, writeFileSync } from 'node:fs'
      import { join } from 'node:path'
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: {
          getFocusedWindow: () => null,
          getAllWindows: () => [],
        },
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

      const nativeSessionPath = join(process.env.HOME, 'pi-target-session.jsonl')
      writeFileSync(nativeSessionPath, [
        JSON.stringify({
          type: 'session',
          version: 3,
          id: 'pi-native-imported-id',
          timestamp: '2026-06-02T00:00:00.000Z',
          cwd: process.env.HOME,
        }),
        JSON.stringify({
          type: 'message',
          id: 'entry-1',
          parentId: null,
          timestamp: '2026-06-02T00:00:01.000Z',
          message: { role: 'user', content: 'hello' },
        }),
      ].join('\\n') + '\\n')

      const { createAgentSession, getAgentSessionMeta } = await import('./agent-session-manager.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')
      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const {
        switchActiveAgentSession,
        __testTrackActiveSessionOrchestrator,
        __testReleaseActiveSessionOrchestrator,
      } = await import('./agent-service.ts')

      const source = createAgentSession('Pi source', 'channel-1', 'workspace-pi', 'pi')
      const adapter = {
        query: async function* () {},
        abort: () => {},
        dispose: () => {},
        switchSession: async () => ({ cancelled: false }),
      }
      const orchestrator = new AgentOrchestrator(adapter, new AgentEventBus(), 'pi')
      __testTrackActiveSessionOrchestrator(source.id, orchestrator)

      try {
        const switched = await switchActiveAgentSession({
          sessionId: source.id,
          sessionPath: nativeSessionPath,
        })
        const persisted = getAgentSessionMeta(source.id)
        console.log(JSON.stringify({ switched, persisted, nativeSessionPath }))
      } finally {
        __testReleaseActiveSessionOrchestrator(source.id, orchestrator)
      }
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('nativeSessionPath'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      nativeSessionPath?: string
      switched?: {
        forkSourcePiSessionId?: string
        forkSourcePiSessionPath?: string
      }
      persisted?: {
        forkSourcePiSessionId?: string
        forkSourcePiSessionPath?: string
      }
    }

    expect(result.switched?.forkSourcePiSessionPath).toBe(result.nativeSessionPath)
    expect(result.switched?.forkSourcePiSessionId).toBe('pi-native-imported-id')
    expect(result.persisted?.forkSourcePiSessionId).toBe('pi-native-imported-id')
  })

  test('Given inactive pi session When setting native session file for next run Then persists Pi session path without active runtime', () => {
    const output = runSessionManagerScript(`
      import { mkdirSync, writeFileSync } from 'node:fs'
      import { join } from 'node:path'
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: {
          getFocusedWindow: () => null,
          getAllWindows: () => [],
        },
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

      const { createAgentSession, getAgentSessionMeta } = await import('./agent-session-manager.ts')
      const { setPiSessionFileForNextRun } = await import('./agent-service.ts')

      const source = createAgentSession('Pi source', 'channel-1', 'workspace-pi', 'pi')
      const updated = await setPiSessionFileForNextRun({
        sessionId: source.id,
        sessionPath: '/tmp/pi-imported-session.jsonl',
      })
      const persisted = getAgentSessionMeta(source.id)
      console.log(JSON.stringify({ updated, persisted }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('persisted'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      updated?: {
        id?: string
        forkSourcePiSessionPath?: string
      }
      persisted?: {
        forkSourcePiSessionPath?: string
      }
    }

    expect(result.updated?.id).toBeString()
    expect(result.updated?.forkSourcePiSessionPath).toBe('/tmp/pi-imported-session.jsonl')
    expect(result.persisted?.forkSourcePiSessionPath).toBe('/tmp/pi-imported-session.jsonl')
  })

  test('Given inactive pi session file has header When setting next run file Then persists Pi native session id', () => {
    const output = runSessionManagerScript(`
      import { mkdirSync, writeFileSync } from 'node:fs'
      import { join } from 'node:path'
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: {
          getFocusedWindow: () => null,
          getAllWindows: () => [],
        },
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

      const nativeSessionPath = join(process.env.HOME, 'pi-imported-session.jsonl')
      writeFileSync(nativeSessionPath, JSON.stringify({
        type: 'session',
        version: 3,
        id: 'pi-native-next-run-id',
        timestamp: '2026-06-02T00:00:00.000Z',
        cwd: process.env.HOME,
      }) + '\\n')

      const { createAgentSession, getAgentSessionMeta } = await import('./agent-session-manager.ts')
      const { setPiSessionFileForNextRun } = await import('./agent-service.ts')

      const source = createAgentSession('Pi source', 'channel-1', 'workspace-pi', 'pi')
      const updated = await setPiSessionFileForNextRun({
        sessionId: source.id,
        sessionPath: nativeSessionPath,
      })
      const persisted = getAgentSessionMeta(source.id)
      console.log(JSON.stringify({ updated, persisted, nativeSessionPath }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('nativeSessionPath'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      nativeSessionPath?: string
      updated?: {
        forkSourcePiSessionId?: string
        forkSourcePiSessionPath?: string
      }
      persisted?: {
        forkSourcePiSessionId?: string
        forkSourcePiSessionPath?: string
      }
    }

    expect(result.updated?.forkSourcePiSessionPath).toBe(result.nativeSessionPath)
    expect(result.updated?.forkSourcePiSessionId).toBe('pi-native-next-run-id')
    expect(result.persisted?.forkSourcePiSessionId).toBe('pi-native-next-run-id')
  })

  test('Given inactive pi session has default title When setting next run file Then title uses first Pi user message', () => {
    const output = runSessionManagerScript(`
      import { mkdirSync, writeFileSync } from 'node:fs'
      import { join } from 'node:path'
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: {
          getFocusedWindow: () => null,
          getAllWindows: () => [],
        },
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

      const nativeSessionPath = join(process.env.HOME, 'pi-default-title-session.jsonl')
      writeFileSync(nativeSessionPath, [
        JSON.stringify({
          type: 'session',
          version: 3,
          id: 'pi-native-title-id',
          timestamp: '2026-06-02T00:00:00.000Z',
          cwd: process.env.HOME,
        }),
        JSON.stringify({
          type: 'message',
          id: 'entry-user-title',
          parentId: null,
          timestamp: '2026-06-02T00:00:01.000Z',
          message: { role: 'user', content: '请帮我修复登录页面的表单校验问题，并补充测试' },
        }),
      ].join('\\n') + '\\n')

      const { createAgentSession, getAgentSessionMeta } = await import('./agent-session-manager.ts')
      const { setPiSessionFileForNextRun } = await import('./agent-service.ts')

      const source = createAgentSession(undefined, 'channel-1', 'workspace-pi', 'pi')
      const updated = await setPiSessionFileForNextRun({
        sessionId: source.id,
        sessionPath: nativeSessionPath,
      })
      const persisted = getAgentSessionMeta(source.id)
      console.log(JSON.stringify({ initialTitle: source.title, updated, persisted }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('initialTitle'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      initialTitle?: string
      updated?: { title?: string }
      persisted?: { title?: string }
    }

    expect(result.initialTitle).toBe('新 Agent 会话')
    expect(result.updated?.title).toBe('请帮我修复登录页面的表单校验问题，并补充')
    expect(result.persisted?.title).toBe('请帮我修复登录页面的表单校验问题，并补充')
  })

  test('Given inactive pi session has manual title When setting next run file Then keeps manual title', () => {
    const output = runSessionManagerScript(`
      import { mkdirSync, writeFileSync } from 'node:fs'
      import { join } from 'node:path'
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: {
          getFocusedWindow: () => null,
          getAllWindows: () => [],
        },
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

      const nativeSessionPath = join(process.env.HOME, 'pi-manual-title-session.jsonl')
      writeFileSync(nativeSessionPath, [
        JSON.stringify({
          type: 'session',
          version: 3,
          id: 'pi-native-manual-title-id',
          timestamp: '2026-06-02T00:00:00.000Z',
          cwd: process.env.HOME,
        }),
        JSON.stringify({
          type: 'message',
          id: 'entry-user-title',
          parentId: null,
          timestamp: '2026-06-02T00:00:01.000Z',
          message: { role: 'user', content: '这段内容不应该覆盖手动标题' },
        }),
      ].join('\\n') + '\\n')

      const { createAgentSession, getAgentSessionMeta } = await import('./agent-session-manager.ts')
      const { setPiSessionFileForNextRun } = await import('./agent-service.ts')

      const source = createAgentSession('我的手动标题', 'channel-1', 'workspace-pi', 'pi')
      const updated = await setPiSessionFileForNextRun({
        sessionId: source.id,
        sessionPath: nativeSessionPath,
      })
      const persisted = getAgentSessionMeta(source.id)
      console.log(JSON.stringify({ updated, persisted }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('persisted'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      updated?: { title?: string }
      persisted?: { title?: string }
    }

    expect(result.updated?.title).toBe('我的手动标题')
    expect(result.persisted?.title).toBe('我的手动标题')
  })

  test('Given claude session When setting Pi native session file Then rejects runtime mismatch', () => {
    const output = runSessionManagerScript(`
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: {
          getFocusedWindow: () => null,
          getAllWindows: () => [],
        },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      const { createAgentSession } = await import('./agent-session-manager.ts')
      const { setPiSessionFileForNextRun } = await import('./agent-service.ts')

      const source = createAgentSession('Claude source', 'channel-1', undefined, 'claude-sdk')
      try {
        await setPiSessionFileForNextRun({
          sessionId: source.id,
          sessionPath: '/tmp/pi-imported-session.jsonl',
        })
      } catch (error) {
        console.log(JSON.stringify({
          errorMessage: error instanceof Error ? error.message : String(error),
        }))
      }
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('errorMessage'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      errorMessage?: string
    }

    expect(result.errorMessage).toContain('当前仅 Pi Agent RPC 支持设置原生 session 文件')
  })

  test('Given Pi native session files When listing native sessions Then returns sorted summaries and skips invalid files', () => {
    const output = runSessionManagerScript(`
      import { mkdirSync, writeFileSync } from 'node:fs'
      import { join } from 'node:path'
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: {
          getFocusedWindow: () => null,
          getAllWindows: () => [],
        },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      const configDir = join(process.env.HOME, '.proma')
      const piSessionDir = join(configDir, 'pi-agent-sessions')
      mkdirSync(piSessionDir, { recursive: true })

      const oldPath = join(piSessionDir, '2026-06-01T00-00-00-000Z_pi-old.jsonl')
      writeFileSync(oldPath, [
        JSON.stringify({ type: 'session', version: 3, id: 'pi-old', timestamp: '2026-06-01T00:00:00.000Z', cwd: '/tmp/old' }),
        JSON.stringify({ type: 'message', id: 'old-user', parentId: null, timestamp: '2026-06-01T00:00:01.000Z', message: { role: 'user', content: 'old prompt' } }),
        '',
      ].join('\\n'))

      const newPath = join(piSessionDir, '2026-06-02T00-00-00-000Z_pi-new.jsonl')
      writeFileSync(newPath, [
        JSON.stringify({ type: 'session', version: 3, id: 'pi-new', timestamp: '2026-06-02T00:00:00.000Z', cwd: '/tmp/new', parentSession: oldPath }),
        JSON.stringify({ type: 'message', id: 'new-user', parentId: null, timestamp: '2026-06-02T00:00:01.000Z', message: { role: 'user', content: [{ type: 'text', text: 'new prompt from blocks' }] } }),
        JSON.stringify({ type: 'message', id: 'new-assistant', parentId: 'new-user', timestamp: '2026-06-02T00:00:02.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'answer' }] } }),
        JSON.stringify({ type: 'message', id: 'new-sibling', parentId: 'new-user', timestamp: '2026-06-02T00:00:03.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'sibling answer' }] } }),
        JSON.stringify({ type: 'session_info', id: 'new-name', parentId: 'new-assistant', timestamp: '2026-06-02T00:00:04.000Z', name: 'Named Pi session' }),
        '',
      ].join('\\n'))

      writeFileSync(join(piSessionDir, 'broken.jsonl'), '{not valid json}\\n')
      writeFileSync(join(piSessionDir, 'notes.txt'), 'not a session')

      const oldTime = new Date('2026-06-01T00:00:00.000Z')
      const newTime = new Date('2026-06-02T00:00:00.000Z')
      await import('node:fs/promises').then(async ({ utimes }) => {
        await utimes(oldPath, oldTime, oldTime)
        await utimes(newPath, newTime, newTime)
      })

      const { listPiNativeSessions } = await import('./agent-session-manager.ts')
      const sessions = listPiNativeSessions()
      console.log(JSON.stringify({ sessions }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('sessions'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      sessions?: Array<{
        id?: string
        path?: string
        cwd?: string
        firstUserMessage?: string
        lastMessagePreview?: string
        sessionName?: string
        leafEntryId?: string
        branchEntryCount?: number
        messageCount?: number
        parentSession?: string
        updatedAt?: number
      }>
    }

    expect(result.sessions?.map((session) => session.id)).toEqual(['pi-new', 'pi-old'])
    expect(result.sessions?.[0]?.cwd).toBe('/tmp/new')
    expect(result.sessions?.[0]?.sessionName).toBe('Named Pi session')
    expect(result.sessions?.[0]?.leafEntryId).toBe('new-name')
    expect(result.sessions?.[0]?.branchEntryCount).toBe(3)
    expect(result.sessions?.[0]?.firstUserMessage).toBe('new prompt from blocks')
    expect(result.sessions?.[0]?.lastMessagePreview).toBe('sibling answer')
    expect(result.sessions?.[0]?.messageCount).toBe(3)
    expect(result.sessions?.[0]?.parentSession).toBe(result.sessions?.[1]?.path)
    expect(result.sessions?.[0]?.updatedAt).toBeGreaterThan(result.sessions?.[1]?.updatedAt ?? 0)
    expect(result.sessions?.[1]?.firstUserMessage).toBe('old prompt')
    expect(result.sessions?.[1]?.lastMessagePreview).toBe('old prompt')
    expect(result.sessions).toHaveLength(2)
  })

  test('Given Pi native session file When loading SDK messages Then returns Proma display messages', () => {
    const output = runSessionManagerScript(`
      import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
      import { join } from 'node:path'
      import { tmpdir } from 'node:os'
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: {
          getFocusedWindow: () => null,
          getAllWindows: () => [],
        },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      const dir = mkdtempSync(join(tmpdir(), 'proma-pi-native-load-'))
      const sessionPath = join(dir, 'native.jsonl')
      writeFileSync(sessionPath, [
        JSON.stringify({ type: 'session', version: 3, id: 'pi-native', timestamp: '2026-06-02T00:00:00.000Z', cwd: dir }),
        JSON.stringify({ type: 'message', id: 'user-1', parentId: null, timestamp: '2026-06-02T00:00:01.000Z', message: { role: 'user', content: 'hello pi' } }),
        JSON.stringify({ type: 'message', id: 'assistant-1', parentId: 'user-1', timestamp: '2026-06-02T00:00:02.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'hello user' }], model: 'deepseek-v4-flash' } }),
        JSON.stringify({ type: 'message', id: 'tool-1', parentId: 'assistant-1', timestamp: '2026-06-02T00:00:03.000Z', message: { role: 'toolResult', toolCallId: 'call-1', toolName: 'read', content: [{ type: 'text', text: 'ok' }], isError: false } }),
        '',
      ].join('\\n'))

      const { loadPiNativeSessionSDKMessages } = await import('./agent-session-manager.ts')
      const messages = loadPiNativeSessionSDKMessages(sessionPath, 'proma-session')
      console.log(JSON.stringify({ messages }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('messages'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      messages?: Array<{
        type?: string
        session_id?: string
        _promaPiEntryId?: string
        message?: { content?: Array<{ type?: string; text?: string; tool_use_id?: string }> }
      }>
    }

    expect(result.messages?.map((message) => message.type)).toEqual(['user', 'assistant', 'user'])
    expect(result.messages?.map((message) => message._promaPiEntryId)).toEqual(['user-1', 'assistant-1', 'tool-1'])
    expect(result.messages?.[0]?.session_id).toBe('proma-session')
    expect(result.messages?.[1]?.message?.content?.[0]?.text).toBe('hello user')
    expect(result.messages?.[2]?.message?.content?.[0]?.tool_use_id).toBe('call-1')
  })

  test('Given Pi native session file and leaf id When loading SDK messages Then returns only branch path messages', () => {
    const output = runSessionManagerScript(`
      import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
      import { join } from 'node:path'
      import { tmpdir } from 'node:os'
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: {
          getFocusedWindow: () => null,
          getAllWindows: () => [],
        },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      const dir = mkdtempSync(join(tmpdir(), 'proma-pi-native-branch-load-'))
      const sessionPath = join(dir, 'native.jsonl')
      writeFileSync(sessionPath, [
        JSON.stringify({ type: 'session', version: 3, id: 'pi-native', timestamp: '2026-06-02T00:00:00.000Z', cwd: dir }),
        JSON.stringify({ type: 'message', id: 'root-user', parentId: null, timestamp: '2026-06-02T00:00:01.000Z', message: { role: 'user', content: 'root prompt' } }),
        JSON.stringify({ type: 'message', id: 'sibling-assistant', parentId: 'root-user', timestamp: '2026-06-02T00:00:02.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'sibling answer' }] } }),
        JSON.stringify({ type: 'message', id: 'target-assistant', parentId: 'root-user', timestamp: '2026-06-02T00:00:03.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'target answer' }] } }),
        '',
      ].join('\\n'))

      const { loadPiNativeSessionSDKMessages } = await import('./agent-session-manager.ts')
      const messages = loadPiNativeSessionSDKMessages(sessionPath, 'proma-session', 'target-assistant')
      console.log(JSON.stringify({ messages }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('messages'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      messages?: Array<{ _promaPiEntryId?: string }>
    }

    expect(result.messages?.map((message) => message._promaPiEntryId)).toEqual(['root-user', 'target-assistant'])
    expect(JSON.stringify(result.messages)).not.toContain('sibling answer')
  })

  test('Given Pi session with existing imported entries When syncing Pi native history Then appends only missing branch messages', () => {
    const output = runSessionManagerScript(`
      import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
      import { join } from 'node:path'
      import { tmpdir } from 'node:os'
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: {
          getFocusedWindow: () => null,
          getAllWindows: () => [],
        },
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

      const dir = mkdtempSync(join(tmpdir(), 'proma-pi-native-sync-'))
      const sessionPath = join(dir, 'native.jsonl')
      writeFileSync(sessionPath, [
        JSON.stringify({ type: 'session', version: 3, id: 'pi-native', timestamp: '2026-06-02T00:00:00.000Z', cwd: dir }),
        JSON.stringify({ type: 'message', id: 'root-user', parentId: null, timestamp: '2026-06-02T00:00:01.000Z', message: { role: 'user', content: 'root prompt' } }),
        JSON.stringify({ type: 'message', id: 'existing-assistant', parentId: 'root-user', timestamp: '2026-06-02T00:00:02.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'already imported' }] } }),
        JSON.stringify({ type: 'message', id: 'target-assistant', parentId: 'existing-assistant', timestamp: '2026-06-02T00:00:03.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'new branch answer' }] } }),
        JSON.stringify({ type: 'message', id: 'sibling-assistant', parentId: 'root-user', timestamp: '2026-06-02T00:00:04.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'sibling answer' }] } }),
        '',
      ].join('\\n'))

      const {
        appendSDKMessages,
        createAgentSession,
        getAgentSessionSDKMessages,
        syncPiNativeSessionMessages,
      } = await import('./agent-session-manager.ts')

      const session = createAgentSession('Pi target', 'channel-1', 'workspace-pi', 'pi')
      appendSDKMessages(session.id, [
        {
          type: 'assistant',
          uuid: 'existing-proma-message',
          session_id: session.id,
          message: { role: 'assistant', content: [{ type: 'text', text: 'already imported' }] },
          parent_tool_use_id: null,
          _promaPiEntryId: 'existing-assistant',
        },
      ])

      const result = syncPiNativeSessionMessages({
        sessionId: session.id,
        sessionPath,
        leafEntryId: 'target-assistant',
      })
      const messages = getAgentSessionSDKMessages(session.id)
      console.log(JSON.stringify({
        result,
        piEntryIds: messages.map((message) => message._promaPiEntryId ?? null),
        messageTexts: messages.map((message) => JSON.stringify(message.message?.content ?? '')),
      }))
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('result'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      result?: { importedCount?: number; skippedCount?: number; totalCount?: number }
      piEntryIds?: Array<string | null>
      messageTexts?: string[]
    }

    expect(result.result).toEqual({ importedCount: 2, skippedCount: 1, totalCount: 3 })
    expect(result.piEntryIds).toEqual(['existing-assistant', 'root-user', 'target-assistant'])
    expect(JSON.stringify(result.messageTexts)).toContain('new branch answer')
    expect(JSON.stringify(result.messageTexts)).not.toContain('sibling answer')
  })

  test('Given Claude session When syncing Pi native history Then rejects the import', () => {
    const output = runSessionManagerScript(`
      import { mkdtempSync, writeFileSync } from 'node:fs'
      import { join } from 'node:path'
      import { tmpdir } from 'node:os'
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: {
          getFocusedWindow: () => null,
          getAllWindows: () => [],
        },
        dialog: {},
        safeStorage: {
          encryptString: (value) => Buffer.from(value),
          decryptString: (value) => value.toString(),
          isEncryptionAvailable: () => false,
        },
      }))

      const dir = mkdtempSync(join(tmpdir(), 'proma-pi-native-sync-reject-'))
      const sessionPath = join(dir, 'native.jsonl')
      writeFileSync(sessionPath, [
        JSON.stringify({ type: 'session', version: 3, id: 'pi-native', timestamp: '2026-06-02T00:00:00.000Z', cwd: dir }),
        JSON.stringify({ type: 'message', id: 'user-1', parentId: null, timestamp: '2026-06-02T00:00:01.000Z', message: { role: 'user', content: 'hello pi' } }),
        '',
      ].join('\\n'))

      const { createAgentSession, syncPiNativeSessionMessages } = await import('./agent-session-manager.ts')
      const session = createAgentSession('Claude target', 'channel-1', undefined, 'claude-sdk')
      try {
        syncPiNativeSessionMessages({ sessionId: session.id, sessionPath })
      } catch (error) {
        console.log(JSON.stringify({ message: error instanceof Error ? error.message : String(error) }))
      }
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('message'))
    const result = JSON.parse(jsonLine ?? '{}') as { message?: string }
    expect(result.message).toContain('仅支持 Pi Agent 会话')
  })

  test('Given active pi session When syncing runtime messages Then imports active runtime snapshot without session file', () => {
    const output = runSessionManagerScript(`
      import { mkdirSync, writeFileSync } from 'node:fs'
      import { join } from 'node:path'
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: {
          getFocusedWindow: () => null,
          getAllWindows: () => [],
        },
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

      const {
        appendSDKMessages,
        createAgentSession,
        getAgentSessionSDKMessages,
      } = await import('./agent-session-manager.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')
      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const {
        syncPiNativeSessionMessages,
        __testTrackActiveSessionOrchestrator,
        __testReleaseActiveSessionOrchestrator,
      } = await import('./agent-service.ts')

      const session = createAgentSession('Pi target', 'channel-1', 'workspace-pi', 'pi')
      appendSDKMessages(session.id, [
        {
          type: 'assistant',
          uuid: 'existing-proma-message',
          session_id: session.id,
          message: { role: 'assistant', content: [{ type: 'text', text: 'already imported' }] },
          parent_tool_use_id: null,
          _promaPiEntryId: 'existing-assistant',
        },
      ])

      const adapter = {
        query: async function* () {},
        abort: () => {},
        dispose: () => {},
        getMessages: async (sessionId) => {
          if (sessionId !== session.id) throw new Error('unexpected session id')
          return [
            {
              type: 'assistant',
              uuid: 'existing-proma-message',
              session_id: session.id,
              message: { role: 'assistant', content: [{ type: 'text', text: 'already imported' }] },
              parent_tool_use_id: null,
              _promaPiEntryId: 'existing-assistant',
            },
            {
              type: 'assistant',
              uuid: 'new-proma-message',
              session_id: session.id,
              message: { role: 'assistant', content: [{ type: 'text', text: 'active runtime answer' }] },
              parent_tool_use_id: null,
              _promaPiEntryId: 'active-assistant',
            },
          ]
        },
      }
      const orchestrator = new AgentOrchestrator(adapter, new AgentEventBus(), 'pi')
      __testTrackActiveSessionOrchestrator(session.id, orchestrator)

      try {
        const result = await syncPiNativeSessionMessages({ sessionId: session.id })
        const messages = getAgentSessionSDKMessages(session.id)
        console.log(JSON.stringify({
          result,
          piEntryIds: messages.map((message) => message._promaPiEntryId ?? null),
          messageTexts: messages.map((message) => JSON.stringify(message.message?.content ?? '')),
        }))
      } finally {
        __testReleaseActiveSessionOrchestrator(session.id, orchestrator)
      }
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('result'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      result?: { importedCount?: number; skippedCount?: number; totalCount?: number }
      piEntryIds?: Array<string | null>
      messageTexts?: string[]
    }

    expect(result.result).toEqual({ importedCount: 1, skippedCount: 1, totalCount: 2 })
    expect(result.piEntryIds).toEqual(['existing-assistant', 'active-assistant'])
    expect(JSON.stringify(result.messageTexts)).toContain('active runtime answer')
  })

  test('Given active pi session When title is renamed Then syncs Pi native session name', () => {
    const output = runSessionManagerScript(`
      import { mkdirSync, writeFileSync } from 'node:fs'
      import { join } from 'node:path'
      import { mock } from 'bun:test'

      mock.module('electron', () => ({
        app: { isPackaged: true, getPath: () => process.env.HOME },
        BrowserWindow: {
          getFocusedWindow: () => null,
          getAllWindows: () => [],
        },
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

      const { createAgentSession, getAgentSessionMeta } = await import('./agent-session-manager.ts')
      const { AgentEventBus } = await import('./agent-event-bus.ts')
      const { AgentOrchestrator } = await import('./agent-orchestrator.ts')
      const {
        renameAgentSessionTitle,
        __testTrackActiveSessionOrchestrator,
        __testReleaseActiveSessionOrchestrator,
      } = await import('./agent-service.ts')

      const session = createAgentSession('旧标题', 'channel-1', 'workspace-pi', 'pi')
      const sessionNameCalls = []
      let releaseAgentEnd
      const waitForRelease = new Promise((resolve) => { releaseAgentEnd = resolve })
      const adapter = {
        query: async function* (input) {
          yield await waitForRelease
          yield {
            type: 'result',
            subtype: 'success',
            usage: { input_tokens: 0, output_tokens: 0 },
            session_id: input.sessionId,
          }
        },
        abort: () => {},
        dispose: () => {},
        setSessionName: async (sessionId, name) => {
          sessionNameCalls.push({ sessionId, name })
        },
      }
      const orchestrator = new AgentOrchestrator(adapter, new AgentEventBus(), 'pi')
      __testTrackActiveSessionOrchestrator(session.id, orchestrator)

      try {
        const runPromise = orchestrator.sendMessage({
          sessionId: session.id,
          userMessage: '保持运行',
          channelId: 'missing-channel',
          modelId: 'model',
          startedAt: 1001,
        }, {
          onError: () => {},
          onComplete: () => {},
          onTitleUpdated: () => {},
          onRunStarted: () => {},
        })
        await new Promise((resolve) => setTimeout(resolve, 0))
        const renamed = await renameAgentSessionTitle(session.id, ' 新标题 ')
        releaseAgentEnd({
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'done' }] },
          parent_tool_use_id: null,
          session_id: session.id,
        })
        await runPromise
        const stored = getAgentSessionMeta(session.id)
        console.log(JSON.stringify({
          renamedTitle: renamed.title,
          storedTitle: stored?.title ?? null,
          sessionNameCalls,
        }))
      } finally {
        __testReleaseActiveSessionOrchestrator(session.id, orchestrator)
      }
    `)

    const jsonLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('sessionNameCalls'))
    const result = JSON.parse(jsonLine ?? '{}') as {
      renamedTitle?: string
      storedTitle?: string | null
      sessionNameCalls?: Array<{ sessionId?: string; name?: string }>
    }

    expect(result.renamedTitle).toBe(' 新标题 ')
    expect(result.storedTitle).toBe(' 新标题 ')
    expect(result.sessionNameCalls).toEqual([{ sessionId: expect.any(String), name: '新标题' }])
  })
})
