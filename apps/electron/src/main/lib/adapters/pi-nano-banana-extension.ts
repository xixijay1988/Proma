import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ChatToolState } from '@proma/shared'

export interface PiNanoBananaExtensionConfig {
  configDir: string
  sessionId: string
  cwd: string
  toolState: ChatToolState
  credentials: Record<string, string>
}

export interface PiNanoBananaExtensionResult {
  extensionPath: string
  toolNames: string[]
  env: Record<string, string>
}

const NANO_BANANA_TOOL_NAMES = ['mcp__nano_banana__generate_image']
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com'
const DEFAULT_MODEL = 'gemini-3.1-flash-image-preview'

function serializeExtensionValue(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function resolveImportUrl(specifier: string): string {
  const moduleAnchor = typeof __filename === 'string'
    ? __filename
    : join(process.cwd(), 'package.json')
  const cjsRequire = createRequire(moduleAnchor)
  return pathToFileURL(cjsRequire.resolve(specifier)).href
}

function buildPiNanoBananaExtensionSource(input: {
  sessionId: string
  cwd: string
  baseUrl: string
  model: string
}): string {
  return `import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, isAbsolute, join, resolve } from 'node:path'
import { Type } from ${serializeExtensionValue(resolveImportUrl('typebox'))}

const SESSION_ID = ${serializeExtensionValue(input.sessionId)}
const AGENT_CWD = ${serializeExtensionValue(input.cwd)}
const GEMINI_BASE_URL = ${serializeExtensionValue(input.baseUrl)}
const GEMINI_MODEL = ${serializeExtensionValue(input.model)}
const GEMINI_API_KEY_ENV = 'PROMA_NANO_BANANA_API_KEY'
const DUMMY_THOUGHT_SIGNATURE = 'skip_thought_signature_validator'
const history = []

const EXT_TO_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
}

const NANO_BANANA_TOOL_HINTS = {
  mcp__nano_banana__generate_image: {
    risk: 'write',
    server: 'nano-banana',
    toolName: 'generate_image',
    description: 'Generate or edit images and save generated files into the Proma agent workspace.',
  },
}

function getApiKey() {
  return String(process.env.PROMA_NANO_BANANA_API_KEY || '').trim()
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function isImageMimeType(mimeType) {
  return typeof mimeType === 'string' && mimeType.startsWith('image/')
}

function readReferenceImages(paths) {
  const parts = []
  for (const rawPath of Array.isArray(paths) ? paths : []) {
    try {
      const filePath = isAbsolute(rawPath) ? rawPath : resolve(AGENT_CWD, rawPath)
      if (!existsSync(filePath)) {
        console.warn('[Pi Nano Banana] 参考图不存在: ' + filePath)
        continue
      }

      const mimeType = EXT_TO_MIME[extname(filePath).toLowerCase()]
      if (!mimeType || !isImageMimeType(mimeType)) {
        console.warn('[Pi Nano Banana] 非图片文件，跳过: ' + filePath)
        continue
      }

      parts.push({
        inlineData: {
          mimeType,
          data: readFileSync(filePath).toString('base64'),
        },
      })
    } catch (error) {
      console.warn('[Pi Nano Banana] 读取参考图失败: ' + rawPath, error)
    }
  }
  return parts
}

function historyHasThoughtSignature() {
  return history.some((item) =>
    Array.isArray(item.parts) && item.parts.some((part) => part.thoughtSignature || part.thought_signature),
  )
}

function buildGeminiRequest(params, referenceImageParts) {
  const needsSignature = history.length > 0 && historyHasThoughtSignature()
  const userParts = [
    ...referenceImageParts,
    {
      text: params.prompt,
      ...(needsSignature ? { thoughtSignature: DUMMY_THOUGHT_SIGNATURE } : {}),
    },
  ]

  const generationConfig = {
    responseModalities: ['TEXT', 'IMAGE'],
  }
  const imageConfig = {}
  if (params.aspectRatio && params.aspectRatio !== '1:1') {
    imageConfig.aspectRatio = params.aspectRatio
  }
  if (params.imageSize && params.imageSize !== 'auto') {
    imageConfig.imageSize = params.imageSize
  }
  if (Object.keys(imageConfig).length > 0) {
    generationConfig.imageConfig = imageConfig
  }

  return {
    contents: [
      ...history,
      { role: 'user', parts: userParts },
    ],
    generationConfig,
  }
}

async function callGemini(params) {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error(GEMINI_API_KEY_ENV + ' 未设置')

  const referenceImageParts = readReferenceImages(params.referenceImagePaths)
  const requestBody = buildGeminiRequest(params, referenceImageParts)
  const url = GEMINI_BASE_URL.replace(/\\/$/, '') + '/v1beta/models/' + encodeURIComponent(GEMINI_MODEL) + ':generateContent?key=' + encodeURIComponent(apiKey)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60_000)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error('HTTP ' + response.status + ': ' + (await response.text()).slice(0, 500))
    }

    const data = await response.json()
    if (data?.error?.message) {
      throw new Error(String(data.error.message))
    }

    const parts = Array.isArray(data?.candidates?.[0]?.content?.parts)
      ? data.candidates[0].content.parts
      : []
    history.push({ role: 'user', parts: [...referenceImageParts, { text: params.prompt }] })
    history.push({ role: 'model', parts })

    return parts
  } finally {
    clearTimeout(timer)
  }
}

function saveGeneratedImage(inlineData) {
  const ext = inlineData.mimeType === 'image/jpeg' ? '.jpg' : '.png'
  const filename = 'nano-banana-' + randomUUID().slice(0, 8) + ext
  const imageDir = join(AGENT_CWD, 'generated-images')
  mkdirSync(imageDir, { recursive: true })
  const imagePath = join(imageDir, filename)
  writeFileSync(imagePath, Buffer.from(inlineData.data, 'base64'))
  return imagePath
}

function buildToolContent(parts) {
  const content = []
  const textParts = []
  const savedPaths = []

  for (const part of parts) {
    if (part?.thought) continue
    if (part?.inlineData?.data && part?.inlineData?.mimeType) {
      try {
        savedPaths.push(saveGeneratedImage(part.inlineData))
      } catch (error) {
        console.warn('[Pi Nano Banana] 保存生成图片失败:', error)
      }
      content.push({
        type: 'image',
        data: part.inlineData.data,
        mimeType: part.inlineData.mimeType,
      })
      continue
    }

    if (typeof part?.text === 'string' && part.text.trim()) {
      textParts.push(part.text)
    }
  }

  const imageCount = content.filter((item) => item.type === 'image').length
  const pathInfo = savedPaths.length > 0
    ? '\\n图片已保存到工作目录:\\n' + savedPaths.map((item) => '- ' + item).join('\\n')
    : ''
  const summary = imageCount > 0
    ? '图片已生成（' + imageCount + ' 张）' + pathInfo + (textParts.length > 0 ? '\\n' + textParts.join('\\n') : '')
    : textParts.join('\\n') || '未生成图片内容'

  content.push({ type: 'text', text: summary })
  return content
}

function publishNanoBananaRiskHints() {
  const currentHints = globalThis.__PROMA_PI_MCP_TOOL_RISK_HINTS__
  const hints = currentHints && typeof currentHints === 'object' ? currentHints : {}
  Object.assign(hints, NANO_BANANA_TOOL_HINTS)
  globalThis.__PROMA_PI_MCP_TOOL_RISK_HINTS__ = hints
}

function createNanoBananaTool() {
  return {
    name: 'mcp__nano_banana__generate_image',
    label: 'Nano Banana / generate image',
    description: 'Generate or edit images using Gemini Image Generation. Supports text-to-image, reference image editing, and iterative editing in this Pi session. Use English prompts for best results.',
    promptSnippet: 'mcp__nano_banana__generate_image: generate or edit images with Gemini Image Generation.',
    parameters: Type.Object({
      prompt: Type.String({ description: 'Detailed description of the image to generate or edit. English descriptions work best.' }),
      referenceImagePaths: Type.Optional(Type.Array(Type.String(), { description: 'Reference image paths. Relative paths are resolved from the current Proma agent workspace.' })),
      aspectRatio: Type.Optional(Type.Union([
        Type.Literal('1:1'),
        Type.Literal('16:9'),
        Type.Literal('4:3'),
        Type.Literal('9:16'),
        Type.Literal('3:4'),
      ], { description: 'Aspect ratio, default 1:1.' })),
      imageSize: Type.Optional(Type.Union([
        Type.Literal('auto'),
        Type.Literal('1K'),
        Type.Literal('2K'),
        Type.Literal('4K'),
      ], { description: 'Resolution, default auto.' })),
      numberOfImages: Type.Optional(Type.Number({ description: 'Number of images requested. Gemini API support may vary.' })),
    }),
    async execute(_toolCallId, params) {
      try {
        const parts = await callGemini(params)
        return {
          content: buildToolContent(parts),
          details: {
            server: 'nano-banana',
            toolName: 'generate_image',
            sessionId: SESSION_ID,
          },
        }
      } catch (error) {
        return {
          content: [{ type: 'text', text: 'Proma Pi Nano Banana 调用失败: ' + getErrorMessage(error) }],
          details: {
            server: 'nano-banana',
            toolName: 'generate_image',
            error: getErrorMessage(error),
          },
          isError: true,
        }
      }
    },
  }
}

export default async function (pi) {
  publishNanoBananaRiskHints()
  pi.registerTool(createNanoBananaTool())
}
`
}

export function ensurePiNanoBananaExtension(config: PiNanoBananaExtensionConfig): PiNanoBananaExtensionResult | null {
  const apiKey = config.credentials.apiKey?.trim()
  if (!config.toolState.enabled || !apiKey) return null

  const extensionDir = join(config.configDir, 'proma-extensions')
  mkdirSync(extensionDir, { recursive: true })

  const extensionPath = join(extensionDir, 'proma-nano-banana-bridge.mjs')
  writeFileSync(
    extensionPath,
    buildPiNanoBananaExtensionSource({
      sessionId: config.sessionId,
      cwd: config.cwd,
      baseUrl: config.credentials.baseUrl?.trim() || DEFAULT_BASE_URL,
      model: config.credentials.model?.trim() || DEFAULT_MODEL,
    }),
    'utf-8',
  )

  return {
    extensionPath,
    toolNames: [...NANO_BANANA_TOOL_NAMES],
    env: {
      PROMA_NANO_BANANA_API_KEY: apiKey,
    },
  }
}

export function buildPiNanoBananaExtensionSourceForTest(input: {
  sessionId: string
  cwd: string
  baseUrl: string
  model: string
}): string {
  return buildPiNanoBananaExtensionSource(input)
}
