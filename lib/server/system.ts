import 'server-only'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SystemInfo } from '@/lib/shared/types'
import { loadConfig } from './config'
import { HttpError } from './http'
import { dataRoot, expandHome, isWindows } from './paths'
import { childEnv } from './process'
import { isPreview } from './runtime'

export function canOpenTerminal(): boolean {
  return isWindows && !isPreview()
}

export function canOpenFolder(): boolean {
  return !isPreview() && (isWindows || process.platform === 'darwin')
}

export async function systemInfo(): Promise<SystemInfo> {
  const config = await loadConfig()
  return {
    platform: process.platform,
    dataRoot: dataRoot(),
    vaultPath: path.resolve(expandHome(config.vaultPath)),
    preview: isPreview(),
    nodeVersion: process.version,
    canOpenTerminal: canOpenTerminal(),
    canOpenFolder: canOpenFolder(),
    homeDir: os.homedir(),
  }
}

/** Opens a folder in Explorer / Finder. For a file, opens its folder with the file selected. */
export async function revealInFileManager(target: string): Promise<void> {
  if (!canOpenFolder()) throw new HttpError(400, '当前环境不能打开本机文件夹。')
  const stat = await fs.stat(target).catch(() => null)
  if (!stat) throw new HttpError(404, '这个位置不存在。')
  if (isWindows) {
    const args = stat.isDirectory() ? [target] : [`/select,"${target}"`]
    const child = spawn('explorer.exe', args, {
      detached: true,
      stdio: 'ignore',
      windowsVerbatimArguments: !stat.isDirectory(),
    })
    child.on('error', () => undefined)
    child.unref()
    return
  }
  const child = spawn('open', stat.isDirectory() ? [target] : ['-R', target], { detached: true, stdio: 'ignore' })
  child.on('error', () => undefined)
  child.unref()
}

export function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * Opens a visible PowerShell window running the given script lines. The script
 * travels as -EncodedCommand (UTF-16LE base64), so Chinese text, spaces and
 * quotes in paths never need escaping through cmd.exe.
 */
export async function openTerminal(title: string, lines: string[]): Promise<void> {
  if (!canOpenTerminal()) throw new HttpError(400, '只有在 Windows 本机运行时才能自动打开终端，请复制命令手动执行。')
  const config = await loadConfig()
  const script = [
    "$ErrorActionPreference = 'Continue'",
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    `$Host.UI.RawUI.WindowTitle = ${psQuote(title)}`,
    ...(config.proxy
      ? [`$env:HTTPS_PROXY = ${psQuote(config.proxy)}`, `$env:HTTP_PROXY = ${psQuote(config.proxy)}`]
      : []),
    ...lines,
  ].join('\r\n')
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const child = spawn(
    'cmd.exe',
    ['/d', '/c', 'start', '', 'powershell.exe', '-NoExit', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { detached: true, stdio: 'ignore', windowsHide: true, env: childEnv({ proxy: config.proxy }) },
  )
  await new Promise<void>((resolve, reject) => {
    child.once('error', (error) => reject(new HttpError(500, `无法打开终端：${error.message}`)))
    child.once('spawn', () => resolve())
  })
  child.unref()
}
