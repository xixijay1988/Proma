import type { AgentPendingFile, AgentRuntimeImageInput } from '@proma/shared'

export interface BuildAgentRuntimeImagesInput {
  pendingFiles: AgentPendingFile[]
  readFileData: (fileId: string) => string | undefined
}

export interface BuildQueueableAgentRuntimeImagesResult {
  canQueue: boolean
  images: AgentRuntimeImageInput[]
  unsupportedFiles: string[]
}

export function buildAgentRuntimeImages(input: BuildAgentRuntimeImagesInput): AgentRuntimeImageInput[] {
  return input.pendingFiles.flatMap((file): AgentRuntimeImageInput[] => {
    if (file.sourcePath) return []
    if (!file.mediaType.startsWith('image/')) return []

    const data = input.readFileData(file.id)
    if (!data) return []

    return [{
      type: 'image',
      data,
      mimeType: file.mediaType,
      filename: file.filename,
    }]
  })
}

export function buildQueueableAgentRuntimeImages(input: BuildAgentRuntimeImagesInput): BuildQueueableAgentRuntimeImagesResult {
  const images = buildAgentRuntimeImages(input)
  const supportedImageIds = new Set(
    input.pendingFiles
      .filter((file) => !file.sourcePath && file.mediaType.startsWith('image/') && !!input.readFileData(file.id))
      .map((file) => file.id),
  )
  const unsupportedFiles = input.pendingFiles
    .filter((file) => !supportedImageIds.has(file.id))
    .map((file) => file.filename)

  return {
    canQueue: unsupportedFiles.length === 0,
    images,
    unsupportedFiles,
  }
}
