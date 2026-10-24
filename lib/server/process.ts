import 'server-only'
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import crossSpawn from 'cross-spawn'
import { expandHome, isWindows } from './paths'

/** Splits an argument template into tokens, honouring "double" and 'single' quotes. Backslashes stay literal so Windows paths work. */
export function splitArgs(template: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inToken = false
  let quote: '"' | "'" | null = null
  for (const ch of template) {
    if (quote) {
      if (ch === quote) quote = null
      else current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      inToken = true
      continue
    }
    if (/\s/.test(ch)) {
      if (inToken) {
        tokens.push(current)
        current = ''
        inToken = false
      }
      continue
    }
    current += ch
    inToken = true
  }
  if (inToken) tokens.push(current)
  return tokens
}

export interface TemplateVars {
  model?: string
  prompt?: string
  output?: string
}

export function templateUses(template: string, name: keyof TemplateVars): boolean {
  return splitArgs(template).some((token) => token.includes(`{${name}}`))
}

/**
 * Expands an argument template into argv. A standalone {model} token becomes
 * `<modelFlag> <model>` (or disappears when no model is set); other placeholders
 * are substituted in place with a single pass so values are never re-expanded.
 */
export function expandTemplate(template: string, vars: TemplateVars, modelFlag?: string): string[] {
  const argv: string[] = []
  for (const token of splitArgs(template)) {
    if (token === '{model}') {
      if (vars.model && modelFlag) argv.push(modelFlag, vars.model)
      continue
    }
    argv.push(token.replace(/\{(model|prompt|output)\}/g, (_, name: keyof TemplateVars) => vars[name] ?? ''))
  }
  return argv
}

function quoteForDisplay(arg: string): string {
  const shown = arg.length > 160 ? `${arg.slice(0, 157)}…` : arg
  const flat = shown.replace(/\r?\n/g, '⏎')
  return /[\s"'&|<>^]/.test(flat) || flat === '' ? `"${flat.replace(/"/g, '\\"')}"` : flat
}

export function formatCommandLine(command: string, args: string[]): string {
  return [quoteForDisplay(command), ...args.map(quoteForDisplay)].join(' ')
}

const WINDOWS_EXTENSIONS = ['.com', '.exe', '.bat', '.cmd']

/** Directories where official installers put CLIs, so freshly installed tools are found without restarting the app. */
function searchDirs(): string[] {
  const env = process.env
  const home = os.homedir()
  const dirs = (env.PATH ?? '').split(path.delimiter)
  dirs.push(path.dirname(process.execPath))
  if (isWindows) {
    if (env.APPDATA) dirs.push(path.join(env.APPDATA, 'npm'))
    if (env.LOCALAPPDATA) {
      dirs.push(
        path.join(env.LOCALAPPDATA, 'agy', 'bin'),
        path.join(env.LOCALAPPDATA, 'pnpm'),
        path.join(env.LOCALAPPDATA, 'Volta', 'bin'),
        path.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'),
      )
    }
    dirs.push(path.join(home, '.local', 'bin'), path.join(home, 'scoop', 'shims'), path.join(home, '.bun', 'bin'))
  } else {
    dirs.push(
      path.join(home, '.local', 'bin'),
      path.join(home, '.npm-global', 'bin'),
      path.join(home, '.bun', 'bin'),
      '/usr/local/bin',
      '/opt/homebrew/bin',
    )
  }
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of dirs) {
    const dir = raw.trim().replace(/^"(.*)"$/, '$1')
    if (!dir) continue
    const key = isWindows ? dir.toLowerCase().replace(/[\\/]+$/, '') : dir.replace(/\/+$/, '')
    if (seen.has(key)) continue
    seen.add(key)
    result.push(dir)
  }
  return result
}

async function isRunnable(file: string): Promise<boolean> {
  try {
    const stat = await fs.stat(file)
    if (!stat.isFile()) return false
    if (!isWindows) await fs.access(file, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

function candidatesFor(base: string): string[] {
  if (!isWindows) return [base]
  const ext = path.extname(base).toLowerCase()
  if (WINDOWS_EXTENSIONS.includes(ext)) return [base]
  // The extensionless file npm drops next to the .cmd shim is a POSIX shell script; never run it on Windows.
  return WINDOWS_EXTENSIONS.map((extension) => base + extension)
}

/** Finds the executable for a command name or path; returns an absolute path or null. */
export async function resolveCommand(command: string): Promise<string | null> {
  const cmd = expandHome(command.trim().replace(/^"(.*)"$/, '$1'))
  if (!cmd) return null
  if (cmd.includes('/') || cmd.includes('\\') || path.isAbsolute(cmd)) {
    for (const candidate of candidatesFor(path.resolve(cmd))) {
      if (await isRunnable(candidate)) return candidate
    }
    return null
  }
  for (const dir of searchDirs()) {
    for (const candidate of candidatesFor(path.join(dir, cmd))) {
      if (await isRunnable(candidate)) return candidate
    }
  }
  return null
}

export function isBatchFile(file: string): boolean {
  return isWindows && /\.(cmd|bat)$/i.test(file)
}

/**
 * Environment for child processes: the augmented PATH (so shims find node and
 * freshly installed tools) plus an optional proxy. Next.js internals are dropped.
 */
export function childEnv(options: { proxy?: string; extra?: Record<string, string> } = {}): NodeJS.ProcessEnv {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (/^path$/i.test(key)) continue
    if (key.startsWith('__NEXT') || key === 'NEXT_RUNTIME' || key === 'NODE_OPTIONS' || key === 'TURBOPACK') continue
    env[key] = value
  }
  env[isWindows ? 'Path' : 'PATH'] = searchDirs().join(path.delimiter)
  env.NO_COLOR = '1'
  env.FORCE_COLOR = '0'
  const proxy = options.proxy?.trim()
  if (proxy) {
    for (const key of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy']) env[key] = proxy
    env.NO_PROXY = env.no_proxy = 'localhost,127.0.0.1,::1'
  }
  return { ...env, ...options.extra } as NodeJS.ProcessEnv
}

const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)|\u001B\[[0-?]*[ -/]*[@-~]|\u001B[@-Z\\-_]/g

export function cleanOutput(text: string): string {
  return text.replace(ANSI_PATTERN, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

export interface RunOptions {
  command: string
  args: string[]
  cwd: string
  /** Written to stdin, which is then closed. stdin is always closed so no CLI waits for input. */
  stdin?: string
  timeoutMs: number
  signal?: AbortSignal
  env?: NodeJS.ProcessEnv
  onOutput?: (text: string, stream: 'stdout' | 'stderr') => void
  /** Keeps only the last N characters of each stream. */
  maxCaptureChars?: number
}

export interface RunResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  aborted: boolean
  spawnError?: string
  durationMs: number
}

function killTree(child: ChildProcess) {
  const pid = child.pid
  if (!pid) return
  if (isWindows) {
    try {
      const killer = nodeSpawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      killer.on('error', () => child.kill())
    } catch {
      child.kill()
    }
    return
  }
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      // already exited
    }
  }, 2500).unref()
}

export function runProcess(options: RunOptions): Promise<RunResult> {
  const startedAt = Date.now()
  const cap = options.maxCaptureChars ?? 4_000_000
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let aborted = false
    let settled = false
    let exitCode: number | null = null
    let timer: NodeJS.Timeout | undefined
    let closeGrace: NodeJS.Timeout | undefined
    let child: ChildProcess | undefined
    const outDecoder = new StringDecoder('utf8')
    const errDecoder = new StringDecoder('utf8')

    const append = (current: string, chunk: string) => {
      const next = current + chunk
      return next.length > cap ? next.slice(next.length - cap) : next
    }
    const push = (text: string, stream: 'stdout' | 'stderr') => {
      if (!text) return
      if (stream === 'stdout') stdout = append(stdout, text)
      else stderr = append(stderr, text)
      options.onOutput?.(text, stream)
    }
    const onAbort = () => {
      aborted = true
      if (child) killTree(child)
    }
    const finish = (code: number | null, spawnError?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(closeGrace)
      options.signal?.removeEventListener('abort', onAbort)
      push(outDecoder.end(), 'stdout')
      push(errDecoder.end(), 'stderr')
      resolve({
        exitCode: code,
        stdout: cleanOutput(stdout),
        stderr: cleanOutput(stderr),
        timedOut,
        aborted,
        spawnError,
        durationMs: Date.now() - startedAt,
      })
    }

    if (options.signal?.aborted) {
      aborted = true
      finish(null)
      return
    }

    try {
      child = crossSpawn(options.command, options.args, {
        cwd: options.cwd,
        env: options.env ?? childEnv(),
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: !isWindows,
      })
    } catch (error) {
      finish(null, error instanceof Error ? error.message : String(error))
      return
    }

    options.signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => {
      timedOut = true
      if (child) killTree(child)
    }, options.timeoutMs)

    child.stdout?.on('data', (chunk: Buffer) => push(outDecoder.write(chunk), 'stdout'))
    child.stderr?.on('data', (chunk: Buffer) => push(errDecoder.write(chunk), 'stderr'))
    child.stdin?.on('error', () => undefined)
    child.stdin?.end(options.stdin ?? '', 'utf8')

    child.on('error', (error: NodeJS.ErrnoException) => {
      const message = error.code === 'ENOENT' ? `找不到命令：${options.command}` : error.message
      finish(exitCode, message)
    })
    child.on('exit', (code) => {
      exitCode = code
      // A grandchild that inherited stdout can keep the pipes open; don't wait on it forever.
      closeGrace = setTimeout(() => finish(code), 3000)
    })
    child.on('close', (code) => finish(code ?? exitCode))
  })
}

/** Runs `<command> --version` and returns the first output line. */
export async function probeVersion(resolvedPath: string, proxy?: string): Promise<string | null> {
  const result = await runProcess({
    command: resolvedPath,
    args: ['--version'],
    cwd: os.tmpdir(),
    timeoutMs: 15_000,
    env: childEnv({ proxy }),
    maxCaptureChars: 20_000,
  })
  if (result.exitCode !== 0) return null
  const line = (result.stdout.trim() ? result.stdout : result.stderr)
    .split('\n')
    .map((part) => part.trim())
    .find(Boolean)
  return line ? line.slice(0, 80) : null
}

/** Last non-empty lines of a CLI's output, for readable error messages. */
export function tailLines(text: string, maxLines = 6, maxChars = 600): string {
  const lines = text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim())
  const tail = lines.slice(-maxLines).join('\n')
  return tail.length > maxChars ? `…${tail.slice(tail.length - maxChars)}` : tail
}
