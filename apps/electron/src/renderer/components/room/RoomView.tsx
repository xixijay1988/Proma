import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { SendHorizonal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { agentWorkspacesAtom } from '@/atoms/agent-atoms'
import { AskUserBanner } from '@/components/agent/AskUserBanner'
import { PermissionBanner } from '@/components/agent/PermissionBanner'
import { channelsAtom } from '@/atoms/chat-atoms'
import {
  currentRoomAtom,
  currentRoomChannelAtom,
  currentRoomChannelIdAtom,
  currentRoomDraftsAtom,
  currentRoomIdAtom,
  currentRoomMembersAtom,
  currentRoomMessagesAtom,
  applyRoomStreamEventAtom,
  deleteRoomMemberAtom,
  loadRoomsAtom,
  roomErrorAtom,
  roomLoadingAtom,
  roomSendingAtom,
  selectRoomAtom,
  saveRoomMemberAtom,
  sendRoomMessageAtom,
  updateRoomDraftAtom,
} from '@/atoms/room-atoms'
import { RoomHeader } from './RoomHeader'
import { RoomMessages } from './RoomMessages'
import { RoomMemberPanel } from './RoomMemberPanel'
import { getMentionableMembers, getPendingDrafts, getRoomAgentSessionIdForMember, getRoomMentionQuery, insertRoomMention } from './room-view-model'

export interface RoomViewProps {
  roomId?: string
}
export function RoomView({ roomId }: RoomViewProps): React.ReactElement {
  const currentRoomId = useAtomValue(currentRoomIdAtom)
  const room = useAtomValue(currentRoomAtom)
  const currentChannel = useAtomValue(currentRoomChannelAtom)
  const currentRoomChannelId = useAtomValue(currentRoomChannelIdAtom)
  const messages = useAtomValue(currentRoomMessagesAtom)
  const members = useAtomValue(currentRoomMembersAtom)
  const drafts = useAtomValue(currentRoomDraftsAtom)
  const channels = useAtomValue(channelsAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const loading = useAtomValue(roomLoadingAtom)
  const sending = useAtomValue(roomSendingAtom)
  const error = useAtomValue(roomErrorAtom)
  const loadRooms = useSetAtom(loadRoomsAtom)
  const selectRoom = useSetAtom(selectRoomAtom)
  const sendMessage = useSetAtom(sendRoomMessageAtom)
  const updateDraft = useSetAtom(updateRoomDraftAtom)
  const saveMember = useSetAtom(saveRoomMemberAtom)
  const deleteMember = useSetAtom(deleteRoomMemberAtom)
  const applyRoomStreamEvent = useSetAtom(applyRoomStreamEventAtom)
  const [input, setInput] = React.useState('')
  const [cursorIndex, setCursorIndex] = React.useState(0)
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null)

  React.useEffect(() => {
    if (roomId && roomId !== currentRoomId) {
      void selectRoom(roomId)
      return
    }
    if (!currentRoomId) {
      void loadRooms()
    }
  }, [currentRoomId, roomId, loadRooms, selectRoom])

  React.useEffect(() => {
    return window.electronAPI.onRoomStreamEvent((event) => {
      applyRoomStreamEvent(event)
    })
  }, [applyRoomStreamEvent])

  const pendingDrafts = React.useMemo(() => getPendingDrafts({ drafts, members }), [drafts, members])
  const mentionQuery = React.useMemo(() => getRoomMentionQuery(input, cursorIndex), [cursorIndex, input])
  const mentionMembers = React.useMemo(() => (
    mentionQuery.active ? getMentionableMembers({ members, query: mentionQuery.query }) : []
  ), [members, mentionQuery])
  const showMentionSuggestions = mentionQuery.active && mentionMembers.length > 0

  const updateCursorFromTextarea = (element: HTMLTextAreaElement): void => {
    setCursorIndex(element.selectionStart)
  }

  const selectMentionMember = (memberName: string): void => {
    const next = insertRoomMention(input, cursorIndex, mentionQuery, memberName)
    setInput(next.value)
    setCursorIndex(next.cursorIndex)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(next.cursorIndex, next.cursorIndex)
    })
  }

  const handleSend = (): void => {
    const content = input.trim()
    if (!content) return
    setInput('')
    void sendMessage(content)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-gradient-to-br from-background via-background to-primary/5">
      <RoomHeader room={room} members={members} channel={currentChannel} />
      {error && (
        <div className="mx-5 mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">正在加载 Room...</div>
            ) : (
              <RoomMessages messages={messages} members={members} />
            )}
          </div>

          {currentRoomId && members.map((member) => {
            const sessionId = getRoomAgentSessionIdForMember(currentRoomId, currentRoomChannelId, member.id)
            return (
              <React.Fragment key={member.id}>
                <PermissionBanner sessionId={sessionId} />
                <AskUserBanner sessionId={sessionId} />
              </React.Fragment>
            )
          })}

          {pendingDrafts.length > 0 && (
            <div className="border-t border-border/40 bg-background/70 px-5 py-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">待确认草稿</div>
              <div className="flex gap-3 overflow-x-auto pb-1">
                {pendingDrafts.map((draft) => (
                  <div key={draft.id} className="w-[280px] shrink-0 rounded-2xl bg-card p-3 shadow-sm">
                    <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>{draft.memberAvatar} {draft.memberName}</span>
                      {draft.scoreLabel && <span>相关度 {draft.scoreLabel}</span>}
                    </div>
                    <p className="line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-card-foreground">{draft.content}</p>
                    {draft.reason && <p className="mt-2 line-clamp-2 text-[11px] text-muted-foreground">{draft.reason}</p>}
                    <div className="mt-3 flex justify-end gap-2">
                      <Button type="button" size="sm" variant="ghost" onClick={() => void updateDraft({ roomId: draft.roomId, draftId: draft.id, action: 'discard' })}>
                        丢弃
                      </Button>
                      <Button type="button" size="sm" onClick={() => void updateDraft({ roomId: draft.roomId, draftId: draft.id, action: 'send', content: draft.content })}>
                        发送
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-border/40 bg-background/80 p-4">
            <div className="relative flex items-end gap-3 rounded-2xl bg-muted/40 p-2 shadow-inner">
              {showMentionSuggestions && (
                <div className="absolute bottom-full left-3 mb-2 w-64 overflow-hidden rounded-2xl bg-popover p-1 text-popover-foreground shadow-xl ring-1 ring-border/60">
                  <div className="px-3 py-2 text-[11px] font-medium text-muted-foreground">选择 Room 成员</div>
                  {mentionMembers.map((member) => (
                    <button
                      key={member.id}
                      type="button"
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-muted"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectMentionMember(member.name)}
                    >
                      <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-xs">{member.avatar ?? '🤖'}</span>
                      <span className="min-w-0 flex-1 truncate font-medium">{member.name}</span>
                      <span className="text-[11px] text-muted-foreground">{member.listenMode === 'listen-and-score' ? '监听' : '@回应'}</span>
                    </button>
                  ))}
                </div>
              )}
              <Textarea
                ref={inputRef}
                value={input}
                onChange={(event) => {
                  setInput(event.target.value)
                  updateCursorFromTextarea(event.target)
                }}
                onSelect={(event) => updateCursorFromTextarea(event.currentTarget)}
                onKeyDown={(event) => {
                  if (showMentionSuggestions && event.key === 'Enter') {
                    event.preventDefault()
                    selectMentionMember(mentionMembers[0]!.name)
                    return
                  }
                  if (showMentionSuggestions && event.key === 'Escape') {
                    event.preventDefault()
                    setCursorIndex(-1)
                    return
                  }
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    handleSend()
                  }
                }}
                placeholder={`发消息到 #${currentChannel?.name ?? 'general'}，或 @Planner 直接唤起成员...`}
                className="max-h-40 min-h-[48px] resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
              />
              <Button type="button" size="icon" onClick={handleSend} disabled={sending || !input.trim()}>
                <SendHorizonal className="size-4" />
              </Button>
            </div>
          </div>
        </div>
        <RoomMemberPanel
          roomId={room?.id ?? currentRoomId}
          members={members}
          channels={channels}
          workspaces={workspaces}
          onSaveMember={(member) => void saveMember(member)}
          onDeleteMember={(targetRoomId, memberId) => void deleteMember({ roomId: targetRoomId, memberId })}
        />
      </div>
    </div>
  )
}
