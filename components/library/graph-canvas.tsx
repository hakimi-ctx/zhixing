'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IconButton } from '@primer/react'
import { ScreenNormalIcon, ZoomInIcon, ZoomOutIcon } from '@primer/octicons-react'
import { LINK_STYLE, topicColor, type GraphLayout, type GraphNode } from '@/lib/client/graph'
import styles from './graph.module.css'

interface GraphCanvasProps {
  layout: GraphLayout
  selected: string | null
  onSelect: (node: GraphNode | null) => void
  onOpen: (node: GraphNode, event: React.MouseEvent | React.KeyboardEvent) => void
}

interface View {
  x: number
  y: number
  k: number
}

const IDENTITY: View = { x: 0, y: 0, k: 1 }
const MIN_ZOOM = 0.25
const MAX_ZOOM = 5
const LABEL_LIMIT = 18

const shorten = (text: string) => (text.length > LABEL_LIMIT ? `${text.slice(0, LABEL_LIMIT - 1)}…` : text)
const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k))

export function GraphCanvas({ layout, selected, onSelect, onOpen }: GraphCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [view, setView] = useState<View>(IDENTITY)
  const [hovered, setHovered] = useState<string | null>(null)
  const pan = useRef<{ x: number; y: number; view: View; moved: boolean } | null>(null)

  const byId = useMemo(() => new Map(layout.nodes.map((node) => [node.id, node])), [layout])
  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const link of layout.links) {
      if (!map.has(link.source)) map.set(link.source, new Set())
      if (!map.has(link.target)) map.set(link.target, new Set())
      map.get(link.source)!.add(link.target)
      map.get(link.target)!.add(link.source)
    }
    return map
  }, [layout])

  const focus = hovered ?? selected
  const lit = useMemo(() => {
    if (!focus || !byId.has(focus)) return null
    return new Set([focus, ...(neighbours.get(focus) ?? [])])
  }, [focus, byId, neighbours])

  const paperCount = useMemo(() => layout.nodes.filter((node) => node.kind === 'paper').length, [layout])

  const toViewBox = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current
    const matrix = svg?.getScreenCTM()
    if (!svg || !matrix) return { x: 0, y: 0 }
    const point = svg.createSVGPoint()
    point.x = clientX
    point.y = clientY
    const result = point.matrixTransform(matrix.inverse())
    return { x: result.x, y: result.y }
  }, [])

  const zoomAt = useCallback((factor: number, anchor?: { x: number; y: number }) => {
    setView((current) => {
      const k = clampZoom(current.k * factor)
      const { x: bx, y: by, width, height } = layout.bounds
      const point = anchor ?? { x: bx + width / 2, y: by + height / 2 }
      const ratio = k / current.k
      return { k, x: point.x - (point.x - current.x) * ratio, y: point.y - (point.y - current.y) * ratio }
    })
  }, [layout.bounds])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      zoomAt(Math.exp(-event.deltaY * 0.0015), toViewBox(event.clientX, event.clientY))
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [zoomAt, toViewBox])

  useEffect(() => {
    setView(IDENTITY)
  }, [layout.bounds.width, layout.bounds.height])

  const showLabel = (node: GraphNode) => {
    if (node.kind !== 'paper') return lit?.has(node.id) ?? false
    if (lit) return lit.has(node.id)
    return paperCount <= 40 || node.degree >= 2 || node.id === selected
  }

  const { x, y, width, height } = layout.bounds

  return (
    <div className={styles.canvasWrap}>
      <svg
        ref={svgRef}
        className={styles.canvas}
        viewBox={`${x} ${y} ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`论文关系图谱，${paperCount} 篇论文，${layout.links.filter((link) => link.type !== 'file').length} 条关系`}
        onPointerDown={(event) => {
          if (event.button !== 0 || (event.target as Element).closest('[data-node]')) return
          event.currentTarget.setPointerCapture(event.pointerId)
          pan.current = { ...toViewBox(event.clientX, event.clientY), view, moved: false }
        }}
        onPointerMove={(event) => {
          const start = pan.current
          if (!start) return
          const point = toViewBox(event.clientX, event.clientY)
          const dx = point.x - start.x
          const dy = point.y - start.y
          if (!start.moved && Math.hypot(dx, dy) < 3) return
          start.moved = true
          setView({ ...start.view, x: start.view.x + dx, y: start.view.y + dy })
        }}
        onPointerUp={() => {
          const start = pan.current
          pan.current = null
          if (start && !start.moved) onSelect(null)
        }}
        onPointerCancel={() => {
          pan.current = null
        }}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <g className={styles.links}>
            {layout.links.map((link) => {
              const from = byId.get(link.source)
              const to = byId.get(link.target)
              if (!from || !to) return null
              const style = LINK_STYLE[link.type]
              const active = lit ? lit.has(link.source) && lit.has(link.target) : true
              return (
                <line
                  key={link.id}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={style.color}
                  strokeDasharray={style.dash}
                  strokeWidth={link.type === 'file' ? 1 : lit && active ? 2.2 : 1.4}
                  opacity={active ? (link.type === 'file' ? 0.8 : 0.85) : 0.12}
                  vectorEffect="non-scaling-stroke"
                />
              )
            })}
          </g>
          <g>
            {layout.nodes.map((node) => {
              const color = topicColor(layout.topics, node.topic)
              const dim = lit ? !lit.has(node.id) : false
              const isSelected = node.id === selected
              const label = node.kind === 'paper' ? `论文：${node.label}` : `${node.kind === 'mindmap' ? '导图' : '笔记'}：${node.label}`
              return (
                <g
                  key={node.id}
                  data-node=""
                  className={styles.node}
                  transform={`translate(${node.x} ${node.y})`}
                  opacity={dim ? 0.18 : 1}
                  role="button"
                  tabIndex={0}
                  aria-label={label}
                  aria-pressed={node.kind === 'paper' ? isSelected : undefined}
                  onPointerEnter={() => setHovered(node.id)}
                  onPointerLeave={() => setHovered((current) => (current === node.id ? null : current))}
                  onFocus={() => setHovered(node.id)}
                  onBlur={() => setHovered((current) => (current === node.id ? null : current))}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    onSelect(node)
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation()
                    onOpen(node, event)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      onOpen(node, event)
                    } else if (event.key === ' ') {
                      event.preventDefault()
                      onSelect(node)
                    }
                  }}
                >
                  <title>{label}</title>
                  <circle r={Math.max(14, node.r + 8)} className={styles.hit} />
                  {isSelected ? <circle r={node.r + 5} className={styles.selectedRing} vectorEffect="non-scaling-stroke" /> : null}
                  {node.kind === 'paper' ? (
                    <circle r={node.r} fill={color} className={styles.paperDot} vectorEffect="non-scaling-stroke" />
                  ) : node.kind === 'mindmap' ? (
                    <circle r={node.r} stroke={color} className={styles.fileDot} vectorEffect="non-scaling-stroke" />
                  ) : (
                    <rect x={-node.r} y={-node.r} width={node.r * 2} height={node.r * 2} rx={1.5} stroke={color} className={styles.fileDot} vectorEffect="non-scaling-stroke" />
                  )}
                  {showLabel(node) ? (
                    <text y={node.r + 13} className={node.kind === 'paper' ? styles.label : styles.fileLabel}>
                      {shorten(node.label)}
                    </text>
                  ) : null}
                </g>
              )
            })}
          </g>
        </g>
      </svg>
      <div className={styles.zoomBar}>
        <IconButton icon={ZoomInIcon} aria-label="放大" size="small" variant="invisible" onClick={() => zoomAt(1.25)} />
        <IconButton icon={ZoomOutIcon} aria-label="缩小" size="small" variant="invisible" onClick={() => zoomAt(0.8)} />
        <IconButton icon={ScreenNormalIcon} aria-label="适应窗口" size="small" variant="invisible" onClick={() => setView(IDENTITY)} />
      </div>
    </div>
  )
}
