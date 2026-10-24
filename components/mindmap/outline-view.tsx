'use client'

import { useLayoutEffect, useRef } from 'react'
import { ChevronDownIcon, ChevronRightIcon } from '@primer/octicons-react'
import { MAX_DEPTH, locateNode, newNodeId, walkNodes, type MindNode } from '@/lib/shared/mindmap'
import type { MapController } from './controller'
import { markerHtml } from './render'
import { useDraft } from './use-map'
import styles from './mindmap.module.css'

interface Row {
  node: MindNode
  depth: number
  hasChildren: boolean
  expanded: boolean
}

type Caret = 'start' | 'end' | number

interface OutlineViewProps {
  controller: MapController
  /** The map's change counter; the outline re-reads the tree whenever it moves. */
  version: number
  activeId: string | null
  onActivate: (id: string) => void
  onOpenPage: (page: number) => void
}

/** Rows in reading order; topics under a folded branch are left out, like on the map. */
function visibleRows(root: MindNode): Row[] {
  const rows: Row[] = []
  const hidden = new Set<string>()
  walkNodes(root, (node, parent, depth) => {
    if (parent && (hidden.has(parent.id) || (parent !== root && parent.expanded === false))) {
      hidden.add(node.id)
      return
    }
    rows.push({ node, depth, hasChildren: Boolean(node.children?.length), expanded: !parent || node.expanded !== false })
  })
  return rows
}

const defaultName = (depth: number) => (depth <= 1 ? '分支主题' : '子主题')

/**
 * XMind-style outliner over the same tree as the map: Enter adds a topic, Tab / Shift+Tab change
 * its level, Alt+↑↓ reorder, Backspace on an empty topic removes it. Every edit is one undo step.
 */
export function OutlineView({ controller, version, activeId, onActivate, onOpenPage }: OutlineViewProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef<{ id: string; caret: Caret } | null>(null)
  const root = controller.liveRoot()
  const rows = root ? visibleRows(root) : []

  useLayoutEffect(() => {
    const pending = pendingFocus.current
    if (!pending) return
    const input = listRef.current?.querySelector<HTMLTextAreaElement>(`textarea[data-id="${pending.id}"]`)
    if (!input) return
    pendingFocus.current = null
    input.focus()
    const position = pending.caret === 'start' ? 0 : pending.caret === 'end' ? input.value.length : Math.min(pending.caret, input.value.length)
    input.setSelectionRange(position, position)
  })

  useLayoutEffect(() => {
    if (!activeId || listRef.current?.contains(document.activeElement)) return
    listRef.current?.querySelector(`[data-row-id="${activeId}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  const focusRow = (id: string, caret: Caret) => {
    pendingFocus.current = { id, caret }
  }

  const change = (mutation: (root: MindNode) => void, select: string[], coalesce?: string) => {
    controller.mutate((live) => mutation(live as unknown as MindNode), { select, coalesce })
  }

  const setTopic = (id: string, topic: string) => {
    change(
      (live) => {
        const found = locateNode(live, id)
        if (found) found.node.topic = topic.slice(0, 2000)
      },
      [id],
      `outline:${id}`,
    )
  }

  const insertAfter = (row: Row, text: string) => {
    const created: MindNode = { id: newNodeId(), topic: '', children: [] }
    if (row.depth === 0) {
      change((live) => {
        live.children = [...(live.children ?? []), created]
      }, [created.id])
    } else {
      change((live) => {
        const found = locateNode(live, row.node.id)
        if (!found?.parent) return
        const siblings = found.parent.children ?? []
        if (found.parent === live && found.node.direction !== undefined) created.direction = found.node.direction
        siblings.splice(found.index + 1, 0, created)
        if (text !== found.node.topic) found.node.topic = text
      }, [created.id])
    }
    focusRow(created.id, 'start')
  }

  const indent = (row: Row, caret: number) => {
    if (row.depth === 0) return
    change((live) => {
      const found = locateNode(live, row.node.id)
      if (!found?.parent || found.index === 0) return
      const siblings = found.parent.children ?? []
      const target = siblings[found.index - 1]
      if (found.depth + 1 + subtreeHeight(found.node) > MAX_DEPTH) return
      siblings.splice(found.index, 1)
      delete found.node.direction
      target.children = [...(target.children ?? []), found.node]
      target.expanded = true
    }, [row.node.id])
    focusRow(row.node.id, caret)
  }

  const outdent = (row: Row, caret: number) => {
    if (row.depth <= 1) return
    change((live) => {
      const found = locateNode(live, row.node.id)
      const parent = found?.parent
      if (!found || !parent) return
      const grand = locateNode(live, parent.id)
      if (!grand?.parent) return
      const siblings = parent.children ?? []
      // Like XMind: the topics after it become its children, so the visual order is kept.
      const following = siblings.splice(found.index)
      following.shift()
      found.node.children = [...(found.node.children ?? []), ...following]
      const uncles = grand.parent.children ?? []
      if (grand.parent === live && parent.direction !== undefined) found.node.direction = parent.direction
      uncles.splice(grand.index + 1, 0, found.node)
    }, [row.node.id])
    focusRow(row.node.id, caret)
  }

  const move = (row: Row, delta: -1 | 1) => {
    if (row.depth === 0) return
    change((live) => {
      const found = locateNode(live, row.node.id)
      if (!found?.parent) return
      const siblings = found.parent.children ?? []
      const target = found.index + delta
      if (target < 0 || target >= siblings.length) return
      siblings.splice(found.index, 1)
      siblings.splice(target, 0, found.node)
    }, [row.node.id])
    focusRow(row.node.id, 'end')
  }

  const remove = (row: Row, index: number) => {
    if (row.depth === 0 || row.hasChildren) return
    const previous = rows[index - 1]
    change((live) => {
      const found = locateNode(live, row.node.id)
      if (!found?.parent) return
      found.parent.children?.splice(found.index, 1)
    }, previous ? [previous.node.id] : [])
    if (previous) focusRow(previous.node.id, 'end')
  }

  const toggle = (row: Row) => {
    if (!row.hasChildren || row.depth === 0) return
    change((live) => {
      const found = locateNode(live, row.node.id)
      if (found) found.node.expanded = !row.expanded
    }, [row.node.id])
  }

  const focusSibling = (index: number, delta: -1 | 1, caret: Caret) => {
    const target = rows[index + delta]
    if (!target) return
    const input = listRef.current?.querySelector<HTMLTextAreaElement>(`textarea[data-id="${target.node.id}"]`)
    if (!input) return
    input.focus()
    const position = caret === 'start' ? 0 : caret === 'end' ? input.value.length : caret
    input.setSelectionRange(position, position)
  }

  if (!root) return null

  return (
    <div ref={listRef} className={styles.outline} role="tree" aria-label="大纲" data-version={version}>
      {rows.map((row, index) => (
        <OutlineRow
          key={row.node.id}
          row={row}
          active={row.node.id === activeId}
          onFocus={() => onActivate(row.node.id)}
          onText={(text) => setTopic(row.node.id, text)}
          onBlurEmpty={() => setTopic(row.node.id, defaultName(row.depth))}
          onKey={(event, text) => {
            const native = event.nativeEvent
            if (native.isComposing || native.keyCode === 229) return
            const input = event.currentTarget
            const caret = input.selectionStart ?? 0
            const singleLine = !text.includes('\n')
            if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
              event.preventDefault()
              insertAfter(row, text)
            } else if (event.key === 'Tab') {
              event.preventDefault()
              if (event.shiftKey) outdent(row, caret)
              else indent(row, caret)
            } else if (event.key === 'Backspace' && text === '' && !row.hasChildren && row.depth > 0) {
              event.preventDefault()
              remove(row, index)
            } else if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
              event.preventDefault()
              move(row, event.key === 'ArrowUp' ? -1 : 1)
            } else if ((event.ctrlKey || event.metaKey) && event.code === 'Slash') {
              event.preventDefault()
              toggle(row)
            } else if (event.key === 'ArrowUp' && !event.shiftKey && (singleLine || caret === 0)) {
              event.preventDefault()
              focusSibling(index, -1, singleLine ? caret : 'end')
            } else if (event.key === 'ArrowDown' && !event.shiftKey && (singleLine || caret === text.length)) {
              event.preventDefault()
              focusSibling(index, 1, singleLine ? caret : 'start')
            }
          }}
          onToggle={() => toggle(row)}
          onOpenPage={onOpenPage}
        />
      ))}
    </div>
  )
}

function subtreeHeight(node: MindNode): number {
  let height = 0
  walkNodes(node, (_child, _parent, depth) => {
    if (depth > height) height = depth
  })
  return height
}

interface OutlineRowProps {
  row: Row
  active: boolean
  onFocus: () => void
  onText: (text: string) => void
  onBlurEmpty: () => void
  onKey: (event: React.KeyboardEvent<HTMLTextAreaElement>, text: string) => void
  onToggle: () => void
  onOpenPage: (page: number) => void
}

function OutlineRow({ row, active, onFocus, onText, onBlurEmpty, onKey, onToggle, onOpenPage }: OutlineRowProps) {
  const { node, depth, hasChildren, expanded } = row
  const [draft, setDraft, ref] = useDraft(node.topic)
  const markers = node.metadata?.markers ?? []
  const page = node.metadata?.page

  return (
    <div
      className={styles.outlineRow}
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={hasChildren && depth > 0 ? expanded : undefined}
      aria-selected={active}
      data-row-id={node.id}
      data-root={depth === 0 ? '' : undefined}
      style={{ '--depth': depth } as React.CSSProperties}
    >
      {hasChildren && depth > 0 ? (
        <button type="button" className={styles.outlineToggle} aria-label={expanded ? '折叠' : '展开'} tabIndex={-1} onClick={onToggle}>
          {expanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
        </button>
      ) : (
        <span className={styles.outlineBullet} aria-hidden="true" />
      )}
      {markers.length ? (
        <span
          className={styles.outlineMarkers}
          // Built from our own constant marker table, escaped in markerHtml.
          dangerouslySetInnerHTML={{ __html: markers.map(markerHtml).join('') }}
        />
      ) : null}
      <textarea
        ref={ref as React.RefObject<HTMLTextAreaElement>}
        className={styles.outlineInput}
        data-id={node.id}
        rows={1}
        value={draft}
        spellCheck={false}
        aria-label={depth === 0 ? '中心主题' : `第 ${depth} 层主题`}
        onFocus={onFocus}
        onChange={(event) => {
          setDraft(event.target.value)
          onText(event.target.value)
        }}
        onBlur={() => {
          if (!draft.trim()) onBlurEmpty()
        }}
        onKeyDown={(event) => onKey(event, draft)}
      />
      {page ? (
        <button type="button" className={styles.outlinePage} tabIndex={-1} title={`对照原文第 ${page} 页`} onClick={() => onOpenPage(page)}>
          p.{page}
        </button>
      ) : null}
    </div>
  )
}
