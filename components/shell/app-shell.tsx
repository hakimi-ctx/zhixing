'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { LibraryActionsProvider } from '@/components/library/library-actions'
import { UploadProvider } from '@/components/library/upload-provider'
import { STUDY_VIEWS, StudySidebar, type StudyView } from '@/components/study/study-sidebar'
import { NoticeProvider } from '@/components/ui/notices'
import { WorkSidebar } from '@/components/work/work-sidebar'
import { TabsProvider } from '@/lib/client/tabs'
import type { AppMode } from '@/lib/shared/types'
import { QuickOpen, isQuickOpenChord } from './quick-open'
import { Rail, type Section } from './rail'
import { StatusBar } from './status-bar'
import { TabBar } from './tab-bar'
import styles from './shell.module.css'

const NARROW_QUERY = '(max-width: 899px)'
const COLLAPSED_KEY = 'zhixing.sidebarCollapsed'
const WIDTH_KEY = 'zhixing.sidebarWidth'
const VIEW_KEY = 'zhixing.studyView'
const DEFAULT_WIDTH = 272
const MIN_WIDTH = 200
const MAX_WIDTH = 480

const clampWidth = (value: number) => Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value)))

function sectionOf(pathname: string): Section {
  if (pathname.startsWith('/work')) return 'work'
  if (pathname.startsWith('/settings')) return 'settings'
  return 'study'
}

interface ResizerProps {
  width: number
  onResize: (width: number, done: boolean) => void
  onDragChange: (dragging: boolean) => void
}

function SidebarResizer({ width, onResize, onDragChange }: ResizerProps) {
  const start = useRef<{ x: number; width: number } | null>(null)
  const [active, setActive] = useState(false)

  const finish = (clientX: number | null) => {
    const origin = start.current
    start.current = null
    setActive(false)
    onDragChange(false)
    if (origin) onResize(clampWidth(clientX === null ? width : origin.width + clientX - origin.x), true)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="调整侧边栏宽度"
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      className={styles.resizer}
      data-active={active}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        start.current = { x: event.clientX, width }
        setActive(true)
        onDragChange(true)
      }}
      onPointerMove={(event) => {
        const origin = start.current
        if (origin) onResize(clampWidth(origin.width + event.clientX - origin.x), false)
      }}
      onPointerUp={(event) => finish(event.clientX)}
      onPointerCancel={() => finish(null)}
      onDoubleClick={() => onResize(DEFAULT_WIDTH, true)}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        onResize(clampWidth(width + (event.key === 'ArrowLeft' ? -16 : 16)), true)
      }}
    />
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/study'
  const section = sectionOf(pathname)
  const [lastMode, setLastMode] = useState<AppMode>(section === 'work' ? 'work' : 'study')
  const [collapsed, setCollapsed] = useState(false)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [resizing, setResizing] = useState(false)

  useEffect(() => {
    if (section !== 'settings') setLastMode(section)
  }, [section])

  useEffect(() => {
    setOverlayOpen(false)
  }, [pathname])

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === '1')
    const saved = Number(window.localStorage.getItem(WIDTH_KEY))
    if (Number.isFinite(saved) && saved >= MIN_WIDTH && saved <= MAX_WIDTH) setWidth(saved)
  }, [])

  useEffect(() => {
    if (!overlayOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOverlayOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [overlayOpen])

  const toggleSidebar = useCallback(() => {
    if (window.matchMedia(NARROW_QUERY).matches) {
      setOverlayOpen((open) => !open)
      return
    }
    setCollapsed((current) => {
      const next = !current
      window.localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0')
      return next
    })
  }, [])

  const resize = useCallback((next: number, done: boolean) => {
    setWidth(next)
    if (done) window.localStorage.setItem(WIDTH_KEY, String(next))
  }, [])

  const mode: AppMode = section === 'settings' ? lastMode : section

  const [studyView, setStudyView] = useState<StudyView>('papers')
  const [searchFocus, setSearchFocus] = useState(0)
  const [quickOpen, setQuickOpen] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isQuickOpenChord(event)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      setQuickOpen((open) => !open)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  useEffect(() => {
    const saved = window.localStorage.getItem(VIEW_KEY) as StudyView | null
    if (saved && STUDY_VIEWS.includes(saved)) setStudyView(saved)
  }, [])

  const changeView = useCallback((view: StudyView) => {
    setStudyView(view)
    window.localStorage.setItem(VIEW_KEY, view)
  }, [])

  /** Brings the sidebar back if it is hidden, e.g. when a shortcut asks for one of its views. */
  const revealSidebar = useCallback(() => {
    if (window.matchMedia(NARROW_QUERY).matches) {
      setOverlayOpen(true)
      return
    }
    setCollapsed(false)
    window.localStorage.setItem(COLLAPSED_KEY, '0')
  }, [])

  useEffect(() => {
    if (mode !== 'study') return
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey || event.isComposing) return
      const key = event.key.toLowerCase()
      if (key !== 'f' && key !== 'e') return
      event.preventDefault()
      changeView(key === 'f' ? 'search' : 'files')
      revealSidebar()
      if (key === 'f') setSearchFocus((count) => count + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, changeView, revealSidebar])

  return (
    <NoticeProvider>
      <TabsProvider>
        <LibraryActionsProvider>
        <UploadProvider enabled={mode === 'study'}>
          <div
            className={styles.app}
            data-collapsed={collapsed}
            data-overlay={overlayOpen}
            data-resizing={resizing}
            style={{ '--sidebar-width': `${width}px` } as React.CSSProperties}
          >
            <div className={styles.frame}>
              <Rail section={section} mode={mode} collapsed={collapsed} overlayOpen={overlayOpen} onToggleSidebar={toggleSidebar} />
              <aside className={styles.sidebar} aria-label={mode === 'study' ? 'Study 侧边栏' : 'Work 侧边栏'} id="app-sidebar">
                {mode === 'study' ? <StudySidebar view={studyView} onViewChange={changeView} searchFocus={searchFocus} /> : <WorkSidebar />}
                <SidebarResizer width={width} onResize={resize} onDragChange={setResizing} />
              </aside>
              <div className={styles.backdrop} aria-hidden="true" onClick={() => setOverlayOpen(false)} />
              <div className={styles.workspace}>
                {mode === 'study' ? <TabBar /> : null}
                <main className={styles.main} id="main-content">
                  {children}
                </main>
              </div>
            </div>
            <StatusBar mode={mode} />
          </div>
          {quickOpen ? <QuickOpen onClose={() => setQuickOpen(false)} /> : null}
        </UploadProvider>
        </LibraryActionsProvider>
      </TabsProvider>
    </NoticeProvider>
  )
}
