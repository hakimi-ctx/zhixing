// 知行一键启动：检查 Node.js → 安装依赖 → 需要时构建 → 只在本机地址启动 → 打开浏览器。
// Start-Zhixing.bat 调用这个脚本；也可以运行 `node scripts/launcher.mjs`。
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isWindows = process.platform === 'win32'
const MIN_NODE_MAJOR = 20
const BASE_PORT = Number(process.env.ZHIXING_PORT) || 3939
const NEXT_BIN = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next')
const INSTALL_STAMP = path.join(root, 'node_modules', '.zhixing-install.json')
const BUILD_STAMP = path.join(root, '.next', 'zhixing-build.json')
const BUILD_SOURCES = ['app', 'components', 'lib', 'public', 'package.json', 'next.config.ts', 'tsconfig.json']
const quietEnv = { ...process.env, NEXT_TELEMETRY_DISABLED: '1', COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' }

function say(text) {
  process.stdout.write(`${text}\n`)
}

function fail(text) {
  process.stderr.write(`\n[知行] ${text}\n`)
  process.exit(1)
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function writeJson(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(value, null, 2))
  } catch {
    // A missing stamp only means the next launch re-checks.
  }
}

function hasCommand(command) {
  return spawnSync(isWindows ? 'where' : 'which', [command], { stdio: 'ignore' }).status === 0
}

/** Runs a package-manager command through the shell (they are .cmd shims on Windows). */
function runShell(commandLine, label) {
  say(`\n[知行] ${label}…`)
  const result = spawnSync(commandLine, { cwd: root, stdio: 'inherit', shell: true, env: quietEnv })
  if (result.status !== 0) fail(`${label}失败（退出码 ${result.status ?? '未知'}）。请看上面的输出；如果是网络问题，稍后重新双击启动即可。`)
}

function fingerprint(files) {
  return files
    .map((name) => {
      try {
        const stat = fs.statSync(path.join(root, name))
        return `${name}:${stat.size}:${Math.round(stat.mtimeMs)}`
      } catch {
        return `${name}:-`
      }
    })
    .join('|')
}

function newestMtime(entries) {
  let newest = 0
  const walk = (target) => {
    let stat
    try {
      stat = fs.statSync(target)
    } catch {
      return
    }
    if (!stat.isDirectory()) {
      newest = Math.max(newest, stat.mtimeMs)
      return
    }
    for (const name of fs.readdirSync(target)) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      walk(path.join(target, name))
    }
  }
  for (const entry of entries) walk(path.join(root, entry))
  return Math.round(newest)
}

function checkNode() {
  const major = Number(process.versions.node.split('.')[0])
  if (major < MIN_NODE_MAJOR) {
    fail(`需要 Node.js ${MIN_NODE_MAJOR} 或更高版本，当前是 ${process.versions.node}。请到 https://nodejs.org/zh-cn 下载 LTS 版本安装后，再双击启动。`)
  }
}

function installDependencies() {
  if (process.env.ZHIXING_SKIP_INSTALL === '1') return
  const print = fingerprint(['package.json', 'pnpm-lock.yaml'])
  const ready = fs.existsSync(path.join(NEXT_BIN)) && readJson(INSTALL_STAMP)?.fingerprint === `${print}|${process.platform}-${process.arch}`
  if (ready) return
  const hasLock = fs.existsSync(path.join(root, 'pnpm-lock.yaml'))
  if (hasLock && hasCommand('pnpm')) runShell('pnpm install', '第一次启动，正在安装依赖（需要联网，大约 1～3 分钟）')
  else if (hasLock && hasCommand('corepack')) runShell('corepack pnpm install', '第一次启动，正在安装依赖（需要联网，大约 1～3 分钟）')
  // npm ignores pnpm-lock.yaml and is stricter about peer ranges than pnpm, so relax that check.
  else runShell('npm install --no-audit --no-fund --legacy-peer-deps', '第一次启动，正在安装依赖（需要联网，大约 1～3 分钟）')
  writeJson(INSTALL_STAMP, { fingerprint: `${print}|${process.platform}-${process.arch}`, at: new Date().toISOString() })
}

function buildIfNeeded() {
  const sources = newestMtime(BUILD_SOURCES)
  const stamp = readJson(BUILD_STAMP)
  const built = fs.existsSync(path.join(root, '.next', 'BUILD_ID'))
  if (built && stamp?.sources === sources && stamp?.node === process.versions.node) return true
  say('\n[知行] 正在构建（第一次或更新后需要，大约 1～2 分钟）…')
  const result = spawnSync(process.execPath, [NEXT_BIN, 'build'], { cwd: root, stdio: 'inherit', env: { ...quietEnv, NODE_ENV: 'production' } })
  if (result.status !== 0) {
    say('[知行] 生产构建失败，改用开发模式启动（功能相同，仅首次打开页面时会再编译一下）。')
    return false
  }
  writeJson(BUILD_STAMP, { sources, node: process.versions.node, at: new Date().toISOString() })
  return true
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, '127.0.0.1')
  })
}

async function systemInfo(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/system`, { signal: AbortSignal.timeout(2000) })
    if (!response.ok) return null
    const data = await response.json()
    return data && typeof data.dataRoot === 'string' ? data : null
  } catch {
    return null
  }
}

function openBrowser(url) {
  if (process.env.ZHIXING_NO_BROWSER === '1') return
  try {
    const child = isWindows
      ? spawn('cmd', ['/c', `start "" "${url}"`], { stdio: 'ignore', detached: true, windowsHide: true, windowsVerbatimArguments: true })
      : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore', detached: true })
    child.on('error', () => say(`[知行] 没能自动打开浏览器，请手动访问 ${url}`))
    child.unref()
  } catch {
    say(`[知行] 没能自动打开浏览器，请手动访问 ${url}`)
  }
}

async function waitUntilReady(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const info = await systemInfo(port)
    if (info) return info
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return null
}

function banner(url, info) {
  const line = '='.repeat(56)
  say(`\n${line}`)
  say('  知行已启动')
  say(`  地址：${url}`)
  if (info?.dataRoot) say(`  你的数据保存在：${info.dataRoot}`)
  say('  关闭这个窗口就会退出知行。')
  say(`${line}\n`)
}

async function main() {
  process.chdir(root)
  checkNode()

  const existing = await systemInfo(BASE_PORT)
  if (existing) {
    const url = `http://127.0.0.1:${BASE_PORT}/study`
    say(`[知行] 知行已经在运行了，正在打开 ${url}`)
    openBrowser(url)
    return
  }

  installDependencies()
  const prodReady = process.env.ZHIXING_USE_DEV === '1' ? false : buildIfNeeded()

  let port = BASE_PORT
  while (!(await portFree(port))) {
    port += 1
    if (port > BASE_PORT + 20) fail(`${BASE_PORT}～${BASE_PORT + 20} 端口都被占用了。可以设置环境变量 ZHIXING_PORT 换一个端口。`)
  }

  say(`\n[知行] 正在启动（端口 ${port}，${prodReady ? '生产' : '开发'}模式）…`)
  const server = spawn(
    process.execPath,
    prodReady
      ? [NEXT_BIN, 'start', '-H', '127.0.0.1', '-p', String(port)]
      : [NEXT_BIN, 'dev', '-H', '127.0.0.1', '-p', String(port)],
    {
      cwd: root,
      stdio: 'inherit',
      env: { ...quietEnv, NODE_ENV: prodReady ? 'production' : 'development', ZHIXING_LOCAL: '1' },
    },
  )
  let exiting = false
  server.on('exit', (code) => {
    if (!exiting && code !== 0) process.stderr.write(`\n[知行] 服务意外退出（退出码 ${code}）。\n`)
    process.exit(code ?? 0)
  })
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      exiting = true
      server.kill()
    })
  }

  const info = await waitUntilReady(port, 90_000)
  const url = `http://127.0.0.1:${port}/study`
  if (!info) {
    say(`[知行] 服务启动得比较慢，请稍后手动访问 ${url}`)
    return
  }
  banner(url, info)
  openBrowser(url)
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)))
