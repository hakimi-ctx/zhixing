'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { ActionList, ActionMenu, Button, Flash, IconButton, Spinner, TextInput, TreeView } from '@primer/react'
import {
  AlertIcon,
  FileIcon,
  KebabHorizontalIcon,
  NoteIcon,
  PlusIcon,
  SearchIcon,
  ShareAndroidIcon,
  SparkleFillIcon,
  SyncIcon,
  UploadIcon,
  WorkflowIcon,
  XIcon,
} from '@primer/octicons-react'
import { useLibraryActions, type PaperFileKind } from '@/components/library/library-actions'
import { PaperMenuItems } from '@/components/library/paper-menu'
import { useUpload } from '@/components/library/upload-provider'
import { SidebarEmpty, SidebarPane } from '@/components/shell/sidebar-section'
import { errorText } from '@/lib/client/api'
import { domId } from '@/lib/client/dom-id'
import { useLibrary } from '@/lib/client/hooks'
import { useOpen } from '@/lib/client/tabs'
import { canOrganize, groupByTopic, paperIdOf, paperMatches, paperStatus, sortPapers } from '@/lib/client/library'
import type { Paper } from '@/lib/shared/types'
import styles from './sidebar.module.css'

const TREE_KEY = 'zhixing.papersTree'

interface TreePrefs {
  open: string[]
  closedTopics: string[]
}

function loadPrefs(): TreePrefs {
  try {
    const raw = JSON.parse(window.localStorage.getItem(TREE_KEY) ?? 'null') as Partial<TreePrefs> | null
    const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])
    return { open: strings(raw?.open), closedTopics: strings(raw?.closedTopics) }
  } catch {
    return { open: [], closedTopics: [] }
  }
}

type TreeTarget = { paper: Paper; kind: 'paper' | PaperFileKind }

const FILE_LABEL: Record<PaperFileKind, string> = { mindmap: '思维导图', note: '笔记' }

/** The library as a file tree: topics → papers → each paper's own mind map and note. */
export function PapersPane() {
  const { data: library, error } = useLibrary()
  const actions = useLibraryActions()
  const upload = useUpload()
  const openHref = useOpen()
  const pathname = usePathname() ?? ''
  const searchParams = useSearchParams()
  const currentPaper = paperIdOf(pathname)
  const currentFile = pathname === '/study/file' ? (searchParams?.get('path') ?? null) : null
  const [filter, setFilter] = useState('')
  const [openPapers, setOpenPapers] = useState<Set<string>>(() => new Set())
  const [closedTopics, setClosedTopics] = useState<Set<string>>(() => new Set())
  const [menuPaper, setMenuPaper] = useState<Paper | null>(null)
  const anchorRef = useRef<HTMLElement | null>(null)
  const [prefsLoaded, setPrefsLoaded] = useState(false)

  useEffect(() => {
    const prefs = loadPrefs()
    setOpenPapers(new Set(prefs.open))
    setClosedTopics(new Set(prefs.closedTopics))
    setPrefsLoaded(true)
  }, [])

  useEffect(() => {
    if (!prefsLoaded) return
    const prefs: TreePrefs = { open: [...openPapers].slice(-300), closedTopics: [...closedTopics].slice(-100) }
    window.localStorage.setItem(TREE_KEY, JSON.stringify(prefs))
  }, [prefsLoaded, openPapers, closedTopics])

  const setPaperOpen = useCallback((id: string, open: boolean) => {
    setOpenPapers((current) => {
      if (current.has(id) === open) return current
      const next = new Set(current)
      if (open) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const setTopicOpen = (name: string, open: boolean) => {
    setClosedTopics((current) => {
      const next = new Set(current)
      if (open) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const papers = useMemo(() => sortPapers(library?.papers ?? [], 'added'), [library])
  const groups = useMemo(() => groupByTopic(papers, library?.insights ?? null), [papers, library])
  const query = filter.trim()
  const filtered = useMemo(() => (query ? papers.filter((paper) => paperMatches(paper, query)) : papers), [papers, query])

  const ownerId = currentFile ? papers.find((paper) => paper.mindmap === currentFile || paper.note === currentFile)?.id : undefined
  useEffect(() => {
    if (ownerId) setPaperOpen(ownerId, true)
  }, [ownerId, setPaperOpen])

  const targets = useMemo(() => {
    const map = new Map<string, TreeTarget>()
    for (const paper of papers) {
      map.set(domId('paper', paper.id), { paper, kind: 'paper' })
      map.set(domId('mindmap', paper.id), { paper, kind: 'mindmap' })
      map.set(domId('note', paper.id), { paper, kind: 'note' })
    }
    return map
  }, [papers])

  const targetOf = (event: React.MouseEvent) => {
    const item = (event.target as HTMLElement).closest('[role="treeitem"]')
    return item ? { item: item as HTMLElement, target: targets.get(item.id) } : null
  }

  const openMenu = (paper: Paper, anchor?: HTMLElement | null) => {
    anchorRef.current = anchor ?? document.getElementById(domId('paper', paper.id))
    setMenuPaper(paper)
  }

  const renderFile = (paper: Paper, kind: PaperFileKind) => {
    const exists = Boolean(paper[kind])
    return (
      <TreeView.Item
        key={kind}
        id={domId(kind, paper.id)}
        current={exists && currentFile === paper[kind]}
        className={exists ? undefined : styles.pendingItem}
        onSelect={(event) => void actions.openFile(paper, kind, event)}
      >
        <TreeView.LeadingVisual>{kind === 'mindmap' ? <ShareAndroidIcon /> : <NoteIcon />}</TreeView.LeadingVisual>
        {FILE_LABEL[kind]}
        {exists ? null : (
          <TreeView.TrailingVisual label="还没有，点击新建">
            <PlusIcon />
          </TreeView.TrailingVisual>
        )}
      </TreeView.Item>
    )
  }

  const renderPaper = (paper: Paper) => {
    const status = paperStatus(paper)
    return (
      <TreeView.Item
        key={paper.id}
        id={domId('paper', paper.id)}
        current={currentPaper === paper.id}
        expanded={openPapers.has(paper.id)}
        onExpandedChange={(open) => setPaperOpen(paper.id, open)}
        onSelect={(event) => actions.open(paper, event)}
      >
        <TreeView.LeadingVisual>
          <FileIcon />
        </TreeView.LeadingVisual>
        {paper.title}
        {status && status.tone !== 'muted' ? (
          <TreeView.TrailingVisual label={status.label}>
            {status.tone === 'busy' ? <Spinner size="small" srText={null} /> : <AlertIcon className={styles.failed} />}
          </TreeView.TrailingVisual>
        ) : null}
        <TreeView.SubTree>
          {renderFile(paper, 'mindmap')}
          {renderFile(paper, 'note')}
        </TreeView.SubTree>
      </TreeView.Item>
    )
  }

  const organizable = library ? canOrganize(library.papers) && library.aiReady && !library.organizing : false

  let body: React.ReactNode
  if (error && !library) body = <Flash variant="danger">{errorText(error)}</Flash>
  else if (!library) body = <SidebarEmpty>正在读取文库…</SidebarEmpty>
  else if (library.error) body = <Flash variant="danger">{library.error}</Flash>
  else if (!papers.length) {
    body = (
      <>
        <SidebarEmpty>还没有论文。</SidebarEmpty>
        <div className={styles.emptyActions}>
          <Button size="small" leadingVisual={UploadIcon} onClick={upload.pick} loading={upload.busy}>
            导入论文
          </Button>
        </div>
      </>
    )
  } else if (query && !filtered.length) {
    body = <SidebarEmpty>没有匹配的论文。</SidebarEmpty>
  } else {
    body = (
      <div
        className={styles.tree}
        onContextMenu={(event) => {
          const hit = targetOf(event)
          if (!hit?.target) return
          event.preventDefault()
          openMenu(hit.target.paper, hit.item)
        }}
        onMouseDown={(event) => {
          if (event.button === 1) event.preventDefault()
        }}
        onAuxClick={(event) => {
          if (event.button !== 1) return
          const target = targetOf(event)?.target
          if (!target) return
          event.preventDefault()
          if (target.kind === 'paper') actions.open(target.paper, null, { newTab: true })
          else void actions.openFile(target.paper, target.kind, event)
        }}
      >
        <TreeView aria-label="文库">
          {groups && !query
            ? groups.map((group) => {
                const id = domId('topic', group.name)
                return (
                  <TreeView.Item
                    key={id}
                    id={id}
                    expanded={!closedTopics.has(group.name)}
                    onExpandedChange={(open) => setTopicOpen(group.name, open)}
                  >
                    <TreeView.LeadingVisual>
                      <TreeView.DirectoryIcon />
                    </TreeView.LeadingVisual>
                    {group.name}
                    <TreeView.TrailingVisual label={`${group.papers.length} 篇`}>
                      <span className={styles.count}>{group.papers.length}</span>
                    </TreeView.TrailingVisual>
                    <TreeView.SubTree>{group.papers.map(renderPaper)}</TreeView.SubTree>
                  </TreeView.Item>
                )
              })
            : filtered.map(renderPaper)}
        </TreeView>
      </div>
    )
  }

  return (
    <SidebarPane
      title="文库"
      meta={papers.length || undefined}
      actions={
        <>
          {library && library.pending > 0 ? <Spinner size="small" srText="正在建档" /> : null}
          <IconButton
            icon={WorkflowIcon}
            aria-label="关系图谱"
            size="small"
            variant="invisible"
            onClick={() => openHref('/study/graph')}
          />
          <IconButton
            icon={UploadIcon}
            aria-label="导入论文"
            size="small"
            variant="invisible"
            loading={upload.busy}
            onClick={upload.pick}
          />
          <ActionMenu>
            <ActionMenu.Anchor>
              <IconButton icon={KebabHorizontalIcon} aria-label="文库操作" size="small" variant="invisible" />
            </ActionMenu.Anchor>
            <ActionMenu.Overlay width="small" align="end">
              <ActionList>
                <ActionList.Item disabled={!organizable} onSelect={() => void actions.organize()}>
                  <ActionList.LeadingVisual>
                    <SparkleFillIcon />
                  </ActionList.LeadingVisual>
                  {library?.organizing ? 'AI 整理中…' : 'AI 整理'}
                </ActionList.Item>
                <ActionList.Item onSelect={() => void actions.rescan()}>
                  <ActionList.LeadingVisual>
                    <SyncIcon />
                  </ActionList.LeadingVisual>
                  重新扫描
                </ActionList.Item>
              </ActionList>
            </ActionMenu.Overlay>
          </ActionMenu>
        </>
      }
      toolbar={
        papers.length ? (
          <TextInput
            block
            size="small"
            leadingVisual={SearchIcon}
            placeholder="筛选"
            aria-label="筛选论文"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && filter) {
                event.preventDefault()
                setFilter('')
              }
            }}
            trailingAction={filter ? <TextInput.Action icon={XIcon} aria-label="清除筛选" onClick={() => setFilter('')} /> : undefined}
          />
        ) : undefined
      }
    >
      {body}
      <ActionMenu open={menuPaper !== null} onOpenChange={(open) => !open && setMenuPaper(null)} anchorRef={anchorRef}>
        <ActionMenu.Overlay width="small">{menuPaper ? <PaperMenuItems paper={menuPaper} /> : null}</ActionMenu.Overlay>
      </ActionMenu>
    </SidebarPane>
  )
}
