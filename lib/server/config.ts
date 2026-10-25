import 'server-only'
import path from 'node:path'
import { z } from 'zod'
import { EXECUTOR_PRESETS, executorFromPreset } from '@/lib/shared/executors'
import { LEGACY_PROVIDER_META } from '@/lib/shared/providers'
import {
  EXECUTOR_KINDS,
  LEGACY_PROVIDER_IDS,
  MAX_AI_SLOTS,
  type AiSlot,
  type AppConfig,
  type ConnectionMode,
  type ExecutorConfig,
  type LegacyProviderId,
  type ProviderId,
} from '@/lib/shared/types'
import { expandHome, paths } from './paths'
import { readJson, withLock, writeFileAtomic } from './store'

export const KEY_MASK = '••••'
const PROXY_PATTERN = /^https?:\/\/[^\s/?#]+\/?$/i
const URL_PATTERN = /^https?:\/\/[^\s]+$/i

const SLOT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

function emptySlot(id: string, label: string): AiSlot {
  return {
    id,
    label,
    enabled: true,
    connection: 'api',
    model: '',
    baseUrl: '',
    apiKey: '',
    command: '',
    args: '',
    note: '',
  }
}

function defaultSlots(): AiSlot[] {
  return LEGACY_PROVIDER_IDS.map((id) => emptySlot(id, LEGACY_PROVIDER_META[id].label))
}

export function defaultConfig(): AppConfig {
  return {
    version: 3,
    vaultPath: paths.defaultVault(),
    proxy: '',
    relay: { baseUrl: '', apiKey: '' },
    providers: defaultSlots(),
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

interface LegacyProviderFields {
  enabled: boolean
  model: string
  baseUrl: string
  apiKey: string
}

function normalizeLegacyProvider(raw: unknown): LegacyProviderFields {
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

function normalizeSlot(raw: unknown): AiSlot | null {
  const value = asObject(raw)
  const id = asString(value.id)
  if (!SLOT_ID.test(id)) return null
  const connection: ConnectionMode = value.connection === 'cli' ? 'cli' : 'api'
  const label = asString(value.label).slice(0, 40) || LEGACY_PROVIDER_META[id as LegacyProviderId]?.label || id
  const args = typeof value.args === 'string' ? value.args.slice(0, 2000) : ''
  return {
    id,
    label,
    enabled: asBool(value.enabled, true),
    connection,
    model: asString(value.model).slice(0, 200),
    baseUrl: cleanUrl(value.baseUrl),
    apiKey: asString(value.apiKey).slice(0, 1000),
    command: asString(value.command).slice(0, 500),
    args,
    note: asString(value.note).slice(0, 200),
  }
}

/** Version 1–2 stored `providers` as `{ chatgpt, claude, gemini }`. Those ids stay stable. */
function slotsFromLegacyRecord(providersRaw: Loose, version: unknown, relay: { baseUrl: string; apiKey: string }): {
  slots: AiSlot[]
  relay: { baseUrl: string; apiKey: string }
} {
  const legacy = Object.fromEntries(LEGACY_PROVIDER_IDS.map((id) => [id, normalizeLegacyProvider(providersRaw[id])])) as Record<
    LegacyProviderId,
    LegacyProviderFields
  >
  let relayConfig = relay
  if (!relayConfig.baseUrl && version !== 2 && version !== 3) {
    const first = LEGACY_PROVIDER_IDS.map((id) => legacy[id]).find((item) => item.baseUrl && item.apiKey)
    if (first) {
      relayConfig = { baseUrl: first.baseUrl, apiKey: first.apiKey }
      for (const id of LEGACY_PROVIDER_IDS) {
        if (legacy[id].baseUrl === first.baseUrl && legacy[id].apiKey === first.apiKey) {
          legacy[id] = { ...legacy[id], baseUrl: '', apiKey: '' }
        }
      }
    }
  }
  return {
    relay: relayConfig,
    slots: LEGACY_PROVIDER_IDS.map((id) => ({
      ...emptySlot(id, LEGACY_PROVIDER_META[id].label),
      enabled: legacy[id].enabled,
      model: legacy[id].model,
      baseUrl: legacy[id].baseUrl,
      apiKey: legacy[id].apiKey,
    })),
  }
}

function normalizeSlots(raw: unknown, version: unknown, relay: { baseUrl: string; apiKey: string }): {
  slots: AiSlot[]
  relay: { baseUrl: string; apiKey: string }
} {
  if (Array.isArray(raw)) {
    const seen = new Set<string>()
    const slots: AiSlot[] = []
    for (const item of raw) {
      const slot = normalizeSlot(item)
      if (!slot || seen.has(slot.id)) continue
      seen.add(slot.id)
      slots.push(slot)
      if (slots.length >= MAX_AI_SLOTS) break
    }
    return { slots, relay }
  }
  return slotsFromLegacyRecord(asObject(raw), version, relay)
}

function pickSlot(ids: string[], wanted: string, preferred: string): string {
  if (wanted && ids.includes(wanted)) return wanted
  if (preferred && ids.includes(preferred)) return preferred
  return ids[0] ?? ''
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
  const work = asObject(value.work)
  const study = asObject(value.study)
  const relay = asObject(value.relay)
  const vaultPath = asString(value.vaultPath)
  const proxy = asString(value.proxy)
  const migrated = normalizeSlots(value.providers, value.version, {
    baseUrl: cleanUrl(relay.baseUrl),
    apiKey: asString(relay.apiKey),
  })
  const ids = migrated.slots.map((slot) => slot.id)
  return {
    version: 3,
    vaultPath: vaultPath && path.isAbsolute(expandHome(vaultPath)) ? vaultPath : fallback.vaultPath,
    proxy: PROXY_PATTERN.test(proxy) ? proxy : '',
    relay: migrated.relay,
    providers: migrated.slots,
    study: {
      provider: pickSlot(ids, asString(study.provider), fallback.study.provider),
      model: asString(study.model),
      baseUrl: cleanUrl(study.baseUrl),
      apiKey: asString(study.apiKey),
    },
    work: {
      supervisor: pickSlot(ids, asString(work.supervisor), fallback.work.supervisor),
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

const slotIdField = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(SLOT_ID, '槽位 id 只能包含字母、数字、下划线和连字符')
const slotIdOrEmpty = z
  .string()
  .trim()
  .max(64)
  .refine((value) => value === '' || SLOT_ID.test(value), '槽位 id 只能包含字母、数字、下划线和连字符')
const urlField = z
  .string()
  .trim()
  .max(500)
  .refine((value) => value === '' || URL_PATTERN.test(value), '接口地址应以 http:// 或 https:// 开头')
const keyField = z.string().trim().max(1000)

const slotPatch = z.object({
  id: slotIdField,
  label: z.string().trim().min(1, '请给这个槽位起个名字').max(40),
  enabled: z.boolean(),
  connection: z.enum(['api', 'cli']),
  model: z.string().trim().max(200),
  baseUrl: urlField,
  apiKey: keyField,
  command: z.string().trim().max(500),
  args: z.string().max(2000),
  note: z.string().trim().max(200),
})

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
    providers: z.array(slotPatch).max(MAX_AI_SLOTS),
    study: z
      .object({ provider: slotIdOrEmpty, model: z.string().trim().max(200), baseUrl: urlField, apiKey: keyField })
      .partial(),
    work: z
      .object({
        supervisor: slotIdOrEmpty,
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
    next.providers = patch.providers.map((update) => {
      const stored = current.providers.find((slot) => slot.id === update.id)
      return { ...update, apiKey: resolveKey(update.apiKey, stored?.apiKey ?? '') }
    })
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
  for (const slot of masked.providers) slot.apiKey = mask(slot.apiKey)
  if (masked.study.apiKey) masked.study.apiKey = mask(masked.study.apiKey)
  return masked
}

export interface ModelRoute {
  baseUrl: string
  apiKey: string
  model: string
}

export function findSlot(config: AppConfig, provider: ProviderId): AiSlot | undefined {
  return config.providers.find((slot) => slot.id === provider)
}

/** Where an API slot's calls go: its own relay when both fields are set, otherwise the shared one. */
export function routeFor(config: AppConfig, provider: ProviderId): ModelRoute {
  const own = findSlot(config, provider)
  if (!own || own.connection !== 'api') return { baseUrl: '', apiKey: '', model: own?.model ?? '' }
  const useOwn = Boolean(own.baseUrl && own.apiKey)
  return {
    baseUrl: useOwn ? own.baseUrl : config.relay.baseUrl,
    apiKey: useOwn ? own.apiKey : config.relay.apiKey,
    model: own.model,
  }
}

export function providerReady(config: AppConfig, provider: ProviderId): boolean {
  const slot = findSlot(config, provider)
  if (!slot?.enabled) return false
  if (slot.connection === 'cli') return Boolean(slot.command.trim())
  const route = routeFor(config, provider)
  return Boolean(route.baseUrl && route.apiKey && route.model)
}
