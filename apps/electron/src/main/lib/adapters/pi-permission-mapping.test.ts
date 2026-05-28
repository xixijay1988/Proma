import { describe, expect, test } from 'bun:test'
import { mapPiToolPermission } from './pi-permission-mapping'

describe('pi permission mapping', () => {
  test('Given safe mode When read tool requested Then allow', () => {
    expect(mapPiToolPermission({ mode: 'safe', toolName: 'read' })).toEqual({ behavior: 'allow' })
  })

  test('Given safe mode When write tool requested Then ask', () => {
    expect(mapPiToolPermission({ mode: 'safe', toolName: 'write' })).toEqual({ behavior: 'ask', dangerLevel: 'medium' })
  })

  test('Given allow-all mode When bash requested Then allow but require scope check', () => {
    expect(mapPiToolPermission({ mode: 'allow-all', toolName: 'bash' })).toEqual({
      behavior: 'allow',
      requireScopeCheck: true,
    })
  })
})
