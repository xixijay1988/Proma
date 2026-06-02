import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const PROMA_CHECKPOINT_TYPE = 'proma-git-checkpoint'

export interface PiGitCheckpointExtensionConfig {
  configDir: string
}

export interface PiGitCheckpoint {
  entryId: string
  targetEntryId: string
  gitRef: string
  cwd?: string
  createdAt?: string
}

interface PiSessionEntry {
  id: string
  parentId: string | null
  type: string
  customType?: string
  data?: Record<string, unknown>
}

export interface PiGitCommandResult {
  status: number | null
  stdout: string
  stderr: string
}

export interface ApplyPiGitCheckpointInput {
  sessionPath: string
  targetEntryId: string
  runGit?: (cwd: string, args: string[]) => PiGitCommandResult
}

export interface ApplyPiGitCheckpointResult {
  restored: boolean
  checkpoint?: PiGitCheckpoint
  filesChanged?: string[]
  error?: string
}

function buildPiGitCheckpointExtensionSource(): string {
  return `const PROMA_CHECKPOINT_TYPE = 'proma-git-checkpoint'
let currentEntryId

function getLeafId(ctx) {
  const leaf = ctx.sessionManager.getLeafEntry()
  return leaf && typeof leaf.id === 'string' ? leaf.id : undefined
}

export default function (pi) {
  pi.on('tool_result', async (_event, ctx) => {
    currentEntryId = getLeafId(ctx)
  })

  pi.on('turn_start', async (_event, ctx) => {
    currentEntryId = currentEntryId || getLeafId(ctx)
    if (!currentEntryId) return

    const { stdout } = await pi.exec('git', ['stash', 'create'])
    const ref = String(stdout || '').trim()
    if (!ref) return

    await pi.appendEntry('proma-git-checkpoint', {
      targetEntryId: currentEntryId,
      gitRef: ref,
      cwd: ctx.cwd,
      createdAt: new Date().toISOString(),
      note: 'git checkpoint by Proma',
    })
  })

  pi.on('session_before_fork', async () => {
    // Proma 只记录 checkpoint 元数据，具体文件恢复必须由 Proma UI 显式触发。
    return undefined
  })
}
`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function normalizeSessionEntry(value: unknown): PiSessionEntry | null {
  const record = asRecord(value)
  if (!record) return null
  const id = getString(record, 'id')
  const type = getString(record, 'type')
  if (!id || !type) return null

  const parentValue = record.parentId
  return {
    id,
    type,
    parentId: typeof parentValue === 'string' ? parentValue : null,
    customType: getString(record, 'customType'),
    data: asRecord(record.data) ?? undefined,
  }
}

function readPiSessionEntries(sessionPath: string): PiSessionEntry[] {
  if (!existsSync(sessionPath)) return []

  const entries: PiSessionEntry[] = []
  for (const line of readFileSync(sessionPath, 'utf-8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue

    try {
      const entry = normalizeSessionEntry(JSON.parse(trimmed))
      if (entry) entries.push(entry)
    } catch {
      // Pi native session 是 append-only JSONL，跳过坏行避免影响 Proma 层回退。
    }
  }
  return entries
}

function toCheckpoint(entry: PiSessionEntry): PiGitCheckpoint | null {
  if (entry.type !== 'custom' || entry.customType !== PROMA_CHECKPOINT_TYPE || !entry.data) return null

  const targetEntryId = getString(entry.data, 'targetEntryId')
  const gitRef = getString(entry.data, 'gitRef')
  if (!targetEntryId || !gitRef) return null

  return {
    entryId: entry.id,
    targetEntryId,
    gitRef,
    ...(getString(entry.data, 'cwd') ? { cwd: getString(entry.data, 'cwd') } : {}),
    ...(getString(entry.data, 'createdAt') ? { createdAt: getString(entry.data, 'createdAt') } : {}),
  }
}

export function ensurePiGitCheckpointExtension(config: PiGitCheckpointExtensionConfig): string {
  const extensionDir = join(config.configDir, 'proma-extensions')
  mkdirSync(extensionDir, { recursive: true })

  const extensionPath = join(extensionDir, 'proma-git-checkpoint.mjs')
  writeFileSync(extensionPath, buildPiGitCheckpointExtensionSource(), 'utf-8')
  return extensionPath
}

export function buildPiGitCheckpointExtensionSourceForTest(): string {
  return buildPiGitCheckpointExtensionSource()
}

export function listPiGitCheckpoints(sessionPath: string): PiGitCheckpoint[] {
  return readPiSessionEntries(sessionPath)
    .map(toCheckpoint)
    .filter((checkpoint): checkpoint is PiGitCheckpoint => checkpoint !== null)
}

export function findPiGitCheckpointForEntry(sessionPath: string, targetEntryId: string): PiGitCheckpoint | null {
  const entries = readPiSessionEntries(sessionPath)
  const checkpointsByTarget = new Map<string, PiGitCheckpoint>()
  const parentById = new Map<string, string | null>()

  for (const entry of entries) {
    parentById.set(entry.id, entry.parentId)
    const checkpoint = toCheckpoint(entry)
    if (checkpoint) {
      checkpointsByTarget.set(checkpoint.entryId, checkpoint)
      checkpointsByTarget.set(checkpoint.targetEntryId, checkpoint)
    }
  }

  let currentId: string | null | undefined = targetEntryId
  const visited = new Set<string>()
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId)
    const checkpoint = checkpointsByTarget.get(currentId)
    if (checkpoint) return checkpoint
    currentId = parentById.get(currentId)
  }

  return null
}

function defaultRunGit(cwd: string, args: string[]): PiGitCommandResult {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf-8',
    timeout: 10_000,
    windowsHide: true,
  })

  return {
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : result.error?.message ?? '',
  }
}

function getGitError(result: PiGitCommandResult): string {
  const message = result.stderr.trim() || result.stdout.trim()
  return message || `git 命令退出码: ${result.status ?? 'unknown'}`
}

function parseGitNameOnlyOutput(output: string): string[] {
  const files: string[] = []
  const seen = new Set<string>()
  for (const line of output.split(/\r?\n/)) {
    const file = line.trim()
    if (!file || seen.has(file)) continue
    seen.add(file)
    files.push(file)
  }
  return files
}

export function applyPiGitCheckpoint(input: ApplyPiGitCheckpointInput): ApplyPiGitCheckpointResult {
  const checkpoint = findPiGitCheckpointForEntry(input.sessionPath, input.targetEntryId)
  if (!checkpoint) {
    return { restored: false, error: '未找到可恢复的 Pi git checkpoint' }
  }
  if (!checkpoint.cwd) {
    return { restored: false, checkpoint, error: 'Pi git checkpoint 缺少 cwd，无法恢复文件' }
  }

  const runGit = input.runGit ?? defaultRunGit
  const statusResult = runGit(checkpoint.cwd, ['status', '--porcelain'])
  if (statusResult.status !== 0) {
    return {
      restored: false,
      checkpoint,
      error: `检查 git 工作区状态失败：${getGitError(statusResult)}`,
    }
  }

  if (statusResult.stdout.trim().length > 0) {
    return {
      restored: false,
      checkpoint,
      error: '工作区存在未提交改动，请先提交、暂存或清理当前改动后再恢复 Pi checkpoint。',
    }
  }

  const applyResult = runGit(checkpoint.cwd, ['stash', 'apply', checkpoint.gitRef])
  if (applyResult.status !== 0) {
    return {
      restored: false,
      checkpoint,
      error: `恢复 Pi git checkpoint 失败：${getGitError(applyResult)}`,
    }
  }

  const changedFilesResult = runGit(checkpoint.cwd, ['diff', '--name-only'])
  const filesChanged = changedFilesResult.status === 0
    ? parseGitNameOnlyOutput(changedFilesResult.stdout)
    : []

  return {
    restored: true,
    checkpoint,
    filesChanged,
  }
}
