import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import {
  AlertFillIcon,
  CheckCircleFillIcon,
  FlagIcon,
  LightBulbIcon,
  LinkIcon,
  NoteIcon,
  PinIcon,
  QuestionIcon,
  QuoteIcon,
  StarFillIcon,
  XCircleFillIcon,
  type Icon,
} from '@primer/octicons-react'

/**
 * mind-elixir renders topics from HTML strings, so the Octicons used inside topics are rendered
 * once to static SVG markup. Call `prepareIcons()` outside React rendering before the map starts.
 */
const ICONS = {
  flag: FlagIcon,
  star: StarFillIcon,
  question: QuestionIcon,
  alert: AlertFillIcon,
  idea: LightBulbIcon,
  check: CheckCircleFillIcon,
  cross: XCircleFillIcon,
  quote: QuoteIcon,
  pin: PinIcon,
  note: NoteIcon,
  link: LinkIcon,
} satisfies Record<string, Icon>

export type TopicIcon = keyof typeof ICONS

let cache: Record<TopicIcon, string> | null = null

export function prepareIcons(): void {
  if (cache) return
  const host = document.createElement('div')
  const root = createRoot(host)
  const html = {} as Record<TopicIcon, string>
  for (const [name, Component] of Object.entries(ICONS) as [TopicIcon, Icon][]) {
    flushSync(() => root.render(createElement(Component, { size: 12 })))
    html[name] = host.innerHTML
  }
  root.unmount()
  cache = html
}

export function iconHtml(name: TopicIcon): string {
  return cache?.[name] ?? ''
}
