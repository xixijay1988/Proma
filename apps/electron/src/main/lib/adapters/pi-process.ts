import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Readable, Writable } from 'node:stream'

const PI_PACKAGE_NAME = '@earendil-works/pi-coding-agent'
const PI_CLI_RELATIVE_PATH = ['dist', 'cli.js'] as const
const MAX_PROCESS_SNIPPET_LENGTH = 800
const FORCE_KILL_DELAY_MS = 1000

export interface PiProcessResult {
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdoutSnippet: string
  stderrSnippet: string
  errorMessage?: string
  aborted: boolean
}

export interface PiRpcCommand {
  type: string
  id?: string
  [key: string]: unknown
}

export interface PiRpcEvent {
  type: string
  [key: string]: unknown
}

export interface StartedPiRpcSession {
  child: ChildProcessByStdio<Writable, Readable, Readable>
  events: AsyncIterable<PiRpcEvent>
  done: Promise<PiProcessResult>
  send: (command: PiRpcCommand) => void
  abort: () => void
  kill: () => void
}

interface PiJsonlLineSplitter {
  push: (chunk: Buffer | string) => string[]
  flush: () => string[]
}

interface AsyncQueueController<T> {
  iterable: AsyncIterable<T>
  push: (value: T) => void
  end: () => void
}

function resolvePackageRootFromPackageJson(cjsRequire: NodeJS.Require): string | null {
  try {
    return dirname(cjsRequire.resolve(`${PI_PACKAGE_NAME}/package.json`))
  } catch {
    return null
  }
}

function resolvePackageRootFromNodeModules(cjsRequire: NodeJS.Require): string | null {
  const searchPaths = cjsRequire.resolve.paths(PI_PACKAGE_NAME) ?? []

  for (const searchPath of searchPaths) {
    const packageRoot = join(searchPath, '@earendil-works', 'pi-coding-agent')
    if (existsSync(join(packageRoot, 'package.json'))) {
      return packageRoot
    }
  }

  return null
}

function resolveCliFromPackageRoot(packageRoot: string): string {
  return join(packageRoot, ...PI_CLI_RELATIVE_PATH)
}

export function resolvePiCliEntrypoint(): string {
  const cjsRequire = createRequire(__filename)
  const packageRoot =
    resolvePackageRootFromPackageJson(cjsRequire) ??
    resolvePackageRootFromNodeModules(cjsRequire)

  if (!packageRoot) {
    throw new Error(`无法解析 ${PI_PACKAGE_NAME} 包路径`)
  }

  const cliPath = resolveCliFromPackageRoot(packageRoot)
  if (!existsSync(cliPath)) {
    throw new Error(`Pi CLI 入口不存在: ${cliPath}`)
  }

  return cliPath
}

export function resolvePiCliEntrypointForTest(): string {
  return resolvePiCliEntrypoint()
}

function createPiJsonlLineSplitter(): PiJsonlLineSplitter {
  let buffer = ''

  const normalizeLine = (line: string): string => (
    line.endsWith('\r') ? line.slice(0, -1) : line
  )

  return {
    push(chunk: Buffer | string): string[] {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      const lines: string[] = []
      let index = buffer.indexOf('\n')

      while (index !== -1) {
        lines.push(normalizeLine(buffer.slice(0, index)))
        buffer = buffer.slice(index + 1)
        index = buffer.indexOf('\n')
      }

      return lines
    },
    flush(): string[] {
      if (!buffer) return []
      const line = normalizeLine(buffer)
      buffer = ''
      return [line]
    },
  }
}

export function createPiJsonlLineSplitterForTest(): PiJsonlLineSplitter {
  return createPiJsonlLineSplitter()
}

function createAsyncQueue<T>(): AsyncQueueController<T> {
  const values: T[] = []
  const resolvers: Array<(result: IteratorResult<T>) => void> = []
  let ended = false

  const resolveNext = (): void => {
    while (resolvers.length > 0 && values.length > 0) {
      const resolve = resolvers.shift()
      const value = values.shift()
      if (resolve && value !== undefined) {
        resolve({ value, done: false })
      }
    }

    if (ended) {
      while (resolvers.length > 0) {
        const resolve = resolvers.shift()
        resolve?.({ value: undefined, done: true })
      }
    }
  }

  return {
    iterable: {
      [Symbol.asyncIterator](): AsyncIterator<T> {
        return {
          next(): Promise<IteratorResult<T>> {
            if (values.length > 0) {
              const value = values.shift()
              if (value !== undefined) {
                return Promise.resolve({ value, done: false })
              }
            }

            if (ended) {
              return Promise.resolve({ value: undefined, done: true })
            }

            return new Promise((resolve) => {
              resolvers.push(resolve)
            })
          },
        }
      },
    },
    push(value: T): void {
      if (ended) return
      values.push(value)
      resolveNext()
    },
    end(): void {
      if (ended) return
      ended = true
      resolveNext()
    },
  }
}

function appendSnippet(current: string, chunk: Buffer): string {
  const next = current + chunk.toString('utf8')
  return next.length > MAX_PROCESS_SNIPPET_LENGTH
    ? next.slice(0, MAX_PROCESS_SNIPPET_LENGTH)
    : next
}

function killRpcChildProcess(child: ChildProcessByStdio<Writable, Readable, Readable>): void {
  if (child.exitCode !== null || child.signalCode !== null) return

  child.kill('SIGTERM')
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
    }
  }, FORCE_KILL_DELAY_MS).unref()
}

function createPiEnv(extraEnv?: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PI_TELEMETRY: process.env.PI_TELEMETRY ?? '0',
    ...extraEnv,
  }

  // Electron 主进程使用 Electron 可执行文件时，以 Node 兼容模式运行 CLI 脚本。
  if (process.versions.electron) {
    env.ELECTRON_RUN_AS_NODE = '1'
  }

  return env
}

function parsePiRpcLine(line: string): PiRpcEvent | null {
  if (!line.trim()) return null

  try {
    const parsed = JSON.parse(line) as unknown
    if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) {
      return { type: 'protocol_error', error: 'Pi RPC 输出缺少 type 字段', raw: line }
    }
    return parsed as PiRpcEvent
  } catch (error) {
    return {
      type: 'protocol_error',
      error: error instanceof Error ? error.message : 'Pi RPC JSON 解析失败',
      raw: line,
    }
  }
}

function buildPiRpcArgs(input: {
  model?: string
  provider?: string
  sessionId?: string
  sessionDir?: string
}): string[] {
  const args = [resolvePiCliEntrypoint(), '--mode', 'rpc']

  if (input.sessionDir?.trim()) {
    args.push('--session-dir', input.sessionDir.trim())
  }

  if (input.sessionId?.trim()) {
    args.push('--session-id', input.sessionId.trim())
  }

  if (!input.sessionDir?.trim() && !input.sessionId?.trim()) {
    args.push('--no-session')
  }

  if (input.provider?.trim()) {
    args.push('--provider', input.provider.trim())
  }

  if (input.model?.trim()) {
    args.push('--model', input.model.trim())
  }

  return args
}

export function buildPiRpcArgsForTest(input: {
  model?: string
  provider?: string
  sessionId?: string
  sessionDir?: string
}): string[] {
  return buildPiRpcArgs(input)
}

export function startPiRpcSession(input: {
  cwd?: string
  model?: string
  provider?: string
  sessionId?: string
  sessionDir?: string
  runtimeEnv?: Record<string, string | undefined>
  abortSignal?: AbortSignal
}): StartedPiRpcSession {
  const child = spawn(process.execPath, buildPiRpcArgs({
    model: input.model,
    provider: input.provider,
    sessionId: input.sessionId,
    sessionDir: input.sessionDir,
  }), {
    cwd: input.cwd,
    env: createPiEnv(input.runtimeEnv),
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const eventQueue = createAsyncQueue<PiRpcEvent>()
  const stdoutSplitter = createPiJsonlLineSplitter()
  let stdoutSnippet = ''
  let stderrSnippet = ''
  let aborted = false
  let settled = false
  let forceKillTimer: NodeJS.Timeout | null = null

  const pushLine = (line: string): void => {
    const event = parsePiRpcLine(line)
    if (event) eventQueue.push(event)
  }

  const abort = (): void => {
    aborted = true
    try {
      if (child.stdin.writable) {
        child.stdin.write(`${JSON.stringify({ type: 'abort' })}\n`)
      }
    } catch {
      // 进程可能已经退出，继续进入 kill 兜底。
    }
    killRpcChildProcess(child)
  }

  if (input.abortSignal?.aborted) {
    abort()
  } else {
    input.abortSignal?.addEventListener('abort', abort, { once: true })
  }

  child.stdout.on('data', (chunk: Buffer) => {
    stdoutSnippet = appendSnippet(stdoutSnippet, chunk)
    for (const line of stdoutSplitter.push(chunk)) {
      pushLine(line)
    }
  })
  child.stderr.on('data', (chunk: Buffer) => {
    stderrSnippet = appendSnippet(stderrSnippet, chunk)
  })

  const done = new Promise<PiProcessResult>((resolve) => {
    const cleanup = (): void => {
      if (forceKillTimer) {
        clearTimeout(forceKillTimer)
        forceKillTimer = null
      }
      input.abortSignal?.removeEventListener('abort', abort)
      for (const line of stdoutSplitter.flush()) {
        pushLine(line)
      }
      eventQueue.end()
    }

    const finish = (result: PiProcessResult): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }

    child.once('error', (error) => {
      finish({
        exitCode: null,
        signal: null,
        stdoutSnippet,
        stderrSnippet,
        errorMessage: error.message,
        aborted,
      })
    })

    child.once('close', (exitCode, signal) => {
      finish({
        exitCode,
        signal,
        stdoutSnippet,
        stderrSnippet,
        aborted,
      })
    })

    forceKillTimer = setTimeout(() => {
      killRpcChildProcess(child)
    }, FORCE_KILL_DELAY_MS * 60)
    forceKillTimer.unref()
  })

  return {
    child,
    done,
    events: eventQueue.iterable,
    send: (command) => {
      child.stdin.write(`${JSON.stringify(command)}\n`)
    },
    abort,
    kill: () => {
      killRpcChildProcess(child)
    },
  }
}
