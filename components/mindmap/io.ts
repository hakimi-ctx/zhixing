import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { newNodeId, outlineToNodes, parseOutline, sanitizeMindmap, type MindNode, type MindmapData } from '@/lib/shared/mindmap'
import { mindmapToXmind, xmindToMindmap, xmindXmlToMindmap, type XmindImport } from '@/lib/shared/xmind'
import { resolveColor } from './theme'

export const IMPORT_ACCEPT = '.xmind,.md,.markdown,.txt,.opml,.json'
const MAX_IMPORT_BYTES = 50 * 1024 * 1024

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/** A `.xmind` workbook (XMind 2020+ format) that XMind, and this editor, can open. */
function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** OPML 2.0 outline. Notes ride on `_note`, which is what this editor reads back. */
export function exportOpml(data: MindmapData, title: string): string {
  const outline = (node: MindNode): string => {
    const note = node.note?.trim() ? ` _note="${escapeXml(node.note)}"` : ''
    const children = (node.children ?? []).map(outline).join('')
    return `<outline text="${escapeXml(node.topic)}"${note}>${children}</outline>`
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0"><head><title>${escapeXml(title)}</title></head><body>${outline(data.nodeData)}</body></opml>\n`
}

export function exportXmind(data: MindmapData, title: string): Blob {
  const files = {
    'content.json': strToU8(JSON.stringify(mindmapToXmind(data, title, resolveColor))),
    'metadata.json': strToU8(JSON.stringify({ creator: { name: '知行', version: '1.0' } })),
    'manifest.json': strToU8(JSON.stringify({ 'file-entries': { 'content.json': {}, 'metadata.json': {} } })),
  }
  const zipped = zipSync(files, { level: 6 })
  return new Blob([zipped.slice().buffer as ArrayBuffer], { type: 'application/vnd.xmind.workbook' })
}

export interface ImportResult {
  data: MindmapData
  /** Shown to the student, e.g. that only the first sheet was imported. */
  warning?: string
}

function xmindWarning(result: XmindImport): string | undefined {
  const parts: string[] = []
  if (result.sheetCount > 1) parts.push(`这个文件有 ${result.sheetCount} 个画布，只导入了第一个`)
  if (result.skipped > 0) parts.push(`${result.skipped} 个标注无法导入`)
  return parts.length ? `${parts.join('，')}。` : undefined
}

function readXmind(bytes: Uint8Array): ImportResult {
  let tooLarge = false
  const entries = unzipSync(bytes, {
    filter: (entry) => {
      if (entry.name !== 'content.json' && entry.name !== 'content.xml') return false
      if (entry.originalSize > MAX_IMPORT_BYTES) {
        tooLarge = true
        return false
      }
      return true
    },
  })
  if (tooLarge) throw new Error('这个 .xmind 文件的内容太大了。')
  if (entries['content.json']) {
    const result = xmindToMindmap(JSON.parse(strFromU8(entries['content.json'])))
    return { data: result.data, warning: xmindWarning(result) }
  }
  if (entries['content.xml']) {
    const doc = new DOMParser().parseFromString(strFromU8(entries['content.xml']), 'application/xml')
    if (doc.getElementsByTagName('parsererror').length) throw new Error('这个 .xmind 文件已损坏。')
    const result = xmindXmlToMindmap(doc)
    return { data: result.data, warning: xmindWarning(result) }
  }
  throw new Error('这个 .xmind 文件里没有找到导图内容。')
}

function readOpml(text: string, fallbackTitle: string): MindmapData {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  const body = doc.getElementsByTagName('body')[0]
  if (!body || doc.getElementsByTagName('parsererror').length) throw new Error('无法识别这个 OPML 文件。')
  const convert = (element: Element, depth: number): MindNode => {
    const node: MindNode = { id: newNodeId(), topic: (element.getAttribute('text') ?? element.getAttribute('title') ?? '').trim() }
    const note = element.getAttribute('_note')
    if (note?.trim()) node.note = note
    node.children = depth < 40 ? Array.from(element.children).filter((child) => child.localName === 'outline').map((child) => convert(child, depth + 1)) : []
    return node
  }
  const tops = Array.from(body.children).filter((child) => child.localName === 'outline')
  const title = doc.getElementsByTagName('title')[0]?.textContent?.trim()
  if (tops.length === 1) return { nodeData: convert(tops[0], 0), direction: 2 }
  return { nodeData: { id: newNodeId(), topic: title || fallbackTitle, children: tops.map((top) => convert(top, 1)) }, direction: 2 }
}

function readOutline(text: string, fallbackTitle: string): MindmapData {
  const outline = parseOutline(text)
  if (!outline.length) throw new Error('文件里没有可以变成主题的内容。')
  if (outline.length === 1) {
    return { nodeData: { id: newNodeId(), topic: outline[0].title.slice(0, 2000), children: outlineToNodes(outline[0].children ?? [], 1) }, direction: 2 }
  }
  return { nodeData: { id: newNodeId(), topic: fallbackTitle, children: outlineToNodes(outline, 1) }, direction: 2 }
}

/** Reads an XMind workbook, a Markdown / plain-text outline, OPML, or a 知行 map file. */
export async function importMindmapFile(file: File): Promise<ImportResult> {
  if (file.size > MAX_IMPORT_BYTES) throw new Error('文件太大了（超过 50 MB）。')
  const lower = file.name.toLowerCase()
  const title = file.name.replace(/\.mindmap\.json$/i, '').replace(/\.[^.]+$/, '') || '中心主题'
  let result: ImportResult
  if (lower.endsWith('.xmind')) {
    result = readXmind(new Uint8Array(await file.arrayBuffer()))
  } else {
    const text = await file.text()
    if (lower.endsWith('.opml')) result = { data: readOpml(text, title) }
    else if (lower.endsWith('.json')) {
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new Error('这个 JSON 文件格式不对。')
      }
      const data = sanitizeMindmap(parsed)
      if (!data) throw new Error('这个 JSON 文件不是思维导图。')
      result = { data }
    } else result = { data: readOutline(text, title) }
  }
  const clean = sanitizeMindmap(result.data)
  if (!clean) throw new Error('无法识别这个文件的内容。')
  delete clean.paperId
  return { ...result, data: clean }
}
