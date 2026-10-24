import 'server-only'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { ExecutionPreview, ExecutionRecord, ExecutorConfig, WorkSession } from '@/lib/shared/types'
import { loadConfig } from './config'
import { HttpError, errorMessage } from './http'
import { paths } from './paths'
import { childEnv, cleanOutput, expandTemplate, formatCommandLine, resolveCommand, runProcess, templateUses } from './process'
import { newId } from './store'
import { attachLive, liveEntry, loadSession, releaseIfIdle, touch } from './work-store'

const HANDOFF = 'HANDOFF.md'
const MAX_OUTPUT = 200_000

const INSTRUCTION = `请先阅读当前目录下的 ${HANDOFF}，然后严格按其中的“最终方案”完成任务（如果有“执行清单”，按清单顺序执行并逐项自查）。所有文件都写在当前目录内，不要修改这个目录以外的任何文件。完成后用几句话总结你做了什么、产出了哪些文件。`

function handoffMarkdown(session: WorkSession, note: string): string {
  return [
    `# 任务交接：${session.title}`,
    '',
    '> 这份文件由“知行”的 Work 模式生成。AI 团队（主管 + 成员）已经讨论并定稿了下面的方案，请你作为执行者按方案完成任务。',
    '',
    '## 原始任务',
    '',
    session.task,
    '',
    ...(note ? ['## 用户补充说明', '', note, ''] : []),
    '## 最终方案',
    '',
    session.final.output,
    '',
    '## 执行要求',
    '',
    '- 只在当前工作目录内创建和修改文件。',
    '- 按“执行清单”（如果有）的顺序执行，完成后对照验收标准自查。',
    '- 结束时总结你做了什么、产出了哪些文件、还有什么需要用户手动处理。',
    '',
  ].join('\n')
}

async function prepare(sessionId: string, executorId: string) {
  const session = await loadSession(sessionId)
  if (!session) throw new HttpError(404, '找不到这个任务，可能已经被删除。')
  if (session.final.status !== 'done' || !session.final.output.trim()) {
    throw new HttpError(400, '主管还没有给出最终方案，暂时不能交给执行器。')
  }
  const config = await loadConfig()
  const executor: ExecutorConfig | undefined = config.executors.find((item) => item.id === executorId)
  if (!executor) throw new HttpError(404, '找不到这个执行器。')
  if (!executor.enabled) throw new HttpError(400, `${executor.name} 已在设置里停用。`)
  if (!executor.command.trim()) throw new HttpError(400, `${executor.name} 还没有填写命令。`)

  const args = expandTemplate(executor.args, { prompt: INSTRUCTION })
  if (executor.promptVia === 'arg' && !templateUses(executor.args, 'prompt')) args.push(INSTRUCTION)
  const cwd = sessionWorkspace(session.id)
  const resolvedPath = await resolveCommand(executor.command)
  return { session, config, executor, args, cwd, resolvedPath }
}

export async function previewExecution(sessionId: string, executorId: string): Promise<ExecutionPreview> {
  const { executor, args, cwd, resolvedPath } = await prepare(sessionId, executorId)
  return {
    executorName: executor.name,
    commandLine: formatCommandLine(executor.command, args),
    cwd,
    resolvedPath,
    instruction: INSTRUCTION,
  }
}

export function sessionWorkspace(sessionId: string): string {
  return path.join(paths.workspaces(), sessionId)
}

/**
 * Writes HANDOFF.md without running anything, for executors driven by hand
 * (e.g. pasting the instruction into the WorkBuddy desktop app).
 */
export async function writeHandoff(sessionId: string, note: string): Promise<{ cwd: string; handoffFile: string; instruction: string }> {
  const session = await loadSession(sessionId)
  if (!session) throw new HttpError(404, '找不到这个任务，可能已经被删除。')
  if (session.final.status !== 'done' || !session.final.output.trim()) {
    throw new HttpError(400, '主管还没有给出最终方案。')
  }
  const cwd = sessionWorkspace(session.id)
  const handoffFile = path.join(cwd, HANDOFF)
  try {
    await fs.mkdir(cwd, { recursive: true })
    await fs.writeFile(handoffFile, handoffMarkdown(session, note.trim()), 'utf8')
  } catch (error) {
    throw new HttpError(500, `无法创建工作目录：${errorMessage(error)}`)
  }
  return { cwd, handoffFile, instruction: `${INSTRUCTION}\n工作目录：${cwd}` }
}

function keepTail(text: string): string {
  return text.length > MAX_OUTPUT ? `…（前面的输出已省略）\n${text.slice(-MAX_OUTPUT)}` : text
}

/**
 * Writes HANDOFF.md into the task's workspace folder and runs the executor there.
 * All executions of one task share the folder, so a second executor can continue the first one's work.
 */
export async function startExecution(sessionId: string, executorId: string, note: string): Promise<ExecutionRecord> {
  const prepared = await prepare(sessionId, executorId)
  const { executor, args, cwd, resolvedPath, config } = prepared
  if (!resolvedPath) {
    throw new HttpError(
      400,
      `没有找到 ${executor.name}（命令 ${executor.command}）。请先在设置里安装，或者把命令改成完整路径。`,
    )
  }

  const entry = attachLive(prepared.session)
  if (entry.session.executions.some((item) => item.status === 'running')) {
    await releaseIfIdle(entry)
    throw new HttpError(409, '这个任务已经有一个执行器在运行，请等它结束或先停止。')
  }

  const handoffFile = path.join(cwd, HANDOFF)
  try {
    await fs.mkdir(cwd, { recursive: true })
    await fs.writeFile(handoffFile, handoffMarkdown(entry.session, note.trim()), 'utf8')
  } catch (error) {
    await releaseIfIdle(entry)
    throw new HttpError(500, `无法创建工作目录：${errorMessage(error)}`)
  }

  const record: ExecutionRecord = {
    id: newId(),
    executorId: executor.id,
    executorName: executor.name,
    command: formatCommandLine(executor.command, args),
    cwd,
    handoffFile,
    status: 'running',
    exitCode: null,
    output: '',
    startedAt: Date.now(),
  }
  entry.session.executions.push(record)
  entry.session.log.push({ at: record.startedAt, level: 'info', text: `已把最终方案交给 ${executor.name} 执行。` })
  touch(entry)

  const controller = new AbortController()
  entry.executions.set(record.id, controller)

  void (async () => {
    try {
      const result = await runProcess({
        command: resolvedPath,
        args,
        cwd,
        stdin: executor.promptVia === 'stdin' ? INSTRUCTION : undefined,
        timeoutMs: executor.timeoutMin * 60_000,
        signal: controller.signal,
        env: childEnv({ proxy: config.proxy }),
        maxCaptureChars: MAX_OUTPUT,
        onOutput: (chunk) => {
          record.output = keepTail(record.output + cleanOutput(chunk))
          touch(entry)
        },
      })
      record.exitCode = result.exitCode
      if (!record.output.trim()) record.output = keepTail(cleanOutput([result.stdout, result.stderr].filter(Boolean).join('\n')))
      if (result.aborted) {
        record.status = 'stopped'
        record.error = '已手动停止。'
      } else if (result.spawnError) {
        record.status = 'failed'
        record.error = `启动失败：${result.spawnError}`
      } else if (result.timedOut) {
        record.status = 'failed'
        record.error = `超过 ${executor.timeoutMin} 分钟没有结束，已停止。可以在设置里调大超时时间。`
      } else if (result.exitCode === 0) {
        record.status = 'done'
      } else {
        record.status = 'failed'
        record.error = `${executor.name} 异常退出（退出码 ${result.exitCode ?? '未知'}）。`
      }
    } catch (error) {
      record.status = 'failed'
      record.error = errorMessage(error)
    } finally {
      record.endedAt = Date.now()
      const level = record.status === 'done' ? 'info' : 'warn'
      const summary =
        record.status === 'done' ? `${executor.name} 执行完成。` : `${executor.name} 没有正常完成：${record.error ?? '未知原因'}`
      entry.session.log.push({ at: record.endedAt, level, text: summary })
      entry.executions.delete(record.id)
      touch(entry)
      await releaseIfIdle(entry).catch((error) => console.error('[zhixing] failed to save work session', error))
    }
  })()

  return record
}

export function stopExecution(sessionId: string, executionId: string): boolean {
  const controller = liveEntry(sessionId)?.executions.get(executionId)
  if (!controller) return false
  controller.abort()
  return true
}
