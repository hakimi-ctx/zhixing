/** Mind maps are stored as mind-elixir data in `<name>.mindmap.json` files inside the vault. */
export const MINDMAP_EXT = '.mindmap.json'
export const NOTE_EXT = '.md'

export interface NodeMeta {
  /** Page of the paper this topic was taken from (1-based). */
  page?: number
  markers?: string[]
}

export interface MindNode {
  id: string
  topic: string
  children?: MindNode[]
  expanded?: boolean
  direction?: 0 | 1
  style?: Record<string, string>
  tags?: string[]
  icons?: string[]
  hyperLink?: string
  note?: string
  branchColor?: string
  image?: { url: string; width: number; height: number; fit?: 'fill' | 'contain' | 'cover' }
  metadata?: NodeMeta
}

export const MIND_THEMES = ['classic', 'colorful', 'minimal', 'dark'] as const
export type MindTheme = (typeof MIND_THEMES)[number]

export interface MindmapData {
  nodeData: MindNode
  arrows?: Record<string, unknown>[]
  summaries?: Record<string, unknown>[]
  direction?: 0 | 1 | 2 | 3
  themeName?: MindTheme
  compact?: boolean
  /** The paper this map is read against, when it is not that paper's own map. */
  paperId?: string
}

export interface OutlineNode {
  title: string
  children?: OutlineNode[]
}

export interface MarkerGroup {
  id: string
  label: string
  /** Only one marker of an exclusive group can sit on a topic, like XMind's priority. */
  exclusive: boolean
  markers: { id: string; label: string }[]
}

export const MARKER_GROUPS: MarkerGroup[] = [
  {
    id: 'priority',
    label: '优先级',
    exclusive: true,
    markers: [1, 2, 3, 4, 5, 6].map((level) => ({ id: `priority-${level}`, label: `优先级 ${level}` })),
  },
  {
    id: 'progress',
    label: '进度',
    exclusive: true,
    markers: [
      { id: 'progress-0', label: '未开始' },
      { id: 'progress-25', label: '进行到 1/4' },
      { id: 'progress-50', label: '进行到一半' },
      { id: 'progress-75', label: '进行到 3/4' },
      { id: 'progress-100', label: '已完成' },
    ],
  },
  {
    id: 'flag',
    label: '旗帜',
    exclusive: true,
    markers: [
      { id: 'flag-red', label: '红旗' },
      { id: 'flag-orange', label: '橙旗' },
      { id: 'flag-green', label: '绿旗' },
      { id: 'flag-blue', label: '蓝旗' },
      { id: 'flag-purple', label: '紫旗' },
    ],
  },
  {
    id: 'symbol',
    label: '阅读标记',
    exclusive: false,
    markers: [
      { id: 'symbol-star', label: '重点' },
      { id: 'symbol-question', label: '疑问' },
      { id: 'symbol-alert', label: '注意' },
      { id: 'symbol-idea', label: '想法' },
      { id: 'symbol-check', label: '认同' },
      { id: 'symbol-cross', label: '存疑' },
      { id: 'symbol-quote', label: '原文引用' },
      { id: 'symbol-pin', label: '待查' },
    ],
  },
]

const MARKER_ORDER = new Map(MARKER_GROUPS.flatMap((group) => group.markers.map((marker) => marker.id)).map((id, index) => [id, index]))
const GROUP_OF = new Map(MARKER_GROUPS.flatMap((group) => group.markers.map((marker) => [marker.id, group] as const)))

export const markerGroupOf = (id: string): MarkerGroup | undefined => GROUP_OF.get(id)
export const markerLabel = (id: string): string => GROUP_OF.get(id)?.markers.find((marker) => marker.id === id)?.label ?? id

/** Keeps known markers only, one per exclusive group, in palette order. */
export function normalizeMarkers(markers: readonly string[]): string[] {
  const seenGroups = new Set<string>()
  const result: string[] = []
  for (const id of [...new Set(markers)].filter((item) => MARKER_ORDER.has(item)).sort((a, b) => MARKER_ORDER.get(a)! - MARKER_ORDER.get(b)!)) {
    const group = GROUP_OF.get(id)!
    if (group.exclusive) {
      if (seenGroups.has(group.id)) continue
      seenGroups.add(group.id)
    }
    result.push(id)
  }
  return result
}

export function newNodeId(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function emptyMindmap(topic: string): MindmapData {
  return { nodeData: { id: newNodeId(), topic: topic.trim().slice(0, 300) || '中心主题', children: [] }, direction: 2 }
}

export const MAX_PAGE = 100_000
const STYLE_KEYS = new Set(['fontSize', 'fontFamily', 'color', 'background', 'fontWeight', 'fontStyle', 'width', 'border', 'textDecoration'])
const UNSAFE_STYLE = /url\(|image-set|image\(|src\(|expression|[<>{};@\\]/i
/** Saving keeps at most this many topics, so the editor refuses changes that would go over it. */
export const MAX_NODES = 5000
export const MAX_DEPTH = 40

function safeUrl(value: unknown, allowDataImage: boolean): string | undefined {
  if (typeof value !== 'string') return undefined
  const url = value.trim()
  if (/^https?:\/\/[^\s]+$/i.test(url) && url.length <= 2000) return url
  if (allowDataImage && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(url)) return url
  return undefined
}

export function safeStyleValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed && trimmed.length < 120 && !UNSAFE_STYLE.test(trimmed) ? trimmed : undefined
}

const SAFE_COLOR = /^(#[0-9a-f]{3,8}|[a-z]+|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i

/**
 * Rebuilds a mind map from untrusted JSON, keeping only known, safe fields. mind-elixir renders
 * `dangerouslySetInnerHTML` and link URLs, and this app can run local commands, so a crafted file
 * must never be able to inject markup or javascript: links.
 */
export function sanitizeMindmap(raw: unknown): MindmapData | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  let count = 0
  const seen = new Set<string>()

  const visit = (value: unknown, depth: number): MindNode | null => {
    if (!value || typeof value !== 'object' || count >= MAX_NODES || depth > MAX_DEPTH) return null
    const node = value as Record<string, unknown>
    count += 1
    let id = typeof node.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(node.id) ? node.id : newNodeId()
    if (seen.has(id)) id = newNodeId()
    seen.add(id)
    const result: MindNode = { id, topic: typeof node.topic === 'string' ? node.topic.slice(0, 2000) : '' }
    if (typeof node.expanded === 'boolean') result.expanded = node.expanded
    if (node.direction === 0 || node.direction === 1) result.direction = node.direction
    if (node.style && typeof node.style === 'object') {
      const style: Record<string, string> = {}
      for (const [key, styleValue] of Object.entries(node.style as Record<string, unknown>)) {
        const clean = STYLE_KEYS.has(key) ? safeStyleValue(styleValue) : undefined
        if (clean) style[key] = clean
      }
      if (Object.keys(style).length) result.style = style
    }
    if (Array.isArray(node.tags)) {
      const tags = node.tags
        .map((tag) => (typeof tag === 'string' ? tag : typeof (tag as { text?: unknown })?.text === 'string' ? (tag as { text: string }).text : ''))
        .map((tag) => tag.trim().slice(0, 60))
        .filter(Boolean)
        .slice(0, 20)
      if (tags.length) result.tags = [...new Set(tags)]
    }
    if (Array.isArray(node.icons)) {
      const icons = node.icons.filter((icon): icon is string => typeof icon === 'string').slice(0, 10).map((icon) => icon.slice(0, 8))
      if (icons.length) result.icons = icons
    }
    const link = safeUrl(node.hyperLink, false)
    if (link) result.hyperLink = link
    if (typeof node.note === 'string' && node.note.trim()) result.note = node.note.slice(0, 20_000)
    if (typeof node.branchColor === 'string' && SAFE_COLOR.test(node.branchColor)) result.branchColor = node.branchColor
    const image = node.image as Record<string, unknown> | undefined
    const imageUrl = image ? safeUrl(image.url, true) : undefined
    if (image && imageUrl && typeof image.width === 'number' && typeof image.height === 'number') {
      result.image = { url: imageUrl, width: image.width, height: image.height }
      if (image.fit === 'fill' || image.fit === 'contain' || image.fit === 'cover') result.image.fit = image.fit
    }
    const meta = node.metadata as Record<string, unknown> | undefined
    if (meta && typeof meta === 'object') {
      const metadata: NodeMeta = {}
      if (typeof meta.page === 'number' && Number.isInteger(meta.page) && meta.page >= 1 && meta.page <= MAX_PAGE) metadata.page = meta.page
      if (Array.isArray(meta.markers)) {
        const markers = normalizeMarkers(meta.markers.filter((item): item is string => typeof item === 'string'))
        if (markers.length) metadata.markers = markers
      }
      if (Object.keys(metadata).length) result.metadata = metadata
    }
    if (Array.isArray(node.children)) {
      result.children = node.children.map((child) => visit(child, depth + 1)).filter((child): child is MindNode => child !== null)
    }
    return result
  }

  const nodeData = visit(source.nodeData, 0)
  if (!nodeData) return null
  if (!nodeData.topic) nodeData.topic = '中心主题'
  const data: MindmapData = { nodeData }
  if (source.direction === 0 || source.direction === 1 || source.direction === 2 || source.direction === 3) data.direction = source.direction
  if (typeof source.themeName === 'string' && (MIND_THEMES as readonly string[]).includes(source.themeName)) data.themeName = source.themeName as MindTheme
  if (typeof source.compact === 'boolean') data.compact = source.compact
  if (typeof source.paperId === 'string' && /^[0-9a-f]{24}$/.test(source.paperId)) data.paperId = source.paperId
  const plainObjects = (value: unknown) =>
    Array.isArray(value)
      ? value
          .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
          .slice(0, 500)
          .map((item) => JSON.parse(JSON.stringify(item)) as Record<string, unknown>)
      : undefined
  const arrows = plainObjects(source.arrows)
  const summaries = plainObjects(source.summaries)
  if (arrows?.length) data.arrows = arrows
  if (summaries?.length) data.summaries = summaries
  return data
}

export function outlineToNodes(items: OutlineNode[], depth = 0): MindNode[] {
  return items
    .filter((item) => item.title.trim())
    .map((item) => ({
      id: newNodeId(),
      topic: item.title.trim().slice(0, 2000),
      children: depth < MAX_DEPTH && item.children?.length ? outlineToNodes(item.children, depth + 1) : [],
    }))
}

const HEADING = /^(#{1,6})\s+(.*)$/
const BULLET = /^(?:[-*+•·]|\d{1,3}[.)、]|[（(]?\d{1,3}[)）])\s+(.*)$/

function indentWidth(line: string): number {
  let width = 0
  for (const char of line) {
    if (char === ' ') width += 1
    else if (char === '\t') width += 4
    else if (char === '\u3000') width += 2
    else break
  }
  return width
}

const stripInline = (text: string) =>
  text
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\[[ xX]\]\s+/, '')
    .trim()

/**
 * Turns an indented outline into a forest: Markdown headings and bullets, numbered lists, or plain
 * lines indented with tabs or spaces (what XMind, Word and most note apps put on the clipboard).
 */
export function parseOutline(text: string): OutlineNode[] {
  const roots: OutlineNode[] = []
  const stack: { depth: number; node: OutlineNode }[] = []
  const indents: number[] = []
  let headingDepth = -1
  let inFence = false

  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*(```|~~~)/.test(rawLine)) {
      inFence = !inFence
      continue
    }
    if (inFence || !rawLine.trim() || /^\s*(---+|\*\*\*+|>)\s*$/.test(rawLine)) continue
    const width = indentWidth(rawLine)
    const line = rawLine.trim()
    let depth: number
    let title: string
    const heading = HEADING.exec(line)
    if (heading) {
      depth = heading[1].length - 1
      headingDepth = depth
      indents.length = 0
      title = heading[2]
    } else {
      while (indents.length && indents[indents.length - 1] > width) indents.pop()
      if (!indents.length || indents[indents.length - 1] < width) indents.push(width)
      depth = headingDepth + indents.length
      const bullet = BULLET.exec(line)
      title = bullet ? bullet[1] : line.replace(/^>\s?/, '')
    }
    title = stripInline(title)
    if (!title) continue
    const node: OutlineNode = { title, children: [] }
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop()
    const parent = stack[stack.length - 1]
    if (parent) parent.node.children!.push(node)
    else roots.push(node)
    stack.push({ depth, node })
  }
  return roots
}

const CJK_CHAR = /[\u3000-\u303f\u3400-\u9fff\uf900-\uffef]/

/** True when pasted text has outline structure (bullets, headings, indentation) rather than being one wrapped paragraph. */
export function looksLikeOutline(text: string): boolean {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((line) => line.trim())
  if (lines.length < 2) return false
  return lines.some((line) => HEADING.test(line.trim()) || BULLET.test(line.trim()) || indentWidth(line) > 0)
}

/** Joins a paragraph copied from a PDF, where every visual line ends in a hard line break. */
export function joinWrappedLines(text: string): string {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  let result = ''
  for (const line of lines) {
    if (!result) result = line
    else if (/[A-Za-z]-$/.test(result) && /^[a-z]/.test(line)) result = result.slice(0, -1) + line
    else if (CJK_CHAR.test(result.slice(-1)) || CJK_CHAR.test(line[0])) result += line
    else result += ` ${line}`
  }
  return result
}

/** Indented Markdown outline, used for "export as note" and for giving a mind map to the AI as context. */
export function mindmapToMarkdown(data: MindmapData): string {
  const lines: string[] = [`# ${data.nodeData.topic.replace(/\s*\n\s*/g, ' ')}`, '']
  if (data.nodeData.note) lines.push(`> ${data.nodeData.note.replace(/\s*\n\s*/g, ' ')}`, '')
  const walk = (nodes: MindNode[] | undefined, depth: number) => {
    for (const node of nodes ?? []) {
      const extras = [
        node.metadata?.markers?.length ? `〔${node.metadata.markers.map(markerLabel).join('、')}〕` : '',
        node.metadata?.page ? `（p.${node.metadata.page}）` : '',
        node.tags?.length ? node.tags.map((tag) => `#${tag.replace(/\s+/g, '_')}`).join(' ') : '',
      ].filter(Boolean)
      lines.push(`${'  '.repeat(depth)}- ${node.topic.replace(/\s*\n\s*/g, ' ')}${extras.length ? ` ${extras.join(' ')}` : ''}`)
      if (node.note) lines.push(`${'  '.repeat(depth + 1)}> ${node.note.replace(/\s*\n\s*/g, ' ')}`)
      if (node.hyperLink) lines.push(`${'  '.repeat(depth + 1)}<${node.hyperLink}>`)
      walk(node.children, depth + 1)
    }
  }
  walk(data.nodeData.children, 0)
  return `${lines.join('\n').trimEnd()}\n`
}

/** Pre-order walk without recursion, so very deep maps cannot overflow the stack. */
export function walkNodes(root: MindNode, visit: (node: MindNode, parent: MindNode | null, depth: number) => void): void {
  const stack: [MindNode, MindNode | null, number][] = [[root, null, 0]]
  while (stack.length) {
    const [node, parent, depth] = stack.pop()!
    visit(node, parent, depth)
    const children = node.children ?? []
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push([children[index], node, depth + 1])
  }
}

export interface NodeLocation {
  node: MindNode
  parent: MindNode | null
  /** Position among the parent's children; 0 for the root. */
  index: number
  depth: number
}

export function locateNode(root: MindNode, id: string): NodeLocation | null {
  let found: NodeLocation | null = null
  walkNodes(root, (node, parent, depth) => {
    if (found || node.id !== id) return
    found = { node, parent, index: parent ? (parent.children ?? []).indexOf(node) : 0, depth }
  })
  return found
}

export function countNodes(root: MindNode): number {
  let count = 0
  walkNodes(root, () => {
    count += 1
  })
  return count
}

/** Deep copy with fresh ids, for paste and duplicate. Main-branch sides are dropped so the copy is laid out again. */
export function cloneWithNewIds(nodes: MindNode[]): MindNode[] {
  const copy = (node: MindNode): MindNode => {
    const clone = JSON.parse(JSON.stringify({ ...node, children: undefined })) as MindNode
    delete clone.direction
    return { ...clone, id: newNodeId(), children: (node.children ?? []).map(copy) }
  }
  return nodes.map(copy)
}

/** Tab-indented plain text, the clipboard format XMind and most outliners read and write. */
export function nodesToText(nodes: MindNode[]): string {
  const lines: string[] = []
  const add = (node: MindNode, depth: number) => {
    lines.push(`${'\t'.repeat(depth)}${node.topic.replace(/\s*\n\s*/g, ' ')}`)
    for (const child of node.children ?? []) add(child, depth + 1)
  }
  for (const node of nodes) add(node, 0)
  return lines.join('\n')
}

/**
 * Topics for pasted or dropped text: an indented outline keeps its structure; anything else is
 * treated as prose (typically copied from a PDF), one topic per paragraph with line breaks joined.
 */
export function textToNodes(text: string): MindNode[] {
  const clean = text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim()
  if (!clean) return []
  if (looksLikeOutline(clean)) {
    const nodes = outlineToNodes(parseOutline(clean))
    if (nodes.length) return nodes.slice(0, 500)
  }
  return clean
    .split(/\n\s*\n/)
    .map(joinWrappedLines)
    .filter(Boolean)
    .slice(0, 200)
    .map((topic) => ({ id: newNodeId(), topic: topic.slice(0, 2000), children: [] }))
}

/** Display name of a vault entry without the note / mind-map extension. */
export function displayName(name: string): string {
  if (name.toLowerCase().endsWith(MINDMAP_EXT)) return name.slice(0, -MINDMAP_EXT.length)
  if (/\.(md|markdown)$/i.test(name)) return name.replace(/\.(md|markdown)$/i, '')
  return name
}
