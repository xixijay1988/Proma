export function getPiAgentExperimentalNotice(): string {
  return [
    'Pi Agent RPC experimental 当前支持本地 coding 最小闭环、Proma 权限确认、AskUserQuestion 向用户提问、Pi 原生 Skills、Proma MCP bridge 逐工具调用、Pi session tree 分叉/克隆/切换，以及 Pi git checkpoint 显式文件恢复；',
    'MCP bridge 不是 Claude SDK 深度注入。',
  ].join('')
}
