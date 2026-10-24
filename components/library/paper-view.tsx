'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button, IconButton, Spinner } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { CommentDiscussionIcon, FileIcon, NoteIcon, ShareAndroidIcon, SidebarCollapseIcon, SidebarExpandIcon } from '@primer/octicons-react'
import { PageFrame } from '@/components/shell/page-frame'
import { useLibrary } from '@/lib/client/hooks'
import { useStatusItem } from '@/lib/client/status-bar'
import { TabLink } from '@/lib/client/tabs'
import { useLibraryActions } from './library-actions'
import { PaperDetails } from './paper-details'
import { PaperMenuButton } from './paper-menu'
import { PaperStatusLabel } from './paper-row'
import styles from './paper.module.css'

const PANEL_KEY = 'zhixing.paperPanel'

function usePanelPreference(): [boolean, () => void] {
  const [open, setOpen] = useState(true)
  useEffect(() => {
    setOpen(window.localStorage.getItem(PANEL_KEY) !== '0')
  }, [])
  const toggle = useCallback(() => {
    setOpen((current) => {
      window.localStorage.setItem(PANEL_KEY, current ? '0' : '1')
      return !current
    })
  }, [])
  return [open, toggle]
}

export function PaperView({ id, page }: { id: string; page: number | null }) {
  const { data: library } = useLibrary()
  const actions = useLibraryActions()
  const [panelOpen, togglePanel] = usePanelPreference()
  const paper = library?.papers.find((item) => item.id === id)
  useStatusItem('paper-pages', paper?.pages ? `${paper.pages} 页` : null)

  if (!library) {
    return (
      <PageFrame title="论文" leading={<FileIcon />}>
        <div className={styles.center}>
          <Spinner srText="正在打开论文" />
        </div>
      </PageFrame>
    )
  }

  if (!paper) {
    return (
      <PageFrame title="论文" leading={<FileIcon />}>
        <div className={styles.missing}>
          <Blankslate border>
            <Blankslate.Visual>
              <FileIcon size="medium" />
            </Blankslate.Visual>
            <Blankslate.Heading>文库里没有这篇论文</Blankslate.Heading>
            <Blankslate.Description>它可能已被删除，或 PDF 被移出了文件库。</Blankslate.Description>
            <Button as={TabLink} href="/study">
              回到文库
            </Button>
          </Blankslate>
        </div>
      </PageFrame>
    )
  }

  return (
    <PageFrame
      title={paper.title}
      leading={<FileIcon />}
      meta={<PaperStatusLabel paper={paper} />}
      body="fill"
      actions={
        <>
          <Button variant="primary" leadingVisual={ShareAndroidIcon} onClick={(event) => void actions.openFile(paper, 'mindmap', event)}>
            思维导图
          </Button>
          <Button leadingVisual={NoteIcon} onClick={(event) => void actions.openFile(paper, 'note', event)}>
            笔记
          </Button>
          <Button leadingVisual={CommentDiscussionIcon} onClick={() => actions.ask(paper)}>
            问导师
          </Button>
          <PaperMenuButton paper={paper} showOpen={false} size="medium" />
          <IconButton
            icon={panelOpen ? SidebarExpandIcon : SidebarCollapseIcon}
            aria-label={panelOpen ? '隐藏论文信息' : '显示论文信息'}
            aria-pressed={panelOpen}
            aria-controls="paper-panel"
            variant="invisible"
            className={styles.panelToggle}
            onClick={togglePanel}
          />
        </>
      }
    >
      <div className={styles.split}>
        <div className={styles.viewer}>
          <iframe
            key={`${paper.id}-${page ?? 1}`}
            className={styles.pdf}
            src={`/api/library/papers/${paper.id}/pdf#page=${page ?? 1}`}
            title={`${paper.title}（PDF）`}
          />
        </div>
        {panelOpen ? (
          <aside id="paper-panel" className={styles.panel} aria-label="论文信息">
            <PaperDetails paper={paper} insights={library.insights} papers={library.papers} />
          </aside>
        ) : null}
      </div>
    </PageFrame>
  )
}
