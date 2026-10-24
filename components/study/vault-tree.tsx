'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { ActionList, ActionMenu, Flash, IconButton, Spinner, TreeView, useConfirm } from '@primer/react'
import {
  CommentDiscussionIcon,
  FileDirectoryIcon,
  FileIcon,
  LinkExternalIcon,
  MoveToEndIcon,
  NoteIcon,
  PencilIcon,
  PlusIcon,
  ShareAndroidIcon,
  SyncIcon,
  TrashIcon,
} from '@primer/octicons-react'
import { mutate } from 'swr'
import { SidebarEmpty, SidebarPane } from '@/components/shell/sidebar-section'
import { useNotice } from '@/components/ui/notices'
import { api, errorText } from '@/lib/client/api'
import { domId } from '@/lib/client/dom-id'
import { flushEditorsWithin } from '@/lib/client/editor-registry'
import { KEYS, useLibrary, useSystem, useVaultTree } from '@/lib/client/hooks'
import { paperHref, paperIdOf } from '@/lib/client/library'
import { useOpen, useTabs, type ModifierEvent } from '@/lib/client/tabs'
import {
  askHref,
  fileHref,
  filePathOf,
  flattenNodes,
  isWithin,
  remapFileHref,
  remapPath,
  vaultApi,
  type EntryKind,
} from '@/lib/client/vault'
import { displayName } from '@/lib/shared/mindmap'
import type { LibraryState, VaultNode } from '@/lib/shared/types'
import { MoveDialog, NameDialog } from './vault-dialogs'

const EXPANDED_KEY = 'zhixing.vaultExpanded'

const itemId = (path: string) => domId('vault', path)

function ancestorsOf(path: string): string[] {
  const parts = path.split('/')
  const result: string[] = []
  for (let index = 1; index < parts.length; index++) result.push(parts.slice(0, index).join('/'))
  return result
}

const KIND_LABEL: Record<EntryKind, string> = { dir: '文件夹', note: '笔记', mindmap: '思维导图' }

type DialogState =
  | { type: 'create'; parent: string; kind: EntryKind }
  | { type: 'rename'; node: VaultNode }
  | { type: 'move'; node: VaultNode }

type MenuTarget = { node: VaultNode } | { root: true }

/** Obsidian's file explorer: every folder and file in the vault, including the PDFs of the library. */
export function FilesPane() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentFile = pathname === '/study/file' ? (searchParams?.get('path') ?? null) : null
  const currentPaper = paperIdOf(pathname ?? '')
  const { data: tree, error, isLoading, mutate: refreshTree, isValidating } = useVaultTree()
  const { data: library } = useLibrary()
  const { data: system } = useSystem()
  const openHref = useOpen()
  const tabs = useTabs()
  const notify = useNotice()
  const confirm = useConfirm()
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [menu, setMenu] = useState<MenuTarget | null>(null)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const anchorRef = useRef<HTMLElement | null>(null)
  const rootMenuButtonRef = useRef<HTMLButtonElement>(null)
  const canReveal = Boolean(system?.canOpenFolder)

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(EXPANDED_KEY) ?? '[]') as unknown
      if (Array.isArray(saved)) setExpanded(new Set(saved.filter((item): item is string => typeof item === 'string')))
    } catch {
      // ignore a corrupt preference
    }
  }, [])

  const updateExpanded = useCallback((update: (current: Set<string>) => Set<string>) => {
    setExpanded((current) => {
      const next = update(current)
      window.localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next].slice(0, 500)))
      return next
    })
  }, [])

  const paperByPath = useMemo(() => new Map((library?.papers ?? []).map((paper) => [paper.path, paper])), [library])
  const currentPaperPath = currentPaper ? library?.papers.find((paper) => paper.id === currentPaper)?.path : undefined
  const revealed = currentFile ?? currentPaperPath ?? null

  useEffect(() => {
    if (!revealed) return
    const ancestors = ancestorsOf(revealed)
    if (!ancestors.length) return
    updateExpanded((current) => (ancestors.every((dir) => current.has(dir)) ? current : new Set([...current, ...ancestors])))
  }, [revealed, updateExpanded])

  const nodes = useMemo(() => tree?.nodes ?? [], [tree])
  const flat = useMemo(() => flattenNodes(nodes), [nodes])
  const byId = useMemo(() => new Map(flat.map((node) => [itemId(node.path), node])), [flat])
  const directories = useMemo(() => flat.filter((node) => node.kind === 'dir'), [flat])

  const nodeAt = (event: React.MouseEvent) => {
    const item = (event.target as HTMLElement).closest('[role="treeitem"]')
    const node = item ? byId.get(item.id) : undefined
    return node && item ? { node, item: item as HTMLElement } : null
  }

  const openMenuFor = (node: VaultNode, anchor?: HTMLElement | null) => {
    anchorRef.current = anchor ?? document.getElementById(itemId(node.path))
    setMenu({ node })
  }

  const openRootMenu = () => {
    anchorRef.current = rootMenuButtonRef.current
    setMenu({ root: true })
  }

  const reveal = async (path: string) => {
    try {
      await vaultApi.reveal(path)
    } catch (err) {
      notify({ variant: 'danger', text: errorText(err) })
    }
  }

  /** A PDF opens as its paper; one copied in from Explorer may need a fresh scan to be found. */
  const openPdf = async (node: VaultNode, event?: ModifierEvent | null, newTab?: boolean) => {
    let paper = paperByPath.get(node.path)
    if (!paper) {
      try {
        const fresh = await api<LibraryState>(`${KEYS.library}?sync=1`)
        void mutate(KEYS.library, fresh, { revalidate: false })
        paper = fresh.papers.find((item) => item.path === node.path)
      } catch (err) {
        notify({ variant: 'danger', text: errorText(err) })
        return
      }
    }
    if (paper) openHref(paperHref(paper.id), event, { newTab })
    else notify({ variant: 'warning', text: '这个 PDF 还没进文库，可能是文件损坏或超过 200 MB。' })
  }

  const openNode = (node: VaultNode, event?: ModifierEvent | null, newTab?: boolean) => {
    if (Date.now() < suppressOpenUntil.current) return
    if (node.kind === 'note' || node.kind === 'mindmap') {
      openHref(fileHref(node.path), event, { newTab })
      return
    }
    if (node.kind === 'pdf') {
      void openPdf(node, event, newTab)
      return
    }
    if (node.kind === 'other') {
      if (canReveal) void reveal(node.path)
      else notify({ text: '知行暂时不能打开这种文件。', variant: 'warning' })
    }
  }

  const create = async (parent: string, kind: EntryKind, name: string) => {
    const { path } = await vaultApi.create(parent, name, kind)
    setDialog(null)
    const toExpand = parent ? [...ancestorsOf(parent), parent] : []
    if (kind === 'dir') toExpand.push(path)
    if (toExpand.length) updateExpanded((current) => new Set([...current, ...toExpand]))
    await refreshTree()
    if (kind !== 'dir') openHref(fileHref(path))
  }

  const relocate = async (node: VaultNode, action: () => Promise<{ path: string }>) => {
    await flushEditorsWithin(node.path)
    const { path } = await action()
    setDialog(null)
    if (path === node.path) return
    updateExpanded((current) => {
      const next = new Set<string>()
      for (const dir of current) next.add(remapPath(dir, node.path, path) ?? dir)
      for (const dir of ancestorsOf(path)) next.add(dir)
      return next
    })
    tabs.rewrite((href) => remapFileHref(href, node.path, path))
    await Promise.all([refreshTree(), mutate(KEYS.library)])
  }

  const trash = async (node: VaultNode) => {
    const isDir = node.kind === 'dir'
    const ok = await confirm({
      title: `删除“${displayName(node.name)}”？`,
      content: `${isDir ? '这个文件夹和里面的所有内容' : '这个文件'}会移到文件库的 .trash 文件夹，需要时可以找回。`,
      confirmButtonContent: '删除',
      confirmButtonType: 'danger',
      cancelButtonContent: '取消',
    })
    if (!ok) return
    const papersInside = new Set((library?.papers ?? []).filter((paper) => isWithin(paper.path, node.path)).map((paper) => paper.id))
    try {
      await flushEditorsWithin(node.path)
      await vaultApi.trash(node.path)
      tabs.closeWhere((href) => {
        const file = filePathOf(href)
        if (file !== null) return isWithin(file, node.path)
        const paperId = paperIdOf(href)
        return paperId !== null && papersInside.has(paperId)
      })
      notify({ variant: 'success', text: `已删除“${displayName(node.name)}”。` })
    } catch (err) {
      notify({ variant: 'danger', text: errorText(err) })
    }
    await Promise.all([refreshTree(), mutate(KEYS.library)])
  }

  /** A drag ends with a click on some browsers; don't open the item that was just moved. */
  const suppressOpenUntil = useRef(0)

  const dropOnRef = useRef<(from: string, toDir: string) => void>(() => undefined)
  dropOnRef.current = (from, toDir) => {
    const node = flat.find((item) => item.path === from)
    if (!node || node.path === toDir) return
    const parent = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : ''
    if (parent === toDir) return
    if (node.kind === 'dir' && (toDir === node.path || toDir.startsWith(`${node.path}/`))) {
      notify({ variant: 'warning', text: '不能把文件夹移动到它自己里面。' })
      return
    }
    void relocate(node, () => vaultApi.move(node.path, toDir))
      .then(() => notify({ variant: 'success', text: `已移动“${displayName(node.name)}”。` }))
      .catch((err) => notify({ variant: 'danger', text: errorText(err) }))
  }

  const bindRow = (node: VaultNode) => (element: HTMLElement | null) => {
    if (!element || element.dataset.zhixingDrag === '1') return
    element.dataset.zhixingDrag = '1'
    element.draggable = true
    const clearMark = () => {
      delete element.dataset.dropTarget
      element.style.outline = ''
      element.style.outlineOffset = ''
    }
    element.addEventListener('dragstart', (event) => {
      suppressOpenUntil.current = Date.now() + 700
      event.stopPropagation()
      event.dataTransfer?.setData('text/plain', `zhixing:${node.path}`)
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
    })
    element.addEventListener('dragover', (event) => {
      const rawTypes = event.dataTransfer?.types
      if (!rawTypes || ![...rawTypes].includes('text/plain')) return
      event.preventDefault()
      event.stopPropagation()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      element.dataset.dropTarget = '1'
      element.style.outline = '2px solid var(--borderColor-accent-emphasis)'
      element.style.outlineOffset = '-2px'
    })
    element.addEventListener('dragleave', clearMark)
    element.addEventListener('drop', (event) => {
      const raw = event.dataTransfer?.getData('text/plain') ?? ''
      if (!raw.startsWith('zhixing:')) return
      event.preventDefault()
      event.stopPropagation()
      clearMark()
      const toDir = node.kind === 'dir' ? node.path : node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : ''
      dropOnRef.current(raw.slice('zhixing:'.length), toDir)
    })
    element.addEventListener('dragend', clearMark)
  }

  const renderNode = (node: VaultNode): React.ReactNode => {
    const id = itemId(node.path)
    if (node.kind === 'dir') {
      return (
        <TreeView.Item
          key={node.path}
          id={id}
          ref={bindRow(node)}
          expanded={expanded.has(node.path)}
          onExpandedChange={(open) =>
            updateExpanded((current) => {
              const next = new Set(current)
              if (open) next.add(node.path)
              else next.delete(node.path)
              return next
            })
          }
        >
          <TreeView.LeadingVisual>
            <TreeView.DirectoryIcon />
          </TreeView.LeadingVisual>
          {node.name}
          {node.children && node.children.length > 0 ? <TreeView.SubTree>{node.children.map(renderNode)}</TreeView.SubTree> : null}
        </TreeView.Item>
      )
    }
    const Icon = node.kind === 'mindmap' ? ShareAndroidIcon : node.kind === 'note' ? NoteIcon : FileIcon
    const paper = node.kind === 'pdf' ? paperByPath.get(node.path) : undefined
    const current = node.path === currentFile || (paper !== undefined && paper.id === currentPaper)
    return (
      <TreeView.Item key={node.path} id={id} ref={bindRow(node)} current={current} onSelect={(event) => openNode(node, event)}>
        <TreeView.LeadingVisual>
          <Icon />
        </TreeView.LeadingVisual>
        {node.kind === 'other' || node.kind === 'pdf' ? node.name : displayName(node.name)}
      </TreeView.Item>
    )
  }

  const createItems = (parent: string) => (
    <>
      <ActionList.Item onSelect={() => setDialog({ type: 'create', parent, kind: 'note' })}>
        <ActionList.LeadingVisual>
          <NoteIcon />
        </ActionList.LeadingVisual>
        新建笔记
      </ActionList.Item>
      <ActionList.Item onSelect={() => setDialog({ type: 'create', parent, kind: 'mindmap' })}>
        <ActionList.LeadingVisual>
          <ShareAndroidIcon />
        </ActionList.LeadingVisual>
        新建思维导图
      </ActionList.Item>
      <ActionList.Item onSelect={() => setDialog({ type: 'create', parent, kind: 'dir' })}>
        <ActionList.LeadingVisual>
          <FileDirectoryIcon />
        </ActionList.LeadingVisual>
        新建文件夹
      </ActionList.Item>
    </>
  )

  const menuNode = menu && 'node' in menu ? menu.node : null
  const askable = menuNode && (menuNode.kind === 'note' || menuNode.kind === 'mindmap' || menuNode.kind === 'pdf')

  return (
    <SidebarPane
      title="文件"
      actions={
        <>
          {isValidating && tree ? <Spinner size="small" srText="正在同步文件库" /> : null}
          <IconButton ref={rootMenuButtonRef} icon={PlusIcon} aria-label="新建" variant="invisible" size="small" onClick={openRootMenu} />
        </>
      }
    >
      {error ? (
        <Flash variant="danger">{errorText(error)}</Flash>
      ) : tree?.error ? (
        <Flash variant="danger">{tree.error}</Flash>
      ) : isLoading && !tree ? (
        <SidebarEmpty>正在读取文件库…</SidebarEmpty>
      ) : nodes.length === 0 ? (
        <SidebarEmpty>文件库是空的。</SidebarEmpty>
      ) : (
        <div
          onDragOver={(event) => {
            if (![...event.dataTransfer.types].includes('text/plain')) return
            event.preventDefault()
          }}
          onDrop={(event) => {
            const raw = event.dataTransfer.getData('text/plain')
            if (!raw.startsWith('zhixing:')) return
            event.preventDefault()
            dropOnRef.current(raw.slice('zhixing:'.length), '')
          }}
          onContextMenu={(event) => {
            const hit = nodeAt(event)
            if (!hit) return
            event.preventDefault()
            openMenuFor(hit.node, hit.item)
          }}
          onMouseDown={(event) => {
            if (event.button === 1) event.preventDefault()
          }}
          onAuxClick={(event) => {
            if (event.button !== 1) return
            const hit = nodeAt(event)
            if (!hit || hit.node.kind === 'dir' || hit.node.kind === 'other') return
            event.preventDefault()
            openNode(hit.node, null, true)
          }}
        >
          <TreeView aria-label="文件">{nodes.map(renderNode)}</TreeView>
        </div>
      )}
      {tree?.truncated ? <SidebarEmpty>文件太多，只显示了前 3000 项。</SidebarEmpty> : null}

      <ActionMenu open={menu !== null} onOpenChange={(open) => !open && setMenu(null)} anchorRef={anchorRef}>
        <ActionMenu.Overlay width="small">
          <ActionList>
            {menu && 'root' in menu ? (
              <>
                {createItems('')}
                <ActionList.Divider />
                {canReveal ? (
                  <ActionList.Item onSelect={() => void reveal('')}>
                    <ActionList.LeadingVisual>
                      <LinkExternalIcon />
                    </ActionList.LeadingVisual>
                    在资源管理器中打开
                  </ActionList.Item>
                ) : null}
                <ActionList.Item onSelect={() => void refreshTree()}>
                  <ActionList.LeadingVisual>
                    <SyncIcon />
                  </ActionList.LeadingVisual>
                  刷新
                </ActionList.Item>
              </>
            ) : menuNode ? (
              <>
                {menuNode.kind === 'dir' ? (
                  <>
                    {createItems(menuNode.path)}
                    <ActionList.Divider />
                  </>
                ) : null}
                {menuNode.kind !== 'dir' && menuNode.kind !== 'other' ? (
                  <ActionList.Item onSelect={() => openNode(menuNode, null, true)}>在新标签页打开</ActionList.Item>
                ) : null}
                {askable ? (
                  <>
                    <ActionList.Item onSelect={() => tabs.openInNewTab(askHref(menuNode.path))}>
                      <ActionList.LeadingVisual>
                        <CommentDiscussionIcon />
                      </ActionList.LeadingVisual>
                      问导师
                    </ActionList.Item>
                    <ActionList.Divider />
                  </>
                ) : null}
                <ActionList.Item onSelect={() => setDialog({ type: 'rename', node: menuNode })}>
                  <ActionList.LeadingVisual>
                    <PencilIcon />
                  </ActionList.LeadingVisual>
                  重命名
                </ActionList.Item>
                <ActionList.Item onSelect={() => setDialog({ type: 'move', node: menuNode })}>
                  <ActionList.LeadingVisual>
                    <MoveToEndIcon />
                  </ActionList.LeadingVisual>
                  移动到…
                </ActionList.Item>
                {canReveal ? (
                  <ActionList.Item onSelect={() => void reveal(menuNode.path)}>
                    <ActionList.LeadingVisual>
                      <LinkExternalIcon />
                    </ActionList.LeadingVisual>
                    在资源管理器中显示
                  </ActionList.Item>
                ) : null}
                <ActionList.Divider />
                <ActionList.Item variant="danger" onSelect={() => void trash(menuNode)}>
                  <ActionList.LeadingVisual>
                    <TrashIcon />
                  </ActionList.LeadingVisual>
                  删除
                </ActionList.Item>
              </>
            ) : null}
          </ActionList>
        </ActionMenu.Overlay>
      </ActionMenu>

      {dialog?.type === 'create' ? (
        <NameDialog
          title={`新建${KIND_LABEL[dialog.kind]}`}
          label="名称"
          initialValue={dialog.kind === 'dir' ? '新建文件夹' : dialog.kind === 'note' ? '未命名笔记' : '未命名导图'}
          confirmLabel="创建"
          caption={dialog.parent ? `位置：文件库/${dialog.parent}` : '位置：文件库最外层'}
          onSubmit={(name) => create(dialog.parent, dialog.kind, name)}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.type === 'rename' ? (
        <NameDialog
          title="重命名"
          label="新名称"
          initialValue={
            dialog.node.kind === 'other'
              ? dialog.node.name
              : dialog.node.kind === 'pdf'
                ? dialog.node.name.replace(/\.pdf$/i, '')
                : displayName(dialog.node.name)
          }
          confirmLabel="重命名"
          caption={dialog.node.kind === 'dir' || dialog.node.kind === 'other' ? undefined : '扩展名会自动保留。'}
          onSubmit={(name) => relocate(dialog.node, () => vaultApi.rename(dialog.node.path, name))}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.type === 'move' ? (
        <MoveDialog
          node={dialog.node}
          directories={directories}
          onSubmit={(toDir) => relocate(dialog.node, () => vaultApi.move(dialog.node.path, toDir))}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </SidebarPane>
  )
}
