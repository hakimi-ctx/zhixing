'use client'

import { useState } from 'react'
import { Button, Flash, Spinner } from '@primer/react'
import { FileIcon } from '@primer/octicons-react'
import useSWR from 'swr'
import { PageFrame } from '@/components/shell/page-frame'
import { errorText } from '@/lib/client/api'
import { TabLink } from '@/lib/client/tabs'
import { baseName, vaultApi } from '@/lib/client/vault'
import { displayName } from '@/lib/shared/mindmap'
import type { VaultFile } from '@/lib/shared/types'
import { MindmapEditor } from '@/components/mindmap/mindmap-editor'
import { NoteEditor } from './note-editor'
import styles from './editor.module.css'

/**
 * Each mount fetches the file fresh (the stamp is part of the SWR key), so an editor never
 * starts from cached content that may have changed on disk in the meantime.
 */
export function FileView({ path }: { path: string | null }) {
  const [stamp] = useState(() => Date.now())
  const { data, error } = useSWR<VaultFile>(path ? ['vault-file', path, stamp] : null, ([, target]: [string, string]) => vaultApi.read(target), {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    shouldRetryOnError: false,
  })

  if (!path) {
    return (
      <PageFrame title="文件">
        <div className={styles.message}>
          <p className={styles.muted}>从左侧选择一篇笔记或思维导图。</p>
        </div>
      </PageFrame>
    )
  }

  const title = displayName(baseName(path))
  if (error) {
    return (
      <PageFrame title={title} leading={<FileIcon />}>
        <div className={styles.message}>
          <Flash variant="danger">{errorText(error)}</Flash>
          <Button as={TabLink} href="/study">
            回到文库
          </Button>
        </div>
      </PageFrame>
    )
  }
  if (!data) {
    return (
      <PageFrame title={title} leading={<FileIcon />}>
        <div className={styles.center}>
          <Spinner srText="正在打开文件" />
        </div>
      </PageFrame>
    )
  }
  if (data.kind === 'mindmap') return <MindmapEditor file={data} />
  if (data.kind === 'note') return <NoteEditor file={data} />
  return (
    <PageFrame title={title} leading={<FileIcon />}>
      <div className={styles.message}>
        <p className={styles.muted}>这个文件不是笔记或思维导图，知行不能直接编辑。可以在文件库里右键它，在资源管理器中打开。</p>
      </div>
    </PageFrame>
  )
}
