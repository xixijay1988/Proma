import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import {
  applyPiGitCheckpoint,
  buildPiGitCheckpointExtensionSourceForTest,
  ensurePiGitCheckpointExtension,
  findPiGitCheckpointForEntry,
  listPiGitCheckpoints,
} from './pi-git-checkpoint-extension'

describe('pi git checkpoint extension', () => {
  test('Given config dir When ensuring extension Then writes checkpoint extension source', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'proma-pi-checkpoint-'))
    try {
      const extensionPath = ensurePiGitCheckpointExtension({ configDir })
      const source = readFileSync(extensionPath, 'utf-8')

      expect(extensionPath).toEndWith('proma-git-checkpoint.mjs')
      expect(source).toContain("pi.on('tool_result'")
      expect(source).toContain("pi.on('turn_start'")
      expect(source).toContain("pi.on('session_before_fork'")
      expect(source).toContain("pi.exec('git', ['stash', 'create'])")
      expect(source).toContain("pi.appendEntry('proma-git-checkpoint'")
      expect(source).not.toContain("git', ['stash', 'apply'")
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('Given generated source When inspected Then records entry id and git ref without auto restore', () => {
    const source = buildPiGitCheckpointExtensionSourceForTest()

    expect(source).toContain('const PROMA_CHECKPOINT_TYPE = \'proma-git-checkpoint\'')
    expect(source).toContain('targetEntryId: currentEntryId')
    expect(source).toContain('gitRef: ref')
    expect(source).toContain('cwd: ctx.cwd')
    expect(source).toContain('checkpoint by Proma')
    expect(source).not.toContain('ctx.ui.select')
  })

  test('Given Pi native session file When listing checkpoints Then returns Proma checkpoint entries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'proma-pi-checkpoint-session-'))
    const sessionPath = join(dir, 'session.jsonl')
    writeFileSync(sessionPath, [
      JSON.stringify({ type: 'session', id: 'pi-session', cwd: '/tmp/work' }),
      JSON.stringify({
        type: 'custom',
        id: 'checkpoint-entry-1',
        parentId: 'entry-user-1',
        customType: 'proma-git-checkpoint',
        data: {
          targetEntryId: 'entry-user-1',
          gitRef: 'abc123',
          cwd: '/tmp/work',
          createdAt: '2026-06-02T01:02:03.000Z',
        },
      }),
      JSON.stringify({
        type: 'custom',
        id: 'other-entry',
        parentId: 'entry-user-1',
        customType: 'other-extension',
        data: { gitRef: 'ignored' },
      }),
      '',
    ].join('\n'), 'utf-8')

    try {
      expect(listPiGitCheckpoints(sessionPath)).toEqual([
        {
          entryId: 'checkpoint-entry-1',
          targetEntryId: 'entry-user-1',
          gitRef: 'abc123',
          cwd: '/tmp/work',
          createdAt: '2026-06-02T01:02:03.000Z',
        },
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('Given target entry has no direct checkpoint When finding checkpoint Then uses nearest ancestor checkpoint', () => {
    const dir = mkdtempSync(join(tmpdir(), 'proma-pi-checkpoint-ancestor-'))
    const sessionPath = join(dir, 'session.jsonl')
    writeFileSync(sessionPath, [
      JSON.stringify({ type: 'session', id: 'pi-session', cwd: '/tmp/work' }),
      JSON.stringify({ type: 'message', id: 'entry-user-1', parentId: null, message: { role: 'user', content: [] } }),
      JSON.stringify({
        type: 'custom',
        id: 'checkpoint-entry-1',
        parentId: 'entry-user-1',
        customType: 'proma-git-checkpoint',
        data: { targetEntryId: 'entry-user-1', gitRef: 'abc123', cwd: '/tmp/work' },
      }),
      JSON.stringify({ type: 'message', id: 'entry-assistant-1', parentId: 'checkpoint-entry-1', message: { role: 'assistant', content: [] } }),
      '',
    ].join('\n'), 'utf-8')

    try {
      expect(findPiGitCheckpointForEntry(sessionPath, 'entry-assistant-1')).toEqual({
        entryId: 'checkpoint-entry-1',
        targetEntryId: 'entry-user-1',
        gitRef: 'abc123',
        cwd: '/tmp/work',
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('Given clean git workspace When applying checkpoint Then uses checkpoint ref from Pi native session', () => {
    const dir = mkdtempSync(join(tmpdir(), 'proma-pi-checkpoint-apply-'))
    const sessionPath = join(dir, 'session.jsonl')
    writeFileSync(sessionPath, [
      JSON.stringify({ type: 'session', id: 'pi-session', cwd: '/tmp/work' }),
      JSON.stringify({ type: 'message', id: 'entry-user-1', parentId: null, message: { role: 'user', content: [] } }),
      JSON.stringify({
        type: 'custom',
        id: 'checkpoint-entry-1',
        parentId: 'entry-user-1',
        customType: 'proma-git-checkpoint',
        data: { targetEntryId: 'entry-user-1', gitRef: 'abc123', cwd: '/tmp/work' },
      }),
      JSON.stringify({ type: 'message', id: 'entry-assistant-1', parentId: 'checkpoint-entry-1', message: { role: 'assistant', content: [] } }),
      '',
    ].join('\n'), 'utf-8')
    const calls: Array<{ cwd: string; args: string[] }> = []

    try {
      const result = applyPiGitCheckpoint({
        sessionPath,
        targetEntryId: 'entry-assistant-1',
        runGit: (cwd, args) => {
          calls.push({ cwd, args })
          return { status: 0, stdout: '', stderr: '' }
        },
      })

      expect(result).toEqual({
        restored: true,
        checkpoint: {
          entryId: 'checkpoint-entry-1',
          targetEntryId: 'entry-user-1',
          gitRef: 'abc123',
          cwd: '/tmp/work',
        },
        filesChanged: [],
      })
      expect(calls).toEqual([
        { cwd: '/tmp/work', args: ['status', '--porcelain'] },
        { cwd: '/tmp/work', args: ['stash', 'apply', 'abc123'] },
        { cwd: '/tmp/work', args: ['diff', '--name-only'] },
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('Given checkpoint apply changes files When applying checkpoint Then returns changed file list', () => {
    const dir = mkdtempSync(join(tmpdir(), 'proma-pi-checkpoint-files-'))
    const sessionPath = join(dir, 'session.jsonl')
    writeFileSync(sessionPath, [
      JSON.stringify({ type: 'session', id: 'pi-session', cwd: '/tmp/work' }),
      JSON.stringify({ type: 'message', id: 'entry-user-1', parentId: null, message: { role: 'user', content: [] } }),
      JSON.stringify({
        type: 'custom',
        id: 'checkpoint-entry-1',
        parentId: 'entry-user-1',
        customType: 'proma-git-checkpoint',
        data: { targetEntryId: 'entry-user-1', gitRef: 'abc123', cwd: '/tmp/work' },
      }),
      '',
    ].join('\n'), 'utf-8')

    try {
      const result = applyPiGitCheckpoint({
        sessionPath,
        targetEntryId: 'entry-user-1',
        runGit: (_cwd, args) => {
          if (args[0] === 'diff') {
            return { status: 0, stdout: 'src/changed.ts\nREADME.md\n\nsrc/changed.ts\n', stderr: '' }
          }
          return { status: 0, stdout: '', stderr: '' }
        },
      })

      expect(result.restored).toBe(true)
      expect(result.filesChanged).toEqual(['src/changed.ts', 'README.md'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('Given dirty git workspace When applying checkpoint Then refuses before stash apply', () => {
    const dir = mkdtempSync(join(tmpdir(), 'proma-pi-checkpoint-dirty-'))
    const sessionPath = join(dir, 'session.jsonl')
    writeFileSync(sessionPath, [
      JSON.stringify({ type: 'session', id: 'pi-session', cwd: '/tmp/work' }),
      JSON.stringify({ type: 'message', id: 'entry-user-1', parentId: null, message: { role: 'user', content: [] } }),
      JSON.stringify({
        type: 'custom',
        id: 'checkpoint-entry-1',
        parentId: 'entry-user-1',
        customType: 'proma-git-checkpoint',
        data: { targetEntryId: 'entry-user-1', gitRef: 'abc123', cwd: '/tmp/work' },
      }),
      '',
    ].join('\n'), 'utf-8')
    const calls: string[][] = []

    try {
      const result = applyPiGitCheckpoint({
        sessionPath,
        targetEntryId: 'entry-user-1',
        runGit: (_cwd, args) => {
          calls.push(args)
          return { status: 0, stdout: ' M current-file.ts\n', stderr: '' }
        },
      })

      expect(result.restored).toBe(false)
      expect(result.error).toContain('工作区存在未提交改动')
      expect(calls).toEqual([['status', '--porcelain']])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
