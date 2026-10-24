import 'server-only'
import fs from 'node:fs/promises'
import path from 'node:path'
import { MINDMAP_EXT, emptyMindmap, mindmapToMarkdown, sanitizeMindmap, type MindmapData } from '@/lib/shared/mindmap'
import type { VaultFile, VaultNode, VaultNodeKind, VaultTree } from '@/lib/shared/types'
import { loadConfig } from './config'
import { HttpError, errorMessage } from './http'
import { expandHome } from './paths'
import { withLock, writeFileAtomic } from './store'

const TRASH_DIR = '.trash'
const MAX_ENTRIES = 3000
const MAX_DEPTH = 12
const MAX_FILE_BYTES = 5 * 1024 * 1024
const IGNORED = new Set(['node_modules', 'desktop.ini', 'thumbs.db'])

export function kindOf(name: string): VaultNodeKind {
  const lower = name.toLowerCase()
  if (lower.endsWith(MINDMAP_EXT)) return 'mindmap'
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'note'
  if (lower.endsWith('.pdf')) return 'pdf'
  return 'other'
}

const WELCOME_NOTE = `# 欢迎使用知行

文件库就是电脑上的一个普通文件夹，两边的改动会互相同步。

- 把读过的论文（PDF）拖进「论文库」，AI 会为每篇建档。
- 每篇论文下面都有「思维导图」，由你自己来画。
- AI 导师会把整个文库当作知识库来回答问题。
- 删除的文件在 \`.trash\` 文件夹里，可以找回。
`

async function ensureVault(root: string): Promise<void> {
  const stat = await fs.stat(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (stat) {
    if (!stat.isDirectory()) throw new HttpError(400, `文件库位置 ${root} 不是文件夹，请在“连接与设置”里换一个位置。`)
    return
  }
  await fs.mkdir(path.join(root, '论文'), { recursive: true })
  await writeFileAtomic(path.join(root, '欢迎使用知行.md'), WELCOME_NOTE)
}

export async function vaultRoot(): Promise<string> {
  const config = await loadConfig()
  const root = path.resolve(expandHome(config.vaultPath))
  await ensureVault(root)
  return root
}

export function normalizeRel(input: string): string {
  if (input.includes('\0')) throw new HttpError(400, '路径不合法。')
  const parts = input
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.')
  if (parts.some((part) => part === '..')) throw new HttpError(400, '路径不合法。')
  if (parts.some((part) => part.startsWith('.'))) throw new HttpError(400, '不能访问隐藏的文件或文件夹。')
  return parts.join('/')
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export async function resolveInVault(rel: string): Promise<{ root: string; rel: string; abs: string }> {
  const root = await vaultRoot()
  const clean = normalizeRel(rel)
  const abs = clean ? path.resolve(root, ...clean.split('/')) : root
  if (!isInside(root, abs)) throw new HttpError(400, '路径超出了文件库。')
  // Check the nearest existing ancestor too, so a symlinked sub-folder cannot redirect new files outside the vault.
  let probe = abs
  let real: string | null = null
  while (!real) {
    real = await fs.realpath(probe).catch(() => null)
    if (real || probe === root || path.dirname(probe) === probe) break
    probe = path.dirname(probe)
  }
  if (real) {
    const realRoot = await fs.realpath(root)
    if (!isInside(realRoot, real)) throw new HttpError(400, '路径超出了文件库。')
  }
  return { root, rel: clean, abs }
}

const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001F]/
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i

export function validateName(raw: string): string {
  const name = raw.trim()
  if (!name) throw new HttpError(400, '名称不能为空。')
  if (name.length > 120) throw new HttpError(400, '名称太长了，最多 120 个字符。')
  if (INVALID_CHARS.test(name)) throw new HttpError(400, '名称里不能有 \\ / : * ? " < > | 这些字符。')
  if (name.startsWith('.')) throw new HttpError(400, '名称不能以点开头。')
  if (/[. ]$/.test(name)) throw new HttpError(400, '名称不能以点或空格结尾。')
  if (RESERVED.test(name)) throw new HttpError(400, '这是 Windows 保留的名称，请换一个。')
  return name
}

const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })

export async function listTree(): Promise<VaultTree> {
  let root: string
  try {
    root = await vaultRoot()
  } catch (error) {
    return { root: '', nodes: [], truncated: false, error: errorMessage(error) }
  }
  let count = 0
  let truncated = false

  const walk = async (absDir: string, relDir: string, depth: number): Promise<VaultNode[]> => {
    let entries
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true })
    } catch {
      return []
    }
    const visible = entries
      .filter((entry) => !entry.name.startsWith('.') && !IGNORED.has(entry.name.toLowerCase()))
      .filter((entry) => entry.isDirectory() || entry.isFile())
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
        return collator.compare(a.name, b.name)
      })
    const nodes: VaultNode[] = []
    for (const entry of visible) {
      if (count >= MAX_ENTRIES) {
        truncated = true
        break
      }
      count += 1
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name
      const abs = path.join(absDir, entry.name)
      const stat = await fs.stat(abs).catch(() => null)
      if (entry.isDirectory()) {
        nodes.push({
          name: entry.name,
          path: rel,
          kind: 'dir',
          mtimeMs: stat?.mtimeMs ?? 0,
          children: depth < MAX_DEPTH ? await walk(abs, rel, depth + 1) : [],
        })
      } else {
        nodes.push({ name: entry.name, path: rel, kind: kindOf(entry.name), mtimeMs: stat?.mtimeMs ?? 0 })
      }
    }
    return nodes
  }

  return { root, nodes: await walk(root, '', 0), truncated }
}

async function readText(abs: string): Promise<{ content: string; mtimeMs: number }> {
  const stat = await fs.stat(abs).catch(() => null)
  if (!stat) throw new HttpError(404, '文件不存在，可能已被移动或删除。')
  if (!stat.isFile()) throw new HttpError(400, '这不是一个文件。')
  if (stat.size > MAX_FILE_BYTES) throw new HttpError(413, '文件超过 5MB，知行暂时不能直接打开。')
  const content = (await fs.readFile(abs, 'utf8')).replace(/^\uFEFF/, '')
  return { content, mtimeMs: stat.mtimeMs }
}

export async function readVaultFile(rel: string): Promise<VaultFile> {
  const { rel: clean, abs } = await resolveInVault(rel)
  const kind = kindOf(clean)
  if (kind === 'pdf') throw new HttpError(415, 'PDF 请在论文库里打开。')
  if (kind === 'other' || kind === 'dir') throw new HttpError(415, '知行暂时不能打开这种文件，可以在资源管理器里用其他软件打开。')
  const { content, mtimeMs } = await readText(abs)
  if (kind === 'mindmap') {
    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch {
      throw new HttpError(422, '这个思维导图文件已损坏（不是有效的 JSON）。')
    }
    const data = sanitizeMindmap(parsed)
    if (!data) throw new HttpError(422, '这个文件不是知行能识别的思维导图。')
    return { path: clean, kind, content: JSON.stringify(data), mtimeMs }
  }
  return { path: clean, kind, content, mtimeMs }
}

/** Reads a note or mind map as plain text for the AI (mind maps become an outline). */
export async function readForPrompt(rel: string): Promise<{ name: string; text: string }> {
  const file = await readVaultFile(rel)
  const name = path.posix.basename(file.path)
  if (file.kind === 'mindmap') return { name, text: mindmapToMarkdown(JSON.parse(file.content) as MindmapData) }
  return { name, text: file.content }
}

export type WriteResult = { ok: true; mtimeMs: number } | { ok: false; conflict: true; mtimeMs: number | null; content: string | null }

export async function writeVaultFile(rel: string, content: string, baseMtimeMs: number | undefined, force: boolean): Promise<WriteResult> {
  const { rel: clean, abs } = await resolveInVault(rel)
  const kind = kindOf(clean)
  if (kind !== 'note' && kind !== 'mindmap') throw new HttpError(415, '只能保存笔记和思维导图。')
  if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) throw new HttpError(413, '内容超过 5MB，无法保存。')
  let body = content
  if (kind === 'mindmap') {
    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch {
      throw new HttpError(400, '思维导图数据不是有效的 JSON。')
    }
    const data = sanitizeMindmap(parsed)
    if (!data) throw new HttpError(400, '思维导图数据不完整。')
    body = JSON.stringify(data, null, 2)
  }
  return withLock(abs, async () => {
    const current = await fs.stat(abs).catch(() => null)
    if (!force && baseMtimeMs !== undefined) {
      const changedOnDisk = !current || Math.abs(current.mtimeMs - baseMtimeMs) > 1
      if (changedOnDisk) {
        const disk = current ? await readText(abs).catch(() => null) : null
        return { ok: false, conflict: true, mtimeMs: disk?.mtimeMs ?? null, content: disk?.content ?? null }
      }
    }
    const parent = await fs.stat(path.dirname(abs)).catch(() => null)
    if (!parent?.isDirectory()) throw new HttpError(404, '文件所在的文件夹已经不存在了。')
    await writeFileAtomic(abs, body)
    const stat = await fs.stat(abs)
    return { ok: true, mtimeMs: stat.mtimeMs }
  })
}

export type EntryKind = 'dir' | 'note' | 'mindmap'

function stripKnownExtension(name: string, kind: EntryKind): string {
  if (kind === 'note') return name.replace(/\.(md|markdown)$/i, '')
  if (kind === 'mindmap') return name.toLowerCase().endsWith(MINDMAP_EXT) ? name.slice(0, -MINDMAP_EXT.length) : name
  return name
}

async function assertDirectory(abs: string) {
  const stat = await fs.stat(abs).catch(() => null)
  if (!stat?.isDirectory()) throw new HttpError(404, '目标文件夹不存在。')
}

async function exists(abs: string): Promise<boolean> {
  return fs
    .stat(abs)
    .then(() => true)
    .catch(() => false)
}

export async function createEntry(parentRel: string, rawName: string, kind: EntryKind, content?: string): Promise<{ path: string }> {
  const parent = await resolveInVault(parentRel)
  await assertDirectory(parent.abs)
  const name = validateName(stripKnownExtension(rawName.trim(), kind))
  const fileName = kind === 'note' ? `${name}.md` : kind === 'mindmap' ? `${name}${MINDMAP_EXT}` : name
  const abs = path.join(parent.abs, fileName)
  const rel = parent.rel ? `${parent.rel}/${fileName}` : fileName
  return withLock(abs, async () => {
    if (await exists(abs)) throw new HttpError(409, '这里已经有同名的文件或文件夹了。')
    if (kind === 'dir') await fs.mkdir(abs)
    else if (kind === 'note') await writeFileAtomic(abs, content ?? `# ${name}\n\n`)
    else await writeFileAtomic(abs, content ?? JSON.stringify(emptyMindmap(name), null, 2))
    return { path: rel }
  })
}

export async function renameEntry(rel: string, rawName: string): Promise<{ path: string }> {
  const source = await resolveInVault(rel)
  if (!source.rel) throw new HttpError(400, '不能重命名文件库本身。')
  const stat = await fs.stat(source.abs).catch(() => null)
  if (!stat) throw new HttpError(404, '要重命名的内容不存在。')
  const oldName = path.basename(source.abs)
  let fileName: string
  if (stat.isDirectory()) {
    fileName = validateName(rawName)
  } else {
    const kind = kindOf(oldName)
    if (kind === 'note') {
      const extension = oldName.match(/\.(md|markdown)$/i)?.[0] ?? '.md'
      fileName = `${validateName(stripKnownExtension(rawName, 'note'))}${extension}`
    } else if (kind === 'mindmap') {
      fileName = `${validateName(stripKnownExtension(rawName, 'mindmap'))}${MINDMAP_EXT}`
    } else if (kind === 'pdf') {
      fileName = `${validateName(rawName.trim().replace(/\.pdf$/i, ''))}.pdf`
    } else {
      fileName = validateName(rawName)
    }
  }
  if (fileName === oldName) return { path: source.rel }
  const target = path.join(path.dirname(source.abs), fileName)
  const sameIgnoringCase = fileName.toLowerCase() === oldName.toLowerCase()
  if (!sameIgnoringCase && (await exists(target))) throw new HttpError(409, '已经有同名的文件或文件夹了。')
  await fs.rename(source.abs, target)
  const parentRel = source.rel.includes('/') ? source.rel.slice(0, source.rel.lastIndexOf('/')) : ''
  return { path: parentRel ? `${parentRel}/${fileName}` : fileName }
}

export async function moveEntry(rel: string, toDirRel: string): Promise<{ path: string }> {
  const source = await resolveInVault(rel)
  if (!source.rel) throw new HttpError(400, '不能移动文件库本身。')
  const targetDir = await resolveInVault(toDirRel)
  await assertDirectory(targetDir.abs)
  if (isInside(source.abs, targetDir.abs)) throw new HttpError(400, '不能把文件夹移动到它自己里面。')
  const name = path.basename(source.abs)
  const target = path.join(targetDir.abs, name)
  if (path.resolve(target) === path.resolve(source.abs)) return { path: source.rel }
  if (await exists(target)) throw new HttpError(409, '目标文件夹里已经有同名的内容了。')
  await fs.rename(source.abs, target)
  return { path: targetDir.rel ? `${targetDir.rel}/${name}` : name }
}

function timestamp(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

/** Moves the entry into `<vault>/.trash` instead of deleting it, so mistakes can be undone from Explorer. */
export async function trashEntry(rel: string): Promise<void> {
  const source = await resolveInVault(rel)
  if (!source.rel) throw new HttpError(400, '不能删除文件库本身。')
  if (!(await exists(source.abs))) throw new HttpError(404, '要删除的内容不存在。')
  const trash = path.join(source.root, TRASH_DIR)
  await fs.mkdir(trash, { recursive: true })
  const base = `${timestamp()}-${path.basename(source.abs)}`
  let target = path.join(trash, base)
  for (let index = 2; await exists(target); index++) target = path.join(trash, `${base}-${index}`)
  try {
    await fs.rename(source.abs, target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    await fs.cp(source.abs, target, { recursive: true })
    await fs.rm(source.abs, { recursive: true, force: true })
  }
}
