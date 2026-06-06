import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export interface PiAskUserExtensionConfig {
  configDir: string
}

export interface PiAskUserExtensionResult {
  extensionPath: string
  toolNames: string[]
}

const ASK_USER_TOOL_NAMES = ['AskUserQuestion']

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

function buildPiAskUserExtensionSource(): string {
  return `import { Type } from ${serializeExtensionValue(resolveImportUrl('typebox'))}

const OptionSchema = Type.Object({
  label: Type.String({ description: 'Short option label shown to the user.' }),
  description: Type.Optional(Type.String({ description: 'Optional one-sentence option description.' })),
  preview: Type.Optional(Type.String({ description: 'Optional preview text for the option.' })),
})

const QuestionSchema = Type.Object({
  question: Type.String({ description: 'The question to ask the user.' }),
  header: Type.Optional(Type.String({ description: 'Short UI header for this question.' })),
  placeholder: Type.Optional(Type.String({ description: 'Placeholder for free-form input.' })),
  prefill: Type.Optional(Type.String({ description: 'Initial text for editor-style input.' })),
  options: Type.Optional(Type.Array(OptionSchema, { description: 'Options for a selection question.' })),
  multiSelect: Type.Optional(Type.Boolean({ description: 'Whether multiple options may be selected. Proma Pi bridge returns a comma-separated answer.' })),
})

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeOptions(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => ({
      label: normalizeText(item?.label),
      description: normalizeText(item?.description),
      preview: normalizeText(item?.preview),
    }))
    .filter((item) => item.label)
}

function questionKey(question, index) {
  const text = normalizeText(question.question)
  return text || 'question_' + (index + 1)
}

function selectionPrompt(question, index) {
  const header = normalizeText(question.header)
  const key = questionKey(question, index)
  return header && header !== key ? header + '\\n' + key : key
}

function formatOptionLines(options) {
  return options.map((option, index) => {
    const detail = option.description || option.preview
    return detail
      ? String(index + 1) + '. ' + option.label + ' — ' + detail
      : String(index + 1) + '. ' + option.label
  })
}

function formatEditorPrompt(question, index, options) {
  const lines = [questionKey(question, index)]
  if (options.length > 0) {
    lines.push('', '可选项：', ...formatOptionLines(options))
  }
  if (question.multiSelect) {
    lines.push('', '可选择多个选项，用逗号分隔；也可以输入自定义答案。')
  }
  return lines.join('\\n')
}

function errorResult(message, questions = []) {
  return {
    content: [{ type: 'text', text: message }],
    details: { answers: {}, questions, cancelled: true, error: message },
    isError: true,
  }
}

function successResult(answers, questions) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ answers }, null, 2) }],
    details: { answers, questions, cancelled: false },
  }
}

function formatAskUserBridgeStatus() {
  return [
    'Proma Pi AskUser bridge 已加载。',
    '- AskUserQuestion: Ask the user one or more questions and wait for their answer.',
    '- select/input/editor requests are surfaced through Proma AskUserBanner in the desktop UI.',
  ].join('\\n')
}

async function askSingleQuestion(question, index, ctx) {
  const options = normalizeOptions(question.options)
  const title = selectionPrompt(question, index)

  if (options.length > 0 && question.multiSelect !== true) {
    const selected = await ctx.ui.select(title, options.map((option) => option.label))
    return normalizeText(selected)
  }

  if (question.multiSelect === true || normalizeText(question.prefill)) {
    const edited = await ctx.ui.editor(formatEditorPrompt(question, index, options), normalizeText(question.prefill))
    return normalizeText(edited)
  }

  const value = await ctx.ui.input(questionKey(question, index), normalizeText(question.placeholder))
  return normalizeText(value)
}

export default function (pi) {
  pi.registerTool({
    name: 'AskUserQuestion',
    label: 'Ask User Question',
    description: 'Ask the user one or more questions and wait for their answer. Use this for clarifying requirements, choosing between options, confirming non-permission decisions, or collecting missing preferences before continuing.',
    promptSnippet: 'AskUserQuestion: pause and ask the user a focused question when user preference, requirements, or a non-permission decision is unclear.',
    parameters: Type.Object({
      questions: Type.Array(QuestionSchema, { description: 'Questions to ask. Ask one focused question at a time unless the questions are tightly related.' }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!ctx.hasUI) {
        return errorResult('AskUserQuestion failed: Proma interactive UI is not available.', params.questions)
      }
      if (!Array.isArray(params.questions) || params.questions.length === 0) {
        return errorResult('AskUserQuestion failed: no questions provided.', [])
      }

      const answers = {}
      for (let index = 0; index < params.questions.length; index += 1) {
        const question = params.questions[index]
        const key = questionKey(question, index)
        const answer = await askSingleQuestion(question, index, ctx)
        if (!answer) {
          return {
            content: [{ type: 'text', text: 'AskUserQuestion cancelled by the user.' }],
            details: { answers, questions: params.questions, cancelled: true },
          }
        }
        answers[key] = answer
      }

      return successResult(answers, params.questions)
    },
  })

  pi.registerCommand('proma:ask_user_bridge_status', {
    description: formatAskUserBridgeStatus(),
    async handler(_args, ctx) {
      ctx.sendMessage({
        customType: 'proma_ask_user_bridge_status',
        content: formatAskUserBridgeStatus(),
        display: formatAskUserBridgeStatus(),
        details: {
          toolNames: ['AskUserQuestion'],
        },
      })
    },
  })
}
`
}

export function ensurePiAskUserExtension(config: PiAskUserExtensionConfig): PiAskUserExtensionResult {
  const extensionDir = join(config.configDir, 'proma-extensions')
  mkdirSync(extensionDir, { recursive: true })

  const extensionPath = join(extensionDir, 'proma-ask-user-bridge.mjs')
  writeFileSync(extensionPath, buildPiAskUserExtensionSource(), 'utf-8')

  return {
    extensionPath,
    toolNames: [...ASK_USER_TOOL_NAMES],
  }
}

export function buildPiAskUserExtensionSourceForTest(): string {
  return buildPiAskUserExtensionSource()
}
