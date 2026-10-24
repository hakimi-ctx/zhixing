import 'server-only'
import { EXECUTOR_PRESETS } from '@/lib/shared/executors'
import type { ExecutorConfig, ExecutorKind, ExecutorStatus, ExecutorsStatus } from '@/lib/shared/types'
import { loadConfig } from './config'
import { HttpError } from './http'
import { probeVersion, resolveCommand } from './process'
import { openTerminal, psQuote } from './system'

async function executorStatus(executor: ExecutorConfig, proxy: string): Promise<ExecutorStatus> {
  const resolvedPath = executor.command.trim() ? await resolveCommand(executor.command) : null
  const version = resolvedPath ? await probeVersion(resolvedPath, proxy) : null
  return { id: executor.id, command: executor.command, resolvedPath, version }
}

export async function executorsStatus(): Promise<ExecutorsStatus> {
  const config = await loadConfig()
  const executors = await Promise.all(config.executors.map((executor) => executorStatus(executor, config.proxy)))
  return { checkedAt: Date.now(), executors }
}

/** Opens a PowerShell window that installs the executor's CLI with npm. */
export async function openExecutorInstall(kind: ExecutorKind): Promise<void> {
  const preset = EXECUTOR_PRESETS[kind]
  if (!preset) throw new HttpError(404, '找不到这个执行器。')
  await openTerminal(`知行 · 安装 ${preset.name}`, [
    `Write-Host ${psQuote(`正在安装 ${preset.name}：${preset.installCommand}`)} -ForegroundColor Cyan`,
    preset.installCommand,
    `Write-Host ''; Write-Host ${psQuote(`装好后：${preset.setupHint}。然后回到知行点“检测”。`)} -ForegroundColor Green`,
  ])
}
