/**
 * App Mode Atom - 应用模式状态
 *
 * - chat: 对话模式
 * - agent: Agent 模式（原 Flow）
 * - room: Agent 团队房间模式
 * - scratch: 草稿本模式
 */

import { atomWithStorage } from 'jotai/utils'

export type AppMode = 'chat' | 'agent' | 'room' | 'scratch'

/** App 模式，自动持久化到 localStorage */
export const appModeAtom = atomWithStorage<AppMode>('proma-app-mode', 'agent')
