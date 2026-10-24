import type { Before, MindElixirData, MindElixirInstance, NodeObj, Operation, SummarySvg, Topic } from 'mind-elixir'
import {
  MAX_DEPTH,
  MAX_NODES,
  MAX_PAGE,
  cloneWithNewIds,
  countNodes,
  joinWrappedLines,
  markerGroupOf,
  newNodeId,
  nodesToText,
  normalizeMarkers,
  textToNodes,
  walkNodes,
  type MindNode,
  type MindTheme,
  type MindmapData,
  type NodeMeta,
} from '@/lib/shared/mindmap'
import { SnapshotHistory } from './history'
import { prepareIcons } from './icons'
import type { CommandId } from './keymap'
import { renderTopic } from './render'
import { buildTheme, resolveColor } from './theme'

type Arrow = MindElixirInstance['arrows'][number]
type Summary = MindElixirInstance['summaries'][number]
type ArrowOptions = NonNullable<Parameters<MindElixirInstance['createArrow']>[2]>
export type Direction = 0 | 1 | 2 | 3
type Side = 'lhs' | 'rhs' | 'down' | 'root'
type Nav = 'up' | 'down' | 'left' | 'right'

export type StyleKey = 'fontSize' | 'color' | 'background' | 'fontWeight' | 'fontStyle' | 'textDecoration' | 'border'
export type TextStyle = 'bold' | 'italic' | 'underline' | 'strike'
export type QuickStyle = 'veryImportant' | 'important' | 'crossOut' | 'default'
export type PanelField = 'note' | 'labels' | 'link' | 'page'

/** Drag data set by the paper reader, so a quote dropped on the map remembers its page. */
export const SOURCE_PAGE_MIME = 'application/x-zhixing-page'

export interface SelectedTopic {
  id: string
  isRoot: boolean
  /** A detached copy of the topic without its children. */
  node: MindNode
  childCount: number
  /** Rendered font size in px (only measured for the primary topic). */
  fontSize: number
}

export interface MapState {
  ready: boolean
  /** Bumped on every change to the map's content. */
  version: number
  /** In selection order; the last one is the primary topic. */
  selection: SelectedTopic[]
  arrow: { id: string; label: string; bidirectional: boolean } | null
  summary: { id: string; label: string } | null
  canUndo: boolean
  canRedo: boolean
  direction: Direction
  themeName: MindTheme
  compact: boolean
  scale: number
  nodeCount: number
  /** Waiting for the student to pick the second topic of a relationship. */
  linking: boolean
}

export type MapEvent =
  | { type: 'contextmenu'; x: number; y: number; onTopic: boolean }
  | { type: 'field'; field: PanelField }
  | { type: 'page'; page: number }
  | { type: 'notice'; variant: 'default' | 'success' | 'warning' | 'danger'; text: string }

const INITIAL_STATE: MapState = {
  ready: false,
  version: 0,
  selection: [],
  arrow: null,
  summary: null,
  canUndo: false,
  canRedo: false,
  direction: 2,
  themeName: 'classic',
  compact: false,
  scale: 1,
  nodeCount: 0,
  linking: false,
}

export const FONT_SIZES = [12, 13, 14, 15, 16, 18, 20, 24, 28, 32, 36, 40, 48]

const QUICK_STYLES: Record<Exclude<QuickStyle, 'default'>, Record<string, string>> = {
  veryImportant: { background: 'var(--display-red-bgColor-emphasis)', color: 'var(--fgColor-onEmphasis)', fontWeight: 'bold' },
  important: { background: 'var(--display-orange-bgColor-emphasis)', color: 'var(--fgColor-onEmphasis)', fontWeight: 'bold' },
  crossOut: { textDecoration: 'line-through', color: 'var(--fgColor-muted)' },
}

/** Topics copied in this window, so pasting into another map keeps markers, notes and styles. */
let clipboard: { text: string; nodes: MindNode[] } | null = null
const normalizeClip = (text: string) => text.replace(/\r\n?/g, '\n').trim()

const isTopic = (element: Element | null | undefined): element is Topic => element?.tagName === 'ME-TPC'

function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.id === 'input-box' || target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
}

/** A copy of the topic and its subtree without the parent pointers mind-elixir adds. */
function stripTree(node: NodeObj): MindNode {
  return JSON.parse(JSON.stringify(node, (key, value: unknown) => (key === 'parent' ? undefined : value))) as MindNode
}

function detach(node: NodeObj): MindNode {
  return JSON.parse(JSON.stringify({ ...node, parent: undefined, children: undefined })) as MindNode
}

function relink(root: NodeObj): void {
  delete root.parent
  const stack: NodeObj[] = [root]
  while (stack.length) {
    const node = stack.pop()!
    for (const child of node.children ?? []) {
      child.parent = node
      stack.push(child)
    }
  }
}

function depthOf(node: NodeObj): number {
  let depth = 0
  for (let parent = node.parent; parent; parent = parent.parent) depth += 1
  return depth
}

function heightOf(node: MindNode | NodeObj): number {
  let height = 0
  walkNodes(node as MindNode, (_child, _parent, depth) => {
    if (depth > height) height = depth
  })
  return height
}

const styleOf = (node: NodeObj) => ({ ...((node.style as Record<string, string> | undefined) ?? {}) })

function assignStyle(node: NodeObj, style: Record<string, string>): void {
  if (Object.keys(style).length) node.style = style as NodeObj['style']
  else delete node.style
}

const metaOf = (node: NodeObj): NodeMeta => ({ ...((node.metadata as NodeMeta | undefined) ?? {}) })

function assignMeta(node: NodeObj, meta: NodeMeta): void {
  if (Object.keys(meta).length) node.metadata = meta
  else delete node.metadata
}

/**
 * Owns the mind-elixir instance behind one editor: commands, selection, formatting, clipboard,
 * undo history and change notifications. React components read `getState()` through
 * `useSyncExternalStore` and call methods; they never touch mind-elixir directly.
 */
export class MapController {
  private mind: MindElixirInstance | null = null
  private generation = 0
  private readonly history = new SnapshotHistory()
  private readonly listeners = new Set<() => void>()
  private readonly eventListeners = new Set<(event: MapEvent) => void>()
  private state: MapState = INITIAL_STATE
  private emitQueued = false
  private version = 0
  private nodeCount = 0
  private themeName: MindTheme = 'classic'
  private palette: string[] = []
  private paperId: string | undefined
  private commitQueued = false
  private pendingBefore: { ids: string[]; at: number } | null = null
  private settledSelection: string[] = []
  private settleTimer: ReturnType<typeof setTimeout> | null = null
  private mapVisible = true
  private needsRelayout = false
  private focusIds: string[] = []
  private linkFrom: string | null = null
  private copiedStyle: { style?: Record<string, string>; branchColor?: string } | null = null
  private lastContent: string | null = null
  private cleanup: (() => void)[] = []

  constructor(private readonly options: { onChange: () => void }) {}

  /* ---------- Store ---------- */

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getState = (): MapState => this.state

  onEvent(listener: (event: MapEvent) => void): () => void {
    this.eventListeners.add(listener)
    return () => {
      this.eventListeners.delete(listener)
    }
  }

  private fire(event: MapEvent): void {
    for (const listener of this.eventListeners) listener(event)
  }

  private notice(text: string, variant: 'warning' | 'default' = 'warning'): void {
    this.fire({ type: 'notice', variant, text })
  }

  /** State is rebuilt once per tick, however many mind-elixir events fired. */
  private emit(): void {
    if (this.emitQueued) return
    this.emitQueued = true
    queueMicrotask(() => {
      this.emitQueued = false
      this.state = this.buildState()
      for (const listener of this.listeners) listener()
    })
  }

  private buildState(): MapState {
    const mind = this.mind
    if (!mind) return { ...INITIAL_STATE, version: this.version }
    const topics = this.selectedTopics()
    const primary = topics[topics.length - 1]
    const arrow = mind.currentArrow?.arrowObj
    const summary = mind.currentSummary?.summaryObj
    return {
      ready: true,
      version: this.version,
      selection: topics.map((topic) => ({
        id: topic.nodeObj.id,
        isRoot: !topic.nodeObj.parent,
        node: detach(topic.nodeObj),
        childCount: topic.nodeObj.children?.length ?? 0,
        fontSize: topic === primary ? Number.parseFloat(getComputedStyle(topic).fontSize) || 16 : 16,
      })),
      arrow: arrow ? { id: arrow.id, label: arrow.label, bidirectional: Boolean(arrow.bidirectional) } : null,
      summary: summary ? { id: summary.id, label: summary.label } : null,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      direction: mind.direction,
      themeName: this.themeName,
      compact: mind.compact,
      scale: mind.scaleVal,
      nodeCount: this.nodeCount,
      linking: this.linkFrom !== null,
    }
  }

  /* ---------- Lifecycle ---------- */

  async mount(el: HTMLElement, data: MindmapData): Promise<void> {
    const generation = ++this.generation
    const { default: MindElixir } = await import('mind-elixir')
    if (generation !== this.generation) return
    prepareIcons()
    this.themeName = data.themeName ?? 'classic'
    this.paperId = data.paperId
    this.palette = [...MindElixir.THEME.palette]
    const mind = new MindElixir({
      el,
      direction: data.direction ?? MindElixir.SIDE,
      editable: true,
      contextMenu: false,
      toolBar: false,
      keypress: false,
      allowUndo: false,
      compact: data.compact ?? false,
      theme: buildTheme(this.themeName, this.palette),
      markdown: renderTopic,
      newTopicName: '分支主题',
      scaleMin: 0.2,
      scaleMax: 3,
      before: this.guards(),
    })
    const failure = mind.init(this.toElixir(data))
    if (failure) throw failure
    this.mind = mind
    this.attach(mind)
    this.nodeCount = countNodes(mind.nodeData as unknown as MindNode)
    this.history.reset(this.snapshot())
    const root = this.rootTopic()
    if (root) mind.selectNode(root)
    this.lastContent = null
    this.settledSelection = []
    this.version += 1
    this.emit()
  }

  destroy(): void {
    this.generation += 1
    for (const dispose of this.cleanup.splice(0)) dispose()
    if (this.settleTimer) clearTimeout(this.settleTimer)
    this.settleTimer = null
    if (this.mind) {
      // Autosave may still flush after the editor unmounts; it then reads this.
      this.lastContent = JSON.stringify(this.data(), null, 2)
      this.mind.destroy()
    }
    this.mind = null
    this.linkFrom = null
    this.emit()
  }

  private toElixir(data: MindmapData): MindElixirData {
    return {
      nodeData: data.nodeData as unknown as NodeObj,
      arrows: (data.arrows ?? []) as unknown as Arrow[],
      summaries: (data.summaries ?? []) as unknown as Summary[],
      direction: data.direction ?? 2,
      compact: data.compact ?? false,
    }
  }

  /** Refuses edits that the file format cannot hold (see sanitizeMindmap) and names new topics like XMind. */
  private guards(): Before {
    const allow = (adding: number): boolean => {
      const mind = this.mind
      if (!mind) return false
      if (countNodes(mind.nodeData as unknown as MindNode) + adding > MAX_NODES) {
        this.notice(`一张导图最多 ${MAX_NODES} 个主题，已经到上限了。`)
        return false
      }
      return true
    }
    const fitsDepth = (parent: NodeObj, subtreeHeight: number): boolean => {
      if (depthOf(parent) + 1 + subtreeHeight <= MAX_DEPTH) return true
      this.notice(`导图最多 ${MAX_DEPTH} 层。`)
      return false
    }
    const nameUnder = (parent: NodeObj) => {
      if (this.mind) this.mind.newTopicName = parent.parent ? '子主题' : '分支主题'
    }
    return {
      addChild: (el, node) => {
        const target = el ?? this.mind?.currentNode
        if (!target) return false
        nameUnder(target.nodeObj)
        return fitsDepth(target.nodeObj, node ? heightOf(node) : 0) && allow(node ? countNodes(node as unknown as MindNode) : 1)
      },
      insertSibling: (_type, el, node) => {
        const target = el ?? this.mind?.currentNode
        if (!target) return false
        nameUnder(target.nodeObj.parent ?? target.nodeObj)
        return allow(node ? countNodes(node as unknown as MindNode) : 1)
      },
      insertParent: (el) => {
        const target = el ?? this.mind?.currentNode
        if (!target?.nodeObj.parent) return false
        return fitsDepth(target.nodeObj.parent, heightOf(target.nodeObj) + 1) && allow(1)
      },
      copyNode: (node, to) => fitsDepth(to.nodeObj, heightOf(node.nodeObj)) && allow(countNodes(node.nodeObj as unknown as MindNode)),
      copyNodes: (nodes, to) =>
        fitsDepth(to.nodeObj, Math.max(0, ...nodes.map((node) => heightOf(node.nodeObj)))) &&
        allow(nodes.reduce((sum, node) => sum + countNodes(node.nodeObj as unknown as MindNode), 0)),
      moveNodeIn: (from, to) => fitsDepth(to.nodeObj, Math.max(0, ...from.map((node) => heightOf(node.nodeObj)))),
    }
  }

  private attach(mind: MindElixirInstance): void {
    const { bus, container } = mind
    const onSelection = () => this.onSelectionChange()
    bus.addListener('operation', (operation: Operation) => {
      if (operation.name !== 'beginEdit') this.scheduleCommit()
    })
    bus.addListener('selectNodes', onSelection)
    bus.addListener('unselectNodes', onSelection)
    bus.addListener('selectArrow', onSelection)
    bus.addListener('unselectArrow', onSelection)
    bus.addListener('selectSummary', onSelection)
    bus.addListener('unselectSummary', onSelection)
    bus.addListener('expandNode', () => this.scheduleCommit())
    bus.addListener('scale', () => this.emit())
    bus.addListener('showContextMenu', (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('me-tpc') : null
      this.fire({ type: 'contextmenu', x: event.clientX, y: event.clientY, onTopic: Boolean(target) })
    })

    container.tabIndex = 0
    const listen = <K extends keyof HTMLElementEventMap>(type: K, handler: (event: HTMLElementEventMap[K]) => void, capture = false) => {
      container.addEventListener(type, handler, capture)
      this.cleanup.push(() => container.removeEventListener(type, handler, capture))
    }
    listen(
      'pointerdown',
      (event) => {
        if (!isTextTarget(event.target) && document.activeElement !== container) container.focus({ preventScroll: true })
      },
      true,
    )
    listen('copy', (event) => this.onCopy(event, false))
    listen('cut', (event) => this.onCopy(event, true))
    listen('paste', (event) => this.onPaste(event))
    listen('click', (event) => this.onBadgeClick(event))
    listen('dragover', (event) => this.onDragOver(event))
    listen('drop', (event) => this.onDrop(event))
  }

  /* ---------- Change tracking ---------- */

  private snapshot(): string {
    return JSON.stringify(this.data())
  }

  /** The map as stored on disk. */
  data(): MindmapData {
    const mind = this.mind
    if (!mind) throw new Error('导图还没有加载。')
    const raw = mind.getData()
    const out: MindmapData = { nodeData: raw.nodeData as unknown as MindNode, direction: raw.direction ?? 2 }
    if (raw.arrows?.length) out.arrows = raw.arrows as unknown as Record<string, unknown>[]
    if (raw.summaries?.length) out.summaries = raw.summaries as unknown as Record<string, unknown>[]
    if (this.themeName !== 'classic') out.themeName = this.themeName
    if (raw.compact) out.compact = true
    if (this.paperId) out.paperId = this.paperId
    return out
  }

  /** Pretty JSON for the file; still available right after the editor unmounted. */
  fileContent(): string | null {
    if (this.mind) this.lastContent = JSON.stringify(this.data(), null, 2)
    return this.lastContent
  }

  setPaperId(id: string): void {
    this.paperId = id
  }

  private markBefore(): void {
    this.pendingBefore = { ids: this.selectedIds(), at: Date.now() }
  }

  private scheduleCommit(): void {
    if (this.commitQueued) return
    this.commitQueued = true
    queueMicrotask(() => {
      this.commitQueued = false
      this.commit()
    })
  }

  /** Records the current map in the undo history and tells the editor it changed. */
  private commit(coalesce?: string): void {
    const mind = this.mind
    if (!mind) return
    mind.tidyArrow()
    const after = this.selectedIds()
    const pending = this.pendingBefore
    const before = pending && Date.now() - pending.at < 2000 ? pending.ids : this.settledSelection
    this.pendingBefore = null
    if (this.history.record({ snapshot: this.snapshot(), before, after }, coalesce)) {
      this.version += 1
      this.nodeCount = countNodes(mind.nodeData as unknown as MindNode)
      this.options.onChange()
    }
    this.settledSelection = after
    this.emit()
  }

  private onSelectionChange(): void {
    if (this.linkFrom) this.completeLink()
    if (this.settleTimer) clearTimeout(this.settleTimer)
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null
      if (!this.commitQueued) this.settledSelection = this.selectedIds()
    }, 0)
    this.emit()
  }

  undo(): void {
    const step = this.mind ? this.history.undo() : null
    if (!step) return
    this.applyData(JSON.parse(step.snapshot) as MindmapData, step.selection)
    this.afterJump()
  }

  redo(): void {
    const step = this.mind ? this.history.redo() : null
    if (!step) return
    this.applyData(JSON.parse(step.snapshot) as MindmapData, step.selection)
    this.afterJump()
  }

  private afterJump(): void {
    this.linkFrom = null
    this.version += 1
    this.nodeCount = countNodes(this.mind!.nodeData as unknown as MindNode)
    this.settledSelection = this.selectedIds()
    this.options.onChange()
    this.emit()
  }

  private applyData(data: MindmapData, select: string[]): void {
    const mind = this.mind!
    mind.direction = data.direction ?? 2
    if (data.paperId) this.paperId = data.paperId
    const theme = data.themeName ?? 'classic'
    const compact = data.compact ?? false
    if (theme !== this.themeName || compact !== mind.compact) {
      this.themeName = theme
      mind.compact = compact
      mind.changeTheme(buildTheme(theme, this.palette), false)
    }
    mind.refresh(this.toElixir(data))
    if (!this.mapVisible) {
      this.needsRelayout = true
      this.focusIds = select
      return
    }
    this.select(select)
  }

  /** Re-centres the map after the canvas changes width (side panes opening or closing). */
  center(): void {
    if (this.mind && this.mapVisible) this.mind.toCenter()
  }

  /** Replaces the whole map (import); undoable. */
  replaceAll(data: MindmapData): void {
    if (!this.mind) return
    this.markBefore()
    this.applyData(data, [])
    if (this.mapVisible) this.mind.toCenter()
    this.commit()
  }

  /** Loads the version on disk after a conflict; it becomes the new undo baseline. */
  loadBaseline(data: MindmapData): void {
    if (!this.mind) return
    this.applyData(data, [])
    this.history.reset(this.snapshot())
    this.version += 1
    this.nodeCount = countNodes(this.mind.nodeData as unknown as MindNode)
    this.emit()
  }

  /* ---------- Selection ---------- */

  private selectedTopics(): Topic[] {
    return (this.mind?.currentNodes ?? []).filter((topic) => topic.isConnected)
  }

  selectedIds(): string[] {
    return this.selectedTopics().map((topic) => topic.nodeObj.id)
  }

  rootId(): string | null {
    return this.mind?.nodeData.id ?? null
  }

  private findTopic(id: string): Topic | null {
    if (!this.mind || !id) return null
    return this.mind.map.querySelector<Topic>(`me-tpc[data-nodeid="me${id}"]`)
  }

  private rootTopic(): Topic | null {
    return this.mind?.map.querySelector<Topic>('me-root > me-tpc') ?? null
  }

  select(ids: string[]): void {
    const mind = this.mind
    if (!mind) return
    const find = () => ids.map((id) => this.findTopic(id)).filter((topic): topic is Topic => topic !== null)
    let topics = find()
    if (topics.length < ids.length && !this.mapVisible && this.needsRelayout) {
      // Topics added in the outline exist only in the data until the map is rebuilt. Lines drawn
      // now are wrong (the map is hidden), so the map is laid out again once it is shown.
      mind.refresh()
      topics = find()
    }
    if (!topics.length) {
      mind.clearSelection()
      return
    }
    if (topics.length === 1) {
      mind.selectNode(topics[0])
      return
    }
    mind.clearSelection()
    mind.selectNodes(topics)
  }

  /** Expands collapsed ancestors, then selects and centres the topic. */
  reveal(id: string): void {
    const mind = this.mind
    const node = mind?.getObjById(id, mind.nodeData)
    if (!mind || !node) return
    const collapsed: NodeObj[] = []
    for (let parent = node.parent; parent; parent = parent.parent) if (parent.expanded === false) collapsed.push(parent)
    if (collapsed.length) {
      this.mutate(
        () => {
          for (const parent of collapsed) parent.expanded = true
        },
        { select: [id] },
      )
    }
    if (!this.mapVisible) {
      this.focusIds = [id]
      return
    }
    const topic = this.findTopic(id)
    if (!topic) return
    mind.selectNode(topic)
    mind.scrollIntoView(topic, true)
  }

  focus(): void {
    this.mind?.container.focus({ preventScroll: true })
  }

  contains(target: EventTarget | null): boolean {
    return target instanceof Node && Boolean(this.mind?.container.contains(target))
  }

  /** The map is hidden while the outline is shown; layout needs a visible container. */
  setMapVisible(visible: boolean, focusIds?: string[]): void {
    this.mapVisible = visible
    if (focusIds) this.focusIds = focusIds
    if (!visible || !this.mind) return
    if (this.needsRelayout) {
      this.needsRelayout = false
      this.mind.refresh()
    }
    if (this.focusIds.length) {
      const ids = this.focusIds
      this.focusIds = []
      this.select(ids)
      const topic = this.findTopic(ids[0])
      if (topic) this.mind.scrollIntoView(topic)
    }
  }

  /** The live tree, for the outline view. Read only; change it through `mutate`. */
  liveRoot(): MindNode | null {
    return (this.mind?.nodeData as unknown as MindNode | undefined) ?? null
  }

  /**
   * Changes the tree directly (outline view, structural commands), then lays the map out again
   * and records one undo step.
   */
  mutate(change: (root: NodeObj) => void, options: { select?: string[]; coalesce?: string; anchor?: string } = {}): void {
    const mind = this.mind
    if (!mind) return
    if (!this.pendingBefore) this.markBefore()
    change(mind.nodeData)
    relink(mind.nodeData)
    this.relayout(options.select ?? this.selectedIds(), options.anchor)
    this.commit(options.coalesce)
  }

  private relayout(select: string[], anchorId?: string): void {
    const mind = this.mind!
    if (!this.mapVisible) {
      this.needsRelayout = true
      this.focusIds = select
      return
    }
    const anchor = (anchorId ? this.findTopic(anchorId) : null) ?? (select[0] ? this.findTopic(select[0]) : null) ?? this.rootTopic()
    const anchorId_ = anchor?.nodeObj.id
    const before = anchor?.getBoundingClientRect()
    mind.refresh()
    const after = anchorId_ ? this.findTopic(anchorId_)?.getBoundingClientRect() : undefined
    if (before && after) mind.move(before.left - after.left, before.top - after.top)
    this.select(select)
  }

  /* ---------- Commands ---------- */

  run(command: CommandId): void {
    const mind = this.mind
    if (!mind) return
    const topics = this.selectedTopics()
    const primary = topics[topics.length - 1] ?? null
    const nav = (dir: Nav) => {
      if (!primary) {
        const root = this.rootTopic()
        if (root) mind.selectNode(root)
        return
      }
      const next = this.neighbor(primary, dir)
      if (next) mind.selectNode(next)
    }
    const extend = (dir: Nav) => {
      if (!primary) return nav(dir)
      const next = this.neighbor(primary, dir)
      if (!next) return
      if (topics.includes(next)) mind.unselectNodes([primary])
      else mind.selectNodes([next])
    }
    const requireTopic = (): Topic | null => {
      if (!primary) this.notice('先选中一个主题。', 'default')
      return primary
    }

    switch (command) {
      case 'insertChild':
        if (requireTopic()) void mind.addChild(primary!)
        return
      case 'insertSibling':
        if (requireTopic()) void mind.insertSibling('after', primary!)
        return
      case 'insertSiblingBefore':
        if (requireTopic()) void mind.insertSibling('before', primary!)
        return
      case 'insertParent':
        if (primary?.nodeObj.parent) void mind.insertParent(primary)
        return
      case 'remove':
        this.removeSelected()
        return
      case 'removeSingle':
        this.removeKeepingChildren(topics)
        return
      case 'edit':
        if (mind.currentSummary) mind.editSummary(mind.currentSummary)
        else if (mind.currentArrow) mind.editArrowLabel(mind.currentArrow)
        else if (primary) this.beginEdit(primary)
        return
      case 'duplicate':
        this.duplicate(topics)
        return
      case 'selectAll': {
        const all = Array.from(mind.map.querySelectorAll<Topic>('me-tpc'))
        mind.clearSelection()
        mind.selectNodes(all)
        return
      }
      case 'selectCenter': {
        const root = this.rootTopic()
        if (!root) return
        mind.selectNode(root)
        mind.scrollIntoView(root, true)
        return
      }
      case 'navUp':
        return nav('up')
      case 'navDown':
        return nav('down')
      case 'navLeft':
        return nav('left')
      case 'navRight':
        return nav('right')
      case 'extendUp':
        return extend('up')
      case 'extendDown':
        return extend('down')
      case 'extendLeft':
        return extend('left')
      case 'extendRight':
        return extend('right')
      case 'moveUp':
      case 'moveDown':
      case 'moveLeft':
      case 'moveRight': {
        if (!primary?.nodeObj.parent) return
        const horizontal = this.sideOf(primary) === 'down'
        const back = horizontal ? command === 'moveLeft' : command === 'moveUp'
        const forward = horizontal ? command === 'moveRight' : command === 'moveDown'
        if (back) void mind.moveUpNode(primary)
        else if (forward) void mind.moveDownNode(primary)
        return
      }
      case 'moveTop':
      case 'moveBottom': {
        if (!primary?.nodeObj.parent) return
        const siblings = this.siblingsOf(primary)
        const edge = command === 'moveTop' ? siblings[0] : siblings[siblings.length - 1]
        if (!edge || edge === primary) return
        if (command === 'moveTop') void mind.moveNodeBefore([primary], edge)
        else void mind.moveNodeAfter([primary], edge)
        return
      }
      case 'toggleFold':
        this.toggleFold(topics)
        return
      case 'toggleFoldAll':
        if (primary) this.toggleFoldAll(primary)
        return
      case 'expandAll':
        this.expandToLevel(Number.POSITIVE_INFINITY)
        return
      case 'collapseAll':
        this.expandToLevel(1)
        return
      case 'bold':
        return this.toggleTextStyle('bold')
      case 'italic':
        return this.toggleTextStyle('italic')
      case 'underline':
        return this.toggleTextStyle('underline')
      case 'strike':
        return this.toggleTextStyle('strike')
      case 'fontBigger':
        return this.fontStep(1)
      case 'fontSmaller':
        return this.fontStep(-1)
      case 'styleVeryImportant':
        return this.applyQuickStyle('veryImportant')
      case 'styleImportant':
        return this.applyQuickStyle('important')
      case 'styleCrossOut':
        return this.applyQuickStyle('crossOut')
      case 'styleDefault':
      case 'resetStyle':
        return this.applyQuickStyle('default')
      case 'copyStyle':
        if (primary) {
          const style = primary.nodeObj.style as Record<string, string> | undefined
          this.copiedStyle = { style: style ? { ...style } : undefined, branchColor: primary.nodeObj.branchColor }
          this.notice('已复制样式。', 'default')
        }
        return
      case 'pasteStyle':
        if (this.copiedStyle) {
          const copied = this.copiedStyle
          this.updateTargets((node) => {
            assignStyle(node, { ...(copied.style ?? {}) })
            if (copied.branchColor) node.branchColor = copied.branchColor
            else delete node.branchColor
          })
        }
        return
      case 'relationship':
        this.startLink(topics)
        return
      case 'summary':
        this.createSummary(topics)
        return
      case 'note':
      case 'labels':
      case 'link':
      case 'page':
        if (requireTopic()) this.fire({ type: 'field', field: command === 'labels' ? 'labels' : command })
        return
      case 'zoomIn':
        return this.zoomBy(0.1)
      case 'zoomOut':
        return this.zoomBy(-0.1)
      case 'zoomReset':
        mind.scale(1)
        return
      case 'zoomFit':
        mind.scaleFit()
        return
      case 'undo':
        return this.undo()
      case 'redo':
        return this.redo()
      case 'escape':
        if (this.linkFrom) this.cancelLink()
        else if (mind.currentArrow || mind.currentSummary) mind.clearSelection()
        return
      default:
        if (command.startsWith('level')) this.expandToLevel(Number(command.slice(5)))
        else if (command.startsWith('priority')) this.toggleMarker(`priority-${command.slice(8)}`)
    }
  }

  /** Starts editing the selected topic so that the key being typed replaces its text (XMind behaviour). */
  typeToEdit(): boolean {
    const topics = this.selectedTopics()
    if (topics.length !== 1 || this.linkFrom || !this.mind) return false
    this.beginEdit(topics[0])
    return true
  }

  private beginEdit(topic: Topic): void {
    const mind = this.mind!
    void mind.beginEdit(topic)
    const box = mind.nodes.querySelector<HTMLElement>('#input-box')
    if (!box || document.activeElement === box) return
    box.focus({ preventScroll: true })
    const range = document.createRange()
    range.selectNodeContents(box)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }

  private removeSelected(): void {
    const mind = this.mind!
    if (mind.currentArrow) {
      mind.removeArrow()
      return
    }
    if (mind.currentSummary) {
      mind.removeSummary(mind.currentSummary.summaryObj.id)
      return
    }
    const targets = this.selectedTopics().filter((topic) => topic.nodeObj.parent)
    if (targets.length) void mind.removeNodes(targets)
  }

  /** Topics whose ancestors are not also selected (copying a branch copies its subtopics once). */
  private topLevel(topics: Topic[]): NodeObj[] {
    const ids = new Set(topics.map((topic) => topic.nodeObj.id))
    return topics
      .map((topic) => topic.nodeObj)
      .filter((node) => {
        for (let parent = node.parent; parent; parent = parent.parent) if (ids.has(parent.id)) return false
        return true
      })
  }

  /** XMind's "delete single topic": its subtopics move up to take its place. */
  private removeKeepingChildren(topics: Topic[]): void {
    const nodes = this.topLevel(topics).filter((node) => node.parent)
    if (!nodes.length) return
    const parents = [...new Set(nodes.map((node) => node.parent!.id))]
    this.mutate(
      () => {
        for (const node of nodes) {
          const parent = node.parent!
          const siblings = parent.children ?? []
          const index = siblings.indexOf(node)
          if (index < 0) continue
          const children = node.children ?? []
          if (!parent.parent) for (const child of children) child.direction = node.direction
          siblings.splice(index, 1, ...children)
        }
      },
      { select: parents, anchor: parents[0] },
    )
  }

  private duplicate(topics: Topic[]): void {
    const nodes = this.topLevel(topics).filter((node) => node.parent)
    if (!nodes.length) return
    const adding = nodes.reduce((sum, node) => sum + countNodes(node as unknown as MindNode), 0)
    if (this.nodeCount + adding > MAX_NODES) {
      this.notice(`一张导图最多 ${MAX_NODES} 个主题，已经到上限了。`)
      return
    }
    const copies: string[] = []
    this.mutate(
      () => {
        for (const node of nodes) {
          const parent = node.parent!
          const siblings = parent.children ?? []
          const [copy] = cloneWithNewIds([stripTree(node)]) as unknown as NodeObj[]
          if (!parent.parent) copy.direction = node.direction
          siblings.splice(siblings.indexOf(node) + 1, 0, copy)
          copies.push(copy.id)
        }
      },
      { select: copies, anchor: nodes[0].id },
    )
  }

  private toggleFold(topics: Topic[]): void {
    const mind = this.mind!
    const withChildren = topics.map((topic) => topic.nodeObj).filter((node) => node.children?.length)
    if (!withChildren.length) return
    const targets = withChildren.some((node) => !node.parent) ? (mind.nodeData.children ?? []).filter((node) => node.children?.length) : withChildren
    if (!targets.length) return
    const collapse = targets.some((node) => node.expanded !== false)
    this.mutate(
      () => {
        for (const node of targets) node.expanded = !collapse
      },
      { anchor: topics[topics.length - 1]?.nodeObj.id },
    )
  }

  private toggleFoldAll(topic: Topic): void {
    let fullyExpanded = true
    walkNodes(topic.nodeObj as unknown as MindNode, (node) => {
      if (node.children?.length && node.expanded === false) fullyExpanded = false
    })
    this.mutate(
      () => {
        walkNodes(topic.nodeObj as unknown as MindNode, (node, parent) => {
          if (!node.children?.length) return
          // The central topic cannot fold; collapsing it folds its main topics instead.
          if (!parent && !topic.nodeObj.parent) return
          node.expanded = !fullyExpanded
        })
      },
      { anchor: topic.nodeObj.id },
    )
  }

  /** XMind's "show to level N": topics deeper than N are folded away. */
  expandToLevel(level: number): void {
    const mind = this.mind
    if (!mind) return
    this.mutate(
      (root) => {
        walkNodes(root as unknown as MindNode, (node, _parent, depth) => {
          if (node.children?.length) node.expanded = depth < level
        })
      },
      { anchor: mind.nodeData.id },
    )
  }

  /* ---------- Navigation ---------- */

  private sideOf(topic: Topic): Side {
    if (!topic.nodeObj.parent) return 'root'
    const main = topic.closest('me-main')
    if (main?.classList.contains('lhs')) return 'lhs'
    if (main?.classList.contains('down')) return 'down'
    return 'rhs'
  }

  private mainTopics(side: 'lhs' | 'rhs' | 'down'): Topic[] {
    return Array.from(this.mind!.map.querySelectorAll<Topic>(`me-main.${side} > me-wrapper > me-parent > me-tpc`))
  }

  /** Visible siblings on the same side of the map, in screen order. */
  private siblingsOf(topic: Topic): Topic[] {
    const container = topic.parentElement?.parentElement?.parentElement
    if (!container) return [topic]
    return Array.from(container.children)
      .map((wrapper) => wrapper.firstElementChild?.firstElementChild)
      .filter(isTopic)
  }

  private childrenOf(topic: Topic): Topic[] {
    const list = topic.parentElement?.parentElement?.children[1]
    if (!list || list.tagName !== 'ME-CHILDREN') return []
    return Array.from(list.children)
      .map((wrapper) => wrapper.firstElementChild?.firstElementChild)
      .filter(isTopic)
  }

  private nearestOnAxis(from: Topic, candidates: Topic[], axis: 'x' | 'y'): Topic | null {
    const origin = from.getBoundingClientRect()
    const center = axis === 'y' ? origin.top + origin.height / 2 : origin.left + origin.width / 2
    let best: Topic | null = null
    let bestDistance = Number.POSITIVE_INFINITY
    for (const candidate of candidates) {
      const rect = candidate.getBoundingClientRect()
      const distance = Math.abs((axis === 'y' ? rect.top + rect.height / 2 : rect.left + rect.width / 2) - center)
      if (distance < bestDistance) {
        best = candidate
        bestDistance = distance
      }
    }
    return best
  }

  /** The closest visible topic in a direction, for moving between cousins. */
  private nearestInDirection(from: Topic, dir: Nav): Topic | null {
    const origin = from.getBoundingClientRect()
    const cx = origin.left + origin.width / 2
    const cy = origin.top + origin.height / 2
    let best: Topic | null = null
    let bestScore = Number.POSITIVE_INFINITY
    for (const candidate of this.mind!.map.querySelectorAll<Topic>('me-tpc')) {
      if (candidate === from) continue
      const rect = candidate.getBoundingClientRect()
      let gap: number
      let offset: number
      if (dir === 'up' || dir === 'down') {
        gap = dir === 'up' ? origin.top - rect.bottom : rect.top - origin.bottom
        offset = Math.abs(rect.left + rect.width / 2 - cx)
      } else {
        gap = dir === 'left' ? origin.left - rect.right : rect.left - origin.right
        offset = Math.abs(rect.top + rect.height / 2 - cy)
      }
      if (gap < -1) continue
      const score = Math.max(0, gap) + offset * 2
      if (score < bestScore) {
        best = candidate
        bestScore = score
      }
    }
    return best
  }

  private neighbor(topic: Topic, dir: Nav): Topic | null {
    const mind = this.mind!
    const side = this.sideOf(topic)
    if (side === 'root') {
      if (mind.direction === 3) return dir === 'down' ? this.nearestOnAxis(topic, this.mainTopics('down'), 'x') : null
      if (dir === 'left') return this.nearestOnAxis(topic, this.mainTopics('lhs'), 'y')
      if (dir === 'right') return this.nearestOnAxis(topic, this.mainTopics('rhs'), 'y')
      return null
    }
    const toChild: Nav = side === 'lhs' ? 'left' : side === 'down' ? 'down' : 'right'
    const toParent: Nav = side === 'lhs' ? 'right' : side === 'down' ? 'up' : 'left'
    if (dir === toChild) {
      if (topic.nodeObj.expanded === false) return null
      return this.nearestOnAxis(topic, this.childrenOf(topic), side === 'down' ? 'x' : 'y')
    }
    if (dir === toParent) {
      const parent = topic.nodeObj.parent
      return parent ? this.findTopic(parent.id) : null
    }
    const siblings = this.siblingsOf(topic)
    const index = siblings.indexOf(topic)
    const backwards = side === 'down' ? dir === 'left' : dir === 'up'
    return siblings[backwards ? index - 1 : index + 1] ?? this.nearestInDirection(topic, dir)
  }

  /* ---------- Formatting ---------- */

  private targets(): NodeObj[] {
    return this.selectedTopics().map((topic) => topic.nodeObj)
  }

  private updateTargets(change: (node: NodeObj) => void, coalesce?: string): void {
    const nodes = this.targets()
    if (!nodes.length) return
    if (!this.pendingBefore) this.markBefore()
    for (const node of nodes) change(node)
    this.rerender(nodes)
    this.commit(coalesce)
  }

  /** Redraws changed topics in place; many at once are cheaper to lay out from scratch. */
  private rerender(nodes: NodeObj[]): void {
    const mind = this.mind!
    if (!this.mapVisible) {
      this.needsRelayout = true
      return
    }
    if (nodes.length > 30) {
      this.relayout(this.selectedIds())
      return
    }
    for (const node of nodes) {
      const topic = this.findTopic(node.id)
      if (!topic) continue
      topic.style.cssText = ''
      void mind.reshapeNode(topic, {})
    }
  }

  setStyle(patch: Partial<Record<StyleKey, string | null>>): void {
    this.updateTargets((node) => {
      const style = styleOf(node)
      for (const [key, value] of Object.entries(patch)) {
        if (value) style[key] = value
        else delete style[key]
      }
      assignStyle(node, style)
    })
  }

  setBranchColor(color: string | null): void {
    this.updateTargets((node) => {
      if (color) node.branchColor = color
      else delete node.branchColor
    })
  }

  toggleTextStyle(kind: TextStyle): void {
    const nodes = this.targets()
    if (!nodes.length) return
    const has = (node: NodeObj) => {
      const style = styleOf(node)
      if (kind === 'bold') return /bold|[6-9]00/.test(style.fontWeight ?? '')
      if (kind === 'italic') return style.fontStyle === 'italic'
      return (style.textDecoration ?? '').includes(kind === 'underline' ? 'underline' : 'line-through')
    }
    const enable = !nodes.every(has)
    this.updateTargets((node) => {
      const style = styleOf(node)
      if (kind === 'bold') {
        if (enable) style.fontWeight = 'bold'
        else delete style.fontWeight
      } else if (kind === 'italic') {
        if (enable) style.fontStyle = 'italic'
        else delete style.fontStyle
      } else {
        const token = kind === 'underline' ? 'underline' : 'line-through'
        const tokens = new Set((style.textDecoration ?? '').split(/\s+/).filter(Boolean))
        if (enable) tokens.add(token)
        else tokens.delete(token)
        const value = ['underline', 'line-through'].filter((item) => tokens.has(item)).join(' ')
        if (value) style.textDecoration = value
        else delete style.textDecoration
      }
      assignStyle(node, style)
    })
  }

  fontStep(step: 1 | -1): void {
    const topics = this.selectedTopics()
    if (!topics.length) return
    const sizes = new Map(
      topics.map((topic) => {
        const own = Number.parseFloat((topic.nodeObj.style as Record<string, string> | undefined)?.fontSize ?? '')
        return [topic.nodeObj.id, own || Number.parseFloat(getComputedStyle(topic).fontSize) || 16]
      }),
    )
    this.updateTargets((node) => {
      const current = sizes.get(node.id) ?? 16
      const next =
        step > 0
          ? (FONT_SIZES.find((size) => size > current) ?? FONT_SIZES[FONT_SIZES.length - 1])
          : ([...FONT_SIZES].reverse().find((size) => size < current) ?? FONT_SIZES[0])
      assignStyle(node, { ...styleOf(node), fontSize: `${next}px` })
    })
  }

  applyQuickStyle(kind: QuickStyle): void {
    this.updateTargets((node) => {
      if (kind === 'default') {
        delete node.style
        delete node.branchColor
      } else {
        assignStyle(node, { ...QUICK_STYLES[kind] })
      }
    })
  }

  toggleMarker(id: string): void {
    const group = markerGroupOf(id)
    const nodes = this.targets()
    if (!group || !nodes.length) return
    const enable = !nodes.every((node) => metaOf(node).markers?.includes(id))
    this.updateTargets((node) => {
      const meta = metaOf(node)
      let markers = (meta.markers ?? []).filter((marker) => marker !== id)
      if (enable) {
        if (group.exclusive) markers = markers.filter((marker) => markerGroupOf(marker)?.id !== group.id)
        markers.push(id)
      }
      markers = normalizeMarkers(markers)
      if (markers.length) meta.markers = markers
      else delete meta.markers
      assignMeta(node, meta)
    })
  }

  clearMarkers(): void {
    this.updateTargets((node) => {
      const meta = metaOf(node)
      delete meta.markers
      assignMeta(node, meta)
    })
  }

  setTags(tags: string[]): void {
    const clean = [...new Set(tags.map((tag) => tag.trim().slice(0, 60)).filter(Boolean))].slice(0, 20)
    this.updateTargets((node) => {
      if (clean.length) node.tags = clean
      else delete node.tags
    })
  }

  setNote(note: string): void {
    const value = note.slice(0, 20_000)
    this.updateTargets(
      (node) => {
        if (value.trim()) node.note = value
        else delete node.note
      },
      `note:${this.selectedIds().join(',')}`,
    )
  }

  setLink(url: string | null): void {
    const value = url?.trim() ?? ''
    if (value && !(/^https?:\/\/\S+$/i.test(value) && value.length <= 2000)) {
      this.notice('链接要以 http:// 或 https:// 开头。')
      return
    }
    this.updateTargets((node) => {
      if (value) node.hyperLink = value
      else delete node.hyperLink
    })
  }

  setPage(page: number | null): void {
    if (page !== null && !(Number.isInteger(page) && page >= 1 && page <= MAX_PAGE)) return
    this.updateTargets((node) => {
      const meta = metaOf(node)
      if (page) meta.page = page
      else delete meta.page
      assignMeta(node, meta)
    })
  }

  /* ---------- Map settings and view ---------- */

  setTheme(name: MindTheme): void {
    const mind = this.mind
    if (!mind || name === this.themeName) return
    this.markBefore()
    const select = this.selectedIds()
    this.themeName = name
    mind.changeTheme(buildTheme(name, this.palette), this.mapVisible)
    if (!this.mapVisible) this.needsRelayout = true
    else this.select(select)
    this.commit()
  }

  setDirection(direction: Direction): void {
    const mind = this.mind
    if (!mind || mind.direction === direction) return
    this.markBefore()
    const select = this.selectedIds()
    if (!this.mapVisible) {
      mind.direction = direction
      this.needsRelayout = true
    } else {
      const init = [mind.initLeft, mind.initRight, mind.initSide, mind.initDown][direction]
      init.call(mind)
      this.select(select)
    }
    this.commit()
  }

  setCompact(compact: boolean): void {
    const mind = this.mind
    if (!mind || mind.compact === compact) return
    this.markBefore()
    const select = this.selectedIds()
    mind.compact = compact
    mind.changeTheme(mind.theme, this.mapVisible)
    if (!this.mapVisible) this.needsRelayout = true
    else this.select(select)
    this.commit()
  }

  zoomBy(delta: number): void {
    const mind = this.mind
    if (!mind) return
    const next = Math.round((mind.scaleVal + delta) * 100) / 100
    mind.scale(Math.min(mind.scaleMax, Math.max(mind.scaleMin, next)))
  }

  zoomTo(scale: number): void {
    this.mind?.scale(scale)
  }

  fit(): void {
    this.mind?.scaleFit()
  }

  /* ---------- Relationships and summaries ---------- */

  private startLink(topics: Topic[]): void {
    const mind = this.mind!
    if (topics.length === 2) {
      this.markBefore()
      mind.createArrow(topics[0], topics[1], { label: '' } as unknown as ArrowOptions)
      return
    }
    if (topics.length !== 1) {
      this.notice('先选中一个主题，再点要联系的另一个主题。', 'default')
      return
    }
    this.linkFrom = topics[0].nodeObj.id
    this.emit()
  }

  cancelLink(): void {
    if (!this.linkFrom) return
    this.linkFrom = null
    this.emit()
  }

  private completeLink(): void {
    const mind = this.mind
    const fromId = this.linkFrom
    const nodes = mind?.currentNodes ?? []
    if (!mind || !fromId || nodes.length !== 1 || nodes[0].nodeObj.id === fromId) return
    const target = nodes[0]
    this.linkFrom = null
    // Not from inside mind-elixir's selection event, which is still running.
    setTimeout(() => {
      const from = this.findTopic(fromId)
      if (!this.mind || !from || !target.isConnected) return
      this.pendingBefore = { ids: [fromId], at: Date.now() }
      this.mind.createArrow(from, target, { label: '' } as unknown as ArrowOptions)
    }, 0)
  }

  toggleArrowBidirectional(): void {
    const mind = this.mind
    const arrow = mind?.currentArrow?.arrowObj
    if (!mind || !arrow) return
    this.markBefore()
    mind.reshapeArrow(arrow, { bidirectional: !arrow.bidirectional })
    this.commit()
  }

  private createSummary(topics: Topic[]): void {
    const mind = this.mind!
    const nodes = topics.map((topic) => topic.nodeObj).filter((node) => node.parent)
    if (!nodes.length) {
      this.notice('先选中要概括的几个子主题。', 'default')
      return
    }
    const parent = nodes[0].parent!
    if (nodes.some((node) => node.parent !== parent)) {
      this.notice('概要只能概括同一个主题下的子主题。')
      return
    }
    if (!parent.parent && mind.direction === 2 && new Set(nodes.map((node) => node.direction)).size > 1) {
      this.notice('概要只能概括同一侧的分支主题。')
      return
    }
    const siblings = parent.children ?? []
    const indexes = nodes.map((node) => siblings.indexOf(node)).sort((a, b) => a - b)
    this.markBefore()
    mind.createSummaryFrom({ parent: parent.id, start: indexes[0], end: indexes[indexes.length - 1], label: '概要' })
    const created = mind.summaries[mind.summaries.length - 1]
    const element = created ? mind.nodes.querySelector<SummarySvg>(`g[id="s-${created.id}"]`) : null
    if (element) mind.editSummary(element)
  }

  /* ---------- Inserting content ---------- */

  insertNodes(parentId: string | null, nodes: MindNode[]): void {
    const mind = this.mind
    if (!mind || !nodes.length) return
    const parent = mind.getObjById(parentId ?? this.selectedIds().at(-1) ?? mind.nodeData.id, mind.nodeData) ?? mind.nodeData
    const adding = nodes.reduce((sum, node) => sum + countNodes(node), 0)
    if (this.nodeCount + adding > MAX_NODES) {
      this.notice(`一张导图最多 ${MAX_NODES} 个主题，放不下这么多内容。`)
      return
    }
    if (depthOf(parent) + 1 + Math.max(...nodes.map(heightOf)) > MAX_DEPTH) {
      this.notice(`导图最多 ${MAX_DEPTH} 层。`)
      return
    }
    this.mutate(
      () => {
        parent.children = [...(parent.children ?? []), ...(nodes as unknown as NodeObj[])]
        parent.expanded = true
      },
      { select: nodes.map((node) => node.id), anchor: parent.id },
    )
  }

  /** A passage from the paper: long quotes keep the full text in the note and are marked as quotes. */
  addQuote(text: string, page: number | null, parentId: string | null = null): void {
    const clean = joinWrappedLines(text).slice(0, 20_000)
    if (!clean) return
    const long = clean.length > 200
    const node: MindNode = { id: newNodeId(), topic: long ? `${clean.slice(0, 120).trim()}…` : clean, children: [] }
    const meta: NodeMeta = {}
    if (long) {
      node.note = clean
      meta.markers = ['symbol-quote']
    }
    if (page && Number.isInteger(page) && page >= 1 && page <= MAX_PAGE) meta.page = page
    if (Object.keys(meta).length) node.metadata = meta
    this.insertNodes(parentId, [node])
  }

  /* ---------- Clipboard ---------- */

  /** Remembers the selected branches and returns them as indented text for the system clipboard. */
  copySelection(): string | null {
    const nodes = this.topLevel(this.selectedTopics()).map(stripTree)
    if (!nodes.length) return null
    const text = nodesToText(nodes)
    clipboard = { text: normalizeClip(text), nodes }
    return text
  }

  async copyToSystem(cut: boolean): Promise<void> {
    const text = this.copySelection()
    if (text === null) return
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Pasting inside 知行 still works from the in-memory copy.
    }
    if (cut) this.removeSelected()
  }

  async pasteFromSystem(): Promise<void> {
    let text: string | null = null
    try {
      text = await navigator.clipboard.readText()
    } catch {
      text = null
    }
    this.paste(text)
  }

  /** Our own topics paste with all their formatting; any other text becomes topics. */
  paste(text: string | null): void {
    const own = clipboard && (text === null || normalizeClip(text) === clipboard.text) ? clipboard : null
    const nodes = own ? cloneWithNewIds(own.nodes) : text ? textToNodes(text) : []
    if (!nodes.length) return
    this.insertNodes(null, nodes)
  }

  private onCopy(event: ClipboardEvent, cut: boolean): void {
    if (isTextTarget(event.target)) return
    const text = this.copySelection()
    if (text === null) return
    event.clipboardData?.setData('text/plain', text)
    event.preventDefault()
    if (cut) this.removeSelected()
  }

  private onPaste(event: ClipboardEvent): void {
    if (isTextTarget(event.target)) return
    event.preventDefault()
    this.paste(event.clipboardData?.getData('text/plain') ?? null)
  }

  private onBadgeClick(event: MouseEvent): void {
    const badge = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-zx]') : null
    if (!badge || badge.dataset.zx === 'link') return
    event.preventDefault()
    const topic = badge.closest<Topic>('me-tpc')
    if (topic) this.mind?.selectNode(topic)
    if (badge.dataset.zx === 'note') this.fire({ type: 'field', field: 'note' })
    else if (badge.dataset.zx === 'page') {
      const page = Number(badge.dataset.page)
      if (Number.isInteger(page) && page > 0) this.fire({ type: 'page', page })
    }
  }

  private acceptsDrop(event: DragEvent): boolean {
    const types = Array.from(event.dataTransfer?.types ?? [])
    return !types.includes('Files') && types.includes('text/plain')
  }

  private onDragOver(event: DragEvent): void {
    if (!this.acceptsDrop(event)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }

  /** Text dropped on a topic becomes its subtopics; quotes dragged from the paper keep their page. */
  private onDrop(event: DragEvent): void {
    const transfer = event.dataTransfer
    if (!transfer || !this.acceptsDrop(event)) return
    event.preventDefault()
    const text = transfer.getData('text/plain')
    const target = event.target instanceof Element ? event.target.closest<Topic>('me-tpc') : null
    const parentId = target?.nodeObj.id ?? null
    const page = Number.parseInt(transfer.getData(SOURCE_PAGE_MIME), 10)
    if (Number.isInteger(page)) this.addQuote(text, page, parentId)
    else this.insertNodes(parentId, textToNodes(text))
  }

  /* ---------- Search and export ---------- */

  /** Topics whose text, note or labels contain the query, in outline order. */
  search(query: string): string[] {
    const root = this.liveRoot()
    const needle = query.trim().toLowerCase()
    if (!root || !needle) return []
    const ids: string[] = []
    walkNodes(root, (node) => {
      const haystack = [node.topic, node.note ?? '', ...(node.tags ?? [])].join('\n').toLowerCase()
      if (haystack.includes(needle)) ids.push(node.id)
    })
    return ids
  }

  topicText(id: string): string {
    const mind = this.mind
    return (mind && mind.getObjById(id, mind.nodeData)?.topic) ?? ''
  }

  async exportPng(): Promise<Blob> {
    const mind = this.mind
    if (!mind) throw new Error('导图还没有加载。')
    const { domToBlob } = await import('modern-screenshot')
    const selected = this.selectedIds()
    mind.clearSelection()
    try {
      return await domToBlob(mind.nodes, {
        scale: 2,
        type: 'image/png',
        backgroundColor: resolveColor(getComputedStyle(mind.container).backgroundColor) ?? null,
      })
    } finally {
      this.select(selected)
    }
  }
}
