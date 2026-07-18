import type { AgentRuntime } from '../types/agent-provider'
import { isClaudeAgentCompatibleProvider, type ProviderType } from '../types/channel'

/**
 * 根据渠道协议解析实际应使用的 Agent runtime。
 *
 * Claude runtime 只能调用 Claude Agent SDK 兼容渠道；Pi runtime 可承载全部
 * 已支持协议。该规则只允许 Claude 自动切到 Pi，不会把用户选择的 Pi 自动降级。
 */
export function resolveAgentRuntimeForProvider(
  requestedRuntime: AgentRuntime,
  provider: ProviderType,
): AgentRuntime {
  if (requestedRuntime === 'claude' && !isClaudeAgentCompatibleProvider(provider)) {
    return 'pi'
  }
  return requestedRuntime
}
