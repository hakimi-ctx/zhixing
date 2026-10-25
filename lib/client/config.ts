import { mutate } from 'swr'
import type { AiSlot, AppConfig, ExecutorKind, ProviderId, RelayConfig, WorkRules } from '@/lib/shared/types'
import { api } from './api'
import { KEYS } from './hooks'

export interface ExecutorPatch {
  id: ExecutorKind
  enabled: boolean
  command: string
  args: string
  timeoutMin: number
}

export interface ConfigPatch {
  vaultPath?: string
  proxy?: string
  relay?: Partial<RelayConfig>
  providers?: AiSlot[]
  study?: { provider: ProviderId }
  work?: Partial<WorkRules>
  executors?: ExecutorPatch[]
}

export async function patchConfig(patch: ConfigPatch): Promise<AppConfig> {
  const next = await api<AppConfig>(KEYS.config, { method: 'PATCH', body: patch })
  await mutate(KEYS.config, next, { revalidate: false })
  return next
}

/** Mirrors the server: an API slot with its own URL and key skips the shared relay; a CLI slot only needs a command. */
export function providerReady(config: AppConfig | undefined, id: ProviderId): boolean {
  if (!config) return false
  const own = config.providers.find((slot) => slot.id === id)
  if (!own?.enabled) return false
  if (own.connection === 'cli') return Boolean(own.command.trim())
  const useOwn = Boolean(own.baseUrl && own.apiKey)
  const baseUrl = useOwn ? own.baseUrl : config.relay.baseUrl
  const apiKey = useOwn ? own.apiKey : config.relay.apiKey
  return Boolean(baseUrl && apiKey && own.model.trim())
}
