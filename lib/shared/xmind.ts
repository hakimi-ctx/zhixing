import { MAX_PAGE, newNodeId, normalizeMarkers, safeStyleValue, type MindNode, type MindmapData } from './mindmap'

/**
 * Conversion between 知行 mind maps and the `content.json` inside a `.xmind` file (XMind Zen,
 * 2020 and later). Only the format is shared with XMind; the code is our own.
 */

interface XTopic {
  id?: string
  title?: string
  structureClass?: string
  branch?: string
  children?: { attached?: XTopic[]; detached?: XTopic[]; summary?: XTopic[]; callout?: XTopic[] }
  notes?: { plain?: { content?: string }; realHTML?: { content?: string } }
  labels?: string[]
  markers?: { markerId?: string }[]
  href?: string
  style?: { properties?: Record<string, string> }
  summaries?: { id?: string; range?: string; topicId?: string }[]
  extensions?: { provider?: string; content?: unknown }[]
}

interface XRelationship {
  id?: string
  end1Id?: string
  end2Id?: string
  title?: string
}

export interface XSheet {
  id?: string
  class?: string
  title?: string
  rootTopic?: XTopic
  relationships?: XRelationship[]
  topicPositioning?: string
}

const TO_XMIND_MARKER: Record<string, string> = {
  'progress-0': 'task-start',
  'progress-25': 'task-quarter',
  'progress-50': 'task-half',
  'progress-75': 'task-3quar',
  'progress-100': 'task-done',
  'symbol-star': 'star-yellow',
  'symbol-question': 'symbol-question',
  'symbol-alert': 'symbol-exclam',
  'symbol-idea': 'symbol-info',
  'symbol-check': 'symbol-right',
  'symbol-cross': 'symbol-wrong',
  'symbol-quote': 'symbol-plus',
  'symbol-pin': 'symbol-minus',
}

const FROM_XMIND_MARKER: Record<string, string> = Object.fromEntries(Object.entries(TO_XMIND_MARKER).map(([ours, theirs]) => [theirs, ours]))

function toXmindMarker(id: string): string {
  if (id.startsWith('priority-') || id.startsWith('flag-')) return id
  return TO_XMIND_MARKER[id] ?? id
}

function fromXmindMarker(id: string): string | null {
  const priority = /^priority-(\d)$/.exec(id)
  if (priority) return `priority-${Math.min(6, Number(priority[1]))}`
  if (/^flag-(red|orange|green|blue|purple)$/.test(id)) return id
  if (id.startsWith('star-')) return 'symbol-star'
  if (id.startsWith('task-')) return FROM_XMIND_MARKER[id] ?? null
  return FROM_XMIND_MARKER[id] ?? null
}

const STRUCTURE_OF: Record<number, string> = {
  0: 'org.xmind.ui.logic.left',
  1: 'org.xmind.ui.logic.right',
  2: 'org.xmind.ui.map.unbalanced',
  3: 'org.xmind.ui.org-chart.down',
}

function directionOf(structure: string | undefined): 0 | 1 | 2 | 3 {
  if (!structure) return 2
  if (/org-chart|tree\.down|\.down$/.test(structure)) return 3
  if (/logic\.left|tree\.left/.test(structure)) return 0
  if (/logic|tree|timeline|fishbone|brace/.test(structure)) return 1
  return 2
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

type ColorResolver = (value: string) => string | undefined

function styleToXmind(node: MindNode, resolveColor: ColorResolver): Record<string, string> | undefined {
  const style = node.style ?? {}
  const properties: Record<string, string> = {}
  if (style.fontWeight && /bold|[6-9]00/.test(style.fontWeight)) properties['fo:font-weight'] = 'bold'
  if (style.fontStyle === 'italic') properties['fo:font-style'] = 'italic'
  if (style.textDecoration) {
    const decoration = ['underline', 'line-through'].filter((item) => style.textDecoration.includes(item)).join(' ')
    if (decoration) properties['fo:text-decoration'] = decoration
  }
  const size = /^(\d{1,3})px$/.exec(style.fontSize ?? '')
  if (size) properties['fo:font-size'] = `${size[1]}pt`
  const color = style.color ? resolveColor(style.color) : undefined
  if (color) properties['fo:color'] = color
  const fill = style.background ? resolveColor(style.background) : undefined
  if (fill) properties['svg:fill'] = fill
  const border = /^(\d)px solid (.+)$/.exec(style.border ?? '')
  const borderColor = border ? resolveColor(border[2]) : undefined
  if (border && borderColor) {
    properties['border-line-width'] = `${border[1]}pt`
    properties['border-line-color'] = borderColor
  }
  const branch = node.branchColor ? resolveColor(node.branchColor) : undefined
  if (branch) properties['line-color'] = branch
  return Object.keys(properties).length ? properties : undefined
}

export function mindmapToXmind(data: MindmapData, sheetTitle: string, resolveColor: ColorResolver): XSheet[] {
  const summariesByParent = new Map<string, Record<string, unknown>[]>()
  for (const summary of data.summaries ?? []) {
    const parent = typeof summary.parent === 'string' ? summary.parent : null
    if (!parent) continue
    summariesByParent.set(parent, [...(summariesByParent.get(parent) ?? []), summary])
  }

  const convert = (node: MindNode, isRoot: boolean): XTopic => {
    const topic: XTopic = { id: node.id, title: node.topic }
    if (isRoot) topic.structureClass = STRUCTURE_OF[data.direction ?? 2]
    if (node.expanded === false && node.children?.length) topic.branch = 'folded'
    if (node.note) topic.notes = { plain: { content: node.note }, realHTML: { content: `<div>${escapeHtml(node.note).replace(/\n/g, '<br>')}</div>` } }
    if (node.tags?.length) topic.labels = [...node.tags]
    if (node.metadata?.markers?.length) topic.markers = node.metadata.markers.map((id) => ({ markerId: toXmindMarker(id) }))
    if (node.hyperLink) topic.href = node.hyperLink
    const properties = styleToXmind(node, resolveColor)
    if (properties) topic.style = { properties }
    if (node.metadata?.page) topic.extensions = [{ provider: 'cn.zhixing.page', content: { page: node.metadata.page } }]
    const children: NonNullable<XTopic['children']> = {}
    if (node.children?.length) children.attached = node.children.map((child) => convert(child, false))
    const summaries = summariesByParent.get(node.id)
    if (summaries?.length) {
      children.summary = []
      topic.summaries = []
      for (const summary of summaries) {
        const start = Number(summary.start)
        const end = Number(summary.end)
        if (!Number.isInteger(start) || !Number.isInteger(end)) continue
        const summaryTopicId = newNodeId()
        children.summary.push({ id: summaryTopicId, title: typeof summary.label === 'string' ? summary.label : '概要' })
        topic.summaries.push({ id: typeof summary.id === 'string' ? summary.id : newNodeId(), range: `(${start},${end})`, topicId: summaryTopicId })
      }
    }
    if (Object.keys(children).length) topic.children = children
    return topic
  }

  const relationships: XRelationship[] = (data.arrows ?? [])
    .filter((arrow) => typeof arrow.from === 'string' && typeof arrow.to === 'string')
    .map((arrow) => ({
      id: typeof arrow.id === 'string' ? arrow.id : newNodeId(),
      end1Id: arrow.from as string,
      end2Id: arrow.to as string,
      title: typeof arrow.label === 'string' ? arrow.label : '',
    }))

  return [
    {
      id: `sheet-${data.nodeData.id}`,
      class: 'sheet',
      title: sheetTitle || '画布 1',
      rootTopic: convert(data.nodeData, true),
      relationships: relationships.length ? relationships : undefined,
      topicPositioning: 'fixed',
    },
  ]
}

export interface XmindImport {
  data: MindmapData
  sheetCount: number
  /** Floating topics and other parts that have no equivalent here. */
  skipped: number
}

function styleFromXmind(properties: Record<string, string> | undefined, node: MindNode) {
  if (!properties) return
  const style: Record<string, string> = {}
  if (properties['fo:font-weight'] === 'bold' || /^[6-9]00$/.test(properties['fo:font-weight'] ?? '')) style.fontWeight = 'bold'
  if (properties['fo:font-style'] === 'italic') style.fontStyle = 'italic'
  const decoration = ['underline', 'line-through'].filter((item) => (properties['fo:text-decoration'] ?? '').includes(item)).join(' ')
  if (decoration) style.textDecoration = decoration
  const size = /^(\d{1,3})(pt|px)?$/.exec(properties['fo:font-size'] ?? '')
  if (size && Number(size[1]) >= 8 && Number(size[1]) <= 96) style.fontSize = `${size[1]}px`
  const color = safeStyleValue(properties['fo:color'])
  if (color && /^#[0-9a-f]{3,8}$/i.test(color)) style.color = color
  const fill = safeStyleValue(properties['svg:fill'])
  if (fill && /^#[0-9a-f]{3,8}$/i.test(fill)) style.background = fill
  const borderColor = properties['border-line-color']
  const borderWidth = /^(\d)(pt|px)?$/.exec(properties['border-line-width'] ?? '')
  if (borderColor && /^#[0-9a-f]{3,8}$/i.test(borderColor) && borderWidth && Number(borderWidth[1]) > 0) style.border = `${borderWidth[1]}px solid ${borderColor}`
  if (Object.keys(style).length) node.style = style
  const line = properties['line-color']
  if (line && /^#[0-9a-f]{3,8}$/i.test(line)) node.branchColor = line
}

/** Builds a mind map from the first sheet of an XMind `content.json`. Ids are kept so relationships still point at the right topics. */
export function xmindToMindmap(content: unknown): XmindImport {
  const sheets = (Array.isArray(content) ? content : []) as XSheet[]
  const sheet = sheets.find((item) => item && typeof item === 'object' && item.rootTopic)
  if (!sheet?.rootTopic) throw new Error('这个 .xmind 文件里没有找到导图内容。')
  let skipped = 0
  const ids = new Map<string, string>()
  const summaries: Record<string, unknown>[] = []

  const convert = (topic: XTopic, depth: number): MindNode => {
    const id = typeof topic.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(topic.id) && !ids.has(topic.id) ? topic.id : newNodeId()
    if (typeof topic.id === 'string') ids.set(topic.id, id)
    const node: MindNode = { id, topic: typeof topic.title === 'string' ? topic.title : '' }
    if (topic.branch === 'folded') node.expanded = false
    const note = topic.notes?.plain?.content
    if (typeof note === 'string' && note.trim()) node.note = note
    if (Array.isArray(topic.labels)) {
      const tags = topic.labels.filter((label): label is string => typeof label === 'string' && Boolean(label.trim())).map((label) => label.trim())
      if (tags.length) node.tags = tags
    }
    const markers = normalizeMarkers(
      (Array.isArray(topic.markers) ? topic.markers : [])
        .map((marker) => (typeof marker?.markerId === 'string' ? fromXmindMarker(marker.markerId) : null))
        .filter((marker): marker is string => marker !== null),
    )
    const pageExtension = topic.extensions?.find((extension) => extension?.provider === 'cn.zhixing.page')?.content as { page?: unknown } | undefined
    const page = typeof pageExtension?.page === 'number' && Number.isInteger(pageExtension.page) && pageExtension.page >= 1 && pageExtension.page <= MAX_PAGE ? pageExtension.page : undefined
    if (markers.length || page) node.metadata = { ...(markers.length ? { markers } : {}), ...(page ? { page } : {}) }
    if (typeof topic.href === 'string' && /^https?:\/\//i.test(topic.href)) node.hyperLink = topic.href
    styleFromXmind(topic.style?.properties, node)
    const attached = depth < 40 && Array.isArray(topic.children?.attached) ? topic.children.attached : []
    node.children = attached.filter((child) => child && typeof child === 'object').map((child) => convert(child, depth + 1))
    if (depth === 0 && Array.isArray(topic.children?.detached)) {
      for (const floating of topic.children.detached) {
        if (floating && typeof floating === 'object') node.children.push(convert(floating, depth + 1))
      }
    }
    skipped += Array.isArray(topic.children?.callout) ? topic.children.callout.length : 0
    const summaryTopics = new Map((topic.children?.summary ?? []).map((item) => [item.id, item.title]))
    for (const summary of topic.summaries ?? []) {
      const range = /^\((\d+),(\d+)\)$/.exec(summary.range ?? '')
      if (!range) continue
      const start = Number(range[1])
      const end = Math.min(Number(range[2]), node.children.length - 1)
      if (start > end) continue
      summaries.push({ id: newNodeId(), parent: id, start, end, label: summaryTopics.get(summary.topicId) ?? '概要' })
    }
    return node
  }

  const nodeData = convert(sheet.rootTopic, 0)
  if (!nodeData.topic.trim()) nodeData.topic = sheet.title?.trim() || '中心主题'
  const arrows = (sheet.relationships ?? [])
    .map((relation) => ({
      id: newNodeId(),
      from: relation.end1Id ? ids.get(relation.end1Id) : undefined,
      to: relation.end2Id ? ids.get(relation.end2Id) : undefined,
      label: typeof relation.title === 'string' ? relation.title : '',
    }))
    .filter((arrow): arrow is { id: string; from: string; to: string; label: string } => Boolean(arrow.from && arrow.to && arrow.from !== arrow.to))

  const data: MindmapData = { nodeData, direction: directionOf(sheet.rootTopic.structureClass) }
  if (arrows.length) data.arrows = arrows
  if (summaries.length) data.summaries = summaries
  return { data, sheetCount: sheets.length, skipped }
}

/** XMind 8 and earlier keep the map in `content.xml`; only titles, notes, labels, markers and links are read. */
export function xmindXmlToMindmap(doc: Document): XmindImport {
  const sheet = doc.getElementsByTagName('sheet')[0]
  const root = sheet ? Array.from(sheet.children).find((element) => element.localName === 'topic') : undefined
  if (!root) throw new Error('这个 .xmind 文件里没有找到导图内容。')
  const childElements = (element: Element, name: string) => Array.from(element.children).filter((child) => child.localName === name)

  const convert = (element: Element, depth: number): MindNode => {
    const node: MindNode = { id: newNodeId(), topic: childElements(element, 'title')[0]?.textContent ?? '' }
    if (element.getAttribute('branch') === 'folded') node.expanded = false
    const href = element.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? element.getAttribute('xlink:href')
    if (href && /^https?:\/\//i.test(href)) node.hyperLink = href
    const plain = childElements(element, 'notes')[0]?.getElementsByTagName('plain')[0]?.textContent
    if (plain?.trim()) node.note = plain
    const labels = Array.from(element.getElementsByTagName('label'))
      .filter((label) => label.parentElement?.parentElement === element)
      .map((label) => label.textContent?.trim() ?? '')
      .filter(Boolean)
    if (labels.length) node.tags = labels
    const markers = normalizeMarkers(
      Array.from(element.getElementsByTagName('marker-ref'))
        .filter((marker) => marker.parentElement?.parentElement === element)
        .map((marker) => fromXmindMarker(marker.getAttribute('marker-id') ?? ''))
        .filter((marker): marker is string => marker !== null),
    )
    if (markers.length) node.metadata = { markers }
    node.children = []
    if (depth < 40) {
      for (const topics of childElements(childElements(element, 'children')[0] ?? element, 'topics')) {
        const type = topics.getAttribute('type')
        if (type !== 'attached' && !(depth === 0 && type === 'detached')) continue
        for (const child of childElements(topics, 'topic')) node.children.push(convert(child, depth + 1))
      }
    }
    return node
  }

  const nodeData = convert(root, 0)
  if (!nodeData.topic.trim()) nodeData.topic = '中心主题'
  return { data: { nodeData, direction: directionOf(root.getAttribute('structure-class') ?? undefined) }, sheetCount: doc.getElementsByTagName('sheet').length, skipped: 0 }
}
