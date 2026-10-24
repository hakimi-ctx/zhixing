'use client'

import { useId, useMemo, useState } from 'react'
import { Button, Label } from '@primer/react'
import { ChevronDownIcon, ChevronUpIcon, SparkleFillIcon } from '@primer/octicons-react'
import { Markdown } from '@/components/ui/markdown'
import { relativeTime } from '@/lib/client/format'
import { linkOverview } from '@/lib/client/library'
import type { LibraryInsights, Paper } from '@/lib/shared/types'
import styles from './library.module.css'

const CLAMP_CHARS = 320

interface LibraryOverviewProps {
  insights: LibraryInsights
  papers: Paper[]
  /** Catalogued papers the overview has not seen yet. */
  newCount: number
}

export function LibraryOverview({ insights, papers, newCount }: LibraryOverviewProps) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const text = useMemo(() => linkOverview(insights, papers), [insights, papers])
  const long = text.length > CLAMP_CHARS

  return (
    <section className={styles.overview} aria-labelledby={id}>
      <div className={styles.overviewHeader}>
        <h2 id={id} className={styles.overviewTitle}>
          <SparkleFillIcon className={styles.overviewIcon} />
          AI 综述
        </h2>
        <span className={styles.overviewMeta}>
          {insights.paperIds.length} 篇 · {relativeTime(insights.at)}
        </span>
        {newCount > 0 ? <Label variant="attention">{newCount} 篇新论文未整理</Label> : null}
      </div>
      <div className={styles.overviewBody} data-clamped={long && !open} id={`${id}-body`}>
        <Markdown>{text}</Markdown>
      </div>
      {long ? (
        <div className={styles.overviewFooter}>
          <Button
            size="small"
            variant="invisible"
            trailingVisual={open ? ChevronUpIcon : ChevronDownIcon}
            aria-expanded={open}
            aria-controls={`${id}-body`}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? '收起' : '展开全文'}
          </Button>
        </div>
      ) : null}
    </section>
  )
}
