import { describe, expect, test } from 'bun:test'
import {
  getPiMcpBridgeDisplay,
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

  test('Given Pi MCP bridge details When display metadata is requested Then returns user visible provenance labels', () => {
    expect(getPiMcpBridgeDisplay({
      details: {
        bridgeType: 'proma-pi-mcp-list-tools',
        server: 'docs',
        nativeToolName: 'mcp__docs__list_tools',
        toolCount: 3,
      },
    })).toEqual({
      bridgeType: 'proma-pi-mcp-list-tools',
      label: 'MCP docs / list_tools',
      description: '列出 3 个 MCP 工具',
      server: 'docs',
      nativeToolName: 'mcp__docs__list_tools',
    })

    expect(getPiMcpBridgeDisplay({
      details: {
        bridgeType: 'proma-pi-mcp-call-tool',
        server: 'docs',
        toolName: 'inspect-result',
        nativeToolName: 'mcp__docs__call_tool',
      },
    })).toMatchObject({
      bridgeType: 'proma-pi-mcp-call-tool',
      label: 'MCP docs / inspect-result',
      description: '通过 call_tool 兜底调用',
    })

    expect(getPiMcpBridgeDisplay({
      details: {
        bridgeType: 'proma-pi-mcp-remote-tool',
        server: 'docs',
        toolName: 'inspect-result',
        nativeToolName: 'mcp__docs__inspect_result',
      },
    })).toMatchObject({
      bridgeType: 'proma-pi-mcp-remote-tool',
      label: 'MCP docs / inspect-result',
      description: 'Pi MCP 原生工具',
    })
  })
})
