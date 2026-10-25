import 'server-only'
import { findSlot, providerLabel, providerStrength } from '@/lib/shared/providers'
import type {
  AiSlot,
  AppConfig,
  ProviderId,
  WorkAttempt,
  WorkLogEntry,
  WorkSession,
  WorkStage,
  WorkSubtask,
} from '@/lib/shared/types'
import { loadConfig, providerReady } from './config'
import { titleFrom } from './conversations'
import { HttpError, errorMessage } from './http'
import { extractJsonObject } from './json-extract'
import { callModel, isAbortError, type ModelRequest } from './llm'
import { newId } from './store'
import { attachLive, liveEntry, loadSession, releaseIfIdle, touch, workSessions, type LiveSession } from './work-store'

/**
 * Work mode is strictly hierarchical so the models never talk in circles:
 * the supervisor plans once, each worker does only its own subtask (seeing the
 * others' results so nothing is redone), the supervisor reviews with a bounded
 * number of revision rounds, then writes the final plan. A per-run call budget
 * is a hard stop on top of that.
 */
interface Run {
  entry: LiveSession
  config: AppConfig
  signal: AbortSignal
  callLimit: number
}

function label(config: AppConfig, id: ProviderId): string {
  return providerLabel(id, config.providers)
}

const SUPERVISOR_SYSTEM = [
  '你是一个 AI 团队的主管，负责拆解用户的任务、分派给下属、验收交付，并汇总成最终方案。团队是上下级关系：',
  '- 只有你负责拆解任务和做决定；下属只完成你分给他的那一块，不会重复思考整个问题。',
  '- 子任务必须边界清楚、互不重叠，并写明交付物，避免重复劳动和来回空转。',
  '- 一步就能完成的事不要拆，子任务宁少勿多。',
  '- 你只返回文字，看不到用户电脑上的文件，也不能运行命令；需要动手落地的部分，最后会交给执行器完成。',
  '- 默认用简体中文。',
].join('\n')

const WORKER_SYSTEM = [
  '你是一个 AI 团队的成员，直属主管给你分配了一个明确的子任务。规则：',
  '- 只完成分配给你的这一块，不要重新规划整个任务，也不要重做其他成员负责的部分。',
  '- 直接交付成果本身（用 Markdown），不要写“好的，我来……”之类的开场白，也不要反问；信息不足时做合理假设，并在末尾用一两句话注明。',
  '- 你只返回文字，看不到用户电脑上的文件，也不能运行命令。',
  '- 默认用简体中文。',
].join('\n')

function clip(text: string, max: number): string {
  const value = text.trim()
  return value.length > max ? `${value.slice(0, max)}\n…（后面还有 ${value.length - max} 字，已省略）` : value
}

function log(entry: LiveSession, level: WorkLogEntry['level'], text: string) {
  const list = entry.session.log
  list.push({ at: Date.now(), level, text })
  if (list.length > 400) list.splice(0, list.length - 400)
  touch(entry)
}

function begin(stage: WorkStage) {
  stage.status = 'running'
  stage.output = ''
  stage.error = undefined
  stage.model = undefined
  stage.startedAt = Date.now()
  stage.endedAt = undefined
}

function finish(stage: WorkStage) {
  stage.status = 'done'
  stage.endedAt = Date.now()
}

function lastAttempt(subtask: WorkSubtask): WorkAttempt | undefined {
  return subtask.attempts[subtask.attempts.length - 1]
}

function latestDelivery(subtask: WorkSubtask): WorkAttempt | undefined {
  for (let index = subtask.attempts.length - 1; index >= 0; index -= 1) {
    if (subtask.attempts[index].status === 'done') return subtask.attempts[index]
  }
  return undefined
}

/** The newest successful output of a subtask. */
export function deliveredOutput(subtask: WorkSubtask): string {
  return latestDelivery(subtask)?.output ?? ''
}

function callBudget(session: WorkSession): number {
  const { maxSubtasks, maxRevisions } = session.rules
  // plan (+1 format retry) + every subtask per round (+1 takeover each) + reviews + final
  return 2 + maxSubtasks * (maxRevisions + 1) * 2 + maxRevisions + 1
}

function interruptRunning(session: WorkSession, message: string) {
  const now = Date.now()
  for (const stage of [session.plan, session.review, session.final]) {
    if (stage.status === 'running') {
      stage.status = 'failed'
      stage.error = message
      stage.endedAt = now
    }
  }
  for (const subtask of session.subtasks) {
    for (const attempt of subtask.attempts) {
      if (attempt.status === 'running') {
        attempt.status = 'failed'
        attempt.error = message
        attempt.endedAt = now
      }
    }
  }
}

async function ask(
  run: Run,
  provider: ProviderId,
  request: ModelRequest,
  onText?: (text: string) => void,
): Promise<{ text: string; model: string }> {
  const { session } = run.entry
  if (session.calls >= run.callLimit) {
    throw new Error('已达到这次运行的模型调用上限。为防止 AI 之间空转，任务已停止。')
  }
  session.calls += 1
  touch(run.entry)
  let streamed = ''
  const result = await callModel({
    provider,
    request,
    config: run.config,
    signal: run.signal,
    onDelta: onText
      ? (delta) => {
          streamed += delta
          onText(streamed)
          touch(run.entry)
        }
      : undefined,
    onReset: onText
      ? () => {
          streamed = ''
          onText('')
          touch(run.entry)
        }
      : undefined,
    onStatus: (status) => log(run.entry, 'info', `${label(run.config, provider)}：${status}`),
  })
  const text = result.text.trim()
  if (!text) throw new Error(`${label(run.config, provider)} 返回了空内容。`)
  return { text, model: result.model }
}

function teamLines(session: WorkSession, config: AppConfig): string {
  return [session.supervisor, ...session.workers]
    .map((id) => {
      const slot = findSlot(config.providers, id)
      const strengths = slot ? providerStrength(slot) : '自定义模型'
      const name = label(config, id)
      return `- ${id}（${name}）：擅长${strengths}${id === session.supervisor ? '（这是你自己，主管）' : ''}`
    })
    .join('\n')
}

function assignable(session: WorkSession): ProviderId[] {
  return session.workers.length ? session.workers : [session.supervisor]
}

const ALIASES: Record<string, string> = {
  chatgpt: 'chatgpt',
  gpt: 'chatgpt',
  openai: 'chatgpt',
  codex: 'chatgpt',
  claude: 'claude',
  anthropic: 'claude',
  gemini: 'gemini',
  google: 'gemini',
}

function normalizeAssignee(raw: string, allowed: ProviderId[], providers: AiSlot[], index: number): ProviderId {
  const trimmed = raw.trim()
  if (allowed.includes(trimmed)) return trimmed
  const lower = trimmed.toLowerCase()
  const byId = allowed.find((id) => id.toLowerCase() === lower)
  if (byId) return byId
  const byLabel = allowed.find((id) => findSlot(providers, id)?.label.toLowerCase() === lower)
  if (byLabel) return byLabel
  const key = lower.replace(/[^a-z0-9]/g, '')
  for (const [alias, id] of Object.entries(ALIASES)) {
    if (key.includes(alias) && allowed.includes(id)) return id
  }
  if (key.length >= 3) {
    const byContains = allowed.find((id) => {
      const slot = findSlot(providers, id)
      const labelKey = (slot?.label ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
      return (labelKey.length >= 3 && (key.includes(labelKey) || labelKey.includes(key))) || key.includes(id.toLowerCase())
    })
    if (byContains) return byContains
  }
  return allowed[index % allowed.length]
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parsePlan(raw: string, session: WorkSession, providers: AiSlot[]): { analysis: string; subtasks: WorkSubtask[] } | null {
  let data: unknown
  try {
    data = extractJsonObject(raw)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object') return null
  const record = data as Record<string, unknown>
  if (!Array.isArray(record.subtasks)) return null
  const allowed = assignable(session)
  const titles = new Set<string>()
  const subtasks: WorkSubtask[] = []
  for (const item of record.subtasks) {
    if (subtasks.length >= session.rules.maxSubtasks) break
    if (!item || typeof item !== 'object') continue
    const fields = item as Record<string, unknown>
    const title = text(fields.title).slice(0, 60)
    const instructions = text(fields.instructions)
    if (!title || !instructions || titles.has(title)) continue
    titles.add(title)
    subtasks.push({
      id: `t${subtasks.length + 1}`,
      title,
      assignee: normalizeAssignee(text(fields.assignee), allowed, providers, subtasks.length),
      instructions: instructions.slice(0, 6000),
      deliverable: text(fields.deliverable).slice(0, 2000) || '按要求完成的成果',
      attempts: [],
    })
  }
  return { analysis: text(record.analysis) || '（主管没有写分析）', subtasks }
}

function planPrompt(session: WorkSession, config: AppConfig): string {
  const ids = assignable(session).join(' / ')
  const example = assignable(session)[0] ?? session.supervisor
  return [
    `## 用户的任务\n${session.task}`,
    `## 你的团队\n${teamLines(session, config)}`,
    [
      '## 你要做的',
      '1. 用 2～5 句话分析任务：目标是什么、关键难点在哪、最终要交付什么。',
      `2. 把任务拆成最多 ${session.rules.maxSubtasks} 个子任务，分给最合适的成员（assignee 只能填：${ids}）。每个子任务写清楚要做什么（instructions）和交付什么（deliverable）。`,
      '3. 如果任务很简单、不需要分工，subtasks 填空数组，你会在最后一步直接给出方案。',
      '',
      '只输出一个 JSON 对象，不要输出任何其他文字：',
      `{"analysis":"……","subtasks":[{"title":"不超过 20 个字的标题","assignee":"${example}","instructions":"……","deliverable":"……"}]}`,
    ].join('\n'),
  ].join('\n\n')
}

async function planPhase(run: Run) {
  const { entry } = run
  const session = entry.session
  session.phase = 'planning'
  session.subtasks = []
  session.review = { status: 'pending', output: '' }
  session.final = { status: 'pending', output: '' }
  const stage = session.plan
  begin(stage)
  stage.analysis = ''
  touch(entry)

  const request: ModelRequest = { system: SUPERVISOR_SYSTEM, messages: [{ role: 'user', content: planPrompt(session, run.config) }] }
  let parsed: ReturnType<typeof parsePlan> = null
  let previous = ''
  for (let round = 0; round < 2 && !parsed; round += 1) {
    const current: ModelRequest =
      round === 0
        ? request
        : {
            ...request,
            messages: [
              ...request.messages,
              { role: 'assistant', content: clip(previous, 4000) },
              { role: 'user', content: '你上面的回复不是要求的 JSON 格式。请只输出那个 JSON 对象，不要输出任何其他文字。' },
            ],
          }
    const reply = await ask(run, session.supervisor, current)
    stage.model = reply.model
    stage.output = reply.text
    previous = reply.text
    parsed = parsePlan(reply.text, session, run.config.providers)
    if (!parsed) log(entry, 'warn', round === 0 ? '主管返回的拆解格式不对，请它重新输出一次。' : '主管第二次返回的格式仍然不对。')
  }
  if (!parsed) throw new Error('主管没能给出有效的任务拆解。可以点“继续”重试，或到设置里换一个主管模型。')

  stage.analysis = parsed.analysis
  session.subtasks = parsed.subtasks
  finish(stage)
  log(
    entry,
    'info',
    parsed.subtasks.length
      ? `主管把任务拆成 ${parsed.subtasks.length} 个子任务：${parsed.subtasks.map((item) => `${item.title}（${label(run.config, item.assignee)}）`).join('；')}。`
      : '主管判断这个任务不需要分工，将直接给出方案。',
  )
}

function workerRequest(session: WorkSession, subtask: WorkSubtask, feedback: string | undefined, config: AppConfig): ModelRequest {
  const outline = session.subtasks
    .map((item, index) => `${index + 1}. ${item.title}（${label(config, item.assignee)}）${item.id === subtask.id ? '  ← 你负责这一项' : ''}`)
    .join('\n')
  const parts = [
    `## 团队的总任务\n${session.task}`,
    `## 主管的分析\n${session.plan.analysis}`,
    `## 团队分工\n${outline}`,
    `## 分配给你的子任务：${subtask.title}\n${subtask.instructions}`,
    `## 交付物要求\n${subtask.deliverable}`,
  ]
  const previous = deliveredOutput(subtask)
  if (feedback) {
    parts.push(`## 主管的返工意见\n${feedback}`)
    if (previous) parts.push(`## 你上一版的交付\n请针对返工意见修改，没被指出问题的部分保持不变，输出修改后的完整交付。\n\n${clip(previous, 12_000)}`)
  }
  const others = session.subtasks
    .filter((item) => item.id !== subtask.id)
    .map((item) => ({ item, output: deliveredOutput(item) }))
    .filter(({ output }) => output)
    .map(({ item, output }) => `### ${item.title}（${label(config, item.assignee)} 负责）\n${clip(output, 5000)}`)
  return {
    system: WORKER_SYSTEM,
    reference: others.length ? `其他成员已经完成的部分（只用来对齐口径、避免重复，不要重做）：\n\n${others.join('\n\n')}` : undefined,
    messages: [{ role: 'user', content: parts.join('\n\n') }],
  }
}

async function attemptOnce(
  run: Run,
  subtask: WorkSubtask,
  by: ProviderId,
  request: ModelRequest,
  feedback: string | undefined,
  note?: string,
): Promise<boolean> {
  const record: WorkAttempt = { by, feedback, note, output: '', status: 'running', startedAt: Date.now() }
  subtask.attempts.push(record)
  touch(run.entry)
  try {
    const reply = await ask(run, by, request, (value) => {
      record.output = value
    })
    record.output = reply.text
    record.model = reply.model
    record.status = 'done'
    record.endedAt = Date.now()
    touch(run.entry)
    return true
  } catch (error) {
    if (run.signal.aborted || isAbortError(error)) throw error
    record.status = 'failed'
    record.error = errorMessage(error)
    record.endedAt = Date.now()
    log(run.entry, 'warn', `${label(run.config, by)} 没能完成“${subtask.title}”：${record.error}`)
    return false
  }
}

/**
 * One delivery of a subtask. A revision goes to whoever produced the current version, so a member
 * whose calls already failed is not tried again; if the call fails, the supervisor takes over once.
 */
async function deliver(run: Run, subtask: WorkSubtask, feedback?: string) {
  const session = run.entry.session
  const request = workerRequest(session, subtask, feedback, run.config)
  const takeoverNote = `${label(run.config, subtask.assignee)} 调用失败，由主管接手`
  const owner = latestDelivery(subtask)?.by ?? subtask.assignee
  const ownerNote = owner === subtask.assignee ? undefined : takeoverNote
  if (await attemptOnce(run, subtask, owner, request, feedback, ownerNote)) return
  if (owner !== session.supervisor) {
    log(run.entry, 'warn', `改由主管 ${label(run.config, session.supervisor)} 接手“${subtask.title}”。`)
    if (await attemptOnce(run, subtask, session.supervisor, request, feedback, takeoverNote)) return
  }
  throw new Error(`子任务“${subtask.title}”没有完成：${lastAttempt(subtask)?.error ?? '未知错误'}`)
}

async function executePhase(run: Run) {
  const session = run.entry.session
  for (const subtask of session.subtasks) {
    const last = lastAttempt(subtask)
    if (last?.status === 'done') continue
    session.phase = last?.feedback ? 'revising' : 'executing'
    touch(run.entry)
    await deliver(run, subtask, last?.status === 'failed' ? last.feedback : undefined)
  }
}

function reviewRequest(session: WorkSession, remaining: number, config: AppConfig): ModelRequest {
  const delivered = session.subtasks
    .map(
      (item) =>
        `### 子任务 ${item.id}：${item.title}（${label(config, item.assignee)} 负责）\n交付要求：${item.deliverable}\n\n${clip(deliveredOutput(item), 8000) || '（没有交付）'}`,
    )
    .join('\n\n')
  return {
    system: SUPERVISOR_SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          `## 用户的任务\n${session.task}`,
          `## 你当初的分析\n${session.plan.analysis}`,
          `## 下属的交付\n${delivered}`,
          [
            '## 你要做的',
            '逐个检查交付是否满足要求、有没有错误或重大遗漏。',
            `只有确实会影响最终方案的问题才要求返工；小问题你会在最后汇总时自己修正，不要为此返工。这次最多还能返工 ${remaining} 轮。返工意见要具体、可执行。`,
            '',
            '只输出一个 JSON 对象，不要输出任何其他文字：',
            '{"decision":"approve"}',
            '或',
            '{"decision":"revise","requests":[{"id":"子任务 id，例如 t1","feedback":"具体要改什么"}]}',
          ].join('\n'),
        ].join('\n\n'),
      },
    ],
  }
}

/** Returns [] for approval, the revision requests, or null when the reply cannot be parsed. */
function parseReview(raw: string, session: WorkSession): { id: string; feedback: string }[] | null {
  let data: unknown
  try {
    data = extractJsonObject(raw)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object') return null
  const record = data as Record<string, unknown>
  const decision = text(record.decision).toLowerCase()
  if (decision === 'approve') return []
  if (decision !== 'revise') return null
  const seen = new Set<string>()
  const requests: { id: string; feedback: string }[] = []
  for (const item of Array.isArray(record.requests) ? record.requests : []) {
    if (!item || typeof item !== 'object') continue
    const fields = item as Record<string, unknown>
    const id = text(fields.id)
    const feedback = text(fields.feedback)
    if (!feedback || seen.has(id) || !session.subtasks.some((subtask) => subtask.id === id)) continue
    seen.add(id)
    requests.push({ id, feedback: feedback.slice(0, 3000) })
  }
  return requests
}

async function reviewPhase(run: Run) {
  const { entry } = run
  const session = entry.session
  const review = session.review
  if (review.status === 'done' || review.status === 'skipped') return
  const max = session.rules.maxRevisions
  if (max <= 0) {
    review.status = 'skipped'
    review.decision = 'skipped'
    log(entry, 'info', '返工轮数设为 0，跳过验收，直接汇总。')
    return
  }
  for (;;) {
    const round = review.rounds ?? 0
    if (round >= max) {
      review.status = 'done'
      review.endedAt = Date.now()
      log(entry, 'info', '返工轮数已用完，不再重复验收，由主管在汇总时做最后修正。')
      return
    }
    session.phase = 'reviewing'
    begin(review)
    review.decision = undefined
    review.requested = undefined
    touch(entry)
    const reply = await ask(run, session.supervisor, reviewRequest(session, max - round, run.config))
    review.model = reply.model
    review.output = reply.text
    const requests = parseReview(reply.text, session)
    if (!requests?.length) {
      review.decision = 'approve'
      finish(review)
      log(entry, requests ? 'info' : 'warn', requests ? '主管验收通过了全部交付。' : '主管的验收结果格式不对，按“通过”处理。')
      return
    }
    review.decision = 'revise'
    review.requested = requests
    review.rounds = round + 1
    session.phase = 'revising'
    log(
      entry,
      'info',
      `主管要求返工 ${requests.length} 项（第 ${round + 1}/${max} 轮）：${requests
        .map((request) => session.subtasks.find((subtask) => subtask.id === request.id)?.title ?? request.id)
        .join('、')}。`,
    )
    for (const request of requests) {
      const subtask = session.subtasks.find((item) => item.id === request.id)
      if (subtask) await deliver(run, subtask, request.feedback)
    }
  }
}

function finalRequest(session: WorkSession, config: AppConfig): ModelRequest {
  const delivered = session.subtasks.map(
    (item, index) => `### ${index + 1}. ${item.title}（${label(config, item.assignee)} 完成）\n${clip(deliveredOutput(item), 9000) || '（没有交付）'}`,
  )
  const parts = [`## 用户的任务\n${session.task}`, `## 你当初的分析\n${session.plan.analysis}`]
  if (delivered.length) parts.push(`## 团队的交付\n${delivered.join('\n\n')}`)
  parts.push(
    [
      '## 你要做的',
      delivered.length
        ? '把团队的交付整合成一份完整、可以直接使用的最终方案。'
        : '这个任务不需要分工，请直接给出一份完整、可以直接使用的最终方案。',
      '- 开头先用一小段话说明结论；',
      '- 修正交付里的错误和前后矛盾，合并重复内容；正文里不要出现“子任务”“下属”这类团队内部的说法；',
      '- 如果任务需要动手落地（写代码、建文件、写文档、做表格等），在最后加一节“## 执行清单”，按顺序列出执行者要做的步骤和每一步的验收标准，执行者会直接照着这一节去做；',
      '- 直接输出方案正文（Markdown），不要输出 JSON，也不要写开场白。',
    ].join('\n'),
  )
  return { system: SUPERVISOR_SYSTEM, messages: [{ role: 'user', content: parts.join('\n\n') }] }
}

async function finalPhase(run: Run) {
  const { entry } = run
  const session = entry.session
  session.phase = 'finalizing'
  const stage = session.final
  begin(stage)
  touch(entry)
  const reply = await ask(run, session.supervisor, finalRequest(session, run.config), (value) => {
    stage.output = value
  })
  stage.output = reply.text
  stage.model = reply.model
  finish(stage)
}

async function orchestrate(run: Run) {
  const { entry } = run
  const session = entry.session
  try {
    if (session.plan.status !== 'done') await planPhase(run)
    if (session.subtasks.length) {
      await executePhase(run)
      await reviewPhase(run)
    }
    if (session.final.status !== 'done') await finalPhase(run)
    session.phase = 'done'
    session.status = 'done'
    log(entry, 'info', '任务完成。可以把最终方案交给执行器去落地。')
  } catch (error) {
    const stopped = run.signal.aborted || isAbortError(error)
    const message = stopped ? '已停止' : errorMessage(error)
    interruptRunning(session, message)
    session.status = stopped ? 'stopped' : 'failed'
    session.error = stopped ? undefined : message
    log(entry, stopped ? 'warn' : 'error', stopped ? '任务已手动停止。' : message)
  }
}

function launch(session: WorkSession, config: AppConfig, note: string) {
  const entry = attachLive(session)
  if (entry.orchestration) throw new HttpError(409, '这个任务已经在运行了。')
  const controller = new AbortController()
  entry.orchestration = controller
  entry.session.status = 'running'
  entry.session.error = undefined
  log(entry, 'info', note)
  const run: Run = { entry, config, signal: controller.signal, callLimit: entry.session.calls + callBudget(entry.session) }
  void orchestrate(run).finally(async () => {
    entry.orchestration = null
    await releaseIfIdle(entry).catch((error) => console.error('[zhixing] failed to save work session', error))
  })
}

export async function createWorkSession(task: string): Promise<WorkSession> {
  const config = await loadConfig()
  const enabled = config.providers.filter((slot) => providerReady(config, slot.id)).map((slot) => slot.id)
  if (!enabled.length) throw new HttpError(400, '还没有可用的模型。请先到设置里添加槽位：API 要填中转站和模型名，CLI 要填命令。')
  const supervisor = enabled.includes(config.work.supervisor) ? config.work.supervisor : enabled[0]
  const workers = enabled.filter((id) => id !== supervisor)
  const now = Date.now()
  const session: WorkSession = {
    id: newId(),
    title: titleFrom(task),
    task,
    createdAt: now,
    updatedAt: now,
    status: 'running',
    phase: 'planning',
    supervisor,
    workers,
    rules: { maxSubtasks: config.work.maxSubtasks, maxRevisions: config.work.maxRevisions },
    plan: { status: 'pending', output: '', analysis: '' },
    subtasks: [],
    review: { status: 'pending', output: '' },
    final: { status: 'pending', output: '' },
    calls: 0,
    log: [],
    executions: [],
  }
  await workSessions.save(session)
  const swapped =
    supervisor !== config.work.supervisor
      ? `（设置里的主管 ${label(config, config.work.supervisor)} 还不可用，临时由 ${label(config, supervisor)} 担任）`
      : ''
  launch(
    session,
    config,
    `任务开始。主管：${label(config, supervisor)}${swapped}；成员：${workers.map((id) => label(config, id)).join('、') || '无，由主管独自完成'}。`,
  )
  return session
}

export async function resumeWorkSession(id: string): Promise<void> {
  const session = await loadSession(id)
  if (!session) throw new HttpError(404, '找不到这个任务，可能已经被删除。')
  if (liveEntry(id)?.orchestration) throw new HttpError(409, '这个任务已经在运行了。')
  if (session.status === 'done') throw new HttpError(400, '这个任务已经完成了。')
  const config = await loadConfig()
  launch(session, config, '从中断的地方继续运行。')
}

export function stopWorkSession(id: string): boolean {
  const controller = liveEntry(id)?.orchestration
  if (!controller) return false
  controller.abort()
  return true
}
