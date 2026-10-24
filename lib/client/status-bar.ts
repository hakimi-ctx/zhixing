'use client'

import { useEffect, useSyncExternalStore } from 'react'

/**
 * Views publish short facts (word count, pages…) to the status bar. This is a tiny external store
 * so that typing in an editor only re-renders the status bar, not the whole shell.
 */

type Items = Readonly<Record<string, string>>

const EMPTY: Items = {}
let items: Items = EMPTY
const listeners = new Set<() => void>()

export function setStatusItem(key: string, value: string | null): void {
  if ((items[key] ?? null) === value) return
  const next: Record<string, string> = { ...items }
  if (value === null) delete next[key]
  else next[key] = value
  items = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useStatusItems(): Items {
  return useSyncExternalStore(
    subscribe,
    () => items,
    () => EMPTY,
  )
}

export function useStatusItem(key: string, value: string | null): void {
  useEffect(() => {
    setStatusItem(key, value)
  }, [key, value])
  useEffect(
    () => () => {
      setStatusItem(key, null)
    },
    [key],
  )
}
