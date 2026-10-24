'use client'

import { useId, useMemo } from 'react'
import Link from 'next/link'
import { Button, Flash, IconButton, Label, Spinner } from '@primer/react'
import { PencilIcon, SparkleFillIcon, SyncIcon } from '@primer/octicons-react'
import { paperHref, RELATION_LABEL } from '@/lib/client/library'
import { TabLink } from '@/lib/client/tabs'
import type { LibraryInsights, Paper, PaperCard } from '@/lib/shared/types'
import { useLibraryActions } from './library-actions'
import styles from './paper.module.css'

function Block({ title, icon, actions, children }: { title: string; icon?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode }) {
  const id = useId()
  return (
    <section className={styles.block} aria-labelledby={id}>
      <div className={styles.blockHeader}>
        <h2 id={id} className={styles.blockTitle}>
          {icon}
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  )
}

const CARD_FIELDS: { key: keyof Omit<PaperCard, 'summary' | 'keywords'>; label: string }[] = [
  { key: 'problem', label: '研究问题' },
  { key: 'method', label: '方法' },
  { key: 'findings', label: '主要发现' },
  { key: 'limitations', label: '局限' },
]

function CardBody({ paper }: { paper: Paper }) {
  const actions = useLibraryActions()
  const card = paper.card
  if (card) {
    return (
      <>
        {card.summary ? <p className={styles.summary}>{card.summary}</p> : null}
        {CARD_FIELDS.map(({ key, label }) =>
          card[key] ? (
            <div key={key} className={styles.cardItem}>
              <span className={styles.cardLabel}>{label}</span>
              <p className={styles.cardText}>{card[key]}</p>
            </div>
          ) : null,
        )}
        {card.keywords.length ? (
          <div className={styles.labels}>
            {card.keywords.map((keyword) => (
              <Label key={keyword} variant="secondary">
                {keyword}
              </Label>
            ))}
          </div>
        ) : null}
      </>
    )
  }
  if (paper.state === 'failed' || paper.aiState === 'failed') {
    return (
      <Flash variant="danger">
        <p>{paper.error || (paper.state === 'failed' ? '读取 PDF 失败。' : 'AI 建档失败。')}</p>
        <Button size="small" leadingVisual={SyncIcon} onClick={() => void actions.retry(paper)}>
          重试
        </Button>
      </Flash>
    )
  }
  if (paper.aiState === 'waiting') {
    return (
      <p className={styles.state}>
        接入 AI 后自动建档。
        <Button size="small" variant="invisible" as={Link} href="/settings">
          去设置
        </Button>
      </p>
    )
  }
  return (
    <p className={styles.state} role="status">
      <Spinner size="small" srText={null} />
      {paper.state === 'queued' ? '排队中…' : paper.state === 'extracting' ? '正在读取全文…' : 'AI 正在建档…'}
    </p>
  )
}

function Relations({ paper, insights, papers }: { paper: Paper; insights: LibraryInsights | null; papers: Paper[] }) {
  const related = useMemo(() => {
    const byId = new Map(papers.map((item) => [item.id, item]))
    return (insights?.relations ?? [])
      .filter((relation) => relation.from === paper.id || relation.to === paper.id)
      .map((relation) => ({ relation, other: byId.get(relation.from === paper.id ? relation.to : relation.from) }))
      .filter((item): item is { relation: typeof item.relation; other: Paper } => Boolean(item.other))
  }, [paper.id, insights, papers])

  if (!related.length) return null
  return (
    <Block title="相关论文">
      <ul className={styles.relations}>
        {related.map(({ relation, other }) => (
          <li key={`${relation.from}-${relation.to}-${relation.type}`} className={styles.relation}>
            <div className={styles.relationHead}>
              <Label variant="accent">{RELATION_LABEL[relation.type]}</Label>
              <TabLink href={paperHref(other.id)} className={styles.relationTitle}>
                {other.title}
              </TabLink>
            </div>
            {relation.note ? <p className={styles.relationNote}>{relation.note}</p> : null}
          </li>
        ))}
      </ul>
    </Block>
  )
}

interface PaperDetailsProps {
  paper: Paper
  insights: LibraryInsights | null
  papers: Paper[]
}

export function PaperDetails({ paper, insights, papers }: PaperDetailsProps) {
  const actions = useLibraryActions()
  const facts: { label: string; value: React.ReactNode }[] = []
  if (paper.authors.length) facts.push({ label: '作者', value: paper.authors.join('、') })
  if (paper.year) facts.push({ label: '年份', value: paper.year })
  if (paper.venue) facts.push({ label: '来源', value: paper.venue })
  if (paper.topic) facts.push({ label: '主题', value: paper.topic })
  if (paper.tags.length) {
    facts.push({
      label: '标签',
      value: (
        <span className={styles.labels}>
          {paper.tags.map((tag) => (
            <Label key={tag} variant="accent">
              {tag}
            </Label>
          ))}
        </span>
      ),
    })
  }
  if (paper.pages) facts.push({ label: '页数', value: paper.pages })

  return (
    <>
      <Block
        title="信息"
        actions={<IconButton icon={PencilIcon} aria-label="编辑论文信息" size="small" variant="invisible" onClick={() => actions.edit(paper)} />}
      >
        <p className={styles.fullTitle}>{paper.title}</p>
        {facts.length ? (
          <dl className={styles.facts}>
            {facts.map((fact) => (
              <div key={fact.label} className={styles.fact}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </Block>
      <Block title="AI 摘要" icon={<SparkleFillIcon className={styles.aiIcon} />}>
        <CardBody paper={paper} />
      </Block>
      <Relations paper={paper} insights={insights} papers={papers} />
    </>
  )
}
