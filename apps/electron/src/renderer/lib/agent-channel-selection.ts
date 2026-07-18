import { resolveAgentRuntimeForProvider } from '@proma/shared'
import type { AgentRuntime, ProviderType } from '@proma/shared'

interface AgentSelectableChannel {
  id: string
  provider: ProviderType
}

interface InitialAgentRuntimeAndChannelIds {
  runtime: AgentRuntime
  agentChannelIds: string[]
}

/**
 * 清理启动设置中的 Agent 使能列表，并修正默认渠道与 runtime 的协议不一致。
 */
export function resolveInitialAgentRuntimeAndChannelIds(
  channels: readonly AgentSelectableChannel[],
  configuredAgentChannelIds: readonly string[],
  selectedChannelId: string | undefined,
  requestedRuntime: AgentRuntime,
): InitialAgentRuntimeAndChannelIds {
  const channelById = new Map(channels.map((channel) => [channel.id, channel]))
  const agentChannelIds = configuredAgentChannelIds.filter((channelId) => channelById.has(channelId))
  const selectedChannel = selectedChannelId ? channelById.get(selectedChannelId) : undefined
  const runtime = selectedChannel
    ? resolveAgentRuntimeForProvider(requestedRuntime, selectedChannel.provider)
    : requestedRuntime

  // 当前默认渠道必须保持 Agent 可用，兼容旧版只有 agentChannelId 的配置。
  if (selectedChannel && !agentChannelIds.includes(selectedChannel.id)) {
    agentChannelIds.push(selectedChannel.id)
  }

  return { runtime, agentChannelIds }
}

/**
 * 解析 Agent 模型选择器应显示的渠道。
 *
 * Agent 渠道 Toggle 是 Claude/Pi 共用的使能开关；协议只决定选择模型后是否需要
 * 自动切换 runtime，不绕过用户设置的使能列表。
 */
export function resolveSelectableAgentChannelIds(
  channels: readonly AgentSelectableChannel[],
  agentChannelIds: readonly string[],
): string[] {
  return channels
    .filter((channel) => agentChannelIds.includes(channel.id))
    .map((channel) => channel.id)
}

export function nextAgentChannelIdsAfterModelSelect(
  currentChannelIds: string[],
  selectedChannelId: string,
): string[] {
  return currentChannelIds.includes(selectedChannelId)
    ? currentChannelIds
    : [...currentChannelIds, selectedChannelId]
}
