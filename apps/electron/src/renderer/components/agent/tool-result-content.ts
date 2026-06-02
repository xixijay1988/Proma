export interface NormalizedToolResultImage {
  src: string
  mimeType: string
}

export interface NormalizedToolResultContent {
  text?: string
  images: NormalizedToolResultImage[]
  structuredJson?: string
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
