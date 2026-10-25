import 'server-only'
import os from 'node:os'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { streamText, type ModelMessage as SdkMessage } from 'ai'
import type { AiSlot, AppConfig, ConnectionTestResult, ProviderId } from '@/lib/shared/types'
import { findSlot, loadConfig, resolveKey, routeFor, type ModelRoute } from './config'
import { childEnv, cleanOutput, expandTemplate, resolveCommand, runProcess, tailLines, templateUses } from './process'

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface ModelRequest {
  /** Core instructions; never trimmed. */
  system: string
  /** Lower-priority material (skill guides, attached notes, library passages); trimmed first when the budget is tight. */
  reference?: string
  /** Oldest first. The last item is the user turn being answered. */
  messages: ChatTurn[]
}

export interface CallOptions {
  provider: ProviderId
  request: ModelRequest
  config?: AppConfig
  signal?: AbortSignal
  timeoutMs?: number
  onDelta?: (text: string) => void
  /** Called when the relay fails after streaming partial text, before the error is thrown. */
  onReset?: () => void
  onStatus?: (text: string) => void
}

export interface CallResult {
  text: string
  model: string
}

export class ModelCallError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelCallError'
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function abortError(): Error {
  const error = new Error('已停止')
  error.name = 'AbortError'
  return error
}

const OVERHEAD = 600
/** Characters, not tokens; generous because relay models have long context windows. */
const REQUEST_BUDGET = 220_000

function clip(text: string, max: number, note: string): string {
  if (text.length <= max) return text
  if (max <= note.length + 20) return ''
  return `${text.slice(0, max - note.length - 1)}\n${note}`
}

/** Shrinks a request to fit a character budget: long history first, then old turns, then reference material, then the question itself. */
export function fitRequest(request: ModelRequest, budget: number): ModelRequest {
  const system = request.system
  const last = request.messages[request.messages.length - 1] ?? { role: 'user', content: '' }
  let history = request.messages.slice(0, -1).map((turn) =>
    turn.content.length > 6000 ? { ...turn, content: clip(turn.content, 6000, '…（这条较早的消息过长，已省略后半部分）') } : turn,
  )
  let reference = request.reference ?? ''
  const historySize = () => history.reduce((sum, turn) => sum + turn.content.length + 16, 0)
  const referenceQuota = Math.min(reference.length, Math.floor(budget * 0.6))
  while (history.length && system.length + referenceQuota + historySize() + last.content.length + OVERHEAD > budget) {
    history = history.slice(history[0]?.role === 'user' && history[1]?.role === 'assistant' ? 2 : 1)
  }
  const referenceRoom = budget - (system.length + historySize() + last.content.length + OVERHEAD)
  reference = clip(reference, Math.max(0, referenceRoom), '…（参考资料较长，已截断）')
  const lastRoom = budget - (system.length + historySize() + reference.length + OVERHEAD)
  const lastContent =
    last.content.length > lastRoom ? clip(last.content, Math.max(200, lastRoom), '…（内容过长，后面的部分没有发送）') : last.content
  return { system, reference, messages: [...history, { ...last, content: lastContent }] }
}

export class RelaySetupError extends Error {}

/** Accepts what people paste from a relay's dashboard: with or without /v1, with or without /chat/completions. */
export function normalizeBaseUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new RelaySetupError('接口地址不是有效的网址，应类似 https://api.example.com/v1')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new RelaySetupError('接口地址必须以 http:// 或 https:// 开头')
  let pathname = url.pathname
    .replace(/\/+$/, '')
    .replace(/\/(chat\/completions|completions|responses|models)$/i, '')
    .replace(/\/+$/, '')
  if (!pathname) pathname = '/v1'
  return `${url.origin}${pathname}`
}

const proxyAgents = new Map<string, unknown>()

async function fetchFor(proxy: string): Promise<typeof fetch | undefined> {
  if (!proxy) return undefined
  const undici = await import('undici')
  let agent = proxyAgents.get(proxy) as InstanceType<typeof undici.ProxyAgent> | undefined
  if (!agent) {
    agent = new undici.ProxyAgent(proxy)
    proxyAgents.set(proxy, agent)
  }
  const dispatcher = agent
  return ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    undici.fetch(input as never, { ...(init as object), dispatcher } as never)) as unknown as typeof fetch
}

function describeError(error: unknown, model: string): string {
  // The SDK wraps repeated failures in a RetryError; the last underlying error carries the status code.
  const retried = (error as { lastError?: unknown } | null)?.lastError
  if (retried) return describeError(retried, model)
  const value = error as {
    name?: string
    statusCode?: number
    responseBody?: string
    message?: string
    cause?: { code?: string; message?: string }
  }
  if (value?.name === 'TimeoutError') return '等待模型响应超时。'
  const status = value?.statusCode
  const body = typeof value?.responseBody === 'string' && value.responseBody ? value.responseBody : (value?.message ?? '')
  const detail = body ? `\n${body.slice(0, 300)}` : ''
  if (/model_not_found|无可用渠道|does not exist|not.?found.*model|model.*not.?found|unknown model|invalid model/i.test(body)) {
    return `中转站没有找到模型“${model}”。请在设置里点“获取模型”，从列表里选一个。${detail}`
  }
  if (status === 401 || status === 403) return `API Key 无效或没有权限（${status}）。${detail}`
  if (status === 402) return `中转站账户余额不足（402）。${detail}`
  if (status === 404) return `接口地址不对（404）。一般以 /v1 结尾。${detail}`
  if (status === 429) return `请求太频繁或额度用完了（429）。${detail}`
  if (status && status >= 500) return `中转站暂时出错（${status}），稍后再试。${detail}`
  if (status) return `调用失败（${status}）。${detail}`
  const code = value?.cause?.code ?? ''
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|EAI_AGAIN|UND_ERR|CERT|SSL/i.test(code) || /fetch failed/i.test(value?.message ?? '')) {
    return `连不上中转站${code ? `（${code}）` : ''}。请检查接口地址和网络。`
  }
  return value?.message || '调用模型失败'
}

function routeError(slot: AiSlot, route: ModelRoute): string | null {
  if (!route.baseUrl || !route.apiKey) return '还没有接入中转站。请到设置里填写接口地址和 API Key，或给这个槽位单独填写。'
  if (!route.model) return `还没有给 ${slot.label} 选模型。请到设置里填写模型名。`
  return null
}

/** Short prompts may go in `{prompt}`; longer ones are written to stdin so the command line stays within OS limits. */
const PROMPT_ARG_LIMIT = 8_000

function renderCliPrompt(request: ModelRequest): string {
  const fitted = fitRequest(request, REQUEST_BUDGET)
  const blocks = [fitted.system]
  if (fitted.reference?.trim()) blocks.push(`<参考资料>\n${fitted.reference.trim()}\n</参考资料>`)
  for (const turn of fitted.messages) {
    blocks.push(`${turn.role === 'user' ? '用户' : '助手'}：\n${turn.content}`)
  }
  return blocks.join('\n\n')
}

async function callCli(slot: AiSlot, options: CallOptions, config: AppConfig): Promise<CallResult> {
  const command = slot.command.trim()
  if (!command) throw new ModelCallError(`${slot.label}：还没有填写 CLI 命令。`)
  const resolved = await resolveCommand(command)
  if (!resolved) throw new ModelCallError(`${slot.label}：找不到命令“${command}”。请确认已安装，或在设置里填写完整路径。`)
  if (options.signal?.aborted) throw abortError()

  const prompt = renderCliPrompt(options.request)
  const wantsArg = templateUses(slot.args, 'prompt')
  const promptInArg = wantsArg && prompt.length <= PROMPT_ARG_LIMIT
  const args = expandTemplate(slot.args, {
    prompt: promptInArg ? prompt : wantsArg ? '完整提示在标准输入。' : '',
    model: slot.model,
  })
  const shownModel = slot.model || command
  const timeoutMs = options.timeoutMs ?? config.work.callTimeoutSec * 1000
  options.onStatus?.(`正在调用 ${slot.label}（${shownModel}）…`)

  let streamed = ''
  const result = await runProcess({
    command: resolved,
    args,
    cwd: os.homedir(),
    stdin: promptInArg ? undefined : prompt,
    timeoutMs,
    signal: options.signal,
    env: childEnv({ proxy: config.proxy }),
    onOutput: (chunk, stream) => {
      if (stream !== 'stdout' || !chunk) return
      const text = cleanOutput(chunk)
      if (!text) return
      streamed += text
      options.onDelta?.(text)
    },
  })
  if (options.signal?.aborted || result.aborted) throw abortError()
  const fail = (message: string): never => {
    if (streamed) options.onReset?.()
    throw new ModelCallError(`${slot.label}：${message}`)
  }
  if (result.spawnError) fail(result.spawnError)
  if (result.timedOut) fail('等待命令响应超时。')
  const text = result.stdout.trim()
  if (result.exitCode !== 0) {
    const detail = tailLines(result.stderr || result.stdout)
    fail(`命令退出码 ${result.exitCode ?? '未知'}${detail ? `\n${detail}` : ''}`)
  }
  if (!text) {
    const detail = tailLines(result.stderr)
    fail(`命令没有返回内容。请确认它把回复写到标准输出。${detail ? `\n${detail}` : ''}`)
  }
  return { text, model: shownModel }
}

async function callApi(slot: AiSlot, options: CallOptions, config: AppConfig): Promise<CallResult> {
  const route = routeFor(config, slot.id)
  const problem = routeError(slot, route)
  if (problem) throw new ModelCallError(problem)
  if (options.signal?.aborted) throw abortError()

  let baseURL: string
  try {
    baseURL = normalizeBaseUrl(route.baseUrl)
  } catch (error) {
    throw new ModelCallError(error instanceof Error ? error.message : String(error))
  }
  const timeoutMs = options.timeoutMs ?? config.work.callTimeoutSec * 1000
  options.onStatus?.(`正在调用 ${slot.label}（${route.model}）…`)

  const relay = createOpenAICompatible({
    name: `zhixing-${slot.id}`,
    baseURL,
    apiKey: route.apiKey,
    fetch: await fetchFor(config.proxy),
  })
  const fitted = fitRequest(options.request, REQUEST_BUDGET)
  const instructions = fitted.reference?.trim()
    ? `${fitted.system}\n\n<参考资料>\n${fitted.reference.trim()}\n</参考资料>`
    : fitted.system
  const messages: SdkMessage[] = fitted.messages.map((turn) => ({ role: turn.role, content: turn.content }))

  let text = ''
  try {
    const result = streamText({
      model: relay.chatModel(route.model),
      instructions,
      messages,
      abortSignal: options.signal,
      maxRetries: 1,
      timeout: { totalMs: timeoutMs },
    })
    for await (const part of result.stream) {
      if (part.type === 'text-delta') {
        if (!part.text) continue
        text += part.text
        options.onDelta?.(part.text)
      } else if (part.type === 'error') {
        throw part.error
      } else if (part.type === 'abort') {
        // An aborted stream ends quietly; treating partial text as a full reply would corrupt plans and saved chats.
        if (options.signal?.aborted) throw abortError()
        const timeout = new Error('等待模型响应超时。')
        timeout.name = 'TimeoutError'
        throw timeout
      }
    }
  } catch (error) {
    if (options.signal?.aborted) throw abortError()
    if (text) options.onReset?.()
    throw new ModelCallError(`${slot.label}：${describeError(error, route.model)}`)
  }
  if (options.signal?.aborted) throw abortError()
  if (!text.trim()) {
    throw new ModelCallError(`${slot.label}：模型没有返回任何内容。`)
  }
  return { text: text.trim(), model: route.model }
}

/** Streams one reply from a slot: an OpenAI-compatible relay, or a local CLI's stdout. */
export async function callModel(options: CallOptions): Promise<CallResult> {
  const config = options.config ?? (await loadConfig())
  const slot = findSlot(config, options.provider)
  if (!slot) throw new ModelCallError('找不到这个模型槽位。请到设置里检查。')
  if (!slot.enabled) throw new ModelCallError(`${slot.label} 已在设置里停用。`)
  if (slot.connection === 'cli') return callCli(slot, options, config)
  return callApi(slot, options, config)
}

export async function testConnection(provider: ProviderId): Promise<ConnectionTestResult> {
  const started = Date.now()
  const config = await loadConfig()
  const slot = findSlot(config, provider)
  if (!slot) return { ok: false, model: '', error: '找不到这个模型槽位。请先保存设置。', ms: Date.now() - started }
  const model = slot.connection === 'cli' ? slot.model || slot.command : slot.model
  try {
    const result = await callModel({
      provider,
      config: {
        ...config,
        providers: config.providers.map((item) => (item.id === provider ? { ...item, enabled: true } : item)),
      },
      timeoutMs: 90_000,
      request: {
        system: '你正在接受连通性测试。',
        messages: [{ role: 'user', content: '请只回复“连接成功”四个字。' }],
      },
    })
    return { ok: true, model: result.model, text: result.text.slice(0, 120), ms: Date.now() - started }
  } catch (error) {
    return { ok: false, model, error: error instanceof Error ? error.message : String(error), ms: Date.now() - started }
  }
}

/** Reads the relay's model list (GET /models). Unsaved form values can be passed; a masked key falls back to the stored one. */
export async function listModels(input: { baseUrl?: string; apiKey?: string; provider?: ProviderId }): Promise<string[]> {
  const config = await loadConfig()
  const slot = input.provider ? findSlot(config, input.provider) : undefined
  if (slot?.connection === 'cli') throw new RelaySetupError('CLI 槽位没有模型列表。模型名是可选项，写在槽位里即可。')
  const stored = slot ? routeFor(config, slot.id) : config.relay
  const baseUrl = input.baseUrl?.trim() || stored.baseUrl
  const apiKey = resolveKey(input.apiKey, stored.apiKey)
  if (!baseUrl || !apiKey) throw new RelaySetupError('先填写接口地址和 API Key。')
  const base = normalizeBaseUrl(baseUrl)
  const doFetch = (await fetchFor(config.proxy)) ?? fetch
  let response: Response
  try {
    response = await doFetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    })
  } catch (error) {
    throw new RelaySetupError(describeError(error, ''))
  }
  const body = await response.text()
  if (!response.ok) throw new RelaySetupError(describeError({ statusCode: response.status, responseBody: body }, ''))
  let data: unknown
  try {
    data = JSON.parse(body)
  } catch {
    throw new RelaySetupError('中转站返回的不是模型列表。请确认接口地址以 /v1 结尾。')
  }
  const list = Array.isArray((data as { data?: unknown })?.data)
    ? ((data as { data: unknown[] }).data)
    : Array.isArray(data)
      ? (data as unknown[])
      : []
  const ids = list
    .map((item) => (typeof item === 'string' ? item : typeof (item as { id?: unknown })?.id === 'string' ? (item as { id: string }).id : ''))
    .filter(Boolean)
  return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b)).slice(0, 2000)
}
