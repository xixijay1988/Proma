import { atom } from 'jotai'
import { DEFAULT_ROOM_CHANNEL_ID } from '@proma/shared'
import type { RoomChannel, RoomDraft, RoomMemberConfig, RoomMemberSaveInput, RoomMessage, RoomMeta, RoomStreamEvent } from '@proma/shared'

export const roomsAtom = atom<RoomMeta[]>([])
export const currentRoomIdAtom = atom<string | null>(null)
export const currentRoomChannelIdAtom = atom<string>(DEFAULT_ROOM_CHANNEL_ID)
export const roomChannelsAtom = atom<Map<string, RoomChannel[]>>(new Map())
export const roomMessagesAtom = atom<Map<string, RoomMessage[]>>(new Map())
export const roomMembersAtom = atom<Map<string, RoomMemberConfig[]>>(new Map())
export const roomDraftsAtom = atom<Map<string, RoomDraft[]>>(new Map())
export const roomLoadingAtom = atom<boolean>(false)
export const roomSendingAtom = atom<boolean>(false)
export const roomErrorAtom = atom<string | null>(null)

function roomMessageKey(roomId: string, roomChannelId: string): string {
  return `${roomId}:${roomChannelId}`
}

export const currentRoomAtom = atom<RoomMeta | null>((get) => {
  const currentId = get(currentRoomIdAtom)
  if (!currentId) return null
  return get(roomsAtom).find((room) => room.id === currentId) ?? null
})

export const currentRoomMessagesAtom = atom<RoomMessage[]>((get) => {
  const currentId = get(currentRoomIdAtom)
  if (!currentId) return []
  return get(roomMessagesAtom).get(roomMessageKey(currentId, get(currentRoomChannelIdAtom))) ?? []
})

export const currentRoomChannelsAtom = atom<RoomChannel[]>((get) => {
  const currentId = get(currentRoomIdAtom)
  if (!currentId) return []
  return get(roomChannelsAtom).get(currentId) ?? []
})

export const currentRoomChannelAtom = atom<RoomChannel | null>((get) => {
  const channelId = get(currentRoomChannelIdAtom)
  return get(currentRoomChannelsAtom).find((channel) => channel.id === channelId) ?? null
})

export const currentRoomMembersAtom = atom<RoomMemberConfig[]>((get) => {
  const currentId = get(currentRoomIdAtom)
  if (!currentId) return []
  return get(roomMembersAtom).get(currentId) ?? []
})

export const currentRoomDraftsAtom = atom<RoomDraft[]>((get) => {
  const currentId = get(currentRoomIdAtom)
  if (!currentId) return []
  const channelId = get(currentRoomChannelIdAtom)
  return (get(roomDraftsAtom).get(currentId) ?? []).filter((draft) => (
    (draft.roomChannelId ?? DEFAULT_ROOM_CHANNEL_ID) === channelId
  ))
})

function applyRoomStreamEvent(messages: RoomMessage[], event: RoomStreamEvent): RoomMessage[] {
  if (event.type === 'message_added') {
    if (messages.some((message) => message.id === event.message.id)) return messages
    return [...messages, event.message]
  }
  return messages.map((message) => {
    if (message.id !== event.messageId) return message
    if (event.type === 'agent_started') {
      return { ...message, status: 'streaming' }
    }
    if (event.type === 'agent_progress') {
      const progress = message.progress ?? []
      const last = progress.at(-1)
      if (last?.kind === event.item.kind && last.content === event.item.content) return message
      return { ...message, progress: [...progress, event.item].slice(-30) }
    }
    if (event.type === 'agent_completed') {
      return { ...message, content: event.content, status: 'final' }
    }
    return { ...message, content: `运行失败：${event.error}`, status: 'error', error: event.error }
  })
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const loadRoomsAtom = atom(null, async (_get, set) => {
  set(roomLoadingAtom, true)
  set(roomErrorAtom, null)
  try {
    const rooms = await window.electronAPI.listRooms()
    set(roomsAtom, rooms)
    const firstRoom = rooms.find((room) => !room.archived) ?? rooms[0] ?? null
    set(currentRoomIdAtom, firstRoom?.id ?? null)
    if (firstRoom) {
      const channels = await window.electronAPI.listRoomChannels(firstRoom.id)
      const firstChannel = channels.find((channel) => !channel.archived) ?? channels[0]
      const channelId = firstChannel?.id ?? DEFAULT_ROOM_CHANNEL_ID
      set(currentRoomChannelIdAtom, channelId)
      const [messages, members, drafts] = await Promise.all([
        window.electronAPI.getRoomMessages(firstRoom.id, channelId),
        window.electronAPI.listRoomMembers(firstRoom.id),
        window.electronAPI.listRoomDrafts(firstRoom.id),
      ])
      set(roomChannelsAtom, new Map([[firstRoom.id, channels]]))
      set(roomMessagesAtom, new Map([[roomMessageKey(firstRoom.id, channelId), messages]]))
      set(roomMembersAtom, new Map([[firstRoom.id, members]]))
      set(roomDraftsAtom, new Map([[firstRoom.id, drafts]]))
    }
  } catch (error) {
    set(roomErrorAtom, getErrorMessage(error))
  } finally {
    set(roomLoadingAtom, false)
  }
})

export const selectRoomAtom = atom(null, async (_get, set, roomId: string) => {
  set(currentRoomIdAtom, roomId)
  set(roomLoadingAtom, true)
  set(roomErrorAtom, null)
  try {
    const channels = await window.electronAPI.listRoomChannels(roomId)
    const firstChannel = channels.find((channel) => !channel.archived) ?? channels[0]
    const channelId = firstChannel?.id ?? DEFAULT_ROOM_CHANNEL_ID
    set(currentRoomChannelIdAtom, channelId)
    const [messages, members, drafts] = await Promise.all([
      window.electronAPI.getRoomMessages(roomId, channelId),
      window.electronAPI.listRoomMembers(roomId),
      window.electronAPI.listRoomDrafts(roomId),
    ])
    set(roomChannelsAtom, (prev) => new Map(prev).set(roomId, channels))
    set(roomMessagesAtom, (prev) => new Map(prev).set(roomMessageKey(roomId, channelId), messages))
    set(roomMembersAtom, (prev) => new Map(prev).set(roomId, members))
    set(roomDraftsAtom, (prev) => new Map(prev).set(roomId, drafts))
  } catch (error) {
    set(roomErrorAtom, getErrorMessage(error))
  } finally {
    set(roomLoadingAtom, false)
  }
})

export const selectRoomChannelAtom = atom(null, async (get, set, roomChannelId: string) => {
  const roomId = get(currentRoomIdAtom)
  if (!roomId) return
  set(currentRoomChannelIdAtom, roomChannelId)
  set(roomLoadingAtom, true)
  set(roomErrorAtom, null)
  try {
    const messages = await window.electronAPI.getRoomMessages(roomId, roomChannelId)
    set(roomMessagesAtom, (prev) => new Map(prev).set(roomMessageKey(roomId, roomChannelId), messages))
  } catch (error) {
    set(roomErrorAtom, getErrorMessage(error))
  } finally {
    set(roomLoadingAtom, false)
  }
})

export const createRoomChannelAtom = atom(null, async (get, set, name: string) => {
  const roomId = get(currentRoomIdAtom)
  const trimmed = name.trim()
  if (!roomId || !trimmed) return
  set(roomErrorAtom, null)
  try {
    const channel = await window.electronAPI.createRoomChannel({ roomId, name: trimmed })
    const channels = await window.electronAPI.listRoomChannels(roomId)
    set(roomChannelsAtom, (prev) => new Map(prev).set(roomId, channels))
    set(currentRoomChannelIdAtom, channel.id)
    set(roomMessagesAtom, (prev) => new Map(prev).set(roomMessageKey(roomId, channel.id), []))
  } catch (error) {
    set(roomErrorAtom, getErrorMessage(error))
  }
})

export const deleteRoomChannelAtom = atom(null, async (get, set, channelId: string) => {
  const roomId = get(currentRoomIdAtom)
  if (!roomId || channelId === DEFAULT_ROOM_CHANNEL_ID) return
  set(roomErrorAtom, null)
  try {
    await window.electronAPI.deleteRoomChannel(roomId, channelId)
    const channels = await window.electronAPI.listRoomChannels(roomId)
    set(roomChannelsAtom, (prev) => new Map(prev).set(roomId, channels))

    if (get(currentRoomChannelIdAtom) === channelId) {
      const fallback = channels.find((channel) => !channel.archived && channel.id !== channelId)
      const fallbackId = fallback?.id ?? DEFAULT_ROOM_CHANNEL_ID
      set(currentRoomChannelIdAtom, fallbackId)
      const messages = await window.electronAPI.getRoomMessages(roomId, fallbackId)
      set(roomMessagesAtom, (prev) => new Map(prev).set(roomMessageKey(roomId, fallbackId), messages))
    }
  } catch (error) {
    set(roomErrorAtom, getErrorMessage(error))
  }
})

export const sendRoomMessageAtom = atom(null, async (get, set, content: string) => {
  const roomId = get(currentRoomIdAtom)
  const roomChannelId = get(currentRoomChannelIdAtom)
  if (!roomId) return
  const trimmed = content.trim()
  if (!trimmed) return

  set(roomSendingAtom, true)
  set(roomErrorAtom, null)
  try {
    const messages = await window.electronAPI.sendRoomMessage({ roomId, roomChannelId, content: trimmed })
    const drafts = await window.electronAPI.listRoomDrafts(roomId)
    set(roomMessagesAtom, (prev) => new Map(prev).set(roomMessageKey(roomId, roomChannelId), messages))
    set(roomDraftsAtom, (prev) => new Map(prev).set(roomId, drafts))
  } catch (error) {
    set(roomErrorAtom, getErrorMessage(error))
  } finally {
    set(roomSendingAtom, false)
  }
})

export const updateRoomDraftAtom = atom(null, async (get, set, input: { roomId: string; draftId: string; action: 'send' | 'discard'; content?: string }) => {
  set(roomErrorAtom, null)
  try {
    const roomChannelId = get(currentRoomChannelIdAtom)
    await window.electronAPI.updateRoomDraft({ ...input, roomChannelId })
    const [messages, drafts] = await Promise.all([
      window.electronAPI.getRoomMessages(input.roomId, roomChannelId),
      window.electronAPI.listRoomDrafts(input.roomId),
    ])
    set(roomMessagesAtom, (prev) => new Map(prev).set(roomMessageKey(input.roomId, roomChannelId), messages))
    set(roomDraftsAtom, (prev) => new Map(prev).set(input.roomId, drafts))
  } catch (error) {
    set(roomErrorAtom, getErrorMessage(error))
  }
})

export const saveRoomMemberAtom = atom(null, async (_get, set, input: RoomMemberSaveInput) => {
  set(roomErrorAtom, null)
  try {
    await window.electronAPI.saveRoomMember(input)
    const members = await window.electronAPI.listRoomMembers(input.roomId)
    set(roomMembersAtom, (prev) => new Map(prev).set(input.roomId, members))
  } catch (error) {
    set(roomErrorAtom, getErrorMessage(error))
  }
})

export const deleteRoomMemberAtom = atom(null, async (_get, set, input: { roomId: string; memberId: string }) => {
  set(roomErrorAtom, null)
  try {
    await window.electronAPI.deleteRoomMember(input.roomId, input.memberId)
    const members = await window.electronAPI.listRoomMembers(input.roomId)
    set(roomMembersAtom, (prev) => new Map(prev).set(input.roomId, members))
  } catch (error) {
    set(roomErrorAtom, getErrorMessage(error))
  }
})

export const applyRoomStreamEventAtom = atom(null, (_get, set, event: RoomStreamEvent) => {
  set(roomMessagesAtom, (prev) => {
    const channelId = event.type === 'message_added'
      ? event.message.roomChannelId ?? DEFAULT_ROOM_CHANNEL_ID
      : event.roomChannelId ?? DEFAULT_ROOM_CHANNEL_ID
    const key = roomMessageKey(event.roomId, channelId)
    const current = prev.get(key) ?? []
    if (event.type === 'message_added') {
      return new Map(prev).set(key, applyRoomStreamEvent(current, event))
    }
    if (!current.some((message) => message.id === event.messageId)) return prev
    return new Map(prev).set(key, applyRoomStreamEvent(current, event))
  })
})
