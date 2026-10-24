'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { IconButton } from '@primer/react'
import {
  BookIcon,
  BriefcaseIcon,
  CommentDiscussionIcon,
  GearIcon,
  MortarBoardIcon,
  SidebarCollapseIcon,
  SidebarExpandIcon,
  UploadIcon,
  WorkflowIcon,
} from '@primer/octicons-react'
import { useUpload } from '@/components/library/upload-provider'
import { HOME_HREF, useOpen, useTabs } from '@/lib/client/tabs'
import type { AppMode } from '@/lib/shared/types'
import styles from './shell.module.css'

export type Section = 'study' | 'work' | 'settings'

interface RailProps {
  section: Section
  /** The mode whose sidebar is showing (settings keeps the last one). */
  mode: AppMode
  collapsed: boolean
  overlayOpen: boolean
  onToggleSidebar: () => void
}

/** Obsidian's ribbon: mode switch on top, Study's quick actions, settings at the bottom. */
export function Rail({ section, mode, collapsed, overlayOpen, onToggleSidebar }: RailProps) {
  const tabs = useTabs()
  const open = useOpen()
  const upload = useUpload()
  const pathname = usePathname() ?? ''

  return (
    <nav className={styles.rail} aria-label="功能栏">
      <div className={styles.brand} aria-hidden="true">
        知
      </div>
      <IconButton
        as={Link}
        href={tabs.ready ? tabs.activeHref : HOME_HREF}
        icon={MortarBoardIcon}
        aria-label="Study 学习"
        aria-current={section === 'study' ? 'page' : undefined}
        variant="invisible"
        tooltipDirection="e"
        className={styles.railItem}
      />
      <IconButton
        as={Link}
        href="/work"
        icon={BriefcaseIcon}
        aria-label="Work 工作"
        aria-current={section === 'work' ? 'page' : undefined}
        variant="invisible"
        tooltipDirection="e"
        className={styles.railItem}
      />
      {mode === 'study' ? (
        <>
          <div className={styles.railDivider} />
          <IconButton icon={BookIcon} aria-label="文库" variant="invisible" tooltipDirection="e" onClick={() => tabs.openInNewTab(HOME_HREF)} />
          <IconButton
            icon={WorkflowIcon}
            aria-label="关系图谱"
            aria-current={pathname === '/study/graph' ? 'page' : undefined}
            variant="invisible"
            tooltipDirection="e"
            className={styles.railItem}
            onClick={() => open('/study/graph')}
          />
          <IconButton
            icon={UploadIcon}
            aria-label={upload.busy ? '正在导入论文' : '导入论文'}
            variant="invisible"
            tooltipDirection="e"
            loading={upload.busy}
            onClick={upload.pick}
          />
          <IconButton
            icon={CommentDiscussionIcon}
            aria-label="问导师"
            variant="invisible"
            tooltipDirection="e"
            onClick={() => tabs.openInNewTab('/study/chat')}
          />
        </>
      ) : null}
      <div className={styles.railSpacer} />
      <IconButton
        as={Link}
        href="/settings"
        icon={GearIcon}
        aria-label="设置"
        aria-current={section === 'settings' ? 'page' : undefined}
        variant="invisible"
        tooltipDirection="e"
        className={styles.railItem}
      />
      <IconButton
        icon={collapsed && !overlayOpen ? SidebarExpandIcon : SidebarCollapseIcon}
        aria-label={overlayOpen || !collapsed ? '收起侧边栏' : '展开侧边栏'}
        aria-controls="app-sidebar"
        variant="invisible"
        tooltipDirection="e"
        onClick={onToggleSidebar}
      />
    </nav>
  )
}
