import type { ChannelModel } from '@proma/shared'

interface MergeFetchedChannelModelsOptions {
  /** Enable every fetched model for curated catalogs such as ChatGPT Codex. */
  enableAllFetched?: boolean
}

/**
 * Merge the provider's latest model catalog with existing user configuration.
 *
 * Provider fields come from fetched models, while user enabled states and context-window
 * overrides are preserved. Manual models remain; stale fetched models are removed.
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
