'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { UploadIcon } from '@primer/octicons-react'
import { mutate } from 'swr'
import { useNotice } from '@/components/ui/notices'
import { errorText } from '@/lib/client/api'
import { KEYS } from '@/lib/client/hooks'
import { isPdfFile, libraryApi } from '@/lib/client/library'
import type { UploadResult } from '@/lib/shared/types'
import styles from './upload.module.css'

interface UploadApi {
  /** Opens the system file picker. */
  pick: () => void
  upload: (files: File[]) => Promise<void>
  busy: boolean
}

const UploadContext = createContext<UploadApi>({ pick: () => undefined, upload: async () => undefined, busy: false })

function summarize(result: UploadResult, skipped: string[]): { variant: 'success' | 'warning' | 'danger'; text: string } {
  const rejected = [...result.rejected.map((item) => `${item.name}（${item.reason}）`), ...skipped.map((name) => `${name}（不是 PDF）`)]
  const parts: string[] = []
  if (result.added.length) parts.push(`已导入 ${result.added.length} 篇`)
  if (result.duplicates.length) parts.push(`${result.duplicates.length} 篇已在文库中`)
  if (rejected.length) parts.push(`未导入 ${rejected.slice(0, 3).join('、')}${rejected.length > 3 ? ` 等 ${rejected.length} 个` : ''}`)
  const variant = result.added.length ? (rejected.length ? 'warning' : 'success') : rejected.length ? 'danger' : 'warning'
  return { variant, text: parts.join('；') || '没有可导入的文件。' }
}

const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files')

/**
 * Importing papers: the ribbon button and the library page open the picker; PDFs dropped anywhere
 * in Study are imported. File drops are always intercepted so the window never navigates to a file.
 */
export function UploadProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const notify = useNotice()
  const inputRef = useRef<HTMLInputElement>(null)
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)

  const upload = useCallback(
    async (files: File[]) => {
      const pdfs = files.filter(isPdfFile)
      const skipped = files.filter((file) => !isPdfFile(file)).map((file) => file.name)
      if (!pdfs.length) {
        notify({ variant: 'warning', text: '只能导入 PDF 论文。' })
        return
      }
      if (busyRef.current) {
        notify({ variant: 'warning', text: '上一批论文还在导入，请稍等。' })
        return
      }
      busyRef.current = true
      setBusy(true)
      try {
        const result = await libraryApi.upload(pdfs)
        notify(summarize(result, skipped))
      } catch (error) {
        notify({ variant: 'danger', text: errorText(error) })
      } finally {
        busyRef.current = false
        setBusy(false)
        void mutate(KEYS.library)
        void mutate(KEYS.vaultTree)
      }
    },
    [notify],
  )

  const pick = useCallback(() => inputRef.current?.click(), [])

  useEffect(() => {
    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth.current += 1
      if (enabled) setDragging(true)
    }
    const onOver = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = enabled ? 'copy' : 'none'
    }
    const onLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setDragging(false)
    }
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth.current = 0
      setDragging(false)
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (enabled && files.length) void upload(files)
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [enabled, upload])

  const value = useMemo(() => ({ pick, upload, busy }), [pick, upload, busy])

  return (
    <UploadContext.Provider value={value}>
      {children}
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        multiple
        hidden
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          if (files.length) void upload(files)
        }}
      />
      {dragging ? (
        <div className={styles.overlay} aria-hidden="true">
          <div className={styles.dropBox}>
            <UploadIcon size={32} />
            <span>松开导入论文</span>
          </div>
        </div>
      ) : null}
    </UploadContext.Provider>
  )
}

export function useUpload(): UploadApi {
  return useContext(UploadContext)
}
