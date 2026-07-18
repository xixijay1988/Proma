import { describe, expect, test } from 'bun:test'
import {
  formatContextWindowInput,
  parseContextWindowInput,
} from './context-window-input'

describe('模型上下文窗口输入', () => {
  test.each([
    ['1M', 1_000_000],
    ['1m', 1_000_000],
    ['1.05M', 1_050_000],
    ['256K', 256_000],
    ['256k', 256_000],
    ['1000000', 1_000_000],
    ['1,000,000', 1_000_000],
    [' 256K ', 256_000],
  ] as const)('Given %s When 解析 Then 返回 %d tokens', (input, expected) => {
    expect(parseContextWindowInput(input)).toEqual({ ok: true, value: expected })
  })

  test('Given 空输入 When 解析 Then 返回 undefined 以恢复自动策略', () => {
    expect(parseContextWindowInput('')).toEqual({ ok: true, value: undefined })
    expect(parseContextWindowInput('   ')).toEqual({ ok: true, value: undefined })
  })

  test.each(['abc', '0', '-1', '0.001K', '10.1M', '1MM', '1K2'])(
    'Given 非法输入 %s When 解析 Then 返回错误',
    (input) => {
      expect(parseContextWindowInput(input).ok).toBe(false)
    },
  )

  test.each([
    [1_000_000, '1M'],
    [1_050_000, '1.05M'],
    [256_000, '256K'],
    [262_144, '262,144'],
    [undefined, ''],
  ] as const)('Given %s tokens When 格式化 Then 返回 %s', (value, expected) => {
    expect(formatContextWindowInput(value)).toBe(expected)
  })
})
