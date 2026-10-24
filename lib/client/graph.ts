import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force'
import { displayName } from '@/lib/shared/mindmap'
import type { LibraryInsights, Paper, RelationType } from '@/lib/shared/types'
import { UNSORTED_TOPIC } from './library'
import { baseName } from './vault'

export type GraphNodeKind = 'paper' | 'mindmap' | 'note'
export type GraphLinkType = RelationType | 'file'

export interface GraphNode {
  id: string
  kind: GraphNodeKind
  label: string
  paper: Paper
  /** Vault path for mind map and note nodes. */
  path: string | null
  topic: string
  degree: number
  r: number
  x: number
  y: number
}

export interface GraphLink {
  id: string
  source: string
  target: string
  type: GraphLinkType
  note: string
}

export interface GraphLayout {
  nodes: GraphNode[]
  links: GraphLink[]
  topics: string[]
  bounds: { x: number; y: number; width: number; height: number }
}

const PALETTE = ['blue', 'green', 'orange', 'purple', 'pink', 'teal', 'yellow', 'red', 'lime', 'coral', 'plum', 'pine', 'auburn', 'brown', 'olive', 'lemon']

export function topicColor(topics: string[], topic: string): string {
  if (topic === UNSORTED_TOPIC) return 'var(--data-gray-color-emphasis)'
  const index = topics.indexOf(topic)
  return `var(--data-${PALETTE[(index < 0 ? 0 : index) % PALETTE.length]}-color-emphasis)`
}

type SimNode = SimulationNodeDatum & { id: string; r: number; kind: GraphNodeKind; topic: string }
type SimLink = SimulationLinkDatum<SimNode> & { type: GraphLinkType }

/** Papers grouped by topic, joined by the relations "AI 整理" found; optionally with each paper's own mind map and note. */
export function buildGraph(papers: Paper[], insights: LibraryInsights | null, withFiles: boolean): GraphLayout {
  const known = new Map(papers.map((paper) => [paper.id, paper]))
  const topicOf = (paper: Paper) => paper.topic.trim() || UNSORTED_TOPIC

  const topics: string[] = []
  for (const topic of insights?.topics ?? []) if (!topics.includes(topic.name)) topics.push(topic.name)
  for (const paper of papers) {
    const topic = topicOf(paper)
    if (!topics.includes(topic)) topics.push(topic)
  }
  topics.sort((a, b) => Number(a === UNSORTED_TOPIC) - Number(b === UNSORTED_TOPIC))

  const links: GraphLink[] = []
  const seen = new Set<string>()
  const degree = new Map<string, number>()
  for (const relation of insights?.relations ?? []) {
    if (relation.from === relation.to || !known.has(relation.from) || !known.has(relation.to)) continue
    const key = [relation.from, relation.to].sort().join('|')
    if (seen.has(key)) continue
    seen.add(key)
    links.push({ id: key, source: relation.from, target: relation.to, type: relation.type, note: relation.note })
    degree.set(relation.from, (degree.get(relation.from) ?? 0) + 1)
    degree.set(relation.to, (degree.get(relation.to) ?? 0) + 1)
  }

  const nodes: GraphNode[] = papers.map((paper) => {
    const count = degree.get(paper.id) ?? 0
    return { id: paper.id, kind: 'paper', label: paper.title, paper, path: null, topic: topicOf(paper), degree: count, r: 7 + Math.min(7, count * 1.5), x: 0, y: 0 }
  })

  if (withFiles) {
    for (const paper of papers) {
      for (const kind of ['mindmap', 'note'] as const) {
        const path = paper[kind]
        if (!path) continue
        const id = `${kind}:${paper.id}`
        nodes.push({ id, kind, label: displayName(baseName(path)), paper, path, topic: topicOf(paper), degree: 1, r: 4.5, x: 0, y: 0 })
        links.push({ id, source: paper.id, target: id, type: 'file', note: '' })
      }
    }
  }

  const clusters = topics.length
  const ring = clusters > 1 ? 140 + 36 * clusters : 0
  const centre = new Map(
    topics.map((topic, index) => {
      const angle = (index / Math.max(1, clusters)) * Math.PI * 2 - Math.PI / 2
      return [topic, { x: Math.cos(angle) * ring, y: Math.sin(angle) * ring }]
    }),
  )

  const sim: SimNode[] = nodes.map((node, index) => {
    const origin = centre.get(node.topic) ?? { x: 0, y: 0 }
    const angle = index * 2.399963
    const spread = 12 * Math.sqrt(index + 1)
    return { id: node.id, r: node.r, kind: node.kind, topic: node.topic, x: origin.x + Math.cos(angle) * spread, y: origin.y + Math.sin(angle) * spread }
  })
  const simLinks: SimLink[] = links.map((link) => ({ source: link.source, target: link.target, type: link.type }))

  const simulation = forceSimulation(sim)
    .force(
      'link',
      forceLink<SimNode, SimLink>(simLinks)
        .id((node) => node.id)
        .distance((link) => (link.type === 'file' ? 26 : 110))
        .strength((link) => (link.type === 'file' ? 1 : 0.25)),
    )
    .force('charge', forceManyBody<SimNode>().strength((node) => (node.kind === 'paper' ? -280 : -30)))
    .force('collide', forceCollide<SimNode>((node) => node.r + (node.kind === 'paper' ? 14 : 4)))
    .force('x', forceX<SimNode>((node) => centre.get(node.topic)?.x ?? 0).strength(0.07))
    .force('y', forceY<SimNode>((node) => centre.get(node.topic)?.y ?? 0).strength(0.07))
    .stop()
  const ticks = Math.ceil(Math.log(simulation.alphaMin()) / Math.log(1 - simulation.alphaDecay()))
  for (let tick = 0; tick < ticks; tick++) simulation.tick()

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  nodes.forEach((node, index) => {
    node.x = sim[index].x ?? 0
    node.y = sim[index].y ?? 0
    minX = Math.min(minX, node.x - node.r)
    minY = Math.min(minY, node.y - node.r)
    maxX = Math.max(maxX, node.x + node.r)
    maxY = Math.max(maxY, node.y + node.r + 18)
  })
  if (!nodes.length) {
    minX = minY = -100
    maxX = maxY = 100
  }
  const pad = 80
  return {
    nodes,
    links,
    topics,
    bounds: { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 },
  }
}

export const LINK_STYLE: Record<GraphLinkType, { color: string; dash?: string }> = {
  extends: { color: 'var(--fgColor-accent)' },
  compares: { color: 'var(--fgColor-attention)', dash: '6 4' },
  contradicts: { color: 'var(--fgColor-danger)', dash: '2 4' },
  method: { color: 'var(--fgColor-done)' },
  data: { color: 'var(--fgColor-success)', dash: '8 3 2 3' },
  related: { color: 'var(--fgColor-muted)' },
  file: { color: 'var(--borderColor-default)', dash: '2 3' },
}
