'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ActionList, Dialog, TextInput } from '@primer/react'
import { FileIcon, NoteIcon, SearchIcon, ShareAndroidIcon, type Icon } from '@primer/octicons-react'
import { useLibrary, useVaultTree } from '@/lib/client/hooks'
import { paperHref } from '@/lib/client/library'
import { useOpen } from '@/lib/client/tabs'
import { baseName, fileHref, flattenNodes } from '@/lib/client/vault'
import { displayName } from '@/lib/shared/mindmap'
import type { Paper, VaultNode } from '@/lib/shared/types'
import styles from './shell.module.css'

export function isQuickOpenChord(event: KeyboardEvent): boolean {
  if (event.isComposing || event.keyCode === 229 || event.altKey || event.shiftKey || event.repeat) return false
  if (!(event.ctrlKey || event.metaKey)) return false
  return event.key.toLowerCase() === 'p' || event.code === 'KeyP'
}

interface QuickItem {
  id: string
  kind: 'paper' | 'note' | 'mindmap' | 'file'
  title: string
  hint: string
  href: string
  recency: number
}

const KIND_LABEL = { paper: '论文', note: '笔记', mindmap: '导图', file: '文件' } as const

function itemIcon(kind: QuickItem['kind']): Icon {
  if (kind === 'note') return NoteIcon
  if (kind === 'mindmap') return ShareAndroidIcon
  return FileIcon
}

function paperItem(paper: Paper): QuickItem {
  const hint = [paper.authors.join('、'), paper.year, paper.topic, paper.path].filter(Boolean).join(' · ')
  return { id: `paper:${paper.id}`, kind: 'paper', title: paper.title, hint, href: paperHref(paper.id), recency: paper.addedAt }
}

function fileItem(node: VaultNode): QuickItem | null {
  if (node.kind === 'dir') return null
  const kind = node.kind === 'note' || node.kind === 'mindmap' ? node.kind : 'file'
  return { id: `file:${node.path}`, kind, title: displayName(baseName(node.path)), hint: node.path, href: fileHref(node.path), recency: node.mtimeMs }
}

function matches(item: QuickItem, terms: string[]): boolean {
  const haystack = `${item.title}\n${item.hint}`.toLowerCase()
  return terms.every((term) => haystack.includes(term))
}

function rank(item: QuickItem, terms: string[], query: string): number {
  const title = item.title.toLowerCase()
  if (title === query) return 0
  if (title.startsWith(query)) return 1
  if (terms.every((term) => title.includes(term))) return 2
  return 3
}

export function QuickOpen({ onClose }: { onClose: () => void }) {
  const openHref = useOpen()
  const { data: library } = useLibrary()
  const { data: tree } = useVaultTree()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const shortcut = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘P' : 'Ctrl+P'

  const flat = useMemo(() => {
    const paperPaths = new Set((library?.papers ?? []).map((paper) => paper.path))
    const papers = (library?.papers ?? []).map(paperItem)
    const files = flattenNodes(tree?.nodes ?? [])
      .filter((node) => !paperPaths.has(node.path))
      .map(fileItem)
      .filter((item): item is QuickItem => item !== null)
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const byRank = (items: QuickItem[]) => {
      if (!terms.length) return [...items].sort((a, b) => b.recency - a.recency).slice(0, 8)
      const needle = query.trim().toLowerCase()
      return items
        .filter((item) => matches(item, terms))
        .sort((a, b) => rank(a, terms, needle) - rank(b, terms, needle) || b.recency - a.recency)
    }
    return [...byRank(papers), ...byRank(files)].slice(0, 40)
  }, [library, tree, query])

  const current = flat.length ? Math.min(active, flat.length - 1) : 0
  const flatRef = useRef(flat)
  const currentRef = useRef(current)
  flatRef.current = flat
  currentRef.current = current

  useEffect(() => {
    setActive(0)
  }, [query])

  useEffect(() => {
    document.getElementById('quick-open-active')?.scrollIntoView({ block: 'nearest' })
  }, [current, flat])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter' && event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        setActive((index) => {
          const last = Math.max(0, flatRef.current.length - 1)
          const at = Math.min(index, last)
          return event.key === 'ArrowDown' ? Math.min(last, at + 1) : Math.max(0, at - 1)
        })
      } else if (event.key === 'Enter') {
        const item = flatRef.current[currentRef.current]
        if (!item) return
        openHref(item.href)
        onClose()
      } else {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, openHref])

  const choose = (item: QuickItem) => {
    openHref(item.href)
    onClose()
  }

  let position = 0
  const groups = [
    { title: '论文', items: flat.filter((item) => item.kind === 'paper') },
    { title: '文件', items: flat.filter((item) => item.kind !== 'paper') },
  ].filter((group) => group.items.length > 0)

  return (
    <Dialog
      title="快速打开"
      subtitle={`搜索论文和文件库 · ${shortcut}`}
      width="min(640px, calc(100vw - 24px))"
      align="top"
      onClose={onClose}
      initialFocusRef={inputRef}
    >
      <div className={styles.quickOpen}>
        <TextInput
          ref={inputRef}
          block
          leadingVisual={SearchIcon}
          placeholder="搜索论文标题、笔记、导图…"
          aria-label="搜索论文和文件"
          aria-controls="quick-open-list"
          aria-activedescendant={flat[current] ? 'quick-open-active' : undefined}
          aria-autocomplete="list"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {flat.length === 0 ? (
          <p className={styles.quickEmpty}>{query.trim() ? '没有匹配的论文或文件。' : '文件库还是空的。'}</p>
        ) : (
          <div className={styles.quickList} id="quick-open-list">
            <ActionList aria-label="搜索结果">
              {groups.map((group) => (
                <ActionList.Group key={group.title}>
                  <ActionList.GroupHeading as="h3">{query.trim() ? group.title : `最近的${group.title}`}</ActionList.GroupHeading>
                  {group.items.map((item) => {
                    const index = position
                    position += 1
                    const selected = index === current
                    const Icon = itemIcon(item.kind)
                    return (
                      <ActionList.Item
                        key={item.id}
                        id={selected ? 'quick-open-active' : undefined}
                        active={selected}
                        onMouseEnter={() => setActive(index)}
                        onSelect={() => choose(item)}
                      >
                        <ActionList.LeadingVisual>
                          <Icon />
                        </ActionList.LeadingVisual>
                        {item.title}
                        <ActionList.Description variant="block">{`${KIND_LABEL[item.kind]} · ${item.hint}`}</ActionList.Description>
                      </ActionList.Item>
                    )
                  })}
                </ActionList.Group>
              ))}
            </ActionList>
          </div>
        )}
        <p className={styles.quickHint}>↑↓ 选择，Enter 打开，Esc 关闭</p>
      </div>
    </Dialog>
  )
}
