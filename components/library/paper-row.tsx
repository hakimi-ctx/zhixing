'use client'

import { Button, Label, Spinner } from '@primer/react'
import { CommentDiscussionIcon, NoteIcon, ShareAndroidIcon } from '@primer/octicons-react'
import { paperHref, paperMeta, paperStatus, type PaperTone } from '@/lib/client/library'
import { TabLink } from '@/lib/client/tabs'
import type { Paper } from '@/lib/shared/types'
import { useLibraryActions } from './library-actions'
import { PaperMenuButton } from './paper-menu'
import styles from './library.module.css'

const TONE_VARIANT: Record<PaperTone, 'accent' | 'secondary' | 'danger'> = { busy: 'accent', muted: 'secondary', danger: 'danger' }

const MAX_LABELS = 6

export function PaperStatusLabel({ paper }: { paper: Paper }) {
  const status = paperStatus(paper)
  if (!status) return null
  return (
    <Label variant={TONE_VARIANT[status.tone]} className={styles.statusLabel}>
      {status.tone === 'busy' ? <Spinner size="small" srText={null} className={styles.statusSpinner} /> : null}
      {status.label}
    </Label>
  )
}

export function PaperRow({ paper }: { paper: Paper }) {
  const actions = useLibraryActions()
  const meta = paperMeta(paper)
  const labels = [...paper.tags, ...(paper.card?.keywords ?? []).filter((keyword) => !paper.tags.includes(keyword))].slice(0, MAX_LABELS)

  return (
    <li className={styles.paper}>
      <div className={styles.paperHead}>
        <TabLink href={paperHref(paper.id)} className={styles.paperTitle}>
          {paper.title}
        </TabLink>
        <PaperStatusLabel paper={paper} />
      </div>
      {meta ? <div className={styles.paperMeta}>{meta}</div> : null}
      {paper.card?.summary ? <p className={styles.paperSummary}>{paper.card.summary}</p> : null}
      {labels.length ? (
        <div className={styles.labels}>
          {labels.map((label) => (
            <Label key={label} variant={paper.tags.includes(label) ? 'accent' : 'secondary'}>
              {label}
            </Label>
          ))}
        </div>
      ) : null}
      <div className={styles.paperActions}>
        <Button size="small" leadingVisual={ShareAndroidIcon} onClick={(event) => void actions.openFile(paper, 'mindmap', event)}>
          思维导图
        </Button>
        <Button size="small" variant="invisible" leadingVisual={NoteIcon} onClick={(event) => void actions.openFile(paper, 'note', event)}>
          笔记
        </Button>
        <Button size="small" variant="invisible" leadingVisual={CommentDiscussionIcon} onClick={() => actions.ask(paper)}>
          问导师
        </Button>
        <span className={styles.paperActionsEnd}>
          <PaperMenuButton paper={paper} />
        </span>
      </div>
    </li>
  )
}
