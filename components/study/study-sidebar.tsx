'use client'

import { Suspense, useState } from 'react'
import { IconButton } from '@primer/react'
import { BookIcon, CommentDiscussionIcon, FileDirectoryIcon, SearchIcon, type Icon } from '@primer/octicons-react'
import { SidebarEmpty } from '@/components/shell/sidebar-section'
import styles from '@/components/shell/shell.module.css'
import { ChatsPane } from './conversation-section'
import { PapersPane } from './papers-pane'
import { SearchPane } from './search-pane'
import { FilesPane } from './vault-tree'

export type StudyView = 'papers' | 'files' | 'search' | 'chats'

export const STUDY_VIEWS: readonly StudyView[] = ['papers', 'files', 'search', 'chats']

const VIEWS: { id: StudyView; label: string; icon: Icon; keys?: string }[] = [
  { id: 'papers', label: '文库', icon: BookIcon },
  { id: 'files', label: '文件', icon: FileDirectoryIcon, keys: 'Mod+Shift+E' },
  { id: 'search', label: '搜索', icon: SearchIcon, keys: 'Mod+Shift+F' },
  { id: 'chats', label: '对话', icon: CommentDiscussionIcon },
]

interface StudySidebarProps {
  view: StudyView
  onViewChange: (view: StudyView) => void
  /** Changes whenever the search box should take focus (Ctrl+Shift+F). */
  searchFocus: number
}

/**
 * Obsidian's left pane: one icon per view, only one view showing at a time. Views stay mounted
 * after their first visit so switching back keeps the filter, scroll position and open folders.
 */
export function StudySidebar({ view, onViewChange, searchFocus }: StudySidebarProps) {
  const [visited, setVisited] = useState<ReadonlySet<StudyView>>(() => new Set([view]))
  if (!visited.has(view)) setVisited(new Set([...visited, view]))

  const pane = (id: StudyView) => {
    if (id === 'papers') return <PapersPane />
    if (id === 'files') return <FilesPane />
    if (id === 'search') return <SearchPane focusToken={searchFocus} />
    return <ChatsPane />
  }

  return (
    <>
      <div className={styles.sidebarHeader}>
        <div className={styles.viewToggles} role="group" aria-label="侧边栏视图">
          {VIEWS.map((item) => (
            <IconButton
              key={item.id}
              icon={item.icon}
              aria-label={item.label}
              aria-pressed={view === item.id}
              keybindingHint={item.keys}
              variant="invisible"
              tooltipDirection="s"
              className={styles.viewToggle}
              onClick={() => onViewChange(item.id)}
            />
          ))}
        </div>
      </div>
      {VIEWS.map((item) =>
        visited.has(item.id) || item.id === view ? (
          <div key={item.id} className={styles.sidebarView} hidden={item.id !== view}>
            <Suspense fallback={<SidebarEmpty>正在读取…</SidebarEmpty>}>{pane(item.id)}</Suspense>
          </div>
        ) : null,
      )}
    </>
  )
}
