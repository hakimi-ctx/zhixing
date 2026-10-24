'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ActionList, Button, Flash, SegmentedControl, Spinner, TextInput } from '@primer/react'
import {
  CopyIcon,
  DownloadIcon,
  FileIcon,
  LinkExternalIcon,
  NoteIcon,
  QuoteIcon,
  SearchIcon,
  ShareAndroidIcon,
  XIcon,
} from '@primer/octicons-react'
import { SidebarEmpty, SidebarPane } from '@/components/shell/sidebar-section'
import { api, errorText } from '@/lib/client/api'
import { useLiteratureSearch, useSearch } from '@/lib/client/hooks'
import { paperHref } from '@/lib/client/library'
import { useOpen } from '@/lib/client/tabs'
import { fileHref } from '@/lib/client/vault'
import type { LiteratureWork, SearchHit } from '@/lib/shared/types'
import styles from './sidebar.module.css'

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  const parts = useMemo(() => {
    if (!terms.length || !text) return [text]
    return text.split(new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi'))
  }, [text, terms])
  return <>{parts.map((part, index) => (index % 2 === 1 ? <mark key={index}>{part}</mark> : part))}</>
}

const hitHref = (hit: SearchHit) => (hit.kind === 'paper' && hit.paperId ? paperHref(hit.paperId, hit.page) : fileHref(hit.path))

function hitIcon(hit: SearchHit) {
  if (hit.kind === 'mindmap') return ShareAndroidIcon
  if (hit.kind === 'note') return NoteIcon
  return hit.page ? QuoteIcon : FileIcon
}

type SearchMode = 'local' | 'literature'

type YearPreset = { id: string; label: string; from: number | null; to: number | null }

function yearPresets(now: number): YearPreset[] {
  return [
    { id: '3', label: '近3年', from: now - 2, to: now },
    { id: '5', label: '近5年', from: now - 4, to: now },
    { id: '10', label: '近10年', from: now - 9, to: now },
    { id: 'all', label: '不限年份', from: null, to: null },
  ]
}

function LocalResults({ query, focusToken }: { query: string; focusToken: number }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const openHref = useOpen()
  const [text, setText] = useState(query)
  const [submitted, setSubmitted] = useState('')
  const { data, error, isValidating } = useSearch(submitted)

  useEffect(() => {
    const timer = window.setTimeout(() => setSubmitted(text), 250)
    return () => window.clearTimeout(timer)
  }, [text])

  useEffect(() => {
    if (!focusToken) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusToken])

  const terms = useMemo(() => (data?.query ?? '').toLowerCase().split(/\s+/).filter(Boolean), [data?.query])
  const groups = useMemo(() => {
    const hits = submitted.trim() ? (data?.hits ?? []) : []
    return [
      { title: '论文', hits: hits.filter((hit) => hit.kind === 'paper' && !hit.page) },
      { title: '原文', hits: hits.filter((hit) => hit.kind === 'paper' && hit.page) },
      { title: '笔记与导图', hits: hits.filter((hit) => hit.kind !== 'paper') },
    ].filter((group) => group.hits.length > 0)
  }, [data, submitted])

  const searching = Boolean(text.trim()) && (text !== submitted || isValidating)
  const total = groups.reduce((sum, group) => sum + group.hits.length, 0)

  return (
    <>
      <TextInput
        ref={inputRef}
        block
        size="small"
        leadingVisual={SearchIcon}
        placeholder="搜索本地论文全文和笔记"
        aria-label="搜索本地文库"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && text) {
            event.preventDefault()
            setText('')
          }
        }}
        trailingAction={text ? <TextInput.Action icon={XIcon} aria-label="清除搜索" onClick={() => setText('')} /> : undefined}
      />
      <div className={styles.searchStatus}>
        {searching ? '正在搜索本地文库…' : submitted.trim() && data ? `找到 ${total} 条` : '在已导入的论文、笔记和导图里查找'}
      </div>
      {error ? (
        <Flash variant="danger">{errorText(error)}</Flash>
      ) : !submitted.trim() ? null : data && !groups.length && !searching ? (
        <SidebarEmpty>没有找到“{submitted.trim()}”。</SidebarEmpty>
      ) : (
        <ActionList aria-label="本地搜索结果" showDividers={false}>
          {groups.map((group) => (
            <ActionList.Group key={group.title}>
              <ActionList.GroupHeading as="h3">{group.title}</ActionList.GroupHeading>
              {group.hits.map((hit, index) => {
                const Icon = hitIcon(hit)
                return (
                  <ActionList.Item key={`${hit.path}-${hit.page ?? 0}-${index}`} onSelect={(event) => openHref(hitHref(hit), event)}>
                    <ActionList.LeadingVisual>
                      <Icon />
                    </ActionList.LeadingVisual>
                    <Highlight text={hit.title} terms={terms} />
                    {hit.page ? (
                      <ActionList.TrailingVisual>
                        <span className={styles.page}>p.{hit.page}</span>
                      </ActionList.TrailingVisual>
                    ) : null}
                    {hit.snippet ? (
                      <ActionList.Description variant="block" className={styles.snippet}>
                        <Highlight text={hit.snippet} terms={terms} />
                      </ActionList.Description>
                    ) : null}
                  </ActionList.Item>
                )
              })}
            </ActionList.Group>
          ))}
        </ActionList>
      )}
    </>
  )
}

function LiteratureResults({ focusToken }: { focusToken: number }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const now = new Date().getFullYear()
  const presets = useMemo(() => yearPresets(now), [now])
  const [presetId, setPresetId] = useState('5')
  const preset = presets.find((item) => item.id === presetId) ?? presets[1]
  const [text, setText] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [page, setPage] = useState(1)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const { data, error, isValidating } = useLiteratureSearch(submitted, preset.from, preset.to, page)

  useEffect(() => {
    if (!focusToken) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusToken])

  const runSearch = () => {
    setPage(1)
    setSubmitted(text.trim())
    setFlash(null)
  }

  const terms = useMemo(() => submitted.toLowerCase().split(/\s+/).filter(Boolean), [submitted])
  const searching = Boolean(submitted) && isValidating
  const works = data?.works ?? []

  const copyCitation = async (work: LiteratureWork) => {
    const authors =
      work.authors.length === 0
        ? '佚名'
        : work.authors.length <= 3
          ? work.authors.join('、')
          : `${work.authors.slice(0, 3).join('、')} 等`
    const year = work.year ? String(work.year) : 'n.d.'
    const venue = work.venue ? `. ${work.venue}` : ''
    const doi = work.doi ? `. https://doi.org/${work.doi}` : work.url ? `. ${work.url}` : ''
    const text = `${authors}. ${work.title}${venue}, ${year}${doi}`
    try {
      await navigator.clipboard.writeText(text)
      setFlash('已复制引用')
    } catch {
      setFlash('复制失败，请手动选择文字')
    }
  }

  const saveReading = async (work: LiteratureWork) => {
    setBusyId(work.id)
    setFlash(null)
    try {
      const result = await api<{ path: string }>('/api/literature/save', { method: 'POST', body: work })
      setFlash(`已保存到文件库：${result.path}`)
    } catch (err) {
      setFlash(errorText(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <TextInput
        ref={inputRef}
        block
        size="small"
        leadingVisual={SearchIcon}
        placeholder="例如：数字制造 工匠精神；Bauhaus craft"
        aria-label="检索学术文献"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            runSearch()
          }
          if (event.key === 'Escape' && text) {
            event.preventDefault()
            setText('')
          }
        }}
        trailingAction={
          text ? (
            <TextInput.Action
              icon={XIcon}
              aria-label="清除"
              onClick={() => {
                setText('')
                setSubmitted('')
              }}
            />
          ) : undefined
        }
      />
      <div className={styles.yearRow} role="group" aria-label="年份范围">
        {presets.map((item) => (
          <Button
            key={item.id}
            size="small"
            className={styles.yearChip}
            variant={presetId === item.id ? 'primary' : 'default'}
            onClick={() => {
              setPresetId(item.id)
              if (submitted) {
                setPage(1)
                setSubmitted(text.trim() || submitted)
              }
            }}
          >
            {item.label}
          </Button>
        ))}
        <Button size="small" variant="primary" disabled={!text.trim()} loading={searching} onClick={runSearch}>
          检索
        </Button>
      </div>
      <div className={styles.searchStatus}>
        {!submitted
          ? '按主题检索近年公开学术文献（OpenAlex，含中英文）'
          : searching
            ? '正在检索文献库…'
            : data?.error
              ? data.error
              : `共约 ${data?.total ?? 0} 篇，当前第 ${data?.page ?? page} 页`}
      </div>
      {flash ? <Flash variant="success">{flash}</Flash> : null}
      {error ? <Flash variant="danger">{errorText(error)}</Flash> : null}
      {data?.error && submitted && !searching ? <Flash variant="danger">{data.error}</Flash> : null}
      {!submitted ? (
        <p className={styles.litHint}>
          输入研究主题后点「检索」。可直接打开 DOI / 开放获取 PDF，或把条目保存到文件库的「待读文献」文件夹，再下载 PDF 导入文库。
        </p>
      ) : !searching && works.length === 0 && !data?.error ? (
        <SidebarEmpty>没有找到相关文献，换个关键词或放宽年份试试。</SidebarEmpty>
      ) : (
        <div className={styles.litList} role="list" aria-label="文献检索结果">
          {works.map((work) => (
            <article key={work.id} className={styles.litCard} role="listitem">
              <h3 className={styles.litTitle}>
                <Highlight text={work.title} terms={terms} />
              </h3>
              <div className={styles.litMeta}>
                <span>
                  {work.authors.slice(0, 4).join('、') || '作者未知'}
                  {work.authors.length > 4 ? ' 等' : ''}
                </span>
                <span>{work.year ?? '年份未知'}</span>
                {work.venue ? <span>{work.venue}</span> : null}
                <span>被引 {work.citedBy}</span>
              </div>
              {work.abstract ? (
                <p className={styles.snippet}>
                  <Highlight text={work.abstract} terms={terms} />
                </p>
              ) : null}
              <div className={styles.litActions}>
                {work.url ? (
                  <Button size="small" leadingVisual={LinkExternalIcon} onClick={() => window.open(work.url!, '_blank', 'noopener,noreferrer')}>
                    打开
                  </Button>
                ) : null}
                {work.oaUrl ? (
                  <Button size="small" leadingVisual={DownloadIcon} onClick={() => window.open(work.oaUrl!, '_blank', 'noopener,noreferrer')}>
                    PDF
                  </Button>
                ) : null}
                <Button size="small" leadingVisual={CopyIcon} onClick={() => void copyCitation(work)}>
                  复制引用
                </Button>
                <Button size="small" leadingVisual={NoteIcon} loading={busyId === work.id} onClick={() => void saveReading(work)}>
                  存到待读
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      {submitted && (data?.total ?? 0) > (data?.perPage ?? 20) ? (
        <div className={styles.pager}>
          <Button size="small" disabled={page <= 1 || searching} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            上一页
          </Button>
          <span>
            第 {page} 页
          </span>
          <Button
            size="small"
            disabled={searching || works.length < (data?.perPage ?? 20)}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </Button>
        </div>
      ) : null}
    </>
  )
}

/** Local vault search + online literature discovery for Study mode. */
export function SearchPane({ focusToken }: { focusToken: number }) {
  const [mode, setMode] = useState<SearchMode>('literature')

  return (
    <SidebarPane
      title="搜索"
      actions={mode === 'literature' ? undefined : undefined}
      toolbar={
        <div className={styles.modeBar}>
          <SegmentedControl
            aria-label="搜索范围"
            size="small"
            fullWidth
            onChange={(index) => setMode(index === 0 ? 'local' : 'literature')}
          >
            <SegmentedControl.Button selected={mode === 'local'}>本地文库</SegmentedControl.Button>
            <SegmentedControl.Button selected={mode === 'literature'}>找文献</SegmentedControl.Button>
          </SegmentedControl>
        </div>
      }
    >
      {mode === 'local' ? <LocalResults query="" focusToken={focusToken} /> : <LiteratureResults focusToken={focusToken} />}
    </SidebarPane>
  )
}
