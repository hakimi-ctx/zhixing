'use client'

import { useEffect, useId, useState, type CSSProperties } from 'react'
import { Button, FormControl, IconButton, SegmentedControl, Select, TextInput, TextInputWithTokens, Textarea, ToggleSwitch } from '@primer/react'
import {
  ArrowBothIcon,
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  BoldIcon,
  BookIcon,
  ItalicIcon,
  PencilIcon,
  StrikethroughIcon,
  TrashIcon,
  XIcon,
} from '@primer/octicons-react'
import { MARKER_GROUPS, MIND_THEMES, type MindNode, type MindTheme } from '@/lib/shared/mindmap'
import { FONT_SIZES, type Direction, type MapController, type MapState, type PanelField, type QuickStyle } from './controller'
import { hintFor, shortcutText } from './keymap'
import { markerHtml } from './render'
import { BORDER_SWATCHES, FILL_SWATCHES, HUE_LABEL, ON_EMPHASIS, STRONG_FILL_SWATCHES, TEXT_SWATCHES, THEME_LABEL, resolveColor, type Hue } from './theme'
import { useDraft } from './use-map'
import styles from './mindmap.module.css'

export interface FieldRequest {
  field: PanelField
  /** Changes on every request, so asking for the same field twice focuses it again. */
  at: number
}

interface FormatPanelProps {
  controller: MapController
  state: MapState
  hasPaper: boolean
  request: FieldRequest | null
  onOpenPage: (page: number) => void
  onClose: () => void
}

export function FormatPanel({ controller, state, hasPaper, request, onOpenPage, onClose }: FormatPanelProps) {
  const [tab, setTab] = useState<'style' | 'map'>('style')
  const primary = state.selection[state.selection.length - 1] ?? null
  const ids = useId()

  useEffect(() => {
    if (request) setTab('style')
  }, [request])

  useEffect(() => {
    if (!request || !primary) return
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(`${ids}-${request.field}`)
      if (target instanceof HTMLElement) {
        target.focus()
        target.scrollIntoView({ block: 'nearest' })
      }
    })
    return () => cancelAnimationFrame(frame)
    // Only a new request moves focus; selection changes must not steal it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, ids])

  const section = state.arrow ? 'arrow' : state.summary ? 'summary' : primary && tab === 'style' ? 'topic' : 'map'

  return (
    <aside className={styles.panel} aria-label="格式">
      <div className={styles.panelHead}>
        {primary || state.arrow || state.summary ? (
          <SegmentedControl aria-label="格式内容" size="small" fullWidth onChange={(index) => setTab(index === 0 ? 'style' : 'map')}>
            <SegmentedControl.Button selected={section !== 'map'}>样式</SegmentedControl.Button>
            <SegmentedControl.Button selected={section === 'map'}>画布</SegmentedControl.Button>
          </SegmentedControl>
        ) : (
          <h2 className={styles.panelTitle}>画布</h2>
        )}
        <IconButton icon={XIcon} aria-label="关闭格式面板" size="small" variant="invisible" onClick={onClose} />
      </div>
      <div className={styles.panelBody}>
        {section === 'arrow' && state.arrow ? (
          <ArrowSection controller={controller} label={state.arrow.label} bidirectional={state.arrow.bidirectional} ids={ids} />
        ) : section === 'summary' && state.summary ? (
          <SummarySection controller={controller} label={state.summary.label} />
        ) : section === 'topic' && primary ? (
          <TopicSection
            key={primary.id}
            controller={controller}
            node={primary.node}
            count={state.selection.length}
            fontSize={primary.fontSize}
            hasPaper={hasPaper}
            ids={ids}
            onOpenPage={onOpenPage}
          />
        ) : (
          <MapSection controller={controller} state={state} ids={ids} />
        )}
      </div>
    </aside>
  )
}

function Group({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section className={styles.group} aria-labelledby={id}>
      <h3 className={styles.groupTitle} id={id}>
        {title}
      </h3>
      {children}
    </section>
  )
}

interface Swatch {
  hue: Hue
  value: string
  /** What the swatch shows when it differs from the stored value (borders). */
  color?: string
}

function Swatches({ label, swatches, value, onPick }: { label: string; swatches: Swatch[]; value: string | undefined; onPick: (value: string | null) => void }) {
  return (
    <div className={styles.swatches} role="group" aria-label={label}>
      <button type="button" className={styles.swatch} data-empty="" aria-pressed={!value} aria-label="默认" title="默认" onClick={() => onPick(null)} />
      {swatches.map((swatch) => (
        <button
          key={swatch.value}
          type="button"
          className={styles.swatch}
          style={{ '--swatch': swatch.color ?? swatch.value } as CSSProperties}
          aria-pressed={value === swatch.value}
          aria-label={HUE_LABEL[swatch.hue]}
          title={HUE_LABEL[swatch.hue]}
          onClick={() => onPick(swatch.value)}
        />
      ))}
    </div>
  )
}

const QUICK: { kind: QuickStyle; label: string; command: 'styleVeryImportant' | 'styleImportant' | 'styleCrossOut' | 'styleDefault' }[] = [
  { kind: 'veryImportant', label: '非常重要', command: 'styleVeryImportant' },
  { kind: 'important', label: '重要', command: 'styleImportant' },
  { kind: 'crossOut', label: '划掉', command: 'styleCrossOut' },
  { kind: 'default', label: '默认', command: 'styleDefault' },
]

const BRANCH_SWATCHES = (['blue', 'green', 'orange', 'purple', 'pink', 'teal', 'yellow', 'red'] as Hue[]).map((hue) => ({ hue, token: `var(--display-${hue}-borderColor-emphasis)` }))

interface TopicSectionProps {
  controller: MapController
  node: MindNode
  count: number
  fontSize: number
  hasPaper: boolean
  ids: string
  onOpenPage: (page: number) => void
}

function TopicSection({ controller, node, count, fontSize, hasPaper, ids, onOpenPage }: TopicSectionProps) {
  const style = node.style ?? {}
  const decoration = style.textDecoration ?? ''
  const bold = /bold|[6-9]00/.test(style.fontWeight ?? '')
  const markers = new Set(node.metadata?.markers ?? [])
  const ownSize = Number.parseFloat(style.fontSize ?? '')
  const branchValue = node.branchColor
  const branchSwatches = BRANCH_SWATCHES.map(({ hue, token }) => ({ hue, value: resolveColor(token) ?? token, color: token }))

  return (
    <>
      {count > 1 ? <p className={styles.panelNote}>已选中 {count} 个主题，修改会应用到全部。</p> : null}

      <Group title="快速样式">
        <div className={styles.quickStyles}>
          {QUICK.map((item) => (
            <button
              key={item.kind}
              type="button"
              className={styles.quickStyle}
              data-kind={item.kind}
              title={`${item.label}（${shortcutText(item.command)}）`}
              onClick={() => controller.applyQuickStyle(item.kind)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </Group>

      <Group title="文字">
        <div className={styles.row}>
          <div className={styles.toggleGroup} role="group" aria-label="文字样式">
            <IconButton icon={BoldIcon} aria-label="加粗" keybindingHint={hintFor('bold')} size="small" variant="invisible" aria-pressed={bold} className={styles.pressable} onClick={() => controller.toggleTextStyle('bold')} />
            <IconButton icon={ItalicIcon} aria-label="斜体" keybindingHint={hintFor('italic')} size="small" variant="invisible" aria-pressed={style.fontStyle === 'italic'} className={styles.pressable} onClick={() => controller.toggleTextStyle('italic')} />
            <Button
              size="small"
              variant="invisible"
              aria-label="下划线"
              aria-pressed={decoration.includes('underline')}
              className={`${styles.pressable} ${styles.underlineButton}`}
              onClick={() => controller.toggleTextStyle('underline')}
            >
              U
            </Button>
            <IconButton icon={StrikethroughIcon} aria-label="删除线" size="small" variant="invisible" aria-pressed={decoration.includes('line-through')} className={styles.pressable} onClick={() => controller.toggleTextStyle('strike')} />
          </div>
          <Select
            size="small"
            aria-label="字号"
            value={ownSize ? String(ownSize) : ''}
            onChange={(event) => controller.setStyle({ fontSize: event.target.value ? `${event.target.value}px` : null })}
            className={styles.sizeSelect}
          >
            <Select.Option value="">默认 {Math.round(fontSize)}</Select.Option>
            {FONT_SIZES.map((size) => (
              <Select.Option key={size} value={String(size)}>
                {size}
              </Select.Option>
            ))}
          </Select>
        </div>
        <Swatches label="文字颜色" swatches={TEXT_SWATCHES} value={style.color} onPick={(value) => controller.setStyle({ color: value })} />
      </Group>

      <Group title="填充">
        <Swatches label="浅色填充" swatches={FILL_SWATCHES} value={style.background} onPick={(value) => controller.setStyle({ background: value, color: style.color === ON_EMPHASIS ? null : (style.color ?? null) })} />
        <Swatches label="深色填充" swatches={STRONG_FILL_SWATCHES} value={style.background} onPick={(value) => controller.setStyle({ background: value, color: value ? ON_EMPHASIS : null })} />
      </Group>

      <Group title="边框与分支">
        <Swatches
          label="边框"
          swatches={BORDER_SWATCHES.map((swatch) => ({ ...swatch, color: swatch.value.replace(/^2px solid /, '') }))}
          value={style.border}
          onPick={(value) => controller.setStyle({ border: value })}
        />
        <Swatches label="分支线颜色" swatches={branchSwatches} value={branchValue} onPick={(value) => controller.setBranchColor(value)} />
      </Group>

      <Group title="标记">
        {MARKER_GROUPS.map((group) => (
          <div key={group.id} className={styles.markerRow} role="group" aria-label={group.label}>
            {group.markers.map((marker) => (
              <button
                key={marker.id}
                type="button"
                className={styles.markerButton}
                aria-pressed={markers.has(marker.id)}
                aria-label={marker.label}
                title={marker.label}
                onClick={() => controller.toggleMarker(marker.id)}
                // Built from our own constant marker table, escaped in markerHtml.
                dangerouslySetInnerHTML={{ __html: markerHtml(marker.id) }}
              />
            ))}
          </div>
        ))}
      </Group>

      <LabelsField controller={controller} tags={node.tags ?? []} id={`${ids}-labels`} />
      <NoteField controller={controller} note={node.note ?? ''} id={`${ids}-note`} />
      <LinkField controller={controller} link={node.hyperLink ?? ''} id={`${ids}-link`} />
      <PageField controller={controller} page={node.metadata?.page ?? null} id={`${ids}-page`} hasPaper={hasPaper} onOpenPage={onOpenPage} />
    </>
  )
}

function LabelsField({ controller, tags, id }: { controller: MapController; tags: string[]; id: string }) {
  const [text, setText] = useState('')
  const add = () => {
    const extra = text
      .split(/[,，;；、]/)
      .map((tag) => tag.trim())
      .filter(Boolean)
    if (!extra.length) return
    controller.setTags([...tags, ...extra])
    setText('')
  }
  return (
    <FormControl id={id}>
      <FormControl.Label>标签</FormControl.Label>
      <TextInputWithTokens
        block
        size="small"
        tokens={tags.map((tag) => ({ id: tag, text: tag }))}
        onTokenRemove={(tokenId) => controller.setTags(tags.filter((tag) => tag !== tokenId))}
        value={text}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => setText(event.target.value)}
        onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return
          if (event.key === 'Enter' || event.key === ',' || event.key === '，') {
            event.preventDefault()
            add()
          }
        }}
        onBlur={add}
        placeholder={tags.length ? '' : '回车添加'}
      />
    </FormControl>
  )
}

function NoteField({ controller, note, id }: { controller: MapController; note: string; id: string }) {
  const [draft, setDraft, ref] = useDraft(note)
  return (
    <FormControl id={id}>
      <FormControl.Label>备注</FormControl.Label>
      <Textarea
        ref={ref as React.RefObject<HTMLTextAreaElement>}
        block
        rows={4}
        resize="vertical"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
          controller.setNote(event.target.value)
        }}
        placeholder="读到的细节、自己的想法…"
      />
    </FormControl>
  )
}

function LinkField({ controller, link, id }: { controller: MapController; link: string; id: string }) {
  const [draft, setDraft, ref] = useDraft(link)
  const commit = () => {
    if (draft.trim() !== link) controller.setLink(draft.trim() || null)
  }
  return (
    <FormControl id={id}>
      <FormControl.Label>链接</FormControl.Label>
      <TextInput
        ref={ref as React.RefObject<HTMLInputElement>}
        block
        size="small"
        type="url"
        value={draft}
        placeholder="https://"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) commit()
        }}
      />
    </FormControl>
  )
}

function PageField({ controller, page, id, hasPaper, onOpenPage }: { controller: MapController; page: number | null; id: string; hasPaper: boolean; onOpenPage: (page: number) => void }) {
  const [draft, setDraft, ref] = useDraft(page ? String(page) : '')
  const parsed = Number.parseInt(draft, 10)
  const commit = () => {
    const next = draft.trim() ? parsed : null
    if (next !== null && !(Number.isInteger(next) && next >= 1)) {
      setDraft(page ? String(page) : '')
      return
    }
    if (next !== page) controller.setPage(next)
  }
  return (
    <FormControl id={id}>
      <FormControl.Label>原文页码</FormControl.Label>
      <div className={styles.row}>
        <TextInput
          ref={ref as React.RefObject<HTMLInputElement>}
          size="small"
          inputMode="numeric"
          value={draft}
          placeholder="—"
          className={styles.pageInput}
          onChange={(event) => setDraft(event.target.value.replace(/\D/g, '').slice(0, 6))}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit()
          }}
        />
        {hasPaper ? (
          <IconButton icon={BookIcon} aria-label="在原文中查看" size="small" variant="invisible" disabled={!page} onClick={() => page && onOpenPage(page)} />
        ) : null}
      </div>
    </FormControl>
  )
}

function ArrowSection({ controller, label, bidirectional, ids }: { controller: MapController; label: string; bidirectional: boolean; ids: string }) {
  return (
    <Group title="联系">
      <p className={styles.panelNote}>{label || '（无文字）'}</p>
      <div className={styles.row}>
        <Button size="small" leadingVisual={PencilIcon} onClick={() => controller.run('edit')}>
          编辑文字
        </Button>
        <IconButton icon={TrashIcon} aria-label="删除联系" size="small" variant="invisible" onClick={() => controller.run('remove')} />
      </div>
      <div className={styles.switchRow}>
        <span id={`${ids}-bidirectional`}>双向箭头</span>
        <ToggleSwitch aria-labelledby={`${ids}-bidirectional`} size="small" checked={bidirectional} onClick={() => controller.toggleArrowBidirectional()} statusLabelPosition="end" />
      </div>
    </Group>
  )
}

function SummarySection({ controller, label }: { controller: MapController; label: string }) {
  return (
    <Group title="概要">
      <p className={styles.panelNote}>{label || '（无文字）'}</p>
      <div className={styles.row}>
        <Button size="small" leadingVisual={PencilIcon} onClick={() => controller.run('edit')}>
          编辑文字
        </Button>
        <IconButton icon={TrashIcon} aria-label="删除概要" size="small" variant="invisible" onClick={() => controller.run('remove')} />
      </div>
    </Group>
  )
}

const DIRECTIONS: { value: Direction; label: string; icon: typeof ArrowRightIcon }[] = [
  { value: 2, label: '两侧展开', icon: ArrowBothIcon },
  { value: 1, label: '向右展开', icon: ArrowRightIcon },
  { value: 0, label: '向左展开', icon: ArrowLeftIcon },
  { value: 3, label: '向下展开', icon: ArrowDownIcon },
]

function MapSection({ controller, state, ids }: { controller: MapController; state: MapState; ids: string }) {
  return (
    <>
      <Group title="结构">
        <SegmentedControl aria-label="结构" size="small" fullWidth onChange={(index) => controller.setDirection(DIRECTIONS[index].value)}>
          {DIRECTIONS.map((item) => (
            <SegmentedControl.IconButton key={item.value} icon={item.icon} aria-label={item.label} selected={state.direction === item.value} />
          ))}
        </SegmentedControl>
      </Group>
      <Group title="风格">
        <div className={styles.themes}>
          {MIND_THEMES.map((name: MindTheme) => (
            <button key={name} type="button" className={styles.themeCard} data-theme={name} aria-pressed={state.themeName === name} onClick={() => controller.setTheme(name)}>
              <span className={styles.themeRoot} aria-hidden="true" />
              <span className={styles.themeBranch} aria-hidden="true" />
              <span className={styles.themeLabel}>{THEME_LABEL[name]}</span>
            </button>
          ))}
        </div>
      </Group>
      <div className={styles.group}>
        <div className={styles.switchRow}>
          <span id={`${ids}-compact`}>紧凑布局</span>
          <ToggleSwitch aria-labelledby={`${ids}-compact`} size="small" checked={state.compact} onClick={() => controller.setCompact(!state.compact)} statusLabelPosition="end" />
        </div>
        <p className={styles.panelNote}>{state.nodeCount} 个主题</p>
      </div>
    </>
  )
}
