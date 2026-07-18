/**
 * Room 管理器
 *
 * 负责 Agent Room 的元数据、成员、消息和草稿持久化。
 * - Room 索引：~/.proma/rooms.json
 * - Room 消息：~/.proma/rooms/{id}.jsonl
 * - Room 成员：~/.proma/rooms/{id}/members.json
 * - Room 草稿：~/.proma/rooms/{id}/drafts/{draftId}.json
 */

import { appendFileSync, existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { DEFAULT_ROOM_CHANNEL_ID } from '@proma/shared'
import { writeJsonFileAtomic, readJsonFileSafe } from './safe-file'
import {
  getRoomDraftPath,
  getRoomDraftsDir,
  getRoomChannelsPath,
  getRoomMembersPath,
  getRoomMessagesPath,
  getRoomsDir,
  getRoomsIndexPath,
  getRoomSummaryPath,
} from './config-paths'
import type {
  RoomChannel,
  RoomChannelCreateInput,
  RoomChannelUpdateInput,
  RoomCreateInput,
  RoomDraft,
  RoomMemberConfig,
  RoomMemberSaveInput,
  RoomMessage,
  RoomMeta,
  RoomUpdateInput,
} from '@proma/shared'

interface RoomsIndex {
  version: number
  rooms: RoomMeta[]
}

interface RoomMembersFile {
  version: number
  members: RoomMemberConfig[]
}

interface RoomChannelsFile {
  version: number
  channels: RoomChannel[]
}

const INDEX_VERSION = 1

function normalizeRoomChannelName(name: string): string {
  return name.trim().replace(/^#+/, '').replace(/\s+/g, '-').toLowerCase()
}

function createDefaultRoomChannel(roomId: string, createdAt = Date.now()): RoomChannel {
  return {
    id: DEFAULT_ROOM_CHANNEL_ID,
    roomId,
    name: 'general',
    description: '默认频道',
    createdAt,
    updatedAt: createdAt,
  }
}

function readIndex(): RoomsIndex {
  const data = readJsonFileSafe<RoomsIndex>(getRoomsIndexPath())
  if (data) return data
  return { version: INDEX_VERSION, rooms: [] }
}

function writeIndex(index: RoomsIndex): void {
  try {
    writeJsonFileAtomic(getRoomsIndexPath(), index)
  } catch (error) {
    console.error('[Room] 写入索引文件失败:', error)
    throw new Error('写入 Room 索引失败')
  }
}

function readMembersFile(roomId: string): RoomMembersFile {
  const data = readJsonFileSafe<RoomMembersFile>(getRoomMembersPath(roomId))
  if (data) return data
  return { version: INDEX_VERSION, members: [] }
}

function readChannelsFile(roomId: string): RoomChannelsFile {
  const data = readJsonFileSafe<RoomChannelsFile>(getRoomChannelsPath(roomId))
  if (data) {
    const hasDefault = data.channels.some((channel) => channel.id === DEFAULT_ROOM_CHANNEL_ID)
    return hasDefault ? data : { ...data, channels: [createDefaultRoomChannel(roomId), ...data.channels] }
  }
  return { version: INDEX_VERSION, channels: [createDefaultRoomChannel(roomId)] }
}

function writeMembersFile(roomId: string, file: RoomMembersFile): void {
  try {
    writeJsonFileAtomic(getRoomMembersPath(roomId), file)
  } catch (error) {
    console.error(`[Room] 写入成员配置失败 (${roomId}):`, error)
    throw new Error('写入 Room 成员配置失败')
  }
}

function writeChannelsFile(roomId: string, file: RoomChannelsFile): void {
  try {
    writeJsonFileAtomic(getRoomChannelsPath(roomId), file)
  } catch (error) {
    console.error(`[Room] 写入频道配置失败 (${roomId}):`, error)
    throw new Error('写入 Room 频道配置失败')
  }
}

function touchRoom(roomId: string): void {
  const index = readIndex()
  const room = index.rooms.find((item) => item.id === roomId)
  if (!room) return
  room.updatedAt = Date.now()
  if (room.archived) room.archived = false
  writeIndex(index)
}

export function listRooms(): RoomMeta[] {
  return readIndex().rooms.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getRoom(id: string): RoomMeta | undefined {
  return readIndex().rooms.find((room) => room.id === id)
}

export function ensureDefaultRoom(): RoomMeta {
  const rooms = listRooms()
  const existing = rooms.find((room) => !room.archived)
  if (existing) return existing
  return createRoom({ title: 'Slock Room', description: 'Agent 团队房间' })
}

export function createRoom(input: RoomCreateInput = {}): RoomMeta {
  const index = readIndex()
  const now = Date.now()
  const room: RoomMeta = {
    id: randomUUID(),
    title: input.title?.trim() || 'Slock Room',
    description: input.description,
    createdAt: now,
    updatedAt: now,
  }

  index.rooms.push(room)
  writeIndex(index)
  getRoomsDir()
  writeMembersFile(room.id, { version: INDEX_VERSION, members: [] })
  writeChannelsFile(room.id, { version: INDEX_VERSION, channels: [createDefaultRoomChannel(room.id, now)] })
  console.log(`[Room] 已创建房间: ${room.title} (${room.id})`)
  return room
}

export function updateRoom(id: string, updates: RoomUpdateInput): RoomMeta {
  const index = readIndex()
  const idx = index.rooms.findIndex((room) => room.id === id)
  if (idx === -1) throw new Error(`Room 不存在: ${id}`)

  const current = index.rooms[idx]!
  const updated: RoomMeta = {
    ...current,
    ...updates,
    title: updates.title?.trim() || current.title,
    updatedAt: Date.now(),
  }
  index.rooms[idx] = updated
  writeIndex(index)
  return updated
}

export function deleteRoom(id: string): void {
  const index = readIndex()
  const idx = index.rooms.findIndex((room) => room.id === id)
  if (idx === -1) return
  index.rooms.splice(idx, 1)
  writeIndex(index)

  const msgPath = getRoomMessagesPath(id)
  if (existsSync(msgPath)) {
    try { unlinkSync(msgPath) } catch (error) { console.warn(`[Room] 删除消息文件失败 (${id}):`, error) }
  }
}

export function listRoomMembers(roomId: string): RoomMemberConfig[] {
  return readMembersFile(roomId).members
}

export function listRoomChannels(roomId: string): RoomChannel[] {
  const file = readChannelsFile(roomId)
  const hasDefaultFile = existsSync(getRoomChannelsPath(roomId))
  if (!hasDefaultFile) writeChannelsFile(roomId, file)
  return file.channels.sort((a, b) => {
    if (a.id === DEFAULT_ROOM_CHANNEL_ID) return -1
    if (b.id === DEFAULT_ROOM_CHANNEL_ID) return 1
    return a.createdAt - b.createdAt
  })
}

export function createRoomChannel(input: RoomChannelCreateInput): RoomChannel {
  const name = normalizeRoomChannelName(input.name)
  if (!name) throw new Error('Room 频道名称不能为空')
  const file = readChannelsFile(input.roomId)
  if (file.channels.some((channel) => normalizeRoomChannelName(channel.name) === name && !channel.archived)) {
    throw new Error(`Room 频道已存在: ${name}`)
  }
  const now = Date.now()
  const channel: RoomChannel = {
    id: randomUUID(),
    roomId: input.roomId,
    name,
    description: input.description?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  }
  file.channels.push(channel)
  writeChannelsFile(input.roomId, file)
  touchRoom(input.roomId)
  return channel
}

export function updateRoomChannel(roomId: string, channelId: string, updates: RoomChannelUpdateInput): RoomChannel {
  const file = readChannelsFile(roomId)
  const idx = file.channels.findIndex((channel) => channel.id === channelId)
  if (idx === -1) throw new Error(`Room 频道不存在: ${channelId}`)
  const current = file.channels[idx]!
  if (current.id === DEFAULT_ROOM_CHANNEL_ID && updates.archived) {
    throw new Error('默认频道不能归档')
  }
  const nextName = updates.name === undefined ? current.name : normalizeRoomChannelName(updates.name)
  if (!nextName) throw new Error('Room 频道名称不能为空')
  if (nextName !== current.name && file.channels.some((channel) => channel.id !== channelId && normalizeRoomChannelName(channel.name) === nextName && !channel.archived)) {
    throw new Error(`Room 频道已存在: ${nextName}`)
  }
  const updated: RoomChannel = {
    ...current,
    name: nextName,
    description: updates.description === undefined ? current.description : updates.description.trim() || undefined,
    archived: updates.archived ?? current.archived,
    updatedAt: Date.now(),
  }
  file.channels[idx] = updated
  writeChannelsFile(roomId, file)
  touchRoom(roomId)
  return updated
}

export function deleteRoomChannel(roomId: string, channelId: string): void {
  if (channelId === DEFAULT_ROOM_CHANNEL_ID) throw new Error('默认频道不能删除')
  updateRoomChannel(roomId, channelId, { archived: true })
}

export function saveRoomMember(input: RoomMemberSaveInput): RoomMemberConfig {
  const file = readMembersFile(input.roomId)
  const now = Date.now()
  const idx = input.memberId ? file.members.findIndex((member) => member.id === input.memberId) : -1
  const existing = idx >= 0 ? file.members[idx] : undefined
  const member: RoomMemberConfig = {
    id: existing?.id ?? randomUUID(),
    roomId: input.roomId,
    name: input.name.trim(),
    avatar: input.avatar,
    rolePrompt: input.rolePrompt,
    channelId: input.channelId,
    modelId: input.modelId,
    workspaceId: input.workspaceId,
    agentEngine: input.agentEngine ?? existing?.agentEngine,
    enabled: input.enabled ?? existing?.enabled ?? true,
    listenMode: input.listenMode ?? existing?.listenMode ?? 'listen-and-score',
    permissionMode: input.permissionMode ?? existing?.permissionMode,
    privateMemorySummary: input.privateMemorySummary ?? existing?.privateMemorySummary,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }

  if (!member.name) throw new Error('Room 成员名称不能为空')
  if (!member.rolePrompt.trim()) throw new Error('Room 成员角色说明不能为空')

  if (idx >= 0) file.members[idx] = member
  else file.members.push(member)
  writeMembersFile(input.roomId, file)
  touchRoom(input.roomId)
  return member
}

export function deleteRoomMember(roomId: string, memberId: string): void {
  const file = readMembersFile(roomId)
  const next = file.members.filter((member) => member.id !== memberId)
  if (next.length === file.members.length) return
  writeMembersFile(roomId, { ...file, members: next })
  touchRoom(roomId)
}

export function getRoomMessages(roomId: string, roomChannelId?: string): RoomMessage[] {
  const filePath = getRoomMessagesPath(roomId)
  if (!existsSync(filePath)) return []

  try {
    const messages = readFileSync(filePath, 'utf-8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as RoomMessage)
    if (!roomChannelId) return messages
    return messages.filter((message) => (message.roomChannelId ?? DEFAULT_ROOM_CHANNEL_ID) === roomChannelId)
  } catch (error) {
    console.error(`[Room] 读取消息失败 (${roomId}):`, error)
    return []
  }
}

export function appendRoomMessage(roomId: string, message: RoomMessage): void {
  try {
    appendFileSync(getRoomMessagesPath(roomId), JSON.stringify(message) + '\n', 'utf-8')
    touchRoom(roomId)
  } catch (error) {
    console.error(`[Room] 追加消息失败 (${roomId}):`, error)
    throw new Error('追加 Room 消息失败')
  }
}

export function saveRoomMessages(roomId: string, messages: RoomMessage[]): void {
  const content = messages.map((message) => JSON.stringify(message)).join('\n') + (messages.length > 0 ? '\n' : '')
  try {
    writeFileSync(getRoomMessagesPath(roomId), content, 'utf-8')
    touchRoom(roomId)
  } catch (error) {
    console.error(`[Room] 保存消息失败 (${roomId}):`, error)
    throw new Error('保存 Room 消息失败')
  }
}

export function listRoomDrafts(roomId: string): RoomDraft[] {
  const dir = getRoomDraftsDir(roomId)
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .flatMap((file) => {
      const data = readJsonFileSafe<RoomDraft>(`${dir}/${file}`)
      return data ? [data] : []
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function saveRoomDraft(draft: RoomDraft): RoomDraft {
  try {
    writeJsonFileAtomic(getRoomDraftPath(draft.roomId, draft.id), draft)
    touchRoom(draft.roomId)
    return draft
  } catch (error) {
    console.error(`[Room] 保存草稿失败 (${draft.roomId}/${draft.id}):`, error)
    throw new Error('保存 Room 草稿失败')
  }
}

export function getRoomSummary(roomId: string): string {
  const filePath = getRoomSummaryPath(roomId)
  if (!existsSync(filePath)) return ''
  try {
    return readFileSync(filePath, 'utf-8')
  } catch (error) {
    console.error(`[Room] 读取摘要失败 (${roomId}):`, error)
    return ''
  }
}

export function saveRoomSummary(roomId: string, summary: string): void {
  try {
    writeFileSync(getRoomSummaryPath(roomId), summary, 'utf-8')
    touchRoom(roomId)
  } catch (error) {
    console.error(`[Room] 保存摘要失败 (${roomId}):`, error)
    throw new Error('保存 Room 摘要失败')
  }
}
