import { describe, expect, test } from 'bun:test'
import { resolvePiCliEntrypointForTest } from './pi-process'

describe('pi process integration', () => {
  test('Given installed pi package When resolving entrypoint Then returns cli path', () => {
    const entrypoint = resolvePiCliEntrypointForTest()

    expect(entrypoint.endsWith('dist/cli.js')).toBe(true)
  })

  test('Given installed pi package When resolving entrypoint Then references the scoped package root', () => {
    const entrypoint = resolvePiCliEntrypointForTest()

    expect(entrypoint).toContain('@earendil-works/pi-coding-agent')
  })
})
