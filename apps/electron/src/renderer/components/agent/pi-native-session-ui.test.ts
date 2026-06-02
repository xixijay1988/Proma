import { describe, expect, test } from 'bun:test'
import type { PiNativeSessionSummary } from '@proma/shared'
import {
  formatPiNativeSessionCwd,
  formatPiNativeSessionTime,
  getPiNativeSessionDisplayTitle,
} from './pi-native-session-ui.ts'

describe('Pi 原生会话 UI 摘要', () => {
  test('优先使用 Pi session name 作为展示标题', () => {
    const summary: PiNativeSessionSummary = {
      id: 'pi-session-1',
      path: '/Users/dawn/.proma/pi-agent-sessions/session.jsonl',
      updatedAt: Date.parse('2026-06-02T12:00:00.000Z'),
      sessionName: '修复 Pi 会话浏览器',
      firstUserMessage: '帮我检查 Pi MCP bridge 的权限流程',
      messageCount: 4,
    }

    expect(getPiNativeSessionDisplayTitle(summary)).toBe('修复 Pi 会话浏览器')
  })

  test('优先使用首条用户消息作为展示标题', () => {
    const summary: PiNativeSessionSummary = {
      id: 'pi-session-1',
      path: '/Users/dawn/.proma/pi-agent-sessions/session.jsonl',
      updatedAt: Date.parse('2026-06-02T12:00:00.000Z'),
      firstUserMessage: '  帮我检查 Pi MCP bridge 的权限流程  ',
      messageCount: 4,
    }

    expect(getPiNativeSessionDisplayTitle(summary)).toBe('帮我检查 Pi MCP bridge 的权限流程')
  })

  test('没有首条用户消息时回退到短 session id', () => {
    const summary: PiNativeSessionSummary = {
      id: '1234567890abcdef',
      path: '/Users/dawn/.proma/pi-agent-sessions/session.jsonl',
      updatedAt: Date.parse('2026-06-02T12:00:00.000Z'),
      messageCount: 0,
    }

    expect(getPiNativeSessionDisplayTitle(summary)).toBe('Pi session 12345678')
  })

  test('格式化 cwd 时保留目录尾名并提示完整路径', () => {
    expect(formatPiNativeSessionCwd('/Users/dawn/Code/agent/Proma')).toBe('Proma')
    expect(formatPiNativeSessionCwd(undefined)).toBe('未知目录')
  })

  test('格式化更新时间为本地短时间', () => {
    const value = formatPiNativeSessionTime(Date.parse('2026-06-02T12:34:00.000Z'))

    expect(value.length).toBeGreaterThan(0)
    expect(value).not.toContain('Invalid')
  })
})
