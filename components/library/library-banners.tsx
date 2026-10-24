'use client'

import Link from 'next/link'
import { Banner } from '@primer/react'
import type { LibraryState } from '@/lib/shared/types'
import { useLibraryActions } from './library-actions'
import styles from './library.module.css'

/** Only states the student can act on: a missing connection, a paused queue, failures. */
export function LibraryBanners({ library }: { library: LibraryState }) {
  const actions = useLibraryActions()
  const failed = library.papers.filter((paper) => paper.state === 'failed' || paper.aiState === 'failed').length
  const waiting = library.papers.some((paper) => paper.aiState === 'waiting')

  const banners: React.ReactNode[] = []
  if (library.error) {
    banners.push(
      <Banner
        key="error"
        variant="critical"
        title="文库打不开"
        description={library.error}
        primaryAction={
          <Banner.PrimaryAction as={Link} href="/settings">
            去设置
          </Banner.PrimaryAction>
        }
      />,
    )
  }
  if (library.aiError) {
    banners.push(
      <Banner
        key="paused"
        variant="critical"
        title="建档已暂停"
        description={library.aiError}
        primaryAction={<Banner.PrimaryAction onClick={() => void actions.retryFailed()}>重试</Banner.PrimaryAction>}
        secondaryAction={
          <Banner.SecondaryAction as={Link} href="/settings">
            去设置
          </Banner.SecondaryAction>
        }
      />,
    )
  } else if (!library.aiReady && waiting) {
    banners.push(
      <Banner
        key="offline"
        variant="warning"
        title="AI 未接入"
        description="论文已保存，接入中转站后会自动建档。"
        primaryAction={
          <Banner.PrimaryAction as={Link} href="/settings">
            去设置
          </Banner.PrimaryAction>
        }
      />,
    )
  }
  if (library.organizeError) {
    banners.push(
      <Banner
        key="organize"
        variant="warning"
        title="AI 整理失败"
        description={library.organizeError}
        primaryAction={<Banner.PrimaryAction onClick={() => void actions.organize()}>重试</Banner.PrimaryAction>}
      />,
    )
  }
  if (failed > 0 && !library.aiError) {
    banners.push(
      <Banner
        key="failed"
        variant="warning"
        title={`${failed} 篇论文建档失败`}
        description="可能是扫描版 PDF 或网络中断。"
        primaryAction={<Banner.PrimaryAction onClick={() => void actions.retryFailed()}>全部重试</Banner.PrimaryAction>}
      />,
    )
  }
  if (!banners.length) return null
  return <div className={styles.banners}>{banners}</div>
}
