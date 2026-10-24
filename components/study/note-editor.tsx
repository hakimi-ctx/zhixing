'use client'

import { useRef, useState } from 'react'
import { Button, SegmentedControl } from '@primer/react'
import { CommentDiscussionIcon, FileIcon, NoteIcon } from '@primer/octicons-react'
import { PageFrame } from '@/components/shell/page-frame'
import { Markdown } from '@/components/ui/markdown'
import { useLibrary } from '@/lib/client/hooks'
import { paperHref } from '@/lib/client/library'
import { useStatusItem } from '@/lib/client/status-bar'
import { useOpen, useTabs } from '@/lib/client/tabs'
import { useAutosave } from '@/lib/client/use-autosave'
import { askHref, baseName } from '@/lib/client/vault'
import { displayName } from '@/lib/shared/mindmap'
import type { VaultFile } from '@/lib/shared/types'
import { ConflictBanner, SaveIndicator } from './editor-parts'
import styles from './editor.module.css'

type ViewMode = 'edit' | 'split' | 'preview'

const MODES: { id: ViewMode; label: string }[] = [
  { id: 'edit', label: '编辑' },
  { id: 'split', label: '分栏' },
  { id: 'preview', label: '预览' },
]

const countChars = (text: string) => text.replace(/\s+/g, '').length

export function NoteEditor({ file }: { file: VaultFile }) {
  const openHref = useOpen()
  const tabs = useTabs()
  const { data: library } = useLibrary()
  const paper = library?.papers.find((item) => item.note === file.path)
  const [content, setContent] = useState(file.content)
  const contentRef = useRef(file.content)
  const [mode, setMode] = useState<ViewMode>('edit')
  const autosave = useAutosave(file.path, file.mtimeMs, () => contentRef.current)
  const name = displayName(baseName(file.path))
  useStatusItem('note-chars', `${countChars(content)} 字`)

  const update = (value: string) => {
    contentRef.current = value
    setContent(value)
    autosave.markDirty()
  }

  const takeDisk = () => {
    const disk = autosave.takeDisk()
    if (disk === null) return
    contentRef.current = disk
    setContent(disk)
  }

  const askTutor = async () => {
    await autosave.flush()
    tabs.openInNewTab(askHref(file.path))
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      void autosave.flush()
    }
  }

  return (
    <PageFrame
      title={name}
      leading={<NoteIcon />}
      body="fill"
      meta={<SaveIndicator status={autosave.status} error={autosave.error} />}
      actions={
        <>
          <SegmentedControl aria-label="显示方式" size="small" onChange={(index) => setMode(MODES[index].id)}>
            {MODES.map((item) => (
              <SegmentedControl.Button key={item.id} selected={mode === item.id}>
                {item.label}
              </SegmentedControl.Button>
            ))}
          </SegmentedControl>
          {paper ? (
            <Button size="small" leadingVisual={FileIcon} onClick={(event) => openHref(paperHref(paper.id), event)}>
              原文
            </Button>
          ) : null}
          <Button size="small" leadingVisual={CommentDiscussionIcon} onClick={() => void askTutor()}>
            问导师
          </Button>
        </>
      }
    >
      <div className={styles.editor}>
        {autosave.conflict ? (
          <ConflictBanner deleted={autosave.conflict.content === null} onKeepMine={() => void autosave.keepMine()} onTakeDisk={takeDisk} />
        ) : null}
        <div className={styles.noteBody} data-mode={mode}>
          {mode !== 'preview' ? (
            <textarea
              className={styles.noteInput}
              value={content}
              onChange={(event) => update(event.target.value)}
              onKeyDown={onKeyDown}
              aria-label={`编辑笔记：${name}`}
              placeholder="用 Markdown 写笔记，自动保存。"
            />
          ) : null}
          {mode !== 'edit' ? (
            <div className={styles.notePreview}>
              {content.trim() ? <Markdown>{content}</Markdown> : <p className={styles.muted}>还没有内容。</p>}
            </div>
          ) : null}
        </div>
      </div>
    </PageFrame>
  )
}
