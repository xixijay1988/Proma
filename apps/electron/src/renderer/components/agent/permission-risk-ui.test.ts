import { describe, expect, test } from 'bun:test'
import {
  getPermissionRiskBadge,
} from './permission-risk-ui'

describe('permission risk UI helpers', () => {
  test('Given Pi MCP read risk hint When badge is requested Then shows read-only MCP wording', () => {
    expect(getPermissionRiskBadge({
      risk: 'read',
      server: 'docs',
      toolName: 'inspect_result',
    })).toEqual({
      label: '只读 MCP',
      description: 'docs / inspect_result',
      className: 'bg-green-500/10 text-green-700 dark:text-green-300',
    })
  })

  test('Given Pi MCP write risk hint When badge is requested Then warns about remote mutation', () => {
    expect(getPermissionRiskBadge({
      risk: 'write',
      server: 'github',
      toolName: 'create_issue',
    })).toEqual({
      label: '可能修改远端',
      description: 'github / create_issue',
      className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
    })
  })

  test('Given Pi MCP unknown risk hint When badge is requested Then asks user to confirm behavior', () => {
    expect(getPermissionRiskBadge({
      risk: 'unknown',
      description: '工具风险未知',
    })).toEqual({
      label: '风险未知',
      description: '工具风险未知',
      className: 'bg-muted text-muted-foreground',
    })
  })

  test('Given missing Pi MCP risk hint When badge is requested Then returns nothing', () => {
    expect(getPermissionRiskBadge(undefined)).toBeUndefined()
  })
})
