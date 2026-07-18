import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function runRoomManagerScript(script: string): string {
  const homeDir = mkdtempSync(join(tmpdir(), 'proma-room-manager-'))
  try {
    const result = Bun.spawnSync({
      cmd: [process.execPath, '--eval', script],
      cwd: import.meta.dir,
      env: {
        ...process.env,
        HOME: homeDir,
        PROMA_DEV: undefined,
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

describe('room-manager', () => {
  test('Given no rooms When ensuring default room Then creates a local-first room with member storage', () => {
    const output = runRoomManagerScript(`
      const { existsSync } = await import('node:fs')
      const { ensureDefaultRoom, listRooms, listRoomMembers } = await import('./room-manager.ts')
      const { getRoomMembersPath, getRoomsIndexPath } = await import('./config-paths.ts')

      const room = ensureDefaultRoom()
      console.log(JSON.stringify({
        title: room.title,
        roomCount: listRooms().length,
        members: listRoomMembers(room.id).length,
        indexExists: existsSync(getRoomsIndexPath()),
        membersExists: existsSync(getRoomMembersPath(room.id)),
      }))
    `)

    const result = JSON.parse(output.split('\n').at(-1) ?? '{}')
    expect(result).toEqual({
      title: 'Slock Room',
      roomCount: 1,
      members: 0,
      indexExists: true,
      membersExists: true,
    })
  })

  test('Given a room When appending messages Then JSONL history is restored in order', () => {
    const output = runRoomManagerScript(`
      const { appendRoomMessage, createRoom, getRoomMessages } = await import('./room-manager.ts')
      const room = createRoom({ title: '工程房间' })

      appendRoomMessage(room.id, {
        id: 'm1',
        roomId: room.id,
        role: 'human',
        content: '@Pat 梳理验收标准',
        status: 'final',
        createdAt: 1,
        updatedAt: 1,
      })
      appendRoomMessage(room.id, {
        id: 'm2',
        roomId: room.id,
        role: 'agent',
        authorId: 'pat',
        content: '我来整理。',
        status: 'final',
        sourceMessageId: 'm1',
        createdAt: 2,
        updatedAt: 2,
      })

      console.log(JSON.stringify(getRoomMessages(room.id).map((message) => message.id)))
    `)

    expect(JSON.parse(output.split('\n').at(-1) ?? '[]')).toEqual(['m1', 'm2'])
  })

  test('Given a room When creating channels Then messages can be read per channel', () => {
    const output = runRoomManagerScript(`
      const { appendRoomMessage, createRoom, createRoomChannel, getRoomMessages, listRoomChannels } = await import('./room-manager.ts')
      const room = createRoom({ title: '频道房间' })
      const frontend = createRoomChannel({ roomId: room.id, name: 'Frontend' })

      appendRoomMessage(room.id, {
        id: 'm1',
        roomId: room.id,
        roomChannelId: 'general',
        role: 'human',
        content: '默认频道消息',
        status: 'final',
        createdAt: 1,
        updatedAt: 1,
      })
      appendRoomMessage(room.id, {
        id: 'm2',
        roomId: room.id,
        roomChannelId: frontend.id,
        role: 'human',
        content: '前端频道消息',
        status: 'final',
        createdAt: 2,
        updatedAt: 2,
      })

      console.log(JSON.stringify({
        channels: listRoomChannels(room.id).map((channel) => channel.name),
        allMessages: getRoomMessages(room.id).map((message) => message.id),
        frontendMessages: getRoomMessages(room.id, frontend.id).map((message) => message.id),
      }))
    `)

    expect(JSON.parse(output.split('\n').at(-1) ?? '{}')).toEqual({
      channels: ['general', 'frontend'],
      allMessages: ['m1', 'm2'],
      frontendMessages: ['m2'],
    })
  })

  test('Given custom channels When deleting a channel Then it is archived and default channel is protected', () => {
    const output = runRoomManagerScript(`
      const { createRoom, createRoomChannel, deleteRoomChannel, listRoomChannels } = await import('./room-manager.ts')
      const room = createRoom({ title: '删除频道房间' })
      const frontend = createRoomChannel({ roomId: room.id, name: 'Frontend' })

      deleteRoomChannel(room.id, frontend.id)
      let defaultDeleteError = ''
      try {
        deleteRoomChannel(room.id, 'general')
      } catch (error) {
        defaultDeleteError = error instanceof Error ? error.message : String(error)
      }

      console.log(JSON.stringify({
        channels: listRoomChannels(room.id).map((channel) => ({ id: channel.id, name: channel.name, archived: !!channel.archived })),
        defaultDeleteError,
      }))
    `)

    expect(JSON.parse(output.split('\n').at(-1) ?? '{}')).toEqual({
      channels: [
        { id: 'general', name: 'general', archived: false },
        { id: expect.any(String), name: 'frontend', archived: true },
      ],
      defaultDeleteError: '默认频道不能删除',
    })
  })

  test('Given member input When saving twice Then updates existing member instead of duplicating', () => {
    const output = runRoomManagerScript(`
      const { createRoom, listRoomMembers, saveRoomMember } = await import('./room-manager.ts')
      const room = createRoom({ title: '团队房间' })

      const created = saveRoomMember({
        roomId: room.id,
        name: 'Pat',
        rolePrompt: '把请求整理成验收标准。',
        listenMode: 'listen-and-score',
      })
      const updated = saveRoomMember({
        roomId: room.id,
        memberId: created.id,
        name: 'Pat PM',
        rolePrompt: '把请求整理成可测试的验收标准。',
        listenMode: 'mention-only',
      })
      const members = listRoomMembers(room.id)

      console.log(JSON.stringify({
        sameId: updated.id === created.id,
        count: members.length,
        name: members[0]?.name,
        listenMode: members[0]?.listenMode,
      }))
    `)

    expect(JSON.parse(output.split('\n').at(-1) ?? '{}')).toEqual({
      sameId: true,
      count: 1,
      name: 'Pat PM',
      listenMode: 'mention-only',
    })
  })

  test('Given a low-confidence response When saving draft Then draft can be listed', () => {
    const output = runRoomManagerScript(`
      const { createRoom, listRoomDrafts, saveRoomDraft } = await import('./room-manager.ts')
      const room = createRoom({ title: '草稿房间' })

      saveRoomDraft({
        id: 'd1',
        roomId: room.id,
        memberId: 'pat',
        sourceMessageId: 'm1',
        content: '这是一个需要确认的草稿。',
        score: 0.42,
        reason: '相关但置信度不足',
        status: 'pending',
        createdAt: 1,
        updatedAt: 1,
      })

      const drafts = listRoomDrafts(room.id)
      console.log(JSON.stringify({
        count: drafts.length,
        status: drafts[0]?.status,
        reason: drafts[0]?.reason,
      }))
    `)

    const result = JSON.parse(output.split('\n').at(-1) ?? '{}')
    expect(result.count).toBe(1)
    expect(result.status).toBe('pending')
    expect(result.reason).toContain('置信度')
  })
})
