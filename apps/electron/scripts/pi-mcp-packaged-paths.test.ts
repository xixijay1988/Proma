import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import {
  buildRunnerSource,
} from './pi-mcp-packaged-smoke.ts'
import {
  defaultPackagedAppPath,
  resolvePackagedSmokePaths,
} from './pi-mcp-packaged-paths.ts'

describe('pi-mcp-packaged-paths', () => {
  test('Given macOS arm64 build When resolving packaged smoke paths Then it points at the app bundle resources', () => {
    const cwd = '/repo/apps/electron'
    const appPath = defaultPackagedAppPath({ cwd, platform: 'darwin', arch: 'arm64' })
    const paths = resolvePackagedSmokePaths({ appPath, platform: 'darwin' })

    expect(appPath).toBe(join(cwd, 'out', 'mac-arm64', 'Proma.app'))
    expect(paths.executablePath).toBe(join(appPath, 'Contents', 'MacOS', 'Proma'))
    expect(paths.resourcesPath).toBe(join(appPath, 'Contents', 'Resources'))
    expect(paths.appAsarPath).toBe(join(appPath, 'Contents', 'Resources', 'app.asar'))
    expect(paths.appUnpackedPath).toBe(join(appPath, 'Contents', 'Resources', 'app.asar.unpacked'))
  })

  test('Given Windows x64 build When resolving packaged smoke paths Then it points at win-unpacked resources', () => {
    const cwd = 'C:\\repo\\apps\\electron'
    const appPath = defaultPackagedAppPath({ cwd, platform: 'win32', arch: 'x64' })
    const paths = resolvePackagedSmokePaths({ appPath, platform: 'win32' })

    expect(appPath).toBe(join(cwd, 'out', 'win-unpacked'))
    expect(paths.executablePath).toBe(join(appPath, 'Proma.exe'))
    expect(paths.resourcesPath).toBe(join(appPath, 'resources'))
    expect(paths.appAsarPath).toBe(join(appPath, 'resources', 'app.asar'))
    expect(paths.appUnpackedPath).toBe(join(appPath, 'resources', 'app.asar.unpacked'))
  })

  test('Given Linux x64 build When resolving packaged smoke paths Then it points at linux-unpacked resources', () => {
    const cwd = '/repo/apps/electron'
    const appPath = defaultPackagedAppPath({ cwd, platform: 'linux', arch: 'x64' })
    const paths = resolvePackagedSmokePaths({ appPath, platform: 'linux' })

    expect(appPath).toBe(join(cwd, 'out', 'linux-unpacked'))
    expect(paths.executablePath).toBe(join(appPath, 'Proma'))
    expect(paths.resourcesPath).toBe(join(appPath, 'resources'))
    expect(paths.appAsarPath).toBe(join(appPath, 'resources', 'app.asar'))
    expect(paths.appUnpackedPath).toBe(join(appPath, 'resources', 'app.asar.unpacked'))
  })

  test('Given custom executable file path When resolving Windows smoke paths Then resources are resolved next to the executable', () => {
    const executablePath = join('C:\\repo\\apps\\electron', 'out', 'win-unpacked', 'Proma.exe')
    const paths = resolvePackagedSmokePaths({ appPath: executablePath, platform: 'win32' })

    expect(paths.executablePath).toBe(executablePath)
    expect(paths.resourcesPath).toBe(join('C:\\repo\\apps\\electron', 'out', 'win-unpacked', 'resources'))
  })

  test('Given runner source is generated When executed inside packaged app Then it contains cross-platform resources resolution', () => {
    const source = buildRunnerSource()

    expect(source).toContain("process.platform === 'darwin'")
    expect(source).toContain("join(dirname(dirname(process.execPath)), 'Resources')")
    expect(source).toContain("join(dirname(process.execPath), 'resources')")
  })
})
