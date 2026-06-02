/**
 * 默认工具结果渲染器 — Key-Value 表格 / 纯文本
 *
 * 用于未匹配到专属渲染器的工具（包括 MCP 工具）
 */

import * as React from 'react'
import { CollapsibleResult } from './collapsible-result'
import type { NormalizedToolResultImage } from '../tool-result-content'

interface DefaultResultRendererProps {
  result: string
  isError: boolean
  images?: NormalizedToolResultImage[]
  structuredJson?: string
}

/** 尝试将结果解析为 key-value 对 */
function tryParseKeyValue(text: string): Array<{ key: string; value: string }> | null {
  // 尝试 JSON 解析
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return Object.entries(parsed as Record<string, unknown>).map(([key, value]) => ({
        key,
        value: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      }))
    }
  } catch {
    // 非 JSON
  }
  return null
}

function ToolResultImages({ images }: { images: NormalizedToolResultImage[] }): React.ReactElement | null {
  if (images.length === 0) return null

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {images.map((image, index) => (
        <a
          key={`${image.mimeType}-${index}`}
          href={image.src}
          target="_blank"
          rel="noreferrer"
          className="block overflow-hidden rounded-md border border-border/30 bg-muted/20"
          title={image.mimeType}
        >
          <img
            src={image.src}
            alt={`MCP image result ${index + 1}`}
            className="max-h-64 w-full object-contain"
          />
        </a>
      ))}
    </div>
  )
}

function StructuredJsonBlock({ structuredJson }: { structuredJson?: string }): React.ReactElement | null {
  if (!structuredJson) return null

  return (
    <details className="rounded-md bg-muted/20 px-3 py-2 text-[12px]">
      <summary className="cursor-pointer text-muted-foreground/70">结构化结果</summary>
      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all font-mono text-foreground/70">
        {structuredJson}
      </pre>
    </details>
  )
}

export function DefaultResultRenderer({ result, isError, images = [], structuredJson }: DefaultResultRendererProps): React.ReactElement {
  if (isError) {
    return (
      <div className="space-y-2">
        <pre className="rounded-md p-3 text-[12px] font-mono text-destructive/80 bg-destructive/5 whitespace-pre-wrap break-all overflow-x-auto">
          {result}
        </pre>
        <ToolResultImages images={images} />
        <StructuredJsonBlock structuredJson={structuredJson} />
      </div>
    )
  }

  const keyValues = React.useMemo(() => tryParseKeyValue(result), [result])

  // Key-Value 表格
  if (keyValues && keyValues.length > 0) {
    return (
      <div className="space-y-2">
        <div className="rounded-md bg-muted/20 overflow-hidden">
          <table className="w-full text-[12px]">
            <tbody>
              {keyValues.map(({ key, value }, i) => (
                <tr key={i} className="border-b border-border/20 last:border-b-0">
                  <td className="px-3 py-1.5 text-muted-foreground/60 font-mono whitespace-nowrap align-top">
                    {key}
                  </td>
                  <td className="px-3 py-1.5 text-foreground/70 font-mono whitespace-pre-wrap break-all">
                    {value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ToolResultImages images={images} />
        <StructuredJsonBlock structuredJson={structuredJson} />
      </div>
    )
  }

  // 纯文本 fallback
  return (
    <div className="space-y-2">
      {result && (
        <CollapsibleResult
          content={result}
          renderContent={(text) => (
            <pre className="rounded-md p-3 text-[12px] font-mono text-foreground/60 bg-muted/30 whitespace-pre-wrap break-all overflow-x-auto max-h-[400px] overflow-y-auto">
              {text}
            </pre>
          )}
        />
      )}
      <ToolResultImages images={images} />
      <StructuredJsonBlock structuredJson={structuredJson} />
    </div>
  )
}
