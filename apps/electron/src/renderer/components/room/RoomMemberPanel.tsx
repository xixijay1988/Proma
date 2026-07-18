import * as React from 'react'
import { Bot, Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import type { AgentEngine, AgentWorkspace, Channel, PromaPermissionMode, RoomMemberConfig, RoomMemberListenMode, RoomMemberSaveInput } from '@proma/shared'
import { PROMA_PERMISSION_MODE_CONFIG, PROMA_PERMISSION_MODE_ORDER } from '@proma/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  buildRoomMemberSaveInput,
  createRoomMemberFormState,
  getRoomMemberRuntimeLabels,
  type RoomMemberFormState,
} from './room-view-model'

const NONE_VALUE = '__none__'

export interface RoomMemberPanelProps {
  roomId: string | null
  members: RoomMemberConfig[]
  channels: Channel[]
  workspaces: AgentWorkspace[]
  onSaveMember: (input: RoomMemberSaveInput) => void
  onDeleteMember: (roomId: string, memberId: string) => void
}

function toSelectValue(value: string): string {
  return value || NONE_VALUE
}

function fromSelectValue(value: string): string {
  return value === NONE_VALUE ? '' : value
}

interface FieldProps {
  label: string
  children: React.ReactNode
}

function Field({ label, children }: FieldProps): React.ReactElement {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

export function RoomMemberPanel({ roomId, members, channels, workspaces, onSaveMember, onDeleteMember }: RoomMemberPanelProps): React.ReactElement {
  const [formState, setFormState] = React.useState<RoomMemberFormState | null>(null)
  const editingMemberId = formState?.memberId ?? null
  const selectedChannel = channels.find((channel) => channel.id === formState?.channelId)

  const beginCreate = (): void => {
    if (!roomId) return
    setFormState(createRoomMemberFormState({ roomId, memberCount: members.length }))
  }

  const beginEdit = (member: RoomMemberConfig): void => {
    if (!roomId) return
    setFormState(createRoomMemberFormState({ roomId, member, memberCount: members.length }))
  }

  const updateForm = (updates: Partial<RoomMemberFormState>): void => {
    setFormState((current) => current ? { ...current, ...updates } : current)
  }

  const handleSave = (): void => {
    if (!roomId || !formState) return
    onSaveMember(buildRoomMemberSaveInput(roomId, formState))
    setFormState(null)
  }

  const handleDelete = (memberId: string): void => {
    if (!roomId) return
    onDeleteMember(roomId, memberId)
    setFormState((current) => current?.memberId === memberId ? null : current)
  }

  return (
    <aside className="hidden w-[320px] shrink-0 overflow-y-auto border-l border-border/40 bg-muted/20 p-4 lg:block">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Room 成员</h3>
          <p className="text-xs text-muted-foreground">配置 Agent 的角色、模型与工作区</p>
        </div>
        <Button type="button" size="icon-sm" variant="secondary" onClick={beginCreate} disabled={!roomId}>
          <Plus className="size-3.5" />
        </Button>
      </div>

      <div className="space-y-2">
        {members.length === 0 ? (
          <div className="rounded-2xl bg-background/70 p-4 text-xs leading-5 text-muted-foreground shadow-sm">
            还没有成员。添加成员后，可通过 @成员名 唤起，也可让成员监听 Room 并生成待确认草稿。
          </div>
        ) : members.map((member) => {
          const labels = getRoomMemberRuntimeLabels({ member, channels, workspaces })
          const selected = editingMemberId === member.id
          return (
            <div key={member.id} className={cn('rounded-2xl bg-background/80 p-3 shadow-sm', selected && 'ring-1 ring-primary/40')}>
              <div className="flex items-start gap-2">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm">
                  {member.avatar || <Bot className="size-4" />}
                </div>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => beginEdit(member)}>
                  <div className="truncate text-sm font-medium text-foreground">{member.name}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {member.listenMode === 'listen-and-score' ? '监听评分' : '@ 提及时回应'} · {member.enabled ? '启用' : '停用'}
                  </div>
                </button>
                <Button type="button" size="icon-sm" variant="ghost" onClick={() => beginEdit(member)}>
                  <Pencil className="size-3.5" />
                </Button>
              </div>
              <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{member.rolePrompt}</p>
              <div className="mt-2 rounded-xl bg-muted/50 px-2.5 py-2 text-[11px] leading-5 text-muted-foreground">
                <div className={labels.runtimeReady ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                  {labels.runtimeReady ? '可运行真实 Agent' : '未配置渠道，仅生成占位/草稿'}
                </div>
                <div className="truncate">{labels.channelLabel} · {labels.modelLabel}</div>
                <div className="truncate">{labels.workspaceLabel} · {labels.engineLabel}</div>
              </div>
            </div>
          )
        })}
      </div>

      {formState && (
        <div className="mt-4 rounded-3xl bg-background/90 p-4 shadow-sm ring-1 ring-border/50">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-semibold text-foreground">{formState.memberId ? '编辑成员' : '新建成员'}</h4>
              <p className="text-xs text-muted-foreground">保存后用于后续真实 Agent 运行</p>
            </div>
            <Button type="button" size="icon-sm" variant="ghost" onClick={() => setFormState(null)}>
              <X className="size-3.5" />
            </Button>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-[72px_1fr] gap-2">
              <Field label="头像">
                <Input value={formState.avatar} onChange={(event) => updateForm({ avatar: event.target.value })} placeholder="🤖" />
              </Field>
              <Field label="名称">
                <Input value={formState.name} onChange={(event) => updateForm({ name: event.target.value })} placeholder="Planner" />
              </Field>
            </div>

            <Field label="角色提示词">
              <Textarea
                value={formState.rolePrompt}
                onChange={(event) => updateForm({ rolePrompt: event.target.value })}
                placeholder="描述这个 Agent 在 Room 中负责什么"
                className="min-h-[96px] resize-none text-sm"
              />
            </Field>

            <Field label="渠道">
              <Select
                value={toSelectValue(formState.channelId)}
                onValueChange={(value) => updateForm({ channelId: fromSelectValue(value), modelId: '' })}
              >
                <SelectTrigger><SelectValue placeholder="选择渠道" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>不绑定渠道</SelectItem>
                  {channels.map((channel) => (
                    <SelectItem key={channel.id} value={channel.id}>{channel.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="模型">
              <Select
                value={toSelectValue(formState.modelId)}
                onValueChange={(value) => updateForm({ modelId: fromSelectValue(value) })}
                disabled={!selectedChannel}
              >
                <SelectTrigger><SelectValue placeholder="使用默认模型" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>使用默认模型</SelectItem>
                  {selectedChannel?.models.filter((model) => model.enabled).map((model) => (
                    <SelectItem key={model.id} value={model.id}>{model.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="工作区">
              <Select value={toSelectValue(formState.workspaceId)} onValueChange={(value) => updateForm({ workspaceId: fromSelectValue(value) })}>
                <SelectTrigger><SelectValue placeholder="使用当前默认工作区" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>使用当前默认工作区</SelectItem>
                  {workspaces.map((workspace) => (
                    <SelectItem key={workspace.id} value={workspace.id}>{workspace.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="运行引擎">
              <Select value={toSelectValue(formState.agentEngine)} onValueChange={(value) => updateForm({ agentEngine: fromSelectValue(value) as AgentEngine | '' })}>
                <SelectTrigger><SelectValue placeholder="跟随工作区" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>跟随工作区</SelectItem>
                  <SelectItem value="claude-sdk">Claude SDK</SelectItem>
                  <SelectItem value="pi">Pi Agent RPC (experimental)</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <Field label="监听方式">
                <Select value={formState.listenMode} onValueChange={(value) => updateForm({ listenMode: value as RoomMemberListenMode })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="listen-and-score">监听评分</SelectItem>
                    <SelectItem value="mention-only">仅 @ 提及</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="权限模式">
                <Select value={formState.permissionMode} onValueChange={(value) => updateForm({ permissionMode: value as PromaPermissionMode })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROMA_PERMISSION_MODE_ORDER.map((mode) => (
                      <SelectItem key={mode} value={mode}>{PROMA_PERMISSION_MODE_CONFIG[mode].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field label="私有记忆摘要">
              <Textarea
                value={formState.privateMemorySummary}
                onChange={(event) => updateForm({ privateMemorySummary: event.target.value })}
                placeholder="可选：这个成员长期知道什么"
                className="min-h-[72px] resize-none text-sm"
              />
            </Field>

            <div className="flex items-center justify-between rounded-2xl bg-muted/50 px-3 py-2">
              <div>
                <div className="text-xs font-medium text-foreground">启用成员</div>
                <div className="text-[11px] text-muted-foreground">停用后不会参与监听或 @ 路由</div>
              </div>
              <Switch checked={formState.enabled} onCheckedChange={(checked) => updateForm({ enabled: checked })} />
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              {formState.memberId ? (
                <Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => { if (formState.memberId) handleDelete(formState.memberId) }}>
                  <Trash2 className="size-3.5" /> 删除
                </Button>
              ) : <span />}
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="ghost" onClick={() => setFormState(null)}>取消</Button>
                <Button type="button" size="sm" onClick={handleSave} disabled={!formState.name.trim() || !formState.rolePrompt.trim()}>
                  <Check className="size-3.5" /> 保存
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
