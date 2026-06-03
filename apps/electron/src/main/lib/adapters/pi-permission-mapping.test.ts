import { describe, expect, test } from 'bun:test'
import {
  buildPiPermissionExtensionSourceForTest,
} from './pi-permission-extension'
import {
  mapPiToolPermission,
  mapPromaPermissionModeToPiMode,
  type PiPermissionMode,
} from './pi-permission-mapping'

describe('pi permission mapping', () => {
  test('Given Pi ask mode When assigned Then accepts confirmed native mode', () => {
    const mode: PiPermissionMode = 'ask'

    expect(mode).toBe('ask')
  })

  test('Given safe mode When read tool requested Then allow', () => {
    expect(mapPiToolPermission({ mode: 'safe', toolName: 'read' })).toEqual({ behavior: 'allow' })
  })

  test('Given ask mode When normalized read tool requested Then allow', () => {
    expect(mapPiToolPermission({ mode: 'ask', toolName: 'Web_Search' })).toEqual({ behavior: 'allow' })
  })

  test('Given ask mode When Proma task tool requested Then allow because it only manages visible progress', () => {
    expect(mapPiToolPermission({ mode: 'ask', toolName: 'TaskCreate' })).toEqual({ behavior: 'allow' })
    expect(mapPiToolPermission({ mode: 'ask', toolName: 'TaskUpdate' })).toEqual({ behavior: 'allow' })
    expect(mapPiToolPermission({ mode: 'ask', toolName: 'TaskGet' })).toEqual({ behavior: 'allow' })
    expect(mapPiToolPermission({ mode: 'ask', toolName: 'TaskList' })).toEqual({ behavior: 'allow' })
    expect(mapPiToolPermission({ mode: 'ask', toolName: 'TaskOutput' })).toEqual({ behavior: 'allow' })
  })

  test('Given safe mode When write tool requested Then ask', () => {
    expect(mapPiToolPermission({ mode: 'safe', toolName: 'write' })).toEqual({ behavior: 'ask', dangerLevel: 'medium' })
  })

  test('Given ask mode When shell tool requested Then ask high danger', () => {
    expect(mapPiToolPermission({ mode: 'ask', toolName: 'Shell' })).toEqual({ behavior: 'ask', dangerLevel: 'high' })
  })

  test('Given safe mode When unknown tool requested Then ask medium danger', () => {
    expect(mapPiToolPermission({ mode: 'safe', toolName: 'unknown_tool' })).toEqual({ behavior: 'ask', dangerLevel: 'medium' })
  })

  test('Given safe mode When MCP list tools requested Then allow because it only inspects available tools', () => {
    expect(mapPiToolPermission({ mode: 'safe', toolName: 'mcp__docs__list_tools' })).toEqual({
      behavior: 'allow',
    })
  })

  test('Given ask mode When MCP remote tool requested Then ask with explicit medium danger', () => {
    expect(mapPiToolPermission({ mode: 'ask', toolName: 'mcp__docs__inspect_result' })).toEqual({
      behavior: 'ask',
      dangerLevel: 'medium',
    })
  })

  test('Given ask mode When MCP remote tool is read-like Then allow without prompting', () => {
    expect(mapPiToolPermission({
      mode: 'ask',
      toolName: 'mcp__docs__search_docs',
      toolDescription: 'Search documentation and return matching pages.',
    })).toEqual({
      behavior: 'allow',
    })
  })

  test('Given safe mode When MCP remote tool description mentions mutation Then ask even if name looks read-like', () => {
    expect(mapPiToolPermission({
      mode: 'safe',
      toolName: 'mcp__docs__inspect_result',
      toolDescription: 'Inspect and delete cached result records.',
    })).toEqual({
      behavior: 'ask',
      dangerLevel: 'medium',
    })
  })

  test('Given allow-all mode When bash requested Then allow without scope check', () => {
    expect(mapPiToolPermission({ mode: 'allow-all', toolName: 'bash' })).toEqual({
      behavior: 'allow',
    })
  })

  test('Given allow-all mode When write tool requested Then allow without scope check', () => {
    expect(mapPiToolPermission({ mode: 'allow-all', toolName: 'write' })).toEqual({
      behavior: 'allow',
    })
  })

  test('Given allow-all mode When filesystem read tool requested Then allow without scope check', () => {
    expect(mapPiToolPermission({ mode: 'allow-all', toolName: 'read' })).toEqual({
      behavior: 'allow',
    })
  })

  test('Given Proma permission mode When mapped Then returns explicit Pi mode', () => {
    expect(mapPromaPermissionModeToPiMode('bypassPermissions')).toBe('allow-all')
    expect(mapPromaPermissionModeToPiMode('auto')).toBe('ask')
    expect(mapPromaPermissionModeToPiMode('plan')).toBe('safe')
  })

  test('Given permission extension source When generated Then embeds mode and allowed directories', () => {
    const source = buildPiPermissionExtensionSourceForTest({
      piMode: 'ask',
      allowedDirectories: ['/tmp/workspace', '/tmp/attached'],
    })

    expect(source).toContain("pi.on('tool_call'")
    expect(source).toContain("pi.registerCommand('proma-permission-mode'")
    expect(source).toContain('Proma Pi 权限确认')
    expect(source).toContain('let currentPermissionMode = "ask"')
    expect(source).toContain('"/tmp/workspace"')
    expect(source).toContain('"/tmp/attached"')
  })

  test('Given allow-all extension source When generated Then bypasses path guard before allowed directory check', () => {
    const source = buildPiPermissionExtensionSourceForTest({
      piMode: 'allow-all',
      allowedDirectories: ['/tmp/workspace'],
    })

    const allowAllIndex = source.indexOf("if (currentPermissionMode === 'allow-all') return undefined")
    const pathGuardIndex = source.indexOf('if (pathValue && !isPathAllowed(pathValue))')

    expect(allowAllIndex).toBeGreaterThan(-1)
    expect(pathGuardIndex).toBeGreaterThan(-1)
    expect(allowAllIndex).toBeLessThan(pathGuardIndex)
  })

  test('Given permission extension source When generated Then exposes internal command for dynamic mode switching', () => {
    const source = buildPiPermissionExtensionSourceForTest({
      piMode: 'ask',
      allowedDirectories: ['/tmp/workspace'],
    })

    expect(source).toContain("const VALID_PERMISSION_MODES = new Set(['safe', 'ask', 'allow-all'])")
    expect(source).toContain("pi.registerCommand('proma-permission-mode'")
    expect(source).toContain('currentPermissionMode = requestedMode')
    expect(source).toContain("ctx.ui.notify('Proma Pi 权限模式已切换: ' + currentPermissionMode, 'info')")
  })

  test('Given permission extension source When MCP tool requested Then generated description names the MCP server and tool', () => {
    const source = buildPiPermissionExtensionSourceForTest({
      piMode: 'ask',
      allowedDirectories: ['/tmp/workspace'],
    })

    expect(source).toContain("if (String(toolName || '').trim().toLowerCase().startsWith('mcp__')) return formatMcpToolDescription(toolName)")
    expect(source).toContain("return '调用 MCP 工具: ' + serverName + ' / ' + mcpToolName")
  })

  test('Given permission extension source When generated Then read-like MCP remote tools can be allowed by description', () => {
    const source = buildPiPermissionExtensionSourceForTest({
      piMode: 'ask',
      allowedDirectories: ['/tmp/workspace'],
    })

    expect(source).toContain('function isReadLikeMcpRemoteTool')
    expect(source).toContain("const MCP_READ_VERBS = new Set(['fetch', 'find', 'get', 'inspect', 'list', 'lookup', 'query', 'read', 'search'])")
    expect(source).toContain("if (isReadLikeMcpRemoteTool(rawTool, getToolDescription(input))) return { behavior: 'allow', dangerLevel: 'safe' }")
  })

  test('Given permission extension source When generated Then Proma task tools are allowed without confirmation', () => {
    const source = buildPiPermissionExtensionSourceForTest({
      piMode: 'ask',
      allowedDirectories: ['/tmp/workspace'],
    })

    expect(source).toContain("const progressTools = new Set(['taskcreate', 'taskupdate', 'taskget', 'tasklist', 'taskoutput', 'todowrite'])")
    expect(source).toContain("if (progressTools.has(tool)) return { behavior: 'allow', dangerLevel: 'safe' }")
  })

  test('Given permission extension source When MCP bridge published risk hints Then permission mapping reads global metadata', () => {
    const source = buildPiPermissionExtensionSourceForTest({
      piMode: 'ask',
      allowedDirectories: ['/tmp/workspace'],
    })

    expect(source).toContain('function getGlobalMcpToolRiskHint')
    expect(source).toContain("globalThis.__PROMA_PI_MCP_TOOL_RISK_HINTS__")
    expect(source).toContain('const mcpRiskHint = getGlobalMcpToolRiskHint(rawTool, input)')
    expect(source).toContain("if (mcpRiskHint?.risk === 'read') return { behavior: 'allow', dangerLevel: 'safe' }")
  })

  test('Given permission extension source When MCP call_tool fallback has toolName Then risk hint can resolve the remote tool', () => {
    const source = buildPiPermissionExtensionSourceForTest({
      piMode: 'ask',
      allowedDirectories: ['/tmp/workspace'],
    })

    expect(source).toContain('const mcpRiskHint = getGlobalMcpToolRiskHint(rawTool, input)')
    expect(source).toContain("if (!rawTool.endsWith('__call_tool')) return undefined")
    expect(source).toContain("const requestedToolName = typeof input?.toolName === 'string' ? input.toolName : ''")
    expect(source).toContain('if (hint?.server === serverName && hint?.toolName === requestedToolName) return hint')
  })
})
