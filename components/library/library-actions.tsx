'use client'

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { useConfirm } from '@primer/react'
import { mutate } from 'swr'
import { useNotice } from '@/components/ui/notices'
import { api, errorText } from '@/lib/client/api'
import { KEYS } from '@/lib/client/hooks'
import { libraryApi, paperHref, paperIdOf, type PaperPatch } from '@/lib/client/library'
import { useOpen, useTabs, type ModifierEvent } from '@/lib/client/tabs'
import { askHref, fileHref, vaultApi } from '@/lib/client/vault'
import type { LibraryState, Paper } from '@/lib/shared/types'
import { PaperEditDialog } from './paper-edit-dialog'

export type PaperFileKind = 'mindmap' | 'note'

export interface LibraryActions {
  open: (paper: Paper, event?: ModifierEvent | null, options?: { newTab?: boolean; page?: number | null }) => void
  /** Opens the paper's own mind map or note, creating it next to the PDF the first time. */
  openFile: (paper: Paper, kind: PaperFileKind, event?: ModifierEvent | null) => Promise<void>
  /** A new tutor chat in its own tab, with the paper attached. */
  ask: (paper: Paper) => void
  edit: (paper: Paper) => void
  retry: (paper: Paper) => Promise<void>
  retryFailed: () => Promise<void>
  reveal: (paper: Paper) => Promise<void>
  remove: (paper: Paper) => Promise<void>
  organize: () => Promise<void>
  /** Rescans the vault for PDFs right away instead of waiting for the next poll. */
  rescan: () => Promise<void>
}

const LibraryActionsContext = createContext<LibraryActions | null>(null)

const refreshLibrary = () => Promise.all([mutate(KEYS.library), mutate(KEYS.vaultTree)])

export function LibraryActionsProvider({ children }: { children: React.ReactNode }) {
  const openHref = useOpen()
  const tabs = useTabs()
  const notify = useNotice()
  const confirm = useConfirm()
  const [editing, setEditing] = useState<Paper | null>(null)
  const opening = useRef(new Set<string>())

  const fail = useCallback((error: unknown) => notify({ variant: 'danger', text: errorText(error) }), [notify])

  const openFile = useCallback(
    async (paper: Paper, kind: PaperFileKind, event?: ModifierEvent | null) => {
      const key = `${paper.id}:${kind}`
      if (opening.current.has(key)) return
      opening.current.add(key)
      try {
        const { path } = await libraryApi.openFile(paper.id, kind)
        openHref(fileHref(path), event)
        if (path !== paper[kind]) void refreshLibrary()
      } catch (error) {
        fail(error)
      } finally {
        opening.current.delete(key)
      }
    },
    [openHref, fail],
  )

  const remove = useCallback(
    async (paper: Paper) => {
      const ok = await confirm({
        title: `从文库删除《${paper.title}》？`,
        content: 'PDF 会移到文件库的 .trash 文件夹，可以找回。它的思维导图和笔记会保留。',
        confirmButtonContent: '删除',
        confirmButtonType: 'danger',
        cancelButtonContent: '取消',
      })
      if (!ok) return
      try {
        await libraryApi.remove(paper.id)
        tabs.closeWhere((href) => paperIdOf(href) === paper.id)
        notify({ variant: 'success', text: `已删除《${paper.title}》。` })
      } catch (error) {
        fail(error)
      }
      await refreshLibrary()
    },
    [confirm, tabs, notify, fail],
  )

  const submitEdit = useCallback(
    async (patch: PaperPatch) => {
      if (!editing) return
      await libraryApi.edit(editing.id, patch)
      setEditing(null)
      await mutate(KEYS.library)
    },
    [editing],
  )

  const value = useMemo<LibraryActions>(
    () => ({
      open: (paper, event, options) => openHref(paperHref(paper.id, options?.page), event, options),
      openFile,
      ask: (paper) => tabs.openInNewTab(askHref(paper.path)),
      edit: setEditing,
      retry: async (paper) => {
        try {
          await libraryApi.retry([paper.id])
          notify({ text: `《${paper.title}》已重新排队建档。` })
        } catch (error) {
          fail(error)
        }
        await mutate(KEYS.library)
      },
      retryFailed: async () => {
        try {
          const { count } = await libraryApi.retry()
          notify({ text: count ? `${count} 篇论文已重新排队。` : '没有需要重试的论文。' })
        } catch (error) {
          fail(error)
        }
        await mutate(KEYS.library)
      },
      reveal: async (paper) => {
        try {
          await vaultApi.reveal(paper.path)
        } catch (error) {
          fail(error)
        }
      },
      remove,
      organize: async () => {
        try {
          await libraryApi.organize()
        } catch (error) {
          fail(error)
        }
        await mutate(KEYS.library)
      },
      rescan: async () => {
        try {
          await mutate(KEYS.library, await api<LibraryState>(`${KEYS.library}?sync=1`), { revalidate: false })
          await mutate(KEYS.vaultTree)
        } catch (error) {
          fail(error)
        }
      },
    }),
    [openHref, openFile, tabs, notify, fail, remove],
  )

  return (
    <LibraryActionsContext.Provider value={value}>
      {children}
      {editing ? <PaperEditDialog key={editing.id} paper={editing} onSubmit={submitEdit} onClose={() => setEditing(null)} /> : null}
    </LibraryActionsContext.Provider>
  )
}

export function useLibraryActions(): LibraryActions {
  const value = useContext(LibraryActionsContext)
  if (!value) throw new Error('useLibraryActions must be used inside LibraryActionsProvider')
  return value
}
