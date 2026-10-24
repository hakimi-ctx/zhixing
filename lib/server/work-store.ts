import 'server-only'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { WorkSession, WorkSessionSummary } from '@/lib/shared/types'
import { JsonCollection } from './collection'
import { HttpError } from './http'
import { paths } from './paths'
import { singleton } from './singleton'

export const workSessions = new JsonCollection<WorkSession, WorkSessionSummary>(
  () => paths.workSessions(),
  (session) => ({
    id: session.id,
    title: session.title,
    status: session.status,
    phase: session.phase,
    updatedAt: session.updatedAt,
  }),
)

/**
 * A session that has work in flight (orchestration and/or executor runs). The
 * in-memory object is the source of truth while live; it is flushed to disk on
 * a short timer so polling clients and crash recovery both see recent progress.
 */
export interface LiveSession {
  session: WorkSession
  orchestration: AbortController | null
  executions: Map<string, AbortController>
  dirty: boolean
  timer: NodeJS.Timeout | null
}

const live = singleton('work-live-sessions', () => new Map<string, LiveSession>())

export function liveEntry(id: string): LiveSession | undefined {
  return live.get(id)
}

export function attachLive(session: WorkSession): LiveSession {
  const existing = live.get(session.id)
  if (existing) return existing
  const entry: LiveSession = { session, orchestration: null, executions: new Map(), dirty: false, timer: null }
  live.set(session.id, entry)
  return entry
}

async function persist(entry: LiveSession): Promise<void> {
  if (!entry.dirty) return
  entry.dirty = false
  try {
    await workSessions.save(structuredClone(entry.session))
  } catch (error) {
    entry.dirty = true
    console.error('[zhixing] failed to save work session', entry.session.id, error)
  }
}

/** Marks the live session as changed and schedules a disk write. */
export function touch(entry: LiveSession): void {
  entry.session.updatedAt = Date.now()
  entry.dirty = true
  if (entry.timer) return
  entry.timer = setTimeout(() => {
    entry.timer = null
    void persist(entry)
  }, 800)
}

export async function flushNow(entry: LiveSession): Promise<void> {
  if (entry.timer) {
    clearTimeout(entry.timer)
    entry.timer = null
  }
  entry.dirty = true
  await persist(entry)
}

/** Writes the final state and drops the session from memory once nothing is running. */
export async function releaseIfIdle(entry: LiveSession): Promise<void> {
  if (entry.orchestration || entry.executions.size) return
  await flushNow(entry)
  if (!entry.orchestration && !entry.executions.size && live.get(entry.session.id) === entry) {
    live.delete(entry.session.id)
  }
}

const INTERRUPTED = '已中断'

function needsRecovery(session: WorkSession): boolean {
  return session.status === 'running' || session.executions.some((execution) => execution.status === 'running')
}

/** A record left "running" on disk without a live run means the app was closed or restarted mid-way. */
function recover(session: WorkSession): void {
  const now = Date.now()
  if (session.status === 'running') {
    session.status = 'failed'
    session.error = '任务在运行时被中断了（知行被关闭或重启）。点“继续运行”可以从中断的地方接着做。'
    for (const stage of [session.plan, session.review, session.final]) {
      if (stage.status === 'running') {
        stage.status = 'failed'
        stage.error = INTERRUPTED
        stage.endedAt = now
      }
    }
    for (const subtask of session.subtasks) {
      for (const attempt of subtask.attempts) {
        if (attempt.status === 'running') {
          attempt.status = 'failed'
          attempt.error = INTERRUPTED
          attempt.endedAt = now
        }
      }
    }
    session.log.push({ at: now, level: 'warn', text: '任务被中断。' })
  }
  for (const execution of session.executions) {
    if (execution.status === 'running') {
      execution.status = 'failed'
      execution.error = '执行在运行时被中断了（知行被关闭或重启）。'
      execution.endedAt = now
    }
  }
  session.updatedAt = now
}

export async function loadSession(id: string): Promise<WorkSession | null> {
  const entry = live.get(id)
  if (entry) return entry.session
  const stored = await workSessions.get(id)
  if (!stored || !needsRecovery(stored)) return stored
  const updated = await workSessions.update(id, (session) => {
    if (!live.has(id)) recover(session)
  })
  return live.get(id)?.session ?? updated ?? stored
}

export async function listSessions(): Promise<WorkSessionSummary[]> {
  const summaries = await workSessions.list()
  const merged = summaries.map((summary) => {
    const entry = live.get(summary.id)
    if (entry) {
      const { session } = entry
      return { id: session.id, title: session.title, status: session.status, phase: session.phase, updatedAt: session.updatedAt }
    }
    return summary.status === 'running' ? { ...summary, status: 'failed' as const } : summary
  })
  for (const entry of live.values()) {
    if (!merged.some((summary) => summary.id === entry.session.id)) {
      const { session } = entry
      merged.push({ id: session.id, title: session.title, status: session.status, phase: session.phase, updatedAt: session.updatedAt })
    }
  }
  return merged.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function deleteSession(id: string): Promise<void> {
  if (live.has(id)) throw new HttpError(409, '这个任务还在运行，请先停止再删除。')
  await workSessions.remove(id)
}

/** The working folder of one execution, for "open in Explorer". */
export async function resolveWorkspaceDir(sessionId: string, executionId: string): Promise<string> {
  const session = await loadSession(sessionId)
  const execution = session?.executions.find((item) => item.id === executionId)
  if (!execution) throw new HttpError(404, '找不到这次执行记录。')
  const dir = path.resolve(execution.cwd)
  const stat = await fs.stat(dir).catch(() => null)
  if (!stat?.isDirectory()) throw new HttpError(404, '这次执行的工作目录已经不存在了。')
  return dir
}
