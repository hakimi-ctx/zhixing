const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const path = require('node:path')
const { killProcessTree } = require('./process-tree.cjs')

const sourceRoot = path.resolve(__dirname, '..')
const packaged = app.isPackaged
let serverPid = null
let serverOwned = false
let quitting = false
let mainWindow = null

app.setAppUserModelId('app.zhixing.desktop')
app.setPath('userData', path.join(app.getPath('appData'), 'ZhixingDesktop'))

function serverRoot() {
  return packaged ? path.join(process.resourcesPath, 'standalone') : sourceRoot
}

function iconPath() {
  const base = packaged ? process.resourcesPath : sourceRoot
  return path.join(base, 'build', 'icon.png')
}

function portFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer()
    probe.once('error', () => resolve(false))
    probe.once('listening', () => probe.close(() => resolve(true)))
    probe.listen(port, '127.0.0.1')
  })
}

async function choosePort() {
  const start = Number(process.env.ZHIXING_PORT) || 3939
  for (let port = start; port < start + 20; port += 1) {
    if (await portFree(port)) return port
  }
  throw new Error(`端口 ${start} 到 ${start + 19} 都被占用了。可以设置环境变量 ZHIXING_PORT。`)
}

function hasProductionBuild(root) {
  return fs.existsSync(path.join(root, '.next', 'BUILD_ID')) || fs.existsSync(path.join(root, 'server.js'))
}

function startServer(port) {
  const root = serverRoot()
  const useElectronNode = packaged
  const bin = useElectronNode ? process.execPath : process.env.ZHIXING_NODE || 'node'
  const env = {
    ...process.env,
    NODE_ENV: packaged || hasProductionBuild(root) ? 'production' : 'development',
    NEXT_TELEMETRY_DISABLED: '1',
    ZHIXING_LOCAL: '1',
    PORT: String(port),
    HOSTNAME: '127.0.0.1',
  }
  if (useElectronNode) env.ELECTRON_RUN_AS_NODE = '1'

  let args
  if (packaged) {
    const entry = path.join(root, 'server.js')
    if (!fs.existsSync(entry)) throw new Error('安装包里缺少 Next 服务。请在 Windows 上重新执行 pnpm build 后再打包。')
    args = [entry]
  } else {
    const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next')
    if (!fs.existsSync(nextBin)) throw new Error('找不到 Next.js。请先在项目目录运行 pnpm install。')
    const mode = hasProductionBuild(root) && process.env.ZHIXING_DESKTOP_DEV !== '1' ? 'start' : 'dev'
    args = [nextBin, mode, '-H', '127.0.0.1', '-p', String(port)]
  }

  const child = spawn(bin, args, {
    cwd: root,
    env,
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
  })
  child.on('error', (error) => {
    dialog.showErrorBox('知行没能启动', error.code === 'ENOENT' ? '找不到 Node.js。请安装 Node.js 20 或更高版本后再打开知行。' : error.message)
  })
  child.on('exit', (code) => {
    if (quitting || serverPid !== child.pid) return
    serverPid = null
    dialog.showErrorBox('知行已退出', `本地服务意外结束（退出码 ${code ?? '未知'}）。`)
    app.quit()
  })
  return child.pid
}

function waitUntilReady(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get({ hostname: '127.0.0.1', port, path: '/api/system', timeout: 2000 }, (response) => {
        response.resume()
        if (response.statusCode === 200) resolve()
        else retry()
      })
      request.on('error', retry)
      request.on('timeout', () => {
        request.destroy()
        retry()
      })
    }
    const retry = () => {
      if (Date.now() > deadline) reject(new Error('知行服务没有在预期时间内就绪。'))
      else setTimeout(attempt, 400)
    }
    attempt()
  })
}

function createWindow(url) {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 730,
    minHeight: 560,
    title: '知行',
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  window.once('ready-to-show', () => window.show())
  const origin = new URL(url).origin
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//i.test(target) && !target.startsWith(origin)) void shell.openExternal(target)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, target) => {
    if (target.startsWith(origin)) return
    event.preventDefault()
    if (/^https?:\/\//i.test(target)) void shell.openExternal(target)
  })
  void window.loadURL(url)
  return window
}

function shutdown() {
  if (quitting) return
  quitting = true
  if (serverOwned && serverPid) killProcessTree(serverPid)
  serverPid = null
}

async function boot() {
  const attached = process.env.ZHIXING_SERVER_URL
  let url = attached
  if (!url) {
    const port = await choosePort()
    serverPid = startServer(port)
    serverOwned = true
    url = `http://127.0.0.1:${port}/study`
    await waitUntilReady(port, 120_000)
  }
  mainWindow = createWindow(url)
  if (process.env.ZHIXING_SMOKE === '1') {
    mainWindow.webContents.once('did-finish-load', async () => {
      const started = Date.now()
      let info = { bridge: false, title: '', text: '' }
      while (Date.now() - started < 15_000) {
        info = await mainWindow.webContents.executeJavaScript(`({
          bridge: Boolean(window.zhixing && window.zhixing.isDesktop && window.zhixing.version),
          title: document.title,
          text: (document.body && document.body.innerText || '').slice(0, 300)
        })`)
        if (info.bridge && info.text.trim().length > 20) break
        await new Promise((resolve) => setTimeout(resolve, 300))
      }
      const image = await mainWindow.capturePage()
      const out = process.env.ZHIXING_SMOKE_PNG || path.join(app.getPath('temp'), 'zhixing-electron.png')
      fs.writeFileSync(out, image.toPNG())
      fs.writeFileSync(`${out}.json`, JSON.stringify({ ...info, url: mainWindow.webContents.getURL() }))
      shutdown()
      app.exit(info.bridge && info.text.trim().length > 20 ? 0 : 2)
    })
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
  app.on('window-all-closed', () => {
    shutdown()
    app.quit()
  })
  app.on('before-quit', shutdown)
  process.on('exit', shutdown)
  app.whenReady().then(boot).catch((error) => {
    dialog.showErrorBox('知行没能启动', error instanceof Error ? error.message : String(error))
    shutdown()
    app.exit(1)
  })
}

ipcMain.handle('zhixing:pick-folder', async (_event, defaultPath) => {
  const parent = BrowserWindow.getFocusedWindow() ?? undefined
  const result = await dialog.showOpenDialog(parent, {
    title: '选择文件库文件夹',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: typeof defaultPath === 'string' && defaultPath ? defaultPath : undefined,
  })
  return result.canceled ? null : (result.filePaths[0] ?? null)
})

ipcMain.handle('zhixing:open-external', async (_event, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return
  await shell.openExternal(url)
})
