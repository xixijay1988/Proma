import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Readable } from 'node:stream'

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

export interface StartedPiProcess {
  child: ChildProcessByStdio<null, Readable, Readable>
  done: Promise<PiProcessResult>
  kill: () => void
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

function appendSnippet(current: string, chunk: Buffer): string {
  const next = current + chunk.toString('utf8')
  return next.length > MAX_PROCESS_SNIPPET_LENGTH
    ? next.slice(0, MAX_PROCESS_SNIPPET_LENGTH)
    : next
}

function killChildProcess(child: ChildProcessByStdio<null, Readable, Readable>): void {
  if (child.exitCode !== null || child.signalCode !== null) return

  child.kill('SIGTERM')
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
    }
  }, FORCE_KILL_DELAY_MS).unref()
}

export function startPiProcessBridgeProbe(input: {
  cwd?: string
  abortSignal?: AbortSignal
}): StartedPiProcess {
  const cliPath = resolvePiCliEntrypoint()
  const env: NodeJS.ProcessEnv = { ...process.env }

  // Electron 主进程使用 Electron 可执行文件时，以 Node 兼容模式运行 CLI 脚本。
  if (process.versions.electron) {
    env.ELECTRON_RUN_AS_NODE = '1'
  }

  const child = spawn(process.execPath, [cliPath, '--help'], {
    cwd: input.cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdoutSnippet = ''
  let stderrSnippet = ''
  let aborted = false
  let settled = false
  let forceKillTimer: NodeJS.Timeout | null = null

  const abort = (): void => {
    aborted = true
    killChildProcess(child)
  }

  if (input.abortSignal?.aborted) {
    abort()
  } else {
    input.abortSignal?.addEventListener('abort', abort, { once: true })
  }

  child.stdout.on('data', (chunk: Buffer) => {
    stdoutSnippet = appendSnippet(stdoutSnippet, chunk)
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
      killChildProcess(child)
    }, FORCE_KILL_DELAY_MS * 5)
    forceKillTimer.unref()
  })

  return {
    child,
    done,
    kill: () => {
      killChildProcess(child)
    },
  }
}
