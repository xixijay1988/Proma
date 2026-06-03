export interface NormalizedToolResultImage {
  src: string
  mimeType: string
}

export interface NormalizedToolResultContent {
  text?: string
  images: NormalizedToolResultImage[]
  structuredJson?: string
}

export type PiMcpBridgeType =
  | 'proma-pi-mcp-list-tools'
  | 'proma-pi-mcp-call-tool'
  | 'proma-pi-mcp-remote-tool'

export interface PiMcpBridgeDisplay {
  bridgeType: PiMcpBridgeType
  label: string
  description: string
  server?: string
  toolName?: string
  nativeToolName?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stringifyJson(value: unknown): string | undefined {
  if (value === undefined) return undefined

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function normalizeImageSource(data: string, mimeType: string): string {
  if (data.startsWith('data:')) return data
  return `data:${mimeType};base64,${data}`
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function getBridgeType(value: unknown): PiMcpBridgeType | undefined {
  if (
    value === 'proma-pi-mcp-list-tools' ||
    value === 'proma-pi-mcp-call-tool' ||
    value === 'proma-pi-mcp-remote-tool'
  ) {
    return value
  }
  return undefined
}

export function getPiMcpBridgeDisplay(toolUseResult: unknown): PiMcpBridgeDisplay | null {
  if (!isRecord(toolUseResult)) return null
  const details = toolUseResult.details
  if (!isRecord(details)) return null

  const bridgeType = getBridgeType(details.bridgeType)
  if (!bridgeType) return null

  const server = readString(details, 'server')
  const toolName = readString(details, 'toolName')
  const nativeToolName = readString(details, 'nativeToolName')
  const serverLabel = server ?? 'unknown'

  if (bridgeType === 'proma-pi-mcp-list-tools') {
    const toolCount = typeof details.toolCount === 'number' ? details.toolCount : undefined
    return {
      bridgeType,
      label: `MCP ${serverLabel} / list_tools`,
      description: toolCount !== undefined ? `列出 ${toolCount} 个 MCP 工具` : '列出 MCP 工具',
      server,
      nativeToolName,
    }
  }

  const displayToolName = toolName ?? nativeToolName ?? 'call_tool'
  return {
    bridgeType,
    label: `MCP ${serverLabel} / ${displayToolName}`,
    description: bridgeType === 'proma-pi-mcp-call-tool' ? '通过 call_tool 兜底调用' : 'Pi MCP 原生工具',
    server,
    toolName,
    nativeToolName,
  }
}

export function normalizeToolResultContent(content: unknown, toolUseResult?: unknown): NormalizedToolResultContent {
  if (typeof content === 'string') {
    return {
      text: content,
      images: [],
      structuredJson: isRecord(toolUseResult) ? stringifyJson(toolUseResult.structuredContent) : undefined,
    }
  }

  if (!Array.isArray(content)) {
    return {
      text: content === undefined || content === null ? undefined : stringifyJson(content),
      images: [],
      structuredJson: isRecord(toolUseResult) ? stringifyJson(toolUseResult.structuredContent) : undefined,
    }
  }

  const texts: string[] = []
  const images: NormalizedToolResultImage[] = []

  for (const item of content) {
    if (!isRecord(item)) continue

    if (item.type === 'text' && typeof item.text === 'string') {
      texts.push(item.text)
      continue
    }

    if (item.type === 'image' && typeof item.data === 'string' && typeof item.mimeType === 'string') {
      images.push({
        src: normalizeImageSource(item.data, item.mimeType),
        mimeType: item.mimeType,
      })
    }
  }

  return {
    text: texts.length > 0 ? texts.join('\n') : undefined,
    images,
    structuredJson: isRecord(toolUseResult) ? stringifyJson(toolUseResult.structuredContent) : undefined,
  }
}
