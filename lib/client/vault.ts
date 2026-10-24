import type { VaultFile, VaultNode } from '@/lib/shared/types'
import { api, ApiError } from './api'

export type EntryKind = 'dir' | 'note' | 'mindmap'

export function fileHref(path: string): string {
  return `/study/file?path=${encodeURIComponent(path)}`
}

/** A new tutor chat with this note, mind map or paper PDF attached. */
export function askHref(path: string): string {
  return `/study/chat?attach=${encodeURIComponent(path)}`
}

/** The vault path a /study/file address shows, or null for any other address. */
export function filePathOf(href: string): string | null {
  try {
    const url = new URL(href, 'http://zhixing.local')
    return url.pathname === '/study/file' ? url.searchParams.get('path') : null
  } catch {
    return null
  }
}

export function parentOf(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}

export function baseName(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? path : path.slice(index + 1)
}

/** Where `target` ends up after `from` is renamed or moved to `to`; null if unaffected. */
export function remapPath(target: string, from: string, to: string): string | null {
  if (target === from) return to
  if (target.startsWith(`${from}/`)) return `${to}${target.slice(from.length)}`
  return null
}

export function isWithin(target: string, ancestor: string): boolean {
  return target === ancestor || target.startsWith(`${ancestor}/`)
}

/** The new address of a file tab after `from` was renamed or moved to `to`; null if unaffected. */
export function remapFileHref(href: string, from: string, to: string): string | null {
  const path = filePathOf(href)
  const moved = path === null ? null : remapPath(path, from, to)
  return moved === null ? null : fileHref(moved)
}

export function flattenNodes(nodes: VaultNode[]): VaultNode[] {
  const result: VaultNode[] = []
  const walk = (list: VaultNode[]) => {
    for (const node of list) {
      result.push(node)
      if (node.children) walk(node.children)
    }
  }
  walk(nodes)
  return result
}

export function findNode(nodes: VaultNode[], path: string): VaultNode | undefined {
  return flattenNodes(nodes).find((node) => node.path === path)
}

export const vaultApi = {
  create: (parent: string, name: string, kind: EntryKind, content?: string) =>
    api<{ path: string }>('/api/vault/entries', { method: 'POST', body: { parent, name, kind, content } }),
  rename: (path: string, name: string) => api<{ path: string }>('/api/vault/rename', { method: 'POST', body: { path, name } }),
  move: (path: string, toDir: string) => api<{ path: string }>('/api/vault/move', { method: 'POST', body: { path, toDir } }),
  trash: (path: string) => api<{ ok: true }>('/api/vault/trash', { method: 'POST', body: { path } }),
  reveal: (path: string) => api<{ ok: true }>('/api/system/reveal', { method: 'POST', body: { scope: 'vault', path } }),
  read: (path: string) => api<VaultFile>(`/api/vault/file?path=${encodeURIComponent(path)}`),
}

export type SaveResult =
  | { ok: true; mtimeMs: number }
  | { ok: false; conflict: true; mtimeMs: number | null; content: string | null }

/** Saves a note or mind map. A 409 means the file changed on disk since it was loaded. */
export async function saveVaultFile(path: string, content: string, baseMtimeMs?: number, force = false): Promise<SaveResult> {
  let response: Response
  try {
    response = await fetch('/api/vault/file', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, content, baseMtimeMs, force }),
      cache: 'no-store',
    })
  } catch {
    throw new ApiError('连不上知行的本地服务，内容还没有保存。', 0)
  }
  const data = (await response.json().catch(() => null)) as (SaveResult & { error?: string }) | null
  if (response.status === 409 && data && 'conflict' in data) return data
  if (!response.ok || !data) throw new ApiError(data?.error ?? `保存失败（${response.status}）`, response.status)
  return data
}
