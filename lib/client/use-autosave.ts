'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { errorText } from './api'
import { registerEditor } from './editor-registry'
import { saveVaultFile } from './vault'

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict'

export interface SaveConflict {
  /** What is on disk now; null when the file was deleted. */
  content: string | null
  mtimeMs: number | null
}

/**
 * Debounced save of a vault file with optimistic concurrency: every save sends the mtime it was
 * based on, and a file changed elsewhere (Explorer, another window) raises a conflict instead of
 * being overwritten. Pending edits are flushed before rename/move/delete and on unmount.
 */
export function useAutosave(path: string, initialMtimeMs: number, read: () => string, delayMs = 900) {
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<SaveConflict | null>(null)
  const baseMtime = useRef(initialMtimeMs)
  const dirty = useRef(false)
  const blocked = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inflight = useRef<Promise<void> | null>(null)
  const readRef = useRef(read)
  readRef.current = read
  const saveRef = useRef<(force?: boolean) => Promise<void>>(async () => undefined)

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      void saveRef.current()
    }, delayMs)
  }, [delayMs])

  saveRef.current = async (force = false) => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    while (inflight.current) await inflight.current
    if (!dirty.current || (blocked.current && !force)) return
    const content = readRef.current()
    dirty.current = false
    setStatus('saving')
    const task = saveVaultFile(path, content, baseMtime.current, force)
      .then(
        (result) => {
          if (result.ok) {
            baseMtime.current = result.mtimeMs
            blocked.current = false
            setConflict(null)
            setError(null)
            setStatus(dirty.current ? 'dirty' : 'saved')
            if (dirty.current) schedule()
          } else {
            dirty.current = true
            blocked.current = true
            setConflict({ content: result.content, mtimeMs: result.mtimeMs })
            setStatus('conflict')
          }
        },
        (err: unknown) => {
          dirty.current = true
          setError(errorText(err))
          setStatus('error')
        },
      )
      .finally(() => {
        inflight.current = null
      })
    inflight.current = task
    await task
  }

  const markDirty = useCallback(() => {
    dirty.current = true
    if (blocked.current) return
    setStatus('dirty')
    schedule()
  }, [schedule])

  const flush = useCallback(() => saveRef.current(), [])

  /** Overwrites the disk version with the editor's content. */
  const keepMine = useCallback(async () => {
    dirty.current = true
    await saveRef.current(true)
  }, [])

  /** Drops local edits and returns the disk content for the editor to load. */
  const takeDisk = useCallback((): string | null => {
    if (!conflict) return null
    if (conflict.mtimeMs !== null) baseMtime.current = conflict.mtimeMs
    blocked.current = false
    dirty.current = false
    setConflict(null)
    setStatus('saved')
    return conflict.content
  }, [conflict])

  useEffect(() => {
    const unregister = registerEditor({ path, flush: () => saveRef.current() })
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty.current && !inflight.current) return
      void saveRef.current()
      event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      unregister()
      window.removeEventListener('beforeunload', onBeforeUnload)
      void saveRef.current()
    }
  }, [path])

  return { status, error, conflict, markDirty, flush, keepMine, takeDisk }
}

export function saveStatusText(status: SaveStatus, error: string | null): string {
  switch (status) {
    case 'saved':
      return '已保存到本机'
    case 'dirty':
      return '有未保存的修改'
    case 'saving':
      return '正在保存…'
    case 'conflict':
      return '文件在别处被修改了'
    case 'error':
      return `保存失败：${error ?? '未知错误'}`
  }
}
