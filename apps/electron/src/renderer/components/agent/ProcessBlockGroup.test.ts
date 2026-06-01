import { describe, expect, test } from 'bun:test'
import { buildAssistantTurnRenderItems, buildProcessGroupToolNames } from './ProcessBlockGroup'
import { mergeAdjacentTextBlocksForTest } from './SDKMessageRenderer'
import type { SDKContentBlock } from '@proma/shared'

const tool = (id: string, name = 'Read'): SDKContentBlock => ({
  type: 'tool_use',
  id,
  name,
  input: {},
})

const thinking = (text = '分析中'): SDKContentBlock => ({
  type: 'thinking',
  thinking: text,
})

const text = (value: string): SDKContentBlock => ({
  type: 'text',
  text: value,
})

describe('Agent 过程块折叠分组', () => {
  test('given continuous thinking and tools before final text when grouping then folds them into one process group', () => {
    const items = buildAssistantTurnRenderItems([
      thinking(),
      tool('tool-1'),
      tool('tool-2'),
      text('最终输出'),
    ])

    expect(items).toHaveLength(2)
    expect(items[0]?.type).toBe('process-group')
    expect(items[1]?.type).toBe('block')
    if (items[0]?.type === 'process-group') {
      expect(items[0].items.map((item) => item.index)).toEqual([0, 1, 2])
    }
  })

  test('given intermediate text between tool runs when grouping then keeps only final output outside process group', () => {
    const items = buildAssistantTurnRenderItems([
      tool('tool-1'),
      text('中间说明'),
      tool('tool-2'),
      text('最终输出'),
    ])

    expect(items.map((item) => item.type)).toEqual(['process-group', 'block'])
    if (items[0]?.type === 'process-group') {
      expect(items[0].items.map((item) => item.index)).toEqual([0, 1, 2])
    }
    if (items[1]?.type === 'block') {
      expect(items[1].item.index).toBe(3)
    }
  })

  test('given streaming turn with trailing text when grouping then keeps the whole turn inside process group', () => {
    const items = buildAssistantTurnRenderItems([
      tool('tool-1'),
      text('可能还是中间说明'),
    ], { isStreaming: true })

    expect(items).toHaveLength(1)
    expect(items[0]?.type).toBe('process-group')
    if (items[0]?.type === 'process-group') {
      expect(items[0].items.map((item) => item.index)).toEqual([0, 1])
    }
  })

  test('given streaming turn with completed tools before trailing text when grouping then keeps final output outside process group', () => {
    const items = buildAssistantTurnRenderItems([
      tool('tool-1'),
      text('最终输出'),
    ], { isStreaming: true, completedToolResultIds: new Set(['tool-1']) })

    expect(items.map((item) => item.type)).toEqual(['process-group', 'block'])
    if (items[0]?.type === 'process-group') {
      expect(items[0].items.map((item) => item.index)).toEqual([0])
    }
    if (items[1]?.type === 'block') {
      expect(items[1].item.index).toBe(1)
    }
  })

  test('given keep expanded after complete when grouping then still keeps final output outside process group', () => {
    const items = buildAssistantTurnRenderItems([
      tool('tool-1'),
      text('最终输出'),
    ])

    expect(items.map((item) => item.type)).toEqual(['process-group', 'block'])
    expect(items[0]?.type).toBe('process-group')
    if (items[0]?.type === 'process-group') {
      expect(items[0].items.map((item) => item.index)).toEqual([0])
    }
  })

  test('given pure text streaming turn when grouping then keeps text as normal output', () => {
    const items = buildAssistantTurnRenderItems([
      text('普通回答'),
    ], { isStreaming: true })

    expect(items).toHaveLength(1)
    expect(items[0]?.type).toBe('block')
  })

  test('given process only turn when grouping then folds the whole turn', () => {
    const items = buildAssistantTurnRenderItems([
      thinking(),
      tool('tool-1'),
    ])

    expect(items).toHaveLength(1)
    expect(items[0]?.type).toBe('process-group')
    if (items[0]?.type === 'process-group') {
      expect(items[0].items.map((item) => item.index)).toEqual([0, 1])
    }
  })

  test('given streaming turn with only thinking before trailing text when grouping then keeps the whole turn inside process group', () => {
    // 仅有 thinking + 尾部 text 时，工具调用可能稍后才出现，
    // 不应把这段尾部 text 提前外置——避免后续完成瞬间从外部又跳回过程组。
    const items = buildAssistantTurnRenderItems([
      thinking(),
      text('暂时的回答片段'),
    ], { isStreaming: true, completedToolResultIds: new Set() })

    expect(items).toHaveLength(1)
    expect(items[0]?.type).toBe('process-group')
    if (items[0]?.type === 'process-group') {
      expect(items[0].items.map((item) => item.index)).toEqual([0, 1])
    }
  })

  test('given repeated tools when building capability icons then returns unique tool names in order', () => {
    const toolNames = buildProcessGroupToolNames([
      tool('tool-1', 'Grep'),
      thinking(),
      tool('tool-2', 'Read'),
      tool('tool-3', 'Grep'),
      tool('tool-4', 'Bash'),
    ])

    expect(toolNames).toEqual(['Grep', 'Read', 'Bash'])
  })

  test('given adjacent Pi text delta blocks when normalizing then merges them into one markdown block', () => {
    const blocks = mergeAdjacentTextBlocksForTest([
      text('✅'),
      text(' **'),
      text('测试'),
      text('成功'),
      tool('tool-1'),
      text('后续'),
      text('文本'),
    ])

    expect(blocks).toEqual([
      text('✅ **测试成功'),
      tool('tool-1'),
      text('后续文本'),
    ])
  })

  test('given adjacent Pi thinking delta blocks when normalizing then merges them into one thinking block', () => {
    const blocks = mergeAdjacentTextBlocksForTest([
      thinking('先'),
      thinking('分析'),
      text('回答'),
      thinking('另一个'),
      thinking('思路'),
    ])

    expect(blocks).toEqual([
      thinking('先分析'),
      text('回答'),
      thinking('另一个思路'),
    ])
  })
})
