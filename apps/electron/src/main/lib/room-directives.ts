export type RoomDirectiveKind = 'room-handoff' | 'room-wait-user' | 'room-done' | 'room-note'

export interface RoomDirective {
  kind: RoomDirectiveKind
  attrs: Record<string, string>
  body: string
}

const DIRECTIVE_KINDS = new Set<RoomDirectiveKind>([
  'room-handoff',
  'room-wait-user',
  'room-done',
  'room-note',
])

function isRoomDirectiveKind(value: string): value is RoomDirectiveKind {
  return DIRECTIVE_KINDS.has(value as RoomDirectiveKind)
}

function parseAttrs(rawAttrs: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const attrPattern = /([A-Za-z][A-Za-z0-9_-]*)\s*=\s*"([^"]*)"/g
  let match: RegExpExecArray | null
  while ((match = attrPattern.exec(rawAttrs)) !== null) {
    const key = match[1]
    const value = match[2]
    if (!key || value === undefined) continue
    attrs[key] = value
  }
  return attrs
}

export function parseRoomDirectives(content: string): RoomDirective[] {
  const directives: RoomDirective[] = []
  const directivePattern = /::(room-[a-z-]+)(?:\{([^}]*)\})?\s*\n([\s\S]*?)\n::/g
  let match: RegExpExecArray | null

  while ((match = directivePattern.exec(content)) !== null) {
    const kind = match[1]
    if (!kind || !isRoomDirectiveKind(kind)) continue
    directives.push({
      kind,
      attrs: parseAttrs(match[2] ?? ''),
      body: (match[3] ?? '').trim(),
    })
  }

  return directives
}
