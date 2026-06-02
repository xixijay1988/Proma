import { describe, expect, test } from 'bun:test'
import {
  normalizeToolResultContent,
} from './tool-result-content'

describe('tool result content normalization', () => {
  test('Given plain string result When normalized Then keeps existing text behavior', () => {
    const normalized = normalizeToolResultContent('hello')

    expect(normalized.text).toBe('hello')
    expect(normalized.images).toEqual([])
    expect(normalized.structuredJson).toBeUndefined()
  })

  test('Given Pi MCP content blocks and structuredContent When normalized Then exposes text image and structured payload', () => {
    const normalized = normalizeToolResultContent(
      [
        { type: 'text', text: 'topic=alpha' },
        { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
        { type: 'text', text: '[MCP resource result]\n{"uri":"file:///alpha.txt"}' },
      ],
      {
        structuredContent: {
          topic: 'alpha',
          ok: true,
        },
      },
    )

    expect(normalized.text).toBe('topic=alpha\n[MCP resource result]\n{"uri":"file:///alpha.txt"}')
    expect(normalized.images).toEqual([
      {
        src: 'data:image/png;base64,iVBORw0KGgo=',
        mimeType: 'image/png',
      },
    ])
    expect(normalized.structuredJson).toBe(JSON.stringify({
      topic: 'alpha',
      ok: true,
    }, null, 2))
  })
})
