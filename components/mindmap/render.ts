import { markerLabel, type MindNode } from '@/lib/shared/mindmap'
import { iconHtml, type TopicIcon } from './icons'

export const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const SYMBOL_ICON: Record<string, TopicIcon> = {
  'symbol-star': 'star',
  'symbol-question': 'question',
  'symbol-alert': 'alert',
  'symbol-idea': 'idea',
  'symbol-check': 'check',
  'symbol-cross': 'cross',
  'symbol-quote': 'quote',
  'symbol-pin': 'pin',
}

export function markerHtml(id: string): string {
  const label = escapeHtml(markerLabel(id))
  const [kind, value] = id.split('-')
  if (kind === 'priority') return `<span class="zx-marker zx-priority" data-level="${escapeHtml(value)}" role="img" aria-label="${label}">${escapeHtml(value)}</span>`
  if (kind === 'progress') return `<span class="zx-marker zx-progress" data-progress="${escapeHtml(value)}" role="img" aria-label="${label}"></span>`
  if (kind === 'flag') return `<span class="zx-marker zx-flag" data-color="${escapeHtml(value)}" role="img" aria-label="${label}">${iconHtml('flag')}</span>`
  const icon = SYMBOL_ICON[id]
  return icon ? `<span class="zx-marker zx-symbol" data-symbol="${escapeHtml(value)}" role="img" aria-label="${label}">${iconHtml(icon)}</span>` : ''
}

const preview = (text: string) => (text.length > 300 ? `${text.slice(0, 300)}…` : text)

/**
 * HTML for a topic, passed to mind-elixir as its `markdown` hook so markers and badges are part of
 * the topic before layout (adding them afterwards would leave branch lines misaligned). Arrow and
 * summary labels come through the same hook and are only escaped.
 */
export function renderTopic(text: string, obj: unknown): string {
  const node = obj as Partial<MindNode> | null
  if (!node || typeof node.topic !== 'string') return escapeHtml(text)
  const parts: string[] = []
  const markers = node.metadata?.markers
  if (markers?.length) parts.push(`<span class="zx-markers">${markers.map(markerHtml).join('')}</span>`)
  parts.push(`<span class="zx-text">${escapeHtml(text)}</span>`)
  const badges: string[] = []
  if (node.hyperLink && /^https?:\/\//i.test(node.hyperLink)) {
    badges.push(
      `<a class="zx-badge" data-zx="link" href="${escapeHtml(node.hyperLink)}" target="_blank" rel="noopener noreferrer" draggable="false" title="${escapeHtml(node.hyperLink)}" aria-label="打开链接">${iconHtml('link')}</a>`,
    )
  }
  if (node.note) {
    badges.push(`<a class="zx-badge" data-zx="note" role="button" draggable="false" title="${escapeHtml(preview(node.note))}" aria-label="查看备注">${iconHtml('note')}</a>`)
  }
  const page = node.metadata?.page
  if (page) {
    badges.push(`<a class="zx-badge zx-page" data-zx="page" data-page="${page}" role="button" draggable="false" title="对照原文第 ${page} 页" aria-label="对照原文第 ${page} 页">p.${page}</a>`)
  }
  if (badges.length) parts.push(`<span class="zx-badges">${badges.join('')}</span>`)
  return parts.join('')
}
