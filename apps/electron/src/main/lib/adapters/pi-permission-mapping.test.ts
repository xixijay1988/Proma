import { describe, expect, test } from 'bun:test'
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

  test('Given safe mode When write tool requested Then ask', () => {
    expect(mapPiToolPermission({ mode: 'safe', toolName: 'write' })).toEqual({ behavior: 'ask', dangerLevel: 'medium' })
  })

  test('Given ask mode When shell tool requested Then ask high danger', () => {
    expect(mapPiToolPermission({ mode: 'ask', toolName: 'Shell' })).toEqual({ behavior: 'ask', dangerLevel: 'high' })
  })

  test('Given safe mode When unknown tool requested Then ask medium danger', () => {
    expect(mapPiToolPermission({ mode: 'safe', toolName: 'unknown_tool' })).toEqual({ behavior: 'ask', dangerLevel: 'medium' })
  })

  test('Given allow-all mode When bash requested Then allow but require scope check', () => {
    expect(mapPiToolPermission({ mode: 'allow-all', toolName: 'bash' })).toEqual({
      behavior: 'allow',
      requireScopeCheck: true,
    })
  })

  test('Given allow-all mode When write tool requested Then allow but require scope check', () => {
    expect(mapPiToolPermission({ mode: 'allow-all', toolName: 'write' })).toEqual({
      behavior: 'allow',
      requireScopeCheck: true,
    })
  })

  test('Given Proma permission mode When mapped Then returns explicit Pi mode', () => {
    expect(mapPromaPermissionModeToPiMode('bypassPermissions')).toBe('allow-all')
    expect(mapPromaPermissionModeToPiMode('auto')).toBe('ask')
    expect(mapPromaPermissionModeToPiMode('plan')).toBe('safe')
  })
})
