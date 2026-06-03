import type { AgentPendingFile, AgentRuntimeImageInput } from '@proma/shared'

export interface BuildAgentRuntimeImagesInput {
  pendingFiles: AgentPendingFile[]
  readFileData: (fileId: string) => string | undefined
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
