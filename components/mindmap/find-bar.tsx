'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { IconButton, TextInput } from '@primer/react'
import { ChevronDownIcon, ChevronUpIcon, SearchIcon, XIcon } from '@primer/octicons-react'
import type { MapController } from './controller'
import styles from './mindmap.module.css'

interface FindBarProps {
  controller: MapController
  version: number
  /** Changes every time Ctrl+F is pressed, to focus the field again. */
  focusSignal: number
  onResults: (ids: string[], current: string | null) => void
  onClose: () => void
}

export function FindBar({ controller, version, focusSignal, onResults, onClose }: FindBarProps) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  // `version` is part of the key so results follow edits made while the bar is open.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const matches = useMemo(() => controller.search(query), [controller, query, version])
  const position = matches.length ? Math.min(index, matches.length - 1) : -1
  const current = position >= 0 ? matches[position] : null

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusSignal])

  useEffect(() => {
    onResults(matches, current)
  }, [matches, current, onResults])

  const step = (delta: 1 | -1) => {
    if (!matches.length) return
    setIndex((value) => (Math.min(value, matches.length - 1) + delta + matches.length) % matches.length)
  }

  return (
    <div className={styles.findBar} role="search">
      <TextInput
        ref={inputRef}
        size="small"
        leadingVisual={SearchIcon}
        aria-label="在导图中查找"
        placeholder="查找主题、备注、标签"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setIndex(0)
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return
          if (event.key === 'Enter') {
            event.preventDefault()
            step(event.shiftKey ? -1 : 1)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
        }}
        trailingVisual={query.trim() ? <span className={styles.findCount}>{matches.length ? `${position + 1}/${matches.length}` : '0'}</span> : undefined}
        className={styles.findInput}
      />
      <IconButton icon={ChevronUpIcon} aria-label="上一个" size="small" variant="invisible" disabled={!matches.length} onClick={() => step(-1)} />
      <IconButton icon={ChevronDownIcon} aria-label="下一个" size="small" variant="invisible" disabled={!matches.length} onClick={() => step(1)} />
      <IconButton icon={XIcon} aria-label="关闭查找" size="small" variant="invisible" onClick={onClose} />
    </div>
  )
}
