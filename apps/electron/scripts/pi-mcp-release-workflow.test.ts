import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Pi MCP release workflow smoke', () => {
  test('Given release builds package Pi runtime When publishing macOS artifacts Then packaged smoke runs before publish', () => {
    const workflow = readFileSync(join(process.cwd(), '.github/workflows/release.yml'), 'utf-8')

    expect(workflow).toContain('Pi MCP packaged smoke 预检 (macOS arm64)')
    expect(workflow).toContain('npx electron-builder --mac --arm64 --dir')
    expect(workflow).toContain('bun run smoke:pi-mcp-packaged -- --platform darwin')
    expect(workflow.indexOf('Pi MCP packaged smoke 预检 (macOS arm64)')).toBeLessThan(
      workflow.indexOf('打包并发布 (macOS)'),
    )
    expect(workflow).toContain('Pi MCP packaged smoke 预检 (macOS x64)')
    expect(workflow).toContain('npx electron-builder --mac --x64 --dir')
    expect(workflow.indexOf('Pi MCP packaged smoke 预检 (macOS x64)')).toBeLessThan(
      workflow.indexOf('打包并发布 (macOS x64)'),
    )
  })

  test('Given release builds package Pi runtime When publishing Windows artifacts Then packaged smoke runs before publish', () => {
    const workflow = readFileSync(join(process.cwd(), '.github/workflows/release.yml'), 'utf-8')

    expect(workflow).toContain('Pi MCP packaged smoke 预检 (Windows x64)')
    expect(workflow).toContain('npx electron-builder --win --x64 --dir')
    expect(workflow).toContain('bun run smoke:pi-mcp-packaged -- --platform win32')
    expect(workflow.indexOf('Pi MCP packaged smoke 预检 (Windows x64)')).toBeLessThan(
      workflow.indexOf('打包并发布 (Windows)'),
    )
  })

  test('Given release builds package Pi runtime When publishing Linux artifacts Then packaged smoke runs before publish', () => {
    const workflow = readFileSync(join(process.cwd(), '.github/workflows/release.yml'), 'utf-8')

    expect(workflow).toContain('build-linux-x64')
    expect(workflow).toContain('Pi MCP packaged smoke 预检 (Linux x64)')
    expect(workflow).toContain('npx electron-builder --linux --x64 --dir')
    expect(workflow).toContain('bun run smoke:pi-mcp-packaged -- --platform linux')
    expect(workflow.indexOf('Pi MCP packaged smoke 预检 (Linux x64)')).toBeLessThan(
      workflow.indexOf('打包并发布 (Linux)'),
    )
  })
})
