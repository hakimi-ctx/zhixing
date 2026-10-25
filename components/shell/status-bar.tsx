'use client'

import Link from 'next/link'
import { Spinner } from '@primer/react'
import { AlertIcon, DotFillIcon } from '@primer/octicons-react'
import { providerReady } from '@/lib/client/config'
import { useConfig, useLibrary } from '@/lib/client/hooks'
import { useStatusItems } from '@/lib/client/status-bar'
import { TabLink } from '@/lib/client/tabs'
import { findSlot, providerLabel } from '@/lib/shared/providers'
import type { AppMode } from '@/lib/shared/types'
import styles from './shell.module.css'

function LibraryStatus() {
  const { data: library } = useLibrary()
  if (!library || library.error) return null
  return (
    <>
      {library.aiError ? (
        <TabLink href="/study" className={styles.statusLink} data-tone="danger" title={library.aiError}>
          <AlertIcon size={12} />
          建档已暂停
        </TabLink>
      ) : library.pending > 0 ? (
        <span className={styles.statusItem}>
          <Spinner size="small" srText={null} />
          建档 {library.pending}
        </span>
      ) : null}
      {library.organizing ? (
        <span className={styles.statusItem}>
          <Spinner size="small" srText={null} />
          AI 整理中
        </span>
      ) : null}
      <TabLink href="/study" className={styles.statusLink}>
        {library.papers.length} 篇论文
      </TabLink>
    </>
  )
}

export function StatusBar({ mode }: { mode: AppMode }) {
  const items = useStatusItems()
  const { data: config } = useConfig()
  const provider = config?.study.provider ?? ''
  const slot = findSlot(config?.providers, provider)
  const ready = providerReady(config, provider)
  const detail = slot ? (slot.connection === 'cli' ? slot.model || slot.command : slot.model) : ''

  return (
    <footer className={styles.statusBar} aria-label="状态栏">
      <div className={styles.statusGroup}>
        {Object.entries(items).map(([key, text]) => (
          <span key={key} className={styles.statusItem}>
            <span className={styles.statusText}>{text}</span>
          </span>
        ))}
      </div>
      <div className={styles.statusGroup}>
        {mode === 'study' ? <LibraryStatus /> : null}
        {config ? (
          <Link href="/settings" className={styles.statusLink} data-tone={ready ? undefined : 'attention'}>
            <DotFillIcon size={12} className={styles.statusDot} />
            <span className={styles.statusText}>
              {ready ? `${providerLabel(provider, config.providers)} · ${detail}` : 'AI 未连接'}
            </span>
          </Link>
        ) : null}
      </div>
    </footer>
  )
}
