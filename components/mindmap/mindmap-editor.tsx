'use client'

import 'mind-elixir/style.css'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ActionList, ActionMenu, Button, Flash, IconButton, Spinner, useConfirm } from '@primer/react'
import {
  CommentDiscussionIcon,
  FileIcon,
  FileMediaIcon,
  KebabHorizontalIcon,
  MarkdownIcon,
  NoteIcon,
  PackageIcon,
  ScreenFullIcon,
  ShareAndroidIcon,
  UploadIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from '@primer/octicons-react'
import { PageFrame } from '@/components/shell/page-frame'
import { ConflictBanner, SaveIndicator } from '@/components/study/editor-parts'
import { useNotice } from '@/components/ui/notices'
import { errorText } from '@/lib/client/api'
import { useLibrary } from '@/lib/client/hooks'
import { sortPapers } from '@/lib/client/library'
import { createUnique } from '@/lib/client/notes'
import { useStatusItem } from '@/lib/client/status-bar'
import { useTabs } from '@/lib/client/tabs'
import { useAutosave } from '@/lib/client/use-autosave'
import { askHref, baseName, fileHref, parentOf } from '@/lib/client/vault'
import { displayName, emptyMindmap, mindmapToMarkdown, sanitizeMindmap, type MindmapData } from '@/lib/shared/mindmap'
import type { Paper, VaultFile } from '@/lib/shared/types'
import { MapContextMenu, type MenuCommand, type MenuPosition } from './context-menu'
import { MapController, type MapEvent } from './controller'
import { FindBar } from './find-bar'
import { FormatPanel, type FieldRequest } from './format-panel'
import { IMPORT_ACCEPT, downloadBlob, exportOpml, exportXmind, importMindmapFile } from './io'
import { hintFor, matchShortcut, shortcutText, type CommandId } from './keymap'
import { OutlineView } from './outline-view'
import { ShortcutsDialog } from './shortcuts-dialog'
import { SourcePane, type PageRequest } from './source-pane'
import { MapToolbar, type EditorView } from './toolbar'
import { useMapState } from './use-map'
import styles from './mindmap.module.css'

function parseFile(content: string): MindmapData | null {
  try {
    return sanitizeMindmap(JSON.parse(content))
  } catch {
    return null
  }
}

function isTextTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

const PANEL_KEY = 'zhixing.mapPanel'

function usePanelPreference(): [boolean, (next: boolean | ((open: boolean) => boolean)) => void] {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    setOpen(window.localStorage.getItem(PANEL_KEY) === '1')
  }, [])
  const update = useCallback((next: boolean | ((open: boolean) => boolean)) => {
    setOpen((current) => {
      const value = typeof next === 'function' ? next(current) : next
      window.localStorage.setItem(PANEL_KEY, value ? '1' : '0')
      return value
    })
  }, [])
  return [open, update]
}

/** Commands after which focus must stay where the command put it (the inline editor, a panel field). */
const KEEPS_FOCUS = new Set<string>(['insertChild', 'insertSibling', 'insertParent', 'summary', 'edit', 'note', 'labels', 'link', 'page', 'find', 'shortcuts'])

const SOURCE_MIN = 280
const MAP_MIN = 320

export function MindmapEditor({ file }: { file: VaultFile }) {
  const notify = useNotice()
  const tabs = useTabs()
  const confirm = useConfirm()
  const { data: library } = useLibrary()
  const name = displayName(baseName(file.path))
  const [start] = useState(() => {
    const parsed = parseFile(file.content)
    return { data: parsed ?? emptyMindmap(name), unreadable: !parsed && file.content.trim() !== '' }
  })
  const markDirty = useRef<() => void>(() => undefined)
  const [controller] = useState(() => new MapController({ onChange: () => markDirty.current() }))
  const autosave = useAutosave(file.path, file.mtimeMs, () => controller.fileContent() ?? file.content)
  markDirty.current = autosave.markDirty
  const state = useMapState(controller)

  const canvasRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [view, setView] = useState<EditorView>('map')
  const [outlineActive, setOutlineActive] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = usePanelPreference()
  const [fieldRequest, setFieldRequest] = useState<FieldRequest | null>(null)
  const [find, setFind] = useState({ open: false, signal: 0 })
  const [found, setFound] = useState<{ ids: string[]; current: string | null }>({ ids: [], current: null })
  const [menu, setMenu] = useState<MenuPosition | null>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [sourceOpen, setSourceOpen] = useState(false)
  const [sourceWidth, setSourceWidth] = useState<number | null>(null)
  const [pageRequest, setPageRequest] = useState<PageRequest | null>(null)
  const [paperId, setPaperId] = useState<string | null>(start.data.paperId ?? null)

  const papers = library?.papers
  const paper: Paper | null = useMemo(() => {
    if (!papers) return null
    return (paperId ? papers.find((item) => item.id === paperId) : undefined) ?? papers.find((item) => item.mindmap === file.path) ?? null
  }, [papers, paperId, file.path])

  useStatusItem('map-topics', state.ready ? `${state.nodeCount} 个主题` : null)
  useStatusItem('map-selection', state.selection.length > 1 ? `已选 ${state.selection.length} 个` : null)

  useEffect(() => {
    const element = canvasRef.current
    if (!element) return
    controller.mount(element, start.data).catch((error: unknown) => setLoadError(errorText(error)))
    return () => controller.destroy()
  }, [controller, start])

  useEffect(() => {
    if (paper && state.ready) controller.setPaperId(paper.id)
  }, [controller, paper, state.ready])

  /** Focus lost to the page (a menu or dialog closed): give it back to the map. */
  const refocusMap = useCallback(() => {
    requestAnimationFrame(() => {
      const active = document.activeElement
      if (!active || active === document.body) controller.focus()
    })
  }, [controller])

  const openPage = useCallback(
    (page: number) => {
      if (!paper) {
        notify({ variant: 'warning', text: '这张导图还没有关联论文。点“原文”选择一篇。' })
        return
      }
      setSourceOpen(true)
      setPageRequest({ page, at: Date.now() })
    },
    [paper, notify],
  )

  const handleEvent = useRef<(event: MapEvent) => void>(() => undefined)
  handleEvent.current = (event) => {
    if (event.type === 'contextmenu') setMenu({ x: event.x, y: event.y, onTopic: event.onTopic })
    else if (event.type === 'field') {
      setPanelOpen(true)
      setFieldRequest({ field: event.field, at: Date.now() })
    } else if (event.type === 'page') openPage(event.page)
    else notify({ variant: event.variant, text: event.text })
  }
  useEffect(() => controller.onEvent((event) => handleEvent.current(event)), [controller])

  useLayoutEffect(() => {
    if (view === 'outline') {
      controller.setMapVisible(false)
      const id = outlineActive ?? controller.rootId()
      stageRef.current?.querySelector<HTMLTextAreaElement>(`textarea[data-id="${id}"]`)?.focus()
    } else {
      controller.setMapVisible(true, outlineActive ? [outlineActive] : undefined)
      if (state.ready) controller.focus()
    }
    // Runs on view switches only; the outline's active row is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, controller])

  const switchView = (next: EditorView) => {
    if (next === view) return
    if (next === 'outline') setOutlineActive(controller.selectedIds().at(-1) ?? controller.rootId())
    setView(next)
  }

  const exportImage = async () => {
    if (view !== 'map') {
      notify({ variant: 'warning', text: '切换到导图视图后再导出图片。' })
      return
    }
    try {
      downloadBlob(await controller.exportPng(), `${name}.png`)
    } catch (error) {
      notify({ variant: 'danger', text: `导出失败：${errorText(error)}` })
    }
  }

  const exportXmindFile = () => {
    try {
      downloadBlob(exportXmind(controller.data(), name), `${name}.xmind`)
    } catch (error) {
      notify({ variant: 'danger', text: `导出失败：${errorText(error)}` })
    }
  }

  const exportMarkdown = () => {
    try {
      downloadBlob(new Blob([mindmapToMarkdown(controller.data())], { type: 'text/markdown;charset=utf-8' }), `${name}.md`)
    } catch (error) {
      notify({ variant: 'danger', text: `导出失败：${errorText(error)}` })
    }
  }

  const exportOpmlFile = () => {
    try {
      downloadBlob(new Blob([exportOpml(controller.data(), name)], { type: 'text/x-opml;charset=utf-8' }), `${name}.opml`)
    } catch (error) {
      notify({ variant: 'danger', text: `导出失败：${errorText(error)}` })
    }
  }

  const saveAsNote = async () => {
    try {
      const created = await createUnique(parentOf(file.path), `${name}-大纲`, 'note', mindmapToMarkdown(controller.data()))
      notify({ variant: 'success', text: '已存为笔记。' })
      tabs.openInNewTab(fileHref(created))
    } catch (error) {
      notify({ variant: 'danger', text: errorText(error) })
    }
  }

  const importFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0]
    event.target.value = ''
    if (!picked) return
    try {
      const result = await importMindmapFile(picked)
      const ok = await confirm({
        title: `用“${picked.name}”替换当前导图？`,
        content: '当前导图的内容会被全部替换，之后可以按 Ctrl+Z 撤销。',
        confirmButtonContent: '替换',
        confirmButtonType: 'danger',
        cancelButtonContent: '取消',
      })
      if (!ok) return
      controller.replaceAll(result.data)
      notify({ variant: result.warning ? 'warning' : 'success', text: result.warning ? `已导入。${result.warning}` : '已导入。' })
      refocusMap()
    } catch (error) {
      notify({ variant: 'danger', text: `导入失败：${errorText(error)}` })
    }
  }

  const askTutor = async () => {
    await autosave.flush()
    tabs.openInNewTab(askHref(file.path))
  }

  const linkPaper = (target: Paper) => {
    setPaperId(target.id)
    controller.setPaperId(target.id)
    autosave.markDirty()
    setSourceOpen(true)
  }

  const takeDisk = () => {
    const disk = autosave.takeDisk()
    const data = disk === null ? null : parseFile(disk)
    if (data) controller.loadBaseline(data)
  }

  const runCommand = (command: CommandId) => {
    switch (command) {
      case 'save':
        void autosave.flush()
        return
      case 'toggleOutline':
        switchView(view === 'map' ? 'outline' : 'map')
        return
      case 'toggleFormat':
        setPanelOpen((open) => !open)
        return
      case 'shortcuts':
        setShortcutsOpen(true)
        return
      case 'exportImage':
        void exportImage()
        return
      case 'find':
        setFind((current) => ({ open: true, signal: current.signal + 1 }))
        return
      case 'toggleSource':
        if (paper) setSourceOpen((open) => !open)
        return
      default:
        controller.run(command)
    }
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Menus and dialogs render in portals; their keys are theirs.
    if (event.defaultPrevented || !event.currentTarget.contains(event.target as Node)) return
    const native = event.nativeEvent
    const inText = isTextTarget(event.target)
    const inMap = view === 'map' && !inText && controller.contains(event.target)
    const command = matchShortcut(native, { inMap, inText })
    if (command) {
      event.preventDefault()
      runCommand(command)
      return
    }
    // XMind: typing on a selected topic starts editing it (IME composition included).
    if (inMap && !event.ctrlKey && !event.metaKey && !event.altKey && (event.key.length === 1 || event.key === 'Process' || native.keyCode === 229)) {
      controller.typeToEdit()
    }
  }

  const onMenuCommand = (command: MenuCommand) => {
    if (command === 'copy' || command === 'cut') void controller.copyToSystem(command === 'cut').then(refocusMap)
    else if (command === 'paste') void controller.pasteFromSystem().then(refocusMap)
    else {
      runCommand(command)
      if (!KEEPS_FOCUS.has(command)) refocusMap()
    }
  }

  const closeFind = () => {
    setFind((current) => ({ open: false, signal: current.signal }))
    setFound({ ids: [], current: null })
    if (view === 'map') refocusMap()
  }

  const onFindResults = useCallback((ids: string[], current: string | null) => {
    setFound((previous) => (previous.current === current && previous.ids.join() === ids.join() ? previous : { ids, current }))
  }, [])

  const currentMatch = found.current
  useEffect(() => {
    if (!find.open || !currentMatch) return
    controller.reveal(currentMatch)
    if (view === 'outline') setOutlineActive(currentMatch)
  }, [controller, find.open, currentMatch, view])

  const highlightCss = useMemo(() => {
    if (!find.open || !found.ids.length) return ''
    const ids = found.ids.slice(0, 300)
    const stage = `.${styles.stage}`
    const rules = [
      `${stage} :is(${ids.map((id) => `me-tpc[data-nodeid="me${id}"]`).join(',')}){box-shadow:0 0 0 2px var(--bgColor-attention-emphasis)}`,
      `${stage} :is(${ids.map((id) => `[data-row-id="${id}"]`).join(',')}){background:var(--bgColor-attention-muted)}`,
    ]
    if (found.current) {
      rules.push(`${stage} me-tpc[data-nodeid="me${found.current}"]{box-shadow:0 0 0 3px var(--bgColor-severe-emphasis)}`)
      rules.push(`${stage} [data-row-id="${found.current}"]{box-shadow:inset 3px 0 0 var(--bgColor-severe-emphasis)}`)
    }
    return rules.join('\n')
  }, [find.open, found])

  const quote = (text: string, page: number | null) => {
    controller.addQuote(text, page)
    if (view === 'map') controller.focus()
  }

  const resizeSource = (event: React.PointerEvent<HTMLDivElement>) => {
    const workspace = workspaceRef.current
    if (!workspace || event.button !== 0) return
    event.preventDefault()
    const handle = event.currentTarget
    const rect = workspace.getBoundingClientRect()
    handle.setPointerCapture(event.pointerId)
    const onMove = (move: PointerEvent) => setSourceWidth(Math.round(Math.min(Math.max(move.clientX - rect.left, SOURCE_MIN), rect.width - MAP_MIN)))
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }

  const nudgeSource = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    const workspace = workspaceRef.current
    const pane = workspace?.firstElementChild
    if (!workspace || !(pane instanceof HTMLElement)) return
    event.preventDefault()
    const total = workspace.clientWidth
    const next = pane.offsetWidth + (event.key === 'ArrowLeft' ? -40 : 40)
    setSourceWidth(Math.round(Math.min(Math.max(next, SOURCE_MIN), total - MAP_MIN)))
  }

  const sourceVisible = sourceOpen && Boolean(paper)
  const formatVisible = panelOpen && state.ready
  useEffect(() => {
    if (!state.ready) return
    const frame = requestAnimationFrame(() => controller.center())
    return () => cancelAnimationFrame(frame)
  }, [sourceVisible, formatVisible, state.ready, controller])

  const sortedPapers = useMemo(() => (papers ? sortPapers(papers, 'added').slice(0, 60) : []), [papers])

  const paperControl = paper ? (
    <Button size="small" leadingVisual={FileIcon} aria-pressed={sourceOpen} className={styles.pressable} onClick={() => setSourceOpen((open) => !open)}>
      原文
    </Button>
  ) : sortedPapers.length ? (
    <ActionMenu>
      <ActionMenu.Button size="small" leadingVisual={FileIcon}>
        原文
      </ActionMenu.Button>
      <ActionMenu.Overlay width="large" align="end">
        <ActionList>
          <ActionList.Group>
            <ActionList.GroupHeading>对照哪篇论文</ActionList.GroupHeading>
            {sortedPapers.map((item) => (
              <ActionList.Item key={item.id} onSelect={() => linkPaper(item)}>
                {item.title}
              </ActionList.Item>
            ))}
          </ActionList.Group>
        </ActionList>
      </ActionMenu.Overlay>
    </ActionMenu>
  ) : null

  return (
    <PageFrame
      title={name}
      leading={<ShareAndroidIcon />}
      body="fill"
      meta={<SaveIndicator status={autosave.status} error={autosave.error} />}
      actions={
        <>
          {paperControl}
          <Button size="small" leadingVisual={CommentDiscussionIcon} onClick={() => void askTutor()}>
            问导师
          </Button>
          <ActionMenu>
            <ActionMenu.Anchor>
              <IconButton icon={KebabHorizontalIcon} aria-label="更多" size="small" />
            </ActionMenu.Anchor>
            <ActionMenu.Overlay width="medium" align="end">
              <ActionList>
                <ActionList.Item onSelect={() => fileInputRef.current?.click()} disabled={!state.ready}>
                  <ActionList.LeadingVisual>
                    <UploadIcon />
                  </ActionList.LeadingVisual>
                  导入…
                  <ActionList.Description variant="block">XMind、Markdown、OPML</ActionList.Description>
                </ActionList.Item>
                <ActionList.Divider />
                <ActionList.Group>
                  <ActionList.GroupHeading>导出</ActionList.GroupHeading>
                  <ActionList.Item onSelect={exportXmindFile} disabled={!state.ready}>
                    <ActionList.LeadingVisual>
                      <PackageIcon />
                    </ActionList.LeadingVisual>
                    XMind 文件
                  </ActionList.Item>
                  <ActionList.Item onSelect={() => void exportImage()} disabled={!state.ready}>
                    <ActionList.LeadingVisual>
                      <FileMediaIcon />
                    </ActionList.LeadingVisual>
                    图片
                    <ActionList.TrailingVisual>{shortcutText('exportImage')}</ActionList.TrailingVisual>
                  </ActionList.Item>
                  <ActionList.Item onSelect={exportMarkdown} disabled={!state.ready}>
                    <ActionList.LeadingVisual>
                      <MarkdownIcon />
                    </ActionList.LeadingVisual>
                    Markdown
                  </ActionList.Item>
                  <ActionList.Item onSelect={exportOpmlFile} disabled={!state.ready}>
                    <ActionList.LeadingVisual>
                      <FileIcon />
                    </ActionList.LeadingVisual>
                    OPML
                  </ActionList.Item>
                  <ActionList.Item onSelect={() => void saveAsNote()} disabled={!state.ready}>
                    <ActionList.LeadingVisual>
                      <NoteIcon />
                    </ActionList.LeadingVisual>
                    存为笔记
                  </ActionList.Item>
                </ActionList.Group>
                <ActionList.Divider />
                <ActionList.Item onSelect={() => setShortcutsOpen(true)}>
                  快捷键
                  <ActionList.TrailingVisual>{shortcutText('shortcuts')}</ActionList.TrailingVisual>
                </ActionList.Item>
              </ActionList>
            </ActionMenu.Overlay>
          </ActionMenu>
        </>
      }
    >
      <div className={styles.editor} onKeyDown={onKeyDown}>
        {autosave.conflict ? (
          <ConflictBanner deleted={autosave.conflict.content === null} onKeepMine={() => void autosave.keepMine()} onTakeDisk={takeDisk} />
        ) : null}
        {start.unreadable ? (
          <div className={styles.banner}>
            <Flash variant="warning">这个文件的内容无法识别，已打开一张空白导图。编辑后会覆盖原来的内容。</Flash>
          </div>
        ) : null}
        <div ref={workspaceRef} className={styles.workspace}>
          {sourceOpen && paper ? (
            <>
              <div className={styles.sourceSlot} style={{ width: sourceWidth ?? '45%' }}>
                <SourcePane paperId={paper.id} title={paper.title} request={pageRequest} onQuote={quote} onClose={() => setSourceOpen(false)} />
              </div>
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="拖动调整原文宽度"
                tabIndex={0}
                className={styles.splitter}
                onPointerDown={resizeSource}
                onKeyDown={nudgeSource}
              />
            </>
          ) : null}
          <div className={styles.main}>
            <MapToolbar
              controller={controller}
              state={state}
              view={view}
              onView={switchView}
              panelOpen={panelOpen}
              onTogglePanel={() => setPanelOpen((open) => !open)}
              onFind={() => runCommand('find')}
            />
            <div ref={stageRef} className={styles.stage}>
              <div ref={canvasRef} className={styles.canvas} hidden={view !== 'map'} aria-label={`思维导图：${name}`} />
              {view === 'outline' && state.ready ? (
                <OutlineView
                  controller={controller}
                  version={state.version}
                  activeId={outlineActive}
                  onActivate={(id) => {
                    setOutlineActive(id)
                    controller.select([id])
                  }}
                  onOpenPage={openPage}
                />
              ) : null}
              {find.open ? <FindBar controller={controller} version={state.version} focusSignal={find.signal} onResults={onFindResults} onClose={closeFind} /> : null}
              {view === 'map' && state.ready ? (
                <div className={styles.zoomBar}>
                  <IconButton icon={ZoomOutIcon} aria-label="缩小" keybindingHint={hintFor('zoomOut')} size="small" variant="invisible" onClick={() => controller.zoomBy(-0.1)} />
                  <Button size="small" variant="invisible" className={styles.zoomValue} aria-label="恢复实际大小" onClick={() => controller.zoomTo(1)}>
                    {Math.round(state.scale * 100)}%
                  </Button>
                  <IconButton icon={ZoomInIcon} aria-label="放大" keybindingHint={hintFor('zoomIn')} size="small" variant="invisible" onClick={() => controller.zoomBy(0.1)} />
                  <IconButton icon={ScreenFullIcon} aria-label="适应窗口" size="small" variant="invisible" onClick={() => controller.fit()} />
                </div>
              ) : null}
              {state.linking ? (
                <p className={styles.linkHint} role="status">
                  点选另一个主题建立联系 · Esc 取消
                </p>
              ) : view === 'map' && state.ready && state.nodeCount <= 1 ? (
                <p className={styles.startHint}>
                  {shortcutText('insertChild')} 子主题 · {shortcutText('insertSibling')} 同级 · {shortcutText('edit')} 编辑 · {shortcutText('shortcuts')} 全部快捷键
                </p>
              ) : null}
              {loadError ? (
                <div className={styles.overlay}>
                  <Flash variant="danger">思维导图加载失败：{loadError}</Flash>
                </div>
              ) : !state.ready ? (
                <div className={styles.overlay}>
                  <Spinner srText="正在打开思维导图" />
                </div>
              ) : null}
            </div>
          </div>
          {panelOpen && state.ready ? (
            <FormatPanel
              controller={controller}
              state={state}
              hasPaper={Boolean(paper)}
              request={fieldRequest}
              onOpenPage={openPage}
              onClose={() => {
                setPanelOpen(false)
                refocusMap()
              }}
            />
          ) : null}
        </div>
        <input ref={fileInputRef} type="file" accept={IMPORT_ACCEPT} hidden onChange={(event) => void importFile(event)} />
        <MapContextMenu
          menu={menu}
          state={state}
          onCommand={onMenuCommand}
          onClose={() => {
            setMenu(null)
            refocusMap()
          }}
        />
        {shortcutsOpen ? (
          <ShortcutsDialog
            onClose={() => {
              setShortcutsOpen(false)
              refocusMap()
            }}
          />
        ) : null}
        {highlightCss ? <style>{highlightCss}</style> : null}
      </div>
    </PageFrame>
  )
}
