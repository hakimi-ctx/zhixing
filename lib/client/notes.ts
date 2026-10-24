import { mutate } from 'swr'
import { ApiError } from './api'
import { KEYS } from './hooks'
import { vaultApi, type EntryKind } from './vault'

/** Creates a file, adding a timestamp to the name if one with the same name already exists. */
export async function createUnique(parent: string, name: string, kind: EntryKind, content: string): Promise<string> {
  let created: { path: string }
  try {
    created = await vaultApi.create(parent, name, kind, content)
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) throw error
    created = await vaultApi.create(parent, `${name}-${timeStamp()}`, kind, content)
  }
  void mutate(KEYS.vaultTree)
  return created.path
}

/** Makes a string safe as a Windows/macOS file name. */
export function safeFileName(text: string, fallback: string): string {
  const name = text
    .replace(/[\\/:*?"<>|#\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 40)
    .trim()
  return name || fallback
}

export function timeStamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

/** Saves text as a new Markdown note (a timestamp keeps the name unique) and returns its vault path. */
export async function saveTextAsNote(title: string, body: string, parent = ''): Promise<string> {
  const heading = title.trim() || '笔记'
  const { path } = await vaultApi.create(parent, `${safeFileName(heading, '笔记')}-${timeStamp()}`, 'note', `# ${heading}\n\n${body.trim()}\n`)
  void mutate(KEYS.vaultTree)
  return path
}
