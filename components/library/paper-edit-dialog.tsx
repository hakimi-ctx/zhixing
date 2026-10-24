'use client'

import { useRef, useState } from 'react'
import { Dialog, FormControl, Stack, TextInput } from '@primer/react'
import { errorText } from '@/lib/client/api'
import { splitList, type PaperPatch } from '@/lib/client/library'
import type { Paper } from '@/lib/shared/types'
import styles from './library.module.css'

interface PaperEditDialogProps {
  paper: Paper
  onSubmit: (patch: PaperPatch) => Promise<void>
  onClose: () => void
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((item, index) => item === b[index])

/** Fields saved here are marked as edited by hand, so cataloguing never overwrites them. */
export function PaperEditDialog({ paper, onSubmit, onClose }: PaperEditDialogProps) {
  const [title, setTitle] = useState(paper.title)
  const [authors, setAuthors] = useState(paper.authors.join('，'))
  const [year, setYear] = useState(paper.year ? String(paper.year) : '')
  const [venue, setVenue] = useState(paper.venue)
  const [tags, setTags] = useState(paper.tags.join('，'))
  const [yearError, setYearError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  const submit = async () => {
    const trimmedYear = year.trim()
    const parsedYear = trimmedYear ? Number(trimmedYear) : null
    if (parsedYear !== null && (!Number.isInteger(parsedYear) || parsedYear < 1800 || parsedYear > 2200)) {
      setYearError('请填写四位数年份，比如 2024。')
      return
    }
    const patch: PaperPatch = {}
    if (title.trim() !== paper.title) patch.title = title.trim()
    const authorList = splitList(authors)
    if (!sameList(authorList, paper.authors)) patch.authors = authorList
    if (parsedYear !== paper.year) patch.year = parsedYear
    if (venue.trim() !== paper.venue) patch.venue = venue.trim()
    const tagList = splitList(tags)
    if (!sameList(tagList, paper.tags)) patch.tags = tagList
    if (!Object.keys(patch).length) {
      onClose()
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSubmit(patch)
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  const onEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229) return
    event.preventDefault()
    void submit()
  }

  return (
    <Dialog
      title="编辑论文信息"
      width="medium"
      onClose={() => {
        if (!busy) onClose()
      }}
      initialFocusRef={titleRef}
      footerButtons={[
        { buttonType: 'default', content: '取消', onClick: onClose, disabled: busy },
        { buttonType: 'primary', content: '保存', onClick: () => void submit(), loading: busy },
      ]}
    >
      <Stack gap="normal">
        <FormControl>
          <FormControl.Label>标题</FormControl.Label>
          <TextInput ref={titleRef} block value={title} maxLength={400} onChange={(event) => setTitle(event.target.value)} onKeyDown={onEnter} />
        </FormControl>
        <FormControl>
          <FormControl.Label>作者</FormControl.Label>
          <TextInput block value={authors} onChange={(event) => setAuthors(event.target.value)} onKeyDown={onEnter} />
          <FormControl.Caption>用逗号分隔</FormControl.Caption>
        </FormControl>
        <Stack direction="horizontal" gap="normal" wrap="wrap">
          <FormControl>
            <FormControl.Label>年份</FormControl.Label>
            <TextInput
              value={year}
              inputMode="numeric"
              maxLength={4}
              validationStatus={yearError ? 'error' : undefined}
              onChange={(event) => {
                setYear(event.target.value)
                if (yearError) setYearError(null)
              }}
              onKeyDown={onEnter}
            />
            {yearError ? <FormControl.Validation variant="error">{yearError}</FormControl.Validation> : null}
          </FormControl>
          <div className={styles.grow}>
            <FormControl>
              <FormControl.Label>期刊 / 会议</FormControl.Label>
              <TextInput block value={venue} maxLength={200} onChange={(event) => setVenue(event.target.value)} onKeyDown={onEnter} />
            </FormControl>
          </div>
        </Stack>
        <FormControl>
          <FormControl.Label>标签</FormControl.Label>
          <TextInput block value={tags} onChange={(event) => setTags(event.target.value)} onKeyDown={onEnter} />
          {error ? <FormControl.Validation variant="error">{error}</FormControl.Validation> : <FormControl.Caption>用逗号分隔</FormControl.Caption>}
        </FormControl>
      </Stack>
    </Dialog>
  )
}
