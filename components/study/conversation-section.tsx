'use client'

import { useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { ActionList, ActionMenu, Button, Flash, IconButton, NavList, Spinner, useConfirm } from '@primer/react'
import { KebabHorizontalIcon, PencilIcon, PlusIcon, TrashIcon } from '@primer/octicons-react'
import { mutate } from 'swr'
import { SidebarEmpty, SidebarPane } from '@/components/shell/sidebar-section'
import { useNotice } from '@/components/ui/notices'
import { api, errorText } from '@/lib/client/api'
import { isRunActive, useChatRuns } from '@/lib/client/chat-store'
import { KEYS, useConversations } from '@/lib/client/hooks'
import { TabLink, useOpen, useTabs } from '@/lib/client/tabs'
import type { ConversationSummary } from '@/lib/shared/types'
import { NameDialog } from './vault-dialogs'

const PAGE = 30

export function ChatsPane() {
  const pathname = usePathname() ?? ''
  const currentId = pathname.startsWith('/study/chat/') ? decodeURIComponent(pathname.split('/')[3] ?? '') : null
  const { data, error, isLoading, mutate: refresh } = useConversations()
  const runs = useChatRuns()
  const openHref = useOpen()
  const tabs = useTabs()
  const notify = useNotice()
  const confirm = useConfirm()
  const [limit, setLimit] = useState(PAGE)
  const [menuFor, setMenuFor] = useState<ConversationSummary | null>(null)
  const [renaming, setRenaming] = useState<ConversationSummary | null>(null)
  const anchorRef = useRef<HTMLElement | null>(null)

  const running = new Set(runs.filter(isRunActive).map((run) => run.conversationId))

  const remove = async (conversation: ConversationSummary) => {
    const ok = await confirm({
      title: '删除这个对话？',
      content: `“${conversation.title}”的全部消息会被删除，无法恢复。`,
      confirmButtonContent: '删除',
      confirmButtonType: 'danger',
      cancelButtonContent: '取消',
    })
    if (!ok) return
    try {
      await api(`/api/study/conversations/${conversation.id}`, { method: 'DELETE' })
      tabs.closeWhere((href) => href === `/study/chat/${conversation.id}`)
      await refresh()
    } catch (err) {
      notify({ variant: 'danger', text: errorText(err) })
    }
  }

  const rename = async (conversation: ConversationSummary, title: string) => {
    await api(`/api/study/conversations/${conversation.id}`, { method: 'PATCH', body: { title } })
    setRenaming(null)
    await refresh()
    void mutate(KEYS.conversation(conversation.id))
  }

  const list = data ?? []

  return (
    <SidebarPane
      title="对话"
      meta={list.length || undefined}
      actions={
        <IconButton
          icon={PlusIcon}
          aria-label="新对话"
          size="small"
          variant="invisible"
          onClick={(event: React.MouseEvent<HTMLButtonElement>) => openHref('/study/chat', event)}
        />
      }
    >
      {error ? (
        <Flash variant="danger">{errorText(error)}</Flash>
      ) : isLoading && !data ? (
        <SidebarEmpty>正在读取对话…</SidebarEmpty>
      ) : list.length === 0 ? (
        <SidebarEmpty>还没有对话。</SidebarEmpty>
      ) : (
        <NavList aria-label="对话">
          {list.slice(0, limit).map((conversation) => (
            <NavList.Item
              key={conversation.id}
              as={TabLink}
              href={`/study/chat/${conversation.id}`}
              aria-current={conversation.id === currentId ? 'page' : undefined}
            >
              {conversation.title}
              {running.has(conversation.id) ? (
                <NavList.TrailingVisual>
                  <Spinner size="small" srText="导师正在回答" />
                </NavList.TrailingVisual>
              ) : null}
              <NavList.TrailingAction
                label={`“${conversation.title}”的更多操作`}
                icon={KebabHorizontalIcon}
                onClick={(event: React.MouseEvent<HTMLElement>) => {
                  anchorRef.current = event.currentTarget
                  setMenuFor(conversation)
                }}
              />
            </NavList.Item>
          ))}
        </NavList>
      )}
      {list.length > limit ? (
        <Button variant="invisible" size="small" onClick={() => setLimit((value) => value + PAGE)}>
          显示更多
        </Button>
      ) : null}

      <ActionMenu open={menuFor !== null} onOpenChange={(open) => !open && setMenuFor(null)} anchorRef={anchorRef}>
        <ActionMenu.Overlay width="small">
          <ActionList>
            <ActionList.Item onSelect={() => menuFor && setRenaming(menuFor)}>
              <ActionList.LeadingVisual>
                <PencilIcon />
              </ActionList.LeadingVisual>
              重命名
            </ActionList.Item>
            <ActionList.Item variant="danger" onSelect={() => menuFor && void remove(menuFor)}>
              <ActionList.LeadingVisual>
                <TrashIcon />
              </ActionList.LeadingVisual>
              删除
            </ActionList.Item>
          </ActionList>
        </ActionMenu.Overlay>
      </ActionMenu>

      {renaming ? (
        <NameDialog
          title="重命名对话"
          label="标题"
          initialValue={renaming.title}
          confirmLabel="保存"
          onSubmit={(title) => rename(renaming, title)}
          onClose={() => setRenaming(null)}
        />
      ) : null}
    </SidebarPane>
  )
}
