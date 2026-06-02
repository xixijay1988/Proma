import { basename, dirname, join } from 'node:path'

export type PackagedSmokePlatform = NodeJS.Platform

export interface DefaultPackagedAppPathInput {
  cwd: string
  platform: PackagedSmokePlatform
  arch: string
}

export interface ResolvePackagedSmokePathsInput {
  appPath: string
  platform: PackagedSmokePlatform
}

export interface PackagedSmokePaths {
  appPath: string
  executablePath: string
  resourcesPath: string
  appAsarPath: string
  appUnpackedPath: string
}

export function defaultPackagedAppPath(input: DefaultPackagedAppPathInput): string {
  if (input.platform === 'darwin') {
    return join(input.cwd, 'out', `mac-${input.arch}`, 'Proma.app')
  }

  if (input.platform === 'win32') {
    return join(input.cwd, 'out', 'win-unpacked')
  }

  if (input.platform === 'linux') {
    return join(input.cwd, 'out', 'linux-unpacked')
  }

  throw new Error(`当前平台暂不支持 Pi MCP packaged smoke: ${input.platform}`)
}

export function resolvePackagedSmokePaths(input: ResolvePackagedSmokePathsInput): PackagedSmokePaths {
  if (input.platform === 'darwin') {
    return buildPaths({
      appPath: input.appPath,
      executablePath: join(input.appPath, 'Contents', 'MacOS', 'Proma'),
      resourcesPath: join(input.appPath, 'Contents', 'Resources'),
    })
  }

  if (input.platform === 'win32') {
    const appPath = input.appPath.endsWith('.exe') ? dirname(input.appPath) : input.appPath
    const executablePath = input.appPath.endsWith('.exe') ? input.appPath : join(appPath, 'Proma.exe')
    return buildPaths({
      appPath,
      executablePath,
      resourcesPath: join(appPath, 'resources'),
    })
  }

  if (input.platform === 'linux') {
    const appPath = isLinuxExecutablePath(input.appPath) ? dirname(input.appPath) : input.appPath
    const executablePath = isLinuxExecutablePath(input.appPath) ? input.appPath : join(appPath, 'Proma')
    return buildPaths({
      appPath,
      executablePath,
      resourcesPath: join(appPath, 'resources'),
    })
  }

  throw new Error(`当前平台暂不支持 Pi MCP packaged smoke: ${input.platform}`)
}

function isLinuxExecutablePath(appPath: string): boolean {
  return basename(appPath) === 'Proma' || basename(appPath) === 'proma'
}

function buildPaths(input: {
  appPath: string
  executablePath: string
  resourcesPath: string
}): PackagedSmokePaths {
  return {
    ...input,
    appAsarPath: join(input.resourcesPath, 'app.asar'),
    appUnpackedPath: join(input.resourcesPath, 'app.asar.unpacked'),
  }
}
