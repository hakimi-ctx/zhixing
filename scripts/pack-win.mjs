// Windows 安装包与免安装版。必须先有 Next standalone 构建。
// 在 Linux 上 electron-builder 也许能产出文件，但这不等于在 Windows 上验证通过。
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isWindows = process.platform === 'win32'

function say(text) {
  process.stdout.write(`${text}\n`)
}

function run(command, args) {
  say(`\n[知行] ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } })
  if (result.status !== 0) {
    process.stderr.write(`\n[知行] 命令失败，退出码 ${result.status ?? '未知'}。\n`)
    process.exit(result.status || 1)
  }
}

if (!isWindows) {
  say('[知行] 当前不是 Windows。下面仍会尝试调用 electron-builder --win。')
  say('[知行] 即使这里生成了文件，也必须在 Windows 上安装或运行后才算通过。详见《Windows 打包与启动说明.md》。')
}

for (const file of ['build/icon.ico', 'build/icon.png']) {
  if (!fs.existsSync(path.join(root, file))) {
    process.stderr.write(`[知行] 缺少 ${file}。\n`)
    process.exit(1)
  }
}

const pnpm = isWindows ? 'pnpm.cmd' : 'pnpm'
run(pnpm, ['build'])
run(pnpm, ['exec', 'electron-builder', '--win', 'nsis', 'portable'])

say('\n[知行] electron-builder 已结束。产物在 release/ 目录。')
if (!isWindows) say('[知行] 这次是在非 Windows 环境执行的，不能当作 Windows 验证通过。')
