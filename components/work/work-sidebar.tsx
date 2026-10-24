'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ActionList, ActionMenu, Button, Flash, NavList, Spinner, useConfirm } from '@primer/react'
import { CheckCircleIcon, KebabHorizontalIcon, PlusIcon, StopIcon, TrashIcon, XCircleIcon } from '@primer/octicons-react'
import { ModeSwitcher } from '@/components/shell/mode-switcher'
import { SidebarEmpty, SidebarSection } from '@/components/shell/sidebar-section'
import styles from '@/components/shell/shell.module.css'
import { useNotice } from '@/components/ui/notices'
import { api, errorText } from '@/lib/client/api'
import { useWorkSessions } from '@/lib/client/hooks'
import type { WorkSessionSummary } from '@/lib/shared/types'

const PAGE = 30

function StatusVisual({ session }: { session: WorkSessionSummary }) {
  if (session.status === 'running') return <Spinner size="small" srText="运行中" />
  const [Icon, label, color] =
    session.status === 'done'
      ? [CheckCircleIcon, '已完成', 'var(--fgColor-success)']
      : session.status === 'failed'
        ? [XCircleIcon, '失败', 'var(--fgColor-danger)']
        : [StopIcon, '已停止', 'var(--fgColor-muted)']
  return (
    <span style={{ color, display: 'inline-flex' }}>
      <Icon aria-label={label} />
    </span>
  )
}

export function WorkSidebar() {
  const router = useRouter()
  const pathname = usePathname() ?? ''
  const match = pathname.match(/^\/work\/([^/]+)/)
  const currentId = match ? decodeURIComponent(match[1]) : null
  const { data, error, isLoading, mutate: refresh } = useWorkSessions()
  const notify = useNotice()
  const confirm = useConfirm()
  const [limit, setLimit] = useState(PAGE)
  const [menuFor, setMenuFor] = useState<WorkSessionSummary | null>(null)
  const anchorRef = useRef<HTMLElement | null>(null)

  const remove = async (session: WorkSessionSummary) => {
    const ok = await confirm({
      title: '删除这条任务记录？',
      content: `“${session.title}”的规划、子任务输出和执行记录都会被删除。执行器生成的工作目录不会被删除。`,
      confirmButtonContent: '删除',
      confirmButtonType: 'danger',
      cancelButtonContent: '取消',
    })
    if (!ok) return
    try {
      await api(`/api/work/sessions/${session.id}`, { method: 'DELETE' })
      if (session.id === currentId) router.push('/work')
      await refresh()
    } catch (err) {
      notify({ variant: 'danger', text: errorText(err) })
    }
  }

  const list = data ?? []

  return (
    <>
      <div className={styles.sidebarHeader}>
        <ModeSwitcher mode="work" />
      </div>
      <div className={styles.sidebarActions}>
        <Button as={Link} href="/work" block leadingVisual={PlusIcon}>
          新任务
        </Button>
      </div>
      <div className={styles.sidebarScroll}>
        <SidebarSection title="任务记录">
          {error ? (
            <Flash variant="danger">{errorText(error)}</Flash>
          ) : isLoading && !data ? (
            <SidebarEmpty>正在读取任务…</SidebarEmpty>
          ) : list.length === 0 ? (
            <SidebarEmpty>还没有任务。把一件事交给 AI 团队试试。</SidebarEmpty>
          ) : (
            <NavList aria-label="任务记录">
              {list.slice(0, limit).map((session) => (
                <NavList.Item
                  key={session.id}
                  as={Link}
                  href={`/work/${session.id}`}
                  aria-current={session.id === currentId ? 'page' : undefined}
                >
                  <NavList.LeadingVisual>
                    <StatusVisual session={session} />
                  </NavList.LeadingVisual>
                  {session.title}
                  <NavList.TrailingAction
                    label={`“${session.title}”的更多操作`}
                    icon={KebabHorizontalIcon}
                    onClick={(event: React.MouseEvent<HTMLElement>) => {
                      anchorRef.current = event.currentTarget
                      setMenuFor(session)
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
        </SidebarSection>
      </div>

      <ActionMenu open={menuFor !== null} onOpenChange={(open) => !open && setMenuFor(null)} anchorRef={anchorRef}>
        <ActionMenu.Overlay width="small">
          <ActionList>
            <ActionList.Item variant="danger" onSelect={() => menuFor && void remove(menuFor)}>
              <ActionList.LeadingVisual>
                <TrashIcon />
              </ActionList.LeadingVisual>
              删除记录
            </ActionList.Item>
          </ActionList>
        </ActionMenu.Overlay>
      </ActionMenu>
    </>
  )
}
