import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export interface PiTaskExtensionConfig {
  configDir: string
}

export interface PiTaskExtensionResult {
  extensionPath: string
  toolNames: string[]
}

const TASK_TOOL_NAMES = [
  'TaskCreate',
  'TaskUpdate',
  'TaskGet',
  'TaskList',
]

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

function buildPiTaskExtensionSource(): string {
  return `import { randomUUID } from 'node:crypto'
import { Type } from ${serializeExtensionValue(resolveImportUrl('typebox'))}

const tasks = new Map()
const VALID_STATUSES = new Set(['pending', 'in_progress', 'completed', 'blocked', 'cancelled', 'error', 'deleted'])

function normalizeStatus(value, fallback = 'pending') {
  return VALID_STATUSES.has(value) ? value : fallback
}

function normalizeBlocks(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item).trim()).filter(Boolean)
}

function serializeTask(task) {
  return {
    id: task.id,
    subject: task.subject,
    status: task.status,
    ...(task.description ? { description: task.description } : {}),
    ...(task.activeForm ? { activeForm: task.activeForm } : {}),
    ...(task.blocks.length > 0 ? { blocks: task.blocks } : {}),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  }
}

function taskResult(task) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ task }, null, 2) }],
    details: { task },
  }
}

function errorResult(message) {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
    details: { error: message },
  }
}

function createTaskCreateTool() {
  return {
    name: 'TaskCreate',
    label: 'Task / create',
    description: 'Create a visible progress task for multi-step work in Proma.',
    promptSnippet: 'TaskCreate: create a visible progress item before starting multi-step work.',
    parameters: Type.Object({
      subject: Type.String({ description: 'Short task title shown in Proma.' }),
      description: Type.Optional(Type.String({ description: 'Optional detail about the task.' })),
      status: Type.Optional(Type.Union([
        Type.Literal('pending'),
        Type.Literal('in_progress'),
        Type.Literal('completed'),
        Type.Literal('blocked'),
      ], { description: 'Initial status, default pending.' })),
      activeForm: Type.Optional(Type.String({ description: 'Optional active wording for the current action.' })),
      blocks: Type.Optional(Type.Array(Type.String(), { description: 'Optional related block identifiers.' })),
    }),
    async execute(_toolCallId, params) {
      const now = new Date().toISOString()
      const task = {
        id: randomUUID().slice(0, 8),
        subject: String(params.subject || '未命名任务'),
        description: typeof params.description === 'string' ? params.description : undefined,
        status: normalizeStatus(params.status),
        activeForm: typeof params.activeForm === 'string' ? params.activeForm : undefined,
        blocks: normalizeBlocks(params.blocks),
        createdAt: now,
        updatedAt: now,
      }
      tasks.set(task.id, task)
      return taskResult(serializeTask(task))
    },
  }
}

function createTaskUpdateTool() {
  return {
    name: 'TaskUpdate',
    label: 'Task / update',
    description: 'Update a visible Proma progress task status or text.',
    promptSnippet: 'TaskUpdate: mark a Proma progress task in_progress, completed, blocked, or pending.',
    parameters: Type.Object({
      taskId: Type.String({ description: 'Task id returned by TaskCreate.' }),
      status: Type.Optional(Type.Union([
        Type.Literal('pending'),
        Type.Literal('in_progress'),
        Type.Literal('completed'),
        Type.Literal('blocked'),
        Type.Literal('cancelled'),
        Type.Literal('error'),
        Type.Literal('deleted'),
      ], { description: 'Updated task status.' })),
      subject: Type.Optional(Type.String({ description: 'Optional new task title.' })),
      description: Type.Optional(Type.String({ description: 'Optional new task detail.' })),
      activeForm: Type.Optional(Type.String({ description: 'Optional active wording for the current action.' })),
      blocks: Type.Optional(Type.Array(Type.String(), { description: 'Optional related block identifiers.' })),
    }),
    async execute(_toolCallId, params) {
      const task = tasks.get(String(params.taskId || ''))
      if (!task) return errorResult('Task not found: ' + String(params.taskId || ''))

      if (typeof params.subject === 'string') task.subject = params.subject
      if (typeof params.description === 'string') task.description = params.description
      if (typeof params.activeForm === 'string') task.activeForm = params.activeForm
      if (Array.isArray(params.blocks)) task.blocks = normalizeBlocks(params.blocks)
      if (typeof params.status === 'string') task.status = normalizeStatus(params.status, task.status)
      task.updatedAt = new Date().toISOString()
      tasks.set(task.id, task)
      return taskResult(serializeTask(task))
    },
  }
}

function createTaskGetTool() {
  return {
    name: 'TaskGet',
    label: 'Task / get',
    description: 'Read one visible Proma progress task.',
    promptSnippet: 'TaskGet: inspect one Proma progress task.',
    parameters: Type.Object({
      taskId: Type.String({ description: 'Task id returned by TaskCreate.' }),
    }),
    async execute(_toolCallId, params) {
      const task = tasks.get(String(params.taskId || ''))
      if (!task) return errorResult('Task not found: ' + String(params.taskId || ''))
      return taskResult(serializeTask(task))
    },
  }
}

function createTaskListTool() {
  return {
    name: 'TaskList',
    label: 'Task / list',
    description: 'List visible Proma progress tasks for this Pi session.',
    promptSnippet: 'TaskList: list current Proma progress tasks.',
    parameters: Type.Object({
      includeDeleted: Type.Optional(Type.Boolean({ description: 'Whether deleted tasks should be included.' })),
    }),
    async execute(_toolCallId, params) {
      const serialized = Array.from(tasks.values())
        .filter((task) => params.includeDeleted || task.status !== 'deleted')
        .map(serializeTask)
      return {
        content: [{ type: 'text', text: JSON.stringify({ tasks: serialized }, null, 2) }],
        details: { tasks: serialized },
      }
    },
  }
}

export default async function (pi) {
  pi.registerTool(createTaskCreateTool())
  pi.registerTool(createTaskUpdateTool())
  pi.registerTool(createTaskGetTool())
  pi.registerTool(createTaskListTool())
}
`
}

export function ensurePiTaskExtension(config: PiTaskExtensionConfig): PiTaskExtensionResult {
  const extensionDir = join(config.configDir, 'proma-extensions')
  mkdirSync(extensionDir, { recursive: true })

  const extensionPath = join(extensionDir, 'proma-task-bridge.mjs')
  writeFileSync(extensionPath, buildPiTaskExtensionSource(), 'utf-8')

  return {
    extensionPath,
    toolNames: [...TASK_TOOL_NAMES],
  }
}

export function buildPiTaskExtensionSourceForTest(): string {
  return buildPiTaskExtensionSource()
}
