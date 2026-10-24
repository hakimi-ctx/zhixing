const { spawnSync } = require('node:child_process')

/** Stops a detached child and every process it started. Windows uses taskkill /T; other systems signal the process group. */
function killProcessTree(pid) {
  if (!pid || pid <= 0) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' })
    return
  }
  const signal = (name) => {
    try {
      process.kill(-pid, name)
      return true
    } catch {
      try {
        process.kill(pid, name)
        return true
      } catch {
        return false
      }
    }
  }
  signal('SIGTERM')
  const timer = setTimeout(() => signal('SIGKILL'), 1200)
  timer.unref?.()
}

module.exports = { killProcessTree }
