import type { AgentEngine, Channel } from '@proma/shared'
import { isProviderCompatibleWithAgentEngine } from '@proma/shared'

const PROMA_OFFICIAL_CHANNEL_ID = 'proma-official'

function hasEnabledModel(channel: Pick<Channel, 'models'>): boolean {
  return channel.models.some((model) => model.enabled)
}

function isRuntimeSelectableChannel(
  channel: Channel,
  allowlistedChannelIds: readonly string[],
  agentEngine: AgentEngine,
): boolean {
  if (!channel.enabled || !hasEnabledModel(channel)) return false
  if (channel.id === PROMA_OFFICIAL_CHANNEL_ID) return true
  if (!allowlistedChannelIds.includes(channel.id)) return false
  return isProviderCompatibleWithAgentEngine(agentEngine, channel.provider)
}

export function getAgentRuntimeSelectableChannelIds(
  channels: readonly Channel[],
  allowlistedChannelIds: readonly string[],
  agentEngine: AgentEngine,
): string[] {
  return channels
    .filter((channel) => isRuntimeSelectableChannel(channel, allowlistedChannelIds, agentEngine))
    .map((channel) => channel.id)
}

export function hasAgentRuntimeAvailableModel(
  channels: readonly Channel[],
  allowlistedChannelIds: readonly string[],
  agentEngine: AgentEngine,
): boolean {
  return channels.some((channel) => isRuntimeSelectableChannel(channel, allowlistedChannelIds, agentEngine))
}

export function isAgentRuntimeSelectedModelAvailable(
  channels: readonly Channel[],
  allowlistedChannelIds: readonly string[],
  agentEngine: AgentEngine,
  channelId: string | null,
  modelId: string | null,
): boolean {
  if (!channelId || !modelId) return false
  const channel = channels.find((candidate) => candidate.id === channelId)
  if (!channel || !isRuntimeSelectableChannel(channel, allowlistedChannelIds, agentEngine)) return false
  return channel.models.some((model) => model.id === modelId && model.enabled)
}
