import { describe, expect, test } from 'bun:test'
import type { ChannelModel } from '@proma/shared'
import { mergeFetchedChannelModels } from './channel-model-merge'

function model(id: string, overrides: Partial<ChannelModel> = {}): ChannelModel {
  return { id, name: id, enabled: false, source: 'fetched', ...overrides }
}

describe('渠道模型拉取合并', () => {
  test('Given 已有模型自定义窗口 When 重新拉取 Then 保留启用状态与上下文窗口', () => {
    const previous = [model('gpt-5.6-sol', { enabled: true, contextWindow: 1_050_000 })]
    const fetched = [model('gpt-5.6-sol', { name: 'GPT-5.6 Sol' })]

    expect(mergeFetchedChannelModels(previous, fetched)).toEqual([
      model('gpt-5.6-sol', { name: 'GPT-5.6 Sol', enabled: true, contextWindow: 1_050_000 }),
    ])
  })

  test('Given Codex 拉取 When 强制启用 Then 仍保留用户上下文窗口', () => {
    const previous = [model('gpt-5.6-sol', { enabled: false, contextWindow: 1_050_000 })]
    const fetched = [model('gpt-5.6-sol')]

    expect(mergeFetchedChannelModels(previous, fetched, { enableAllFetched: true })[0]).toEqual(
      model('gpt-5.6-sol', { enabled: true, contextWindow: 1_050_000 }),
    )
  })

  test('Given 手动模型不在供应商结果中 When 合并 Then 完整保留', () => {
    const manual = model('private-model', {
      enabled: true,
      source: 'manual',
      contextWindow: 256_000,
    })

    expect(mergeFetchedChannelModels([manual], [model('new-model')])).toEqual([
      manual,
      model('new-model'),
    ])
  })

  test('Given 旧 fetched 模型已从供应商消失 When 合并 Then 清理旧模型', () => {
    expect(mergeFetchedChannelModels([model('old-model')], [model('new-model')])).toEqual([
      model('new-model'),
    ])
  })
})
