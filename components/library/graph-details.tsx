'use client'

import { Button } from '@primer/react'
import { CommentDiscussionIcon, FileIcon, NoteIcon, ShareAndroidIcon } from '@primer/octicons-react'
import { LINK_STYLE, topicColor, type GraphLayout, type GraphNode } from '@/lib/client/graph'
import { paperMeta, RELATION_LABEL } from '@/lib/client/library'
import type { RelationType } from '@/lib/shared/types'
import { useLibraryActions } from './library-actions'
import styles from './graph.module.css'

const RELATION_ORDER: RelationType[] = ['extends', 'compares', 'contradicts', 'method', 'data', 'related']

interface GraphDetailsProps {
  layout: GraphLayout
  node: GraphNode | null
  onSelect: (node: GraphNode) => void
}

function Swatch({ color }: { color: string }) {
  return <span className={styles.swatch} style={{ background: color }} aria-hidden="true" />
}

function LinkSample({ type }: { type: keyof typeof LINK_STYLE }) {
  const style = LINK_STYLE[type]
  return (
    <svg width="28" height="8" aria-hidden="true" className={styles.linkSample}>
      <line x1="1" y1="4" x2="27" y2="4" stroke={style.color} strokeWidth="2" strokeDasharray={style.dash} />
    </svg>
  )
}

function Legend({ layout }: { layout: GraphLayout }) {
  const counts = new Map<string, number>()
  for (const node of layout.nodes) if (node.kind === 'paper') counts.set(node.topic, (counts.get(node.topic) ?? 0) + 1)
  const used = new Set(layout.links.map((link) => link.type))

  return (
    <div className={styles.detailsBody}>
      <section aria-labelledby="graph-topics">
        <h2 id="graph-topics" className={styles.sectionTitle}>
          主题
        </h2>
        <ul className={styles.legendList}>
          {layout.topics
            .filter((topic) => counts.has(topic))
            .map((topic) => (
              <li key={topic} className={styles.legendItem}>
                <Swatch color={topicColor(layout.topics, topic)} />
                <span className={styles.legendText}>{topic}</span>
                <span className={styles.count}>{counts.get(topic)}</span>
              </li>
            ))}
        </ul>
      </section>
      {RELATION_ORDER.some((type) => used.has(type)) ? (
        <section aria-labelledby="graph-relations">
          <h2 id="graph-relations" className={styles.sectionTitle}>
            关系
          </h2>
          <ul className={styles.legendList}>
            {RELATION_ORDER.filter((type) => used.has(type)).map((type) => (
              <li key={type} className={styles.legendItem}>
                <LinkSample type={type} />
                <span className={styles.legendText}>{RELATION_LABEL[type]}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className={styles.hint}>单击选中查看关系，双击或按 Enter 打开。滚轮缩放，拖动空白处平移。</p>
    </div>
  )
}

export function GraphDetails({ layout, node, onSelect }: GraphDetailsProps) {
  const actions = useLibraryActions()

  if (!node) {
    return (
      <aside className={styles.details} aria-label="图例">
        <Legend layout={layout} />
      </aside>
    )
  }

  const { paper } = node
  const byId = new Map(layout.nodes.map((item) => [item.id, item]))
  const relations = layout.links
    .filter((link) => link.type !== 'file' && (link.source === paper.id || link.target === paper.id))
    .map((link) => ({ link, other: byId.get(link.source === paper.id ? link.target : link.source) }))
    .filter((entry): entry is { link: typeof entry.link; other: GraphNode } => Boolean(entry.other))

  return (
    <aside className={styles.details} aria-label="论文详情">
      <div className={styles.detailsBody}>
        <div className={styles.topicLine}>
          <Swatch color={topicColor(layout.topics, node.topic)} />
          <span>{node.topic}</span>
        </div>
        <h2 className={styles.paperTitle}>{paper.title}</h2>
        {node.kind !== 'paper' ? <p className={styles.hint}>{node.kind === 'mindmap' ? '这篇论文的思维导图' : '这篇论文的笔记'}</p> : null}
        {paperMeta(paper) ? <p className={styles.paperMeta}>{paperMeta(paper)}</p> : null}
        {paper.card?.summary ? <p className={styles.summary}>{paper.card.summary}</p> : null}
        <div className={styles.actionGrid}>
          <Button size="small" variant="primary" leadingVisual={FileIcon} onClick={(event) => actions.open(paper, event)}>
            打开论文
          </Button>
          <Button size="small" leadingVisual={ShareAndroidIcon} onClick={(event) => void actions.openFile(paper, 'mindmap', event)}>
            {paper.mindmap ? '导图' : '建导图'}
          </Button>
          <Button size="small" leadingVisual={NoteIcon} onClick={(event) => void actions.openFile(paper, 'note', event)}>
            {paper.note ? '笔记' : '建笔记'}
          </Button>
          <Button size="small" leadingVisual={CommentDiscussionIcon} onClick={() => actions.ask(paper)}>
            问导师
          </Button>
        </div>
        <section aria-labelledby="graph-paper-relations">
          <h3 id="graph-paper-relations" className={styles.sectionTitle}>
            {`关系 · ${relations.length}`}
          </h3>
          {relations.length ? (
            <ul className={styles.relationList}>
              {relations.map(({ link, other }) => (
                <li key={link.id} className={styles.relation}>
                  <div className={styles.relationHead}>
                    <LinkSample type={link.type} />
                    <span className={styles.relationType}>{RELATION_LABEL[link.type as RelationType]}</span>
                  </div>
                  <button type="button" className={styles.relationTarget} onClick={() => onSelect(other)}>
                    {other.label}
                  </button>
                  {link.note ? <p className={styles.relationNote}>{link.note}</p> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.hint}>AI 整理时没有找到这篇和其他论文的直接关系。</p>
          )}
        </section>
      </div>
    </aside>
  )
}
