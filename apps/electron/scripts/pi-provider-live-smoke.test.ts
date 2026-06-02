import { describe, expect, test } from 'bun:test'
import { PI_AGENT_COMPATIBLE_PROVIDERS } from '@proma/shared'

import {
  getProviderLiveSmokeTargetsForTest,
  parsePiProviderLiveSmokeArgsForTest,
  runPiProviderLiveSmoke,
} from './pi-provider-live-smoke.ts'

describe('pi-provider-live-smoke', () => {
  test('Given no provider argument When parsing args Then all Pi compatible providers are selected', () => {
    const options = parsePiProviderLiveSmokeArgsForTest([])

    expect(options.providers.toSorted()).toEqual([...PI_AGENT_COMPATIBLE_PROVIDERS].toSorted())
  })

  test('Given selected providers When parsing args Then only requested providers are selected', () => {
    const options = parsePiProviderLiveSmokeArgsForTest([
      '--providers',
      'qwen,doubao',
      '--prompt',
      'ping',
      '--timeout-ms',
      '12000',
    ])

    expect(options.providers).toEqual(['qwen', 'doubao'])
    expect(options.prompt).toBe('ping')
    expect(options.timeoutMs).toBe(12000)
  })

  test('Given target registry When comparing with runtime providers Then every Pi provider has a live smoke target', () => {
    const targets = getProviderLiveSmokeTargetsForTest()

    expect(Object.keys(targets).toSorted()).toEqual([...PI_AGENT_COMPATIBLE_PROVIDERS].toSorted())
  })

  test('Given missing API key When running live smoke Then provider is skipped instead of failing CI', async () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY
    try {
      const results = await runPiProviderLiveSmoke({
        providers: ['qwen'],
        prompt: 'ping',
        timeoutMs: 100,
        keepTemp: false,
      })

      expect(results).toEqual([{
        provider: 'qwen',
        status: 'skipped',
        reason: '缺少 OPENAI_API_KEY',
        model: getProviderLiveSmokeTargetsForTest().qwen.model,
      }])
    } finally {
      if (previousOpenAiKey === undefined) {
        delete process.env.OPENAI_API_KEY
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiKey
      }
    }
  })

  test('Given custom provider without base url When running live smoke Then it is skipped with explicit reason', async () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = 'sk-test-custom-live-smoke'
    try {
      const results = await runPiProviderLiveSmoke({
        providers: ['custom'],
        prompt: 'ping',
        timeoutMs: 100,
        keepTemp: false,
      })

      expect(results[0]).toMatchObject({
        provider: 'custom',
        status: 'skipped',
        reason: '缺少 PROMA_PI_LIVE_CUSTOM_BASE_URL',
      })
    } finally {
      if (previousOpenAiKey === undefined) {
        delete process.env.OPENAI_API_KEY
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiKey
      }
    }
  })
})
