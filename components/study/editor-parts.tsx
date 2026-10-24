'use client'

import { Banner, Spinner } from '@primer/react'
import { saveStatusText, type SaveStatus } from '@/lib/client/use-autosave'
import styles from './editor.module.css'

export function SaveIndicator({ status, error }: { status: SaveStatus; error: string | null }) {
  const problem = status === 'error' || status === 'conflict'
  return (
    <span className={problem ? `${styles.status} ${styles.statusError}` : styles.status} role="status">
      {status === 'saving' ? <Spinner size="small" srText={null} /> : null}
      {saveStatusText(status, error)}
    </span>
  )
}

interface ConflictBannerProps {
  deleted: boolean
  onKeepMine: () => void
  onTakeDisk: () => void
}

export function ConflictBanner({ deleted, onKeepMine, onTakeDisk }: ConflictBannerProps) {
  return (
    <div className={styles.banner}>
      <Banner
        variant="warning"
        title={deleted ? '这个文件在别处被删除了' : '这个文件在别处被修改了'}
        description={
          deleted
            ? '自动保存已暂停。可以把你正在编辑的内容重新保存成这个文件。'
            : '可能是在资源管理器或其他软件里改过。为了不覆盖别处的修改，自动保存已暂停，请选择保留哪个版本。'
        }
        primaryAction={<Banner.PrimaryAction onClick={onKeepMine}>{deleted ? '重新保存' : '保留我的版本'}</Banner.PrimaryAction>}
        secondaryAction={deleted ? undefined : <Banner.SecondaryAction onClick={onTakeDisk}>改用磁盘上的版本</Banner.SecondaryAction>}
      />
    </div>
  )
}
