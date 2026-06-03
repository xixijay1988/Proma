import { describe, expect, test } from 'bun:test'
import {
  buildAgentRuntimeImages,
} from './agent-runtime-images.ts'

describe('Agent runtime images', () => {
  test('Given pending image files with base64 data When building runtime images Then returns Pi-compatible images', () => {
    const images = buildAgentRuntimeImages({
      pendingFiles: [
        {
          id: 'image-1',
          filename: 'diagram.png',
          mediaType: 'image/png',
          size: 128,
        },
        {
          id: 'text-1',
          filename: 'notes.txt',
          mediaType: 'text/plain',
          size: 64,
        },
      ],
      readFileData: (id) => id === 'image-1' ? 'iVBORw0KGgo=' : 'hello',
    })

    expect(images).toEqual([
      {
        type: 'image',
        data: 'iVBORw0KGgo=',
        mimeType: 'image/png',
        filename: 'diagram.png',
      },
    ])
  })

  test('Given path-backed or missing image data When building runtime images Then skips unsafe inline payloads', () => {
    const images = buildAgentRuntimeImages({
      pendingFiles: [
        {
          id: 'path-image',
          filename: 'large.png',
          mediaType: 'image/png',
          size: 1024,
          sourcePath: '/tmp/large.png',
        },
        {
          id: 'missing-data',
          filename: 'missing.jpg',
          mediaType: 'image/jpeg',
          size: 32,
        },
      ],
      readFileData: () => '',
    })

    expect(images).toEqual([])
  })
})
