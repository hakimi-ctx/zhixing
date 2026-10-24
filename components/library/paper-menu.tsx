'use client'

import { ActionList, ActionMenu, IconButton } from '@primer/react'
import {
  CommentDiscussionIcon,
  KebabHorizontalIcon,
  LinkExternalIcon,
  NoteIcon,
  PencilIcon,
  ShareAndroidIcon,
  SyncIcon,
  TrashIcon,
} from '@primer/octicons-react'
import { useSystem } from '@/lib/client/hooks'
import { isPaperBusy } from '@/lib/client/library'
import type { Paper } from '@/lib/shared/types'
import { useLibraryActions } from './library-actions'

interface PaperMenuItemsProps {
  paper: Paper
  /** Off on the paper's own page, where opening it again makes no sense. */
  showOpen?: boolean
}

export function PaperMenuItems({ paper, showOpen = true }: PaperMenuItemsProps) {
  const actions = useLibraryActions()
  const { data: system } = useSystem()
  return (
    <ActionList>
      {showOpen ? (
        <>
          <ActionList.Item onSelect={() => actions.open(paper, null, { newTab: true })}>在新标签页打开</ActionList.Item>
          <ActionList.Divider />
        </>
      ) : null}
      <ActionList.Item onSelect={() => void actions.openFile(paper, 'mindmap')}>
        <ActionList.LeadingVisual>
          <ShareAndroidIcon />
        </ActionList.LeadingVisual>
        思维导图
      </ActionList.Item>
      <ActionList.Item onSelect={() => void actions.openFile(paper, 'note')}>
        <ActionList.LeadingVisual>
          <NoteIcon />
        </ActionList.LeadingVisual>
        笔记
      </ActionList.Item>
      <ActionList.Item onSelect={() => actions.ask(paper)}>
        <ActionList.LeadingVisual>
          <CommentDiscussionIcon />
        </ActionList.LeadingVisual>
        问导师
      </ActionList.Item>
      <ActionList.Divider />
      <ActionList.Item onSelect={() => actions.edit(paper)}>
        <ActionList.LeadingVisual>
          <PencilIcon />
        </ActionList.LeadingVisual>
        编辑信息
      </ActionList.Item>
      <ActionList.Item disabled={isPaperBusy(paper) || paper.state === 'queued'} onSelect={() => void actions.retry(paper)}>
        <ActionList.LeadingVisual>
          <SyncIcon />
        </ActionList.LeadingVisual>
        重新建档
      </ActionList.Item>
      {system?.canOpenFolder ? (
        <ActionList.Item onSelect={() => void actions.reveal(paper)}>
          <ActionList.LeadingVisual>
            <LinkExternalIcon />
          </ActionList.LeadingVisual>
          在资源管理器中显示
        </ActionList.Item>
      ) : null}
      <ActionList.Divider />
      <ActionList.Item variant="danger" onSelect={() => void actions.remove(paper)}>
        <ActionList.LeadingVisual>
          <TrashIcon />
        </ActionList.LeadingVisual>
        从文库删除
      </ActionList.Item>
    </ActionList>
  )
}

export function PaperMenuButton({ paper, showOpen, size = 'small' }: PaperMenuItemsProps & { size?: 'small' | 'medium' }) {
  return (
    <ActionMenu>
      <ActionMenu.Anchor>
        <IconButton icon={KebabHorizontalIcon} aria-label={`《${paper.title}》的更多操作`} size={size} variant="invisible" />
      </ActionMenu.Anchor>
      <ActionMenu.Overlay width="small" align="end">
        <PaperMenuItems paper={paper} showOpen={showOpen} />
      </ActionMenu.Overlay>
    </ActionMenu>
  )
}
