import 'server-only'
import path from 'node:path'
import { z } from 'zod'
import { EXECUTOR_PRESETS, executorFromPreset } from '@/lib/shared/executors'
import {
  EXECUTOR_KINDS,
  PROVIDER_IDS,
  type AppConfig,
  type ExecutorConfig,
  type ProviderConfig,
  type ProviderId,
} from '@/lib/shared/types'
import { expandHome, paths } from './paths'
import { readJson, withLock, writeFileAtomic } from './store'

export const KEY_MASK = '••••'
const PROXY_PATTERN = /^https?:\/\/[^\s/?#]+\/?$/i
const URL_PATTERN = /^https?:\/\/[^\s]+$/i

function defaultProvider(): ProviderConfig {
  return { enabled: true, model: '', baseUrl: '', apiKey: '' }
}

export function defaultConfig(): AppConfig {
  return {
    version: 2,
    vaultPath: paths.defaultVault(),
    proxy: '',
    relay: { baseUrl: '', apiKey: '' },
    providers: { chatgpt: defaultProvider(), claude: defaultProvider(), gemini: defaultProvider() },
    study: { provider: 'claude', model: '', baseUrl: '', apiKey: '' },
    work: { supervisor: 'chatgpt', maxSubtasks: 4, maxRevisions: 1, callTimeoutSec: 600 },
    executors: EXECUTOR_KINDS.map((kind) => executorFromPreset(kind)),
  }
}

type Loose = Record<string, unknown>
const asObject = (value: unknown): Loose =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Loose) : {}
const asString = (value: unknown, fallback = '') => (typeof value === 'string' ? value.trim() : fallback)
const asBool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)
const asInt = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback
function oneOf<T extends string>(value: unknown, list: readonly T[], fallback: T): T {
  return list.includes(value as T) ? (value as T) : fallback
}
const cleanUrl = (value: unknown) => {
  const url = asString(value)
  return URL_PATTERN.test(url) ? url : ''
}

function normalizeProvider(raw: unknown): ProviderConfig {
  const value = asObject(raw)
  // Version 1 kept the OpenAI-compatible settings under `api`; their values carry over.
  const legacy = asObject(value.api)
  return {
    enabled: asBool(value.enabled, true),
    model: asString(value.model) || asString(legacy.model),
    baseUrl: cleanUrl(value.baseUrl) || cleanUrl(legacy.baseUrl),
    apiKey: asString(value.apiKey) || asString(legacy.apiKey),
  }
}

/** The old WorkBuddy argument template; still valid, but the documented headless flags are clearer. */
const LEGACY_WORKBUDDY_ARGS = '--print --permission-mode bypassPermissions {prompt}'

function normalizeExecutors(raw: unknown): ExecutorConfig[] {
  const list = Array.isArray(raw) ? raw.map(asObject) : []
  return EXECUTOR_KINDS.map((kind) => {
    const preset = executorFromPreset(kind)
    const stored = list.find((item) => item.kind === kind || item.id === kind)
    if (!stored) return preset
    const args = asString(stored.args, preset.args)
    return {
      ...preset,
      enabled: asBool(stored.enabled, true),
      command: asString(stored.command) || preset.command,
      args: !args || args === LEGACY_WORKBUDDY_ARGS ? preset.args : args,
      promptVia: oneOf(stored.promptVia, ['stdin', 'arg'] as const, preset.promptVia),
      timeoutMin: asInt(stored.timeoutMin, preset.timeoutMin, 1, 240),
    }
  })
}

export function normalizeConfig(raw: unknown): AppConfig {
  const fallback = defaultConfig()
  const value = asObject(raw)
  const providersRaw = asObject(value.providers)
  const work = asObject(value.work)
  const study = asObject(value.study)
  const relay = asObject(value.relay)
  const vaultPath = asString(value.vaultPath)
  const proxy = asString(value.proxy)
  const providers = {
    chatgpt: normalizeProvider(providersRaw.chatgpt),
    claude: normalizeProvider(providersRaw.claude),
    gemini: normalizeProvider(providersRaw.gemini),
  }
  let relayConfig = { baseUrl: cleanUrl(relay.baseUrl), apiKey: asString(relay.apiKey) }
  // Migrating from version 1: the first per-model API becomes the shared relay.
  if (!relayConfig.baseUrl && value.version !== 2) {
    const first = PROVIDER_IDS.map((id) => providers[id]).find((item) => item.baseUrl && item.apiKey)
    if (first) {
      relayConfig = { baseUrl: first.baseUrl, apiKey: first.apiKey }
      for (const id of PROVIDER_IDS) {
        if (providers[id].baseUrl === first.baseUrl && providers[id].apiKey === first.apiKey) {
          providers[id] = { ...providers[id], baseUrl: '', apiKey: '' }
        }
      }
    }
  }
  return {
    version: 2,
    vaultPath: vaultPath && path.isAbsolute(expandHome(vaultPath)) ? vaultPath : fallback.vaultPath,
    proxy: PROXY_PATTERN.test(proxy) ? proxy : '',
    relay: relayConfig,
    providers,
    study: {
      provider: oneOf(study.provider, PROVIDER_IDS, fallback.study.provider),
      model: asString(study.model),
      baseUrl: cleanUrl(study.baseUrl),
      apiKey: asString(study.apiKey),
    },
    work: {
      supervisor: oneOf(work.supervisor, PROVIDER_IDS, fallback.work.supervisor),
      maxSubtasks: asInt(work.maxSubtasks, fallback.work.maxSubtasks, 1, 6),
      maxRevisions: asInt(work.maxRevisions, fallback.work.maxRevisions, 0, 2),
      callTimeoutSec: asInt(work.callTimeoutSec, fallback.work.callTimeoutSec, 60, 3600),
    },
    executors: normalizeExecutors(value.executors),
  }
}

export async function loadConfig(): Promise<AppConfig> {
  return normalizeConfig(await readJson<unknown>(paths.config()))
}

const providerIdEnum = z.enum(['chatgpt', 'claude', 'gemini'])
const urlField = z
  .string()
  .trim()
  .max(500)
  .refine((value) => value === '' || URL_PATTERN.test(value), '接口地址应以 http:// 或 https:// 开头')
const keyField = z.string().trim().max(1000)

const providerPatch = z
  .object({ enabled: z.boolean(), model: z.string().trim().max(200), baseUrl: urlField, apiKey: keyField })
  .partial()

const executorPatch = z.object({
  id: z.enum(['workbuddy', 'deepseek-harness']),
  enabled: z.boolean(),
  command: z.string().trim().max(500),
  args: z.string().max(2000),
  timeoutMin: z.number().int().min(1).max(240),
})

export const configPatchSchema = z
  .object({
    vaultPath: z
      .string()
      .trim()
      .min(1, '文件库位置不能为空')
      .max(1000)
      .refine((value) => path.isAbsolute(expandHome(value)), '请填写完整的文件夹路径，例如 D:\\学习笔记'),
    proxy: z
      .string()
      .trim()
      .max(300)
      .refine((value) => value === '' || PROXY_PATTERN.test(value), '代理地址的格式应类似 http://127.0.0.1:7890'),
    relay: z.object({ baseUrl: urlField, apiKey: keyField }).partial(),
    providers: z.object({ chatgpt: providerPatch, claude: providerPatch, gemini: providerPatch }).partial(),
    study: z
      .object({ provider: providerIdEnum, model: z.string().trim().max(200), baseUrl: urlField, apiKey: keyField })
      .partial(),
    work: z
      .object({
        supervisor: providerIdEnum,
        maxSubtasks: z.number().int().min(1).max(6),
        maxRevisions: z.number().int().min(0).max(2),
        callTimeoutSec: z.number().int().min(60).max(3600),
      })
      .partial(),
    executors: z.array(executorPatch).max(EXECUTOR_KINDS.length),
  })
  .partial()

export type ConfigPatch = z.infer<typeof configPatchSchema>

/** A masked key from the browser means "keep the stored one". */
export function resolveKey(incoming: string | undefined, stored: string): string {
  if (incoming === undefined || incoming.startsWith(KEY_MASK)) return stored
  return incoming.trim()
}

function applyPatch(current: AppConfig, patch: ConfigPatch): AppConfig {
  const next: AppConfig = structuredClone(current)
  if (patch.vaultPath) next.vaultPath = patch.vaultPath
  if (patch.proxy !== undefined) next.proxy = patch.proxy
  if (patch.study) next.study = { ...next.study, ...patch.study }
  if (patch.work) next.work = { ...next.work, ...patch.work }
  if (patch.relay) {
    if (patch.relay.baseUrl !== undefined) next.relay.baseUrl = patch.relay.baseUrl
    next.relay.apiKey = resolveKey(patch.relay.apiKey, next.relay.apiKey)
  }
  if (patch.providers) {
    for (const id of PROVIDER_IDS) {
      const update = patch.providers[id]
      if (!update) continue
      const target = next.providers[id]
      if (update.enabled !== undefined) target.enabled = update.enabled
      if (update.model !== undefined) target.model = update.model
      if (update.baseUrl !== undefined) target.baseUrl = update.baseUrl
      target.apiKey = resolveKey(update.apiKey, target.apiKey)
    }
  }
  if (patch.executors) {
    next.executors = next.executors.map((executor) => {
      const update = patch.executors?.find((item) => item.id === executor.id)
      if (!update) return executor
      const preset = EXECUTOR_PRESETS[executor.kind]
      return {
        ...executor,
        enabled: update.enabled,
        command: update.command || preset.command,
        args: update.args.trim() ? update.args : preset.args,
        timeoutMin: update.timeoutMin,
      }
    })
  }
  return normalizeConfig(next)
}

export function updateConfig(patch: ConfigPatch): Promise<AppConfig> {
  const file = paths.config()
  return withLock(file, async () => {
    const next = applyPatch(await loadConfig(), patch)
    await writeFileAtomic(file, JSON.stringify(next, null, 2))
    return next
  })
}

const mask = (key: string) => (key ? `${KEY_MASK}${key.slice(-4)}` : '')

/** Never send stored API keys back to the browser. */
export function maskConfig(config: AppConfig): AppConfig {
  const masked: AppConfig = structuredClone(config)
  masked.relay.apiKey = mask(masked.relay.apiKey)
  for (const id of PROVIDER_IDS) masked.providers[id].apiKey = mask(masked.providers[id].apiKey)
  if (masked.study.apiKey) masked.study.apiKey = mask(masked.study.apiKey)
  return masked
}

export interface ModelRoute {
  baseUrl: string
  apiKey: string
  model: string
}

/** Where a provider's calls go: its own relay when both fields are set, otherwise the shared one. */
export function routeFor(config: AppConfig, provider: ProviderId): ModelRoute {
  const own = config.providers[provider]
  const useOwn = Boolean(own.baseUrl && own.apiKey)
  return {
    baseUrl: useOwn ? own.baseUrl : config.relay.baseUrl,
    apiKey: useOwn ? own.apiKey : config.relay.apiKey,
    model: own.model,
  }
}

export function providerReady(config: AppConfig, provider: ProviderId): boolean {
  const route = routeFor(config, provider)
  return config.providers[provider].enabled && Boolean(route.baseUrl && route.apiKey && route.model)
}
