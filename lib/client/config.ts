import { mutate } from 'swr'
import type { AppConfig, ExecutorKind, ProviderConfig, ProviderId, RelayConfig, WorkRules } from '@/lib/shared/types'
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
  providers?: Partial<Record<ProviderId, Partial<ProviderConfig>>>
  study?: { provider: ProviderId }
  work?: Partial<WorkRules>
  executors?: ExecutorPatch[]
}

export async function patchConfig(patch: ConfigPatch): Promise<AppConfig> {
  const next = await api<AppConfig>(KEYS.config, { method: 'PATCH', body: patch })
  await mutate(KEYS.config, next, { revalidate: false })
  return next
}

/** Mirrors the server's routing rule: a model with its own URL and key skips the shared relay. */
export function providerReady(config: AppConfig | undefined, id: ProviderId): boolean {
  if (!config) return false
  const own = config.providers[id]
  const useOwn = Boolean(own.baseUrl && own.apiKey)
  const baseUrl = useOwn ? own.baseUrl : config.relay.baseUrl
  const apiKey = useOwn ? own.apiKey : config.relay.apiKey
  return own.enabled && Boolean(baseUrl && apiKey && own.model)
}
