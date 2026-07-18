import type { ChannelModel } from '@proma/shared'

interface MergeFetchedChannelModelsOptions {
  /** ChatGPT Codex 等精选目录拉取后默认全部启用。 */
  enableAllFetched?: boolean
}

/**
 * 将供应商最新模型清单与用户已有配置合并。
 *
 * 供应商字段以 fetched 为准；用户的启用状态和上下文窗口保留；不在供应商
 * 清单中的 manual 模型继续存在，普通 fetched 残留则被清理。
 */
export function mergeFetchedChannelModels(
  previous: ChannelModel[],
  fetched: ChannelModel[],
  options: MergeFetchedChannelModelsOptions = {},
): ChannelModel[] {
  const fetchedIds = new Set(fetched.map((model) => model.id))
  const previousById = new Map(previous.map((model) => [model.id, model]))
  const manualKept = previous.filter(
    (model) => model.source === 'manual' && !fetchedIds.has(model.id),
  )

  const merged = fetched.map((model) => {
    const old = previousById.get(model.id)
    const enabled = options.enableAllFetched ? true : old?.enabled ?? false
    return {
      ...model,
      enabled,
      ...(old?.contextWindow !== undefined ? { contextWindow: old.contextWindow } : {}),
    }
  })

  return [...manualKept, ...merged]
}
