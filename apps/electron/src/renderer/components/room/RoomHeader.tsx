import * as React from 'react'
import { Hash, UsersRound } from 'lucide-react'
import type { RoomChannel, RoomMeta, RoomMemberConfig } from '@proma/shared'

export interface RoomHeaderProps {
  room: RoomMeta | null
  channel?: RoomChannel | null
  members: RoomMemberConfig[]
}

export function RoomHeader({ room, channel, members }: RoomHeaderProps): React.ReactElement {
  const enabledCount = members.filter((member) => member.enabled).length
  return (
    <div className="flex items-center justify-between border-b border-border/40 px-5 py-3 bg-background/70 backdrop-blur">
      <div className="flex items-center gap-3 min-w-0">
        <div className="size-10 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shadow-sm">
          <UsersRound className="size-5" />
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-foreground">{room?.title ?? 'Slock Room'}</h2>
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span className="truncate">{room?.description || '多人 Agent 协作房间 · 支持 @Agent 与草稿确认'}</span>
            {channel && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5">
                <Hash className="size-3" />
                {channel.name}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
        {enabledCount} 位成员在线
      </div>
    </div>
  )
}
