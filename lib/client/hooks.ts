'use client'

import useSWR from 'swr'
import type {
  AppConfig,
  Conversation,
  ConversationSummary,
  ExecutorsStatus,
  LibraryState,
  LiteratureSearchResponse,
  SearchResponse,
  SystemInfo,
  VaultTree,
  WorkSession,
  WorkSessionSummary,
} from '@/lib/shared/types'
import { fetcher } from './api'

export const KEYS = {
  config: '/api/config',
  system: '/api/system',
  executors: '/api/executors',
  vaultTree: '/api/vault/tree',
  library: '/api/library',
  conversations: '/api/study/conversations',
  conversation: (id: string) => `/api/study/conversations/${id}`,
  workSessions: '/api/work/sessions',
  workSession: (id: string) => `/api/work/sessions/${id}`,
}

export function useConfig() {
  return useSWR<AppConfig>(KEYS.config, fetcher, { revalidateOnFocus: false })
}

export function useSystem() {
  return useSWR<SystemInfo>(KEYS.system, fetcher, { revalidateOnFocus: false })
}

/** Probing executors spawns processes, so this only runs on demand. */
export function useExecutors(enabled = true) {
  return useSWR<ExecutorsStatus>(enabled ? KEYS.executors : null, fetcher, {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    shouldRetryOnError: false,
  })
}

/** Polled so files added or removed in Explorer show up without a manual refresh. */
export function useVaultTree() {
  return useSWR<VaultTree>(KEYS.vaultTree, fetcher, { refreshInterval: 5000, keepPreviousData: true })
}

/** Polls fast while papers are being read or catalogued, slowly otherwise (to pick up PDFs added in Explorer). */
export function useLibrary(enabled = true) {
  return useSWR<LibraryState>(enabled ? KEYS.library : null, fetcher, {
    refreshInterval: (data) => (data && (data.pending > 0 || data.organizing) ? 2000 : 15000),
    keepPreviousData: true,
  })
}

export function useSearch(query: string) {
  const trimmed = query.trim()
  return useSWR<SearchResponse>(trimmed ? `/api/search?q=${encodeURIComponent(trimmed)}` : null, fetcher, {
    keepPreviousData: true,
    revalidateOnFocus: false,
  })
}

export function useLiteratureSearch(query: string, fromYear: number | null, toYear: number | null, page = 1) {
  const trimmed = query.trim()
  const params = new URLSearchParams()
  if (trimmed) params.set('q', trimmed)
  if (fromYear) params.set('fromYear', String(fromYear))
  if (toYear) params.set('toYear', String(toYear))
  if (page > 1) params.set('page', String(page))
  return useSWR<LiteratureSearchResponse>(trimmed ? `/api/literature?${params}` : null, fetcher, {
    keepPreviousData: true,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
}

export function useConversations() {
  return useSWR<ConversationSummary[]>(KEYS.conversations, fetcher)
}

export type ConversationDetail = Conversation & { running: boolean }

export function useConversation(id: string | undefined) {
  return useSWR<ConversationDetail>(id ? KEYS.conversation(id) : null, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
}

export function useWorkSessions() {
  return useSWR<WorkSessionSummary[]>(KEYS.workSessions, fetcher, {
    refreshInterval: (data) => (data?.some((session) => session.status === 'running') ? 3000 : 0),
  })
}

export function isSessionBusy(session: WorkSession | undefined): boolean {
  return Boolean(session && (session.status === 'running' || session.executions.some((item) => item.status === 'running')))
}

export function useWorkSession(id: string | undefined) {
  return useSWR<WorkSession>(id ? KEYS.workSession(id) : null, fetcher, {
    refreshInterval: (data) => (isSessionBusy(data) ? 1200 : 0),
    shouldRetryOnError: false,
  })
}
