'use client'

import { useMemo, useState } from 'react'
import { ActionList, ActionMenu, Button, Flash, Spinner, TextInput, Token } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { BookIcon, SearchIcon, SortDescIcon, SparkleFillIcon, UploadIcon, WorkflowIcon, XIcon } from '@primer/octicons-react'
import { PageFrame } from '@/components/shell/page-frame'
import { errorText } from '@/lib/client/api'
import { useLibrary } from '@/lib/client/hooks'
import { useOpen } from '@/lib/client/tabs'
import {
  canOrganize,
  groupByTopic,
  paperMatches,
  sortPapers,
  unorganizedCount,
  UNSORTED_TOPIC,
  type PaperSort,
} from '@/lib/client/library'
import type { LibraryState, Paper } from '@/lib/shared/types'
import { useLibraryActions } from './library-actions'
import { LibraryBanners } from './library-banners'
import { LibraryOverview } from './library-overview'
import { PaperRow } from './paper-row'
import { useUpload } from './upload-provider'
import styles from './library.module.css'

const SORT_LABEL: Record<PaperSort, string> = { added: '最近导入', year: '年份', title: '标题' }

function PaperList({ papers }: { papers: Paper[] }) {
  return (
    <ul className={styles.list}>
      {papers.map((paper) => (
        <PaperRow key={paper.id} paper={paper} />
      ))}
    </ul>
  )
}

function OrganizeButton({ library }: { library: LibraryState }) {
  const actions = useLibraryActions()
  if (!canOrganize(library.papers)) return null
  const fresh = library.insights ? unorganizedCount(library.papers, library.insights) : 0
  return (
    <Button
      leadingVisual={SparkleFillIcon}
      loading={library.organizing}
      disabled={!library.aiReady}
      count={fresh || undefined}
      onClick={() => void actions.organize()}
    >
      {library.organizing ? '整理中' : 'AI 整理'}
    </Button>
  )
}

function EmptyLibrary() {
  const upload = useUpload()
  return (
    <Blankslate border spacious>
      <Blankslate.Visual>
        <BookIcon size="medium" />
      </Blankslate.Visual>
      <Blankslate.Heading>文库还是空的</Blankslate.Heading>
      <Blankslate.Description>把读过的论文 PDF 拖到这里，AI 会读完并建档。</Blankslate.Description>
      <Blankslate.PrimaryAction onClick={upload.pick}>导入论文</Blankslate.PrimaryAction>
    </Blankslate>
  )
}

export function LibraryView() {
  const { data: library, error } = useLibrary()
  const upload = useUpload()
  const open = useOpen()
  const [filter, setFilter] = useState('')
  const [topic, setTopic] = useState<string | null>(null)
  const [sort, setSort] = useState<PaperSort>('added')

  const papers = useMemo(() => sortPapers(library?.papers ?? [], sort), [library, sort])
  const insights = library?.insights ?? null
  const groups = useMemo(() => groupByTopic(papers, insights), [papers, insights])
  const activeTopic = topic && groups?.some((group) => group.name === topic) ? topic : null
  const query = filter.trim()
  const filtered = useMemo(() => {
    const pool = activeTopic ? (groups?.find((group) => group.name === activeTopic)?.papers ?? []) : papers
    return pool.filter((paper) => paperMatches(paper, query))
  }, [activeTopic, groups, papers, query])

  let body: React.ReactNode
  if (error && !library) {
    body = <Flash variant="danger">{errorText(error)}</Flash>
  } else if (!library) {
    body = (
      <div className={styles.center}>
        <Spinner srText="正在读取文库" />
      </div>
    )
  } else if (!library.papers.length) {
    body = (
      <>
        <LibraryBanners library={library} />
        {library.error ? null : <EmptyLibrary />}
      </>
    )
  } else {
    const showGroups = groups && !activeTopic && !query
    body = (
      <>
        <LibraryBanners library={library} />
        {insights ? <LibraryOverview insights={insights} papers={library.papers} newCount={unorganizedCount(library.papers, insights)} /> : null}
        <div className={styles.toolbar}>
          <div className={styles.toolbarRow}>
            <TextInput
              className={styles.filter}
              leadingVisual={SearchIcon}
              placeholder="筛选标题、作者、关键词"
              aria-label="筛选论文"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              trailingAction={
                filter ? <TextInput.Action icon={XIcon} aria-label="清除筛选" onClick={() => setFilter('')} /> : undefined
              }
            />
            <ActionMenu>
              <ActionMenu.Button leadingVisual={SortDescIcon}>{SORT_LABEL[sort]}</ActionMenu.Button>
              <ActionMenu.Overlay width="small" align="end">
                <ActionList selectionVariant="single" aria-label="排序">
                  {(Object.keys(SORT_LABEL) as PaperSort[]).map((key) => (
                    <ActionList.Item key={key} selected={key === sort} onSelect={() => setSort(key)}>
                      {SORT_LABEL[key]}
                    </ActionList.Item>
                  ))}
                </ActionList>
              </ActionMenu.Overlay>
            </ActionMenu>
          </div>
          {groups ? (
            <div className={styles.topics} role="group" aria-label="按主题筛选">
              <Token as="button" text={`全部 ${papers.length}`} isSelected={!activeTopic} onClick={() => setTopic(null)} />
              {groups.map((group) => (
                <Token
                  key={group.name}
                  as="button"
                  text={`${group.name} ${group.papers.length}`}
                  isSelected={activeTopic === group.name}
                  onClick={() => setTopic(activeTopic === group.name ? null : group.name)}
                />
              ))}
            </div>
          ) : null}
        </div>
        {showGroups ? (
          <div className={styles.groups}>
            {groups.map((group) => (
              <section key={group.name} className={styles.group} aria-label={group.name}>
                <div className={styles.groupHeader}>
                  <h2 className={styles.groupTitle}>
                    {group.name}
                    <span className={styles.paperMeta}>{group.papers.length}</span>
                  </h2>
                  {group.description && group.name !== UNSORTED_TOPIC ? <p className={styles.groupDescription}>{group.description}</p> : null}
                </div>
                <PaperList papers={group.papers} />
              </section>
            ))}
          </div>
        ) : filtered.length ? (
          <PaperList papers={filtered} />
        ) : (
          <p className={styles.empty}>没有匹配的论文。</p>
        )}
      </>
    )
  }

  return (
    <PageFrame
      title="文库"
      leading={<BookIcon />}
      meta={library?.papers.length ? `${library.papers.length} 篇` : undefined}
      actions={
        <>
          <Button leadingVisual={WorkflowIcon} onClick={() => open('/study/graph')}>
            关系图谱
          </Button>
          {library ? <OrganizeButton library={library} /> : null}
          <Button variant="primary" leadingVisual={UploadIcon} loading={upload.busy} onClick={upload.pick}>
            导入论文
          </Button>
        </>
      }
    >
      <div className={styles.page}>{body}</div>
    </PageFrame>
  )
}
