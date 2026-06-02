import { getAgentSessionMeta } from './agent-session-manager'
import { resolveExistingSessionAgentEngine } from './agent-engine'

/**
 * 检查会话是否允许走 Proma 的分叉入口。
 *
 * Claude SDK 使用原生 forkSession；Pi 当前走 Proma 层分叉，并尽量补齐 Pi 原生 session 文件。
 */
export function assertAgentSessionForkSupported(sessionId: string): void {
  const session = getAgentSessionMeta(sessionId)
  const engine = resolveExistingSessionAgentEngine({ session })
  if (engine !== 'claude-sdk' && engine !== 'pi') {
    throw new Error(`当前 Agent 引擎暂不支持会话分叉: ${engine}`)
  }
}
