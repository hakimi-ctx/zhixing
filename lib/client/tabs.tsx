'use client'

import { createContext, forwardRef, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

/**
 * Study pages open in tabs, Obsidian style: a plain click replaces the current tab (each tab keeps
 * its own back/forward history), Ctrl/⌘-click or middle-click opens a new tab. The tab list lives
 * in the browser and is restored on the next launch.
 */

export const HOME_HREF = '/study'
const STORAGE_KEY = 'zhixing.tabs.v1'
const MAX_TABS = 24
const MAX_HISTORY = 40
const BASE = 'http://zhixing.local'

export interface Tab {
  id: string
  history: string[]
  index: number
}

interface TabsState {
  tabs: Tab[]
  activeId: string
}

export function normalizeHref(href: string): string {
  try {
    const url = new URL(href, BASE)
    const query = new URLSearchParams(url.search).toString()
    const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname
    return query ? `${pathname}?${query}` : pathname
  } catch {
    return href
  }
}

export const isStudyHref = (href: string) => /^\/study(?:[/?]|$)/.test(href)

/** Two addresses with the same key show the same document (e.g. a paper at different pages). */
export function tabKey(href: string): string {
  try {
    const url = new URL(href, BASE)
    if (url.pathname === '/study/file') return `file:${url.searchParams.get('path') ?? ''}`
    return url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname
  } catch {
    return href
  }
}

export const tabHref = (tab: Tab): string => tab.history[tab.index] ?? HOME_HREF

let idCounter = 0
const newTabId = () => `t${Date.now().toString(36)}${(idCounter++).toString(36)}`
const makeTab = (href: string): Tab => ({ id: newTabId(), history: [href], index: 0 })

function withTab(state: TabsState, id: string, change: (tab: Tab) => Tab): TabsState {
  return { ...state, tabs: state.tabs.map((tab) => (tab.id === id ? change(tab) : tab)) }
}

function replaceEntry(tab: Tab, href: string): Tab {
  const history = [...tab.history]
  history[tab.index] = href
  return { ...tab, history }
}

function pushEntry(tab: Tab, href: string): Tab {
  const history = [...tab.history.slice(0, tab.index + 1), href].slice(-MAX_HISTORY)
  return { ...tab, history, index: history.length - 1 }
}

function insertTab(state: TabsState, tab: Tab): TabsState {
  const at = state.tabs.findIndex((item) => item.id === state.activeId)
  const tabs = [...state.tabs]
  tabs.splice(at < 0 ? tabs.length : at + 1, 0, tab)
  while (tabs.length > MAX_TABS) {
    const victim = tabs.findIndex((item) => item.id !== tab.id)
    tabs.splice(victim, 1)
  }
  return { tabs, activeId: tab.id }
}

/** Folds a navigation that did not come from the tab bar (a link, a redirect) into the tabs. */
function reconcile(state: TabsState, href: string): TabsState {
  const key = tabKey(href)
  const active = state.tabs.find((tab) => tab.id === state.activeId)
  if (active && tabKey(tabHref(active)) === key) {
    return tabHref(active) === href ? state : withTab(state, active.id, (tab) => replaceEntry(tab, href))
  }
  const other = state.tabs.find((tab) => tabKey(tabHref(tab)) === key)
  if (other) {
    const next = tabHref(other) === href ? state : withTab(state, other.id, (tab) => replaceEntry(tab, href))
    return { ...next, activeId: other.id }
  }
  if (!active) return insertTab(state, makeTab(href))
  // A new chat becomes a saved conversation in place, so "back" does not return to an empty chat.
  if (tabKey(tabHref(active)) === '/study/chat' && key.startsWith('/study/chat/')) {
    return withTab(state, active.id, (tab) => replaceEntry(tab, href))
  }
  return withTab(state, active.id, (tab) => pushEntry(tab, href))
}

function singleTab(href: string): TabsState {
  const tab = makeTab(href)
  return { tabs: [tab], activeId: tab.id }
}

function loadSaved(): TabsState | null {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as unknown
    if (!raw || typeof raw !== 'object') return null
    const { tabs, activeId } = raw as { tabs?: unknown; activeId?: unknown }
    if (!Array.isArray(tabs)) return null
    const valid: Tab[] = []
    const seen = new Set<string>()
    for (const item of tabs.slice(0, MAX_TABS)) {
      if (!item || typeof item !== 'object') continue
      const { id, history, index } = item as Partial<Tab>
      if (typeof id !== 'string' || seen.has(id) || !Array.isArray(history)) continue
      const entries = history
        .filter((entry): entry is string => typeof entry === 'string' && isStudyHref(entry))
        .map(normalizeHref)
        .slice(-MAX_HISTORY)
      if (!entries.length) continue
      const at = typeof index === 'number' && Number.isInteger(index) ? Math.min(Math.max(index, 0), entries.length - 1) : entries.length - 1
      seen.add(id)
      valid.push({ id, history: entries, index: at })
    }
    if (!valid.length) return null
    return { tabs: valid, activeId: typeof activeId === 'string' && seen.has(activeId) ? activeId : valid[0].id }
  } catch {
    return null
  }
}

/** On launch the app opens the library; the last active tab is restored instead, like Obsidian. */
function restore(current: string): { state: TabsState; navigateTo: string | null } {
  const saved = loadSaved()
  if (!isStudyHref(current)) return { state: saved ?? singleTab(HOME_HREF), navigateTo: null }
  if (!saved) return { state: singleTab(current), navigateTo: null }
  if (current === HOME_HREF) {
    const active = saved.tabs.find((tab) => tab.id === saved.activeId)
    if (active && tabHref(active) !== HOME_HREF) return { state: saved, navigateTo: tabHref(active) }
  }
  return { state: reconcile(saved, current), navigateTo: null }
}

export interface TabsApi {
  /** False until the saved tabs were restored on the client. */
  ready: boolean
  tabs: Tab[]
  activeId: string
  activeHref: string
  /** The page being shown is a Study page, i.e. one of the tabs. */
  inStudy: boolean
  canGoBack: boolean
  canGoForward: boolean
  activate: (id: string) => void
  close: (id: string) => void
  closeOthers: (id: string) => void
  closeToRight: (id: string) => void
  /** Closes every tab whose current address matches, e.g. after a file was deleted. */
  closeWhere: (match: (href: string) => boolean) => void
  reorder: (fromId: string, toId: string) => void
  /** Switches to a tab that already shows this document, or opens a new tab for it. */
  openInNewTab: (href: string) => void
  /** Always adds a tab (the "+" button). */
  newTab: (href?: string) => void
  goBack: () => void
  goForward: () => void
  /** Points a tab at a new address if it still shows `fromHref`, e.g. a new chat that was just saved. */
  retarget: (tabId: string, fromHref: string, toHref: string) => void
  /** Rewrites addresses in every tab and its history, e.g. after a file was renamed or moved. */
  rewrite: (map: (href: string) => string | null) => void
}

const TabsContext = createContext<TabsApi | null>(null)

function UrlWatcher({ onChange }: { onChange: (href: string) => void }) {
  const pathname = usePathname() ?? '/'
  const searchParams = useSearchParams()
  const query = searchParams?.toString() ?? ''
  useEffect(() => {
    onChange(normalizeHref(query ? `${pathname}?${query}` : pathname))
  }, [pathname, query, onChange])
  return null
}

export function TabsProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const initial = useMemo(() => ({ tabs: [{ id: 't0', history: [HOME_HREF], index: 0 }], activeId: 't0' }), [])
  const stateRef = useRef<TabsState>(initial)
  const [state, setState] = useState<TabsState>(initial)
  const [ready, setReady] = useState(false)
  const readyRef = useRef(false)
  const [href, setHref] = useState<string | null>(null)
  const hrefRef = useRef<string | null>(null)
  /** The address a tab action is navigating to; its URL change must not be folded in again. */
  const pendingRef = useRef<string | null>(null)
  /** Old file addresses that were moved, so a navigation already in flight does not open the stale path. */
  const redirectsRef = useRef(new Map<string, string>())

  const commit = useCallback((next: TabsState) => {
    if (next === stateRef.current) return
    stateRef.current = next
    setState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Storage full or disabled: tabs still work for this session.
    }
  }, [])

  const go = useCallback(
    (target: string, replace = false) => {
      const normalized = normalizeHref(target)
      const here = normalizeHref(`${window.location.pathname}${window.location.search}`)
      if (normalized === hrefRef.current && normalized === here) return
      pendingRef.current = normalized
      if (replace) router.replace(normalized)
      else router.push(normalized)
    },
    [router],
  )

  const onUrl = useCallback(
    (next: string) => {
      // Effects can fire twice for one address (React strict mode); only real changes count.
      if (next === hrefRef.current) return
      const hop = redirectsRef.current.get(next)
      if (hop && hop !== next) {
        go(hop, true)
        return
      }
      for (const [from, to] of redirectsRef.current) {
        if (to === next) redirectsRef.current.delete(from)
      }
      hrefRef.current = next
      setHref(next)
      if (!readyRef.current) {
        readyRef.current = true
        pendingRef.current = null
        const restored = restore(next)
        stateRef.current = restored.state
        setState(restored.state)
        setReady(true)
        if (restored.navigateTo) go(restored.navigateTo, true)
        return
      }
      const pending = pendingRef.current
      pendingRef.current = null
      if (!isStudyHref(next) || pending === next) return
      commit(reconcile(stateRef.current, next))
    },
    [commit, go],
  )

  const onStudyPage = () => hrefRef.current !== null && isStudyHref(hrefRef.current)

  const activate = useCallback(
    (id: string) => {
      const current = stateRef.current
      const tab = current.tabs.find((item) => item.id === id)
      if (!tab) return
      commit(current.activeId === id ? current : { ...current, activeId: id })
      go(tabHref(tab))
    },
    [commit, go],
  )

  const closeWhere = useCallback(
    (match: (tab: Tab) => boolean) => {
      const current = stateRef.current
      const tabs = current.tabs.filter((tab) => !match(tab))
      if (tabs.length === current.tabs.length) return
      if (!tabs.length) {
        commit(singleTab(HOME_HREF))
        if (onStudyPage()) go(HOME_HREF)
        return
      }
      if (tabs.some((tab) => tab.id === current.activeId)) {
        commit({ ...current, tabs })
        return
      }
      const activeIndex = current.tabs.findIndex((tab) => tab.id === current.activeId)
      const after = current.tabs.slice(activeIndex + 1).find((tab) => tabs.includes(tab))
      const before = [...current.tabs.slice(0, Math.max(activeIndex, 0))].reverse().find((tab) => tabs.includes(tab))
      const next = after ?? before ?? tabs[0]
      commit({ tabs, activeId: next.id })
      if (onStudyPage()) go(tabHref(next))
    },
    [commit, go],
  )

  const api = useMemo<TabsApi>(() => {
    const active = state.tabs.find((tab) => tab.id === state.activeId)
    return {
      ready,
      tabs: state.tabs,
      activeId: state.activeId,
      activeHref: active ? tabHref(active) : HOME_HREF,
      inStudy: href !== null && isStudyHref(href),
      canGoBack: Boolean(active && active.index > 0),
      canGoForward: Boolean(active && active.index < active.history.length - 1),
      activate,
      close: (id) => closeWhere((tab) => tab.id === id),
      // When the active tab is among the closed ones, closeWhere moves to its nearest survivor: `id`.
      closeOthers: (id) => closeWhere((tab) => tab.id !== id),
      closeToRight: (id) => {
        const index = stateRef.current.tabs.findIndex((tab) => tab.id === id)
        if (index < 0) return
        const doomed = new Set(stateRef.current.tabs.slice(index + 1).map((tab) => tab.id))
        closeWhere((tab) => doomed.has(tab.id))
      },
      closeWhere: (match) => closeWhere((tab) => match(tabHref(tab))),
      reorder: (fromId, toId) => {
        const current = stateRef.current
        const from = current.tabs.findIndex((tab) => tab.id === fromId)
        const to = current.tabs.findIndex((tab) => tab.id === toId)
        if (from < 0 || to < 0 || from === to) return
        const tabs = [...current.tabs]
        const [moved] = tabs.splice(from, 1)
        tabs.splice(to, 0, moved)
        commit({ ...current, tabs })
      },
      openInNewTab: (target) => {
        const normalized = normalizeHref(target)
        const current = stateRef.current
        const key = tabKey(normalized)
        const existing = current.tabs.find((tab) => tabKey(tabHref(tab)) === key)
        if (existing) {
          const updated = tabHref(existing) === normalized ? current : withTab(current, existing.id, (tab) => replaceEntry(tab, normalized))
          commit({ ...updated, activeId: existing.id })
        } else {
          commit(insertTab(current, makeTab(normalized)))
        }
        go(normalized)
      },
      newTab: (target = HOME_HREF) => {
        const normalized = normalizeHref(target)
        commit(insertTab(stateRef.current, makeTab(normalized)))
        go(normalized)
      },
      goBack: () => step(-1),
      goForward: () => step(1),
      retarget: (tabId, fromHref, toHref) => {
        const current = stateRef.current
        const from = normalizeHref(fromHref)
        const to = normalizeHref(toHref)
        const tab = current.tabs.find((item) => item.id === tabId)
        if (!tab || tabHref(tab) !== from) return
        commit(withTab(current, tabId, (item) => replaceEntry(item, to)))
        if (current.activeId === tabId && hrefRef.current === from) go(to, true)
      },
      rewrite: (map) => {
        const current = stateRef.current
        let changed = false
        const tabs = current.tabs.map((tab) => {
          let touched = false
          const history = tab.history.map((entry) => {
            const mapped = map(entry)
            const next = mapped === null ? entry : normalizeHref(mapped)
            if (next !== entry) {
              touched = true
              redirectsRef.current.set(entry, next)
            }
            return next
          })
          if (!touched) return tab
          changed = true
          return { ...tab, history }
        })
        if (!changed) return
        commit({ ...current, tabs })
        const active = tabs.find((tab) => tab.id === current.activeId)
        const shown = hrefRef.current
        let next: string | null = null
        if (active && shown && isStudyHref(shown) && map(shown) !== null && tabHref(active) !== shown) next = tabHref(active)
        // The address bar can still show the old path after the tab history was rewritten.
        const live = normalizeHref(`${window.location.pathname}${window.location.search}`)
        const movedLive = map(live)
        if (movedLive) {
          const normalized = normalizeHref(movedLive)
          if (normalized !== live) next = normalized
        }
        const pending = pendingRef.current
        const movedPending = pending ? map(pending) : null
        if (movedPending) {
          const normalized = normalizeHref(movedPending)
          if (normalized !== pending) next = normalized
        }
        const destination = next
        if (!destination) return
        go(destination, true)
        // The address bar can lag the tab rewrite; check again after this turn's navigation settles.
        window.setTimeout(() => {
          const now = normalizeHref(`${window.location.pathname}${window.location.search}`)
          if (now !== destination) go(destination, true)
        }, 0)
      },
    }

    function step(delta: -1 | 1) {
      const current = stateRef.current
      const tab = current.tabs.find((item) => item.id === current.activeId)
      if (!tab) return
      const index = tab.index + delta
      if (index < 0 || index >= tab.history.length) return
      commit(withTab(current, tab.id, (item) => ({ ...item, index })))
      go(tab.history[index])
    }
  }, [state, ready, href, activate, closeWhere, commit, go])

  return (
    <TabsContext.Provider value={api}>
      <Suspense fallback={null}>
        <UrlWatcher onChange={onUrl} />
      </Suspense>
      {children}
    </TabsContext.Provider>
  )
}

export function useTabs(): TabsApi {
  const value = useContext(TabsContext)
  if (!value) throw new Error('useTabs must be used inside TabsProvider')
  return value
}

export type ModifierEvent = { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; button?: number }

export const wantsNewTab = (event?: ModifierEvent | null) =>
  Boolean(event && (event.ctrlKey || event.metaKey || event.shiftKey || event.button === 1))

/** Opens a Study address: in the current tab, or in a new one for Ctrl/⌘/middle clicks. */
export function useOpen() {
  const router = useRouter()
  const { openInNewTab } = useTabs()
  return useCallback(
    (href: string, event?: ModifierEvent | null, options?: { newTab?: boolean }) => {
      if (options?.newTab || wantsNewTab(event)) openInNewTab(href)
      else router.push(href)
    },
    [router, openInNewTab],
  )
}

type TabLinkProps = Omit<React.ComponentProps<typeof Link>, 'href'> & {
  href: string
  /** Open in a (deduplicated) tab instead of replacing the current one. */
  newTab?: boolean
}

/** A Study link that respects the tab rules; use it instead of next/link inside Study. */
export const TabLink = forwardRef<HTMLAnchorElement, TabLinkProps>(function TabLink({ href, newTab, onClick, onAuxClick, ...props }, ref) {
  const { openInNewTab } = useTabs()
  return (
    <Link
      ref={ref}
      href={href}
      {...props}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented || event.button !== 0) return
        if (newTab || wantsNewTab(event)) {
          event.preventDefault()
          openInNewTab(href)
        }
      }}
      onAuxClick={(event) => {
        onAuxClick?.(event)
        if (event.defaultPrevented || event.button !== 1) return
        event.preventDefault()
        openInNewTab(href)
      }}
    />
  )
})
