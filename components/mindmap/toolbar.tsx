'use client'

import { ActionBar, IconButton, SegmentedControl } from '@primer/react'
import type { ComponentProps } from 'react'

type ActionBarMenuItemProps = ComponentProps<typeof ActionBar.Menu>['items'][number]
import {
  ArrowBothIcon,
  FlagIcon,
  LinkIcon,
  ListUnorderedIcon,
  MoveToStartIcon,
  NoteIcon,
  PaintbrushIcon,
  PlusIcon,
  RedoIcon,
  RowsIcon,
  SearchIcon,
  ShareAndroidIcon,
  StackIcon,
  TagIcon,
  UndoIcon,
} from '@primer/octicons-react'
import { MARKER_GROUPS } from '@/lib/shared/mindmap'
import type { MapController, MapState } from './controller'
import { hintFor, type CommandId } from './keymap'
import styles from './mindmap.module.css'

export type EditorView = 'map' | 'outline'

interface MapToolbarProps {
  controller: MapController
  state: MapState
  view: EditorView
  onView: (view: EditorView) => void
  panelOpen: boolean
  onTogglePanel: () => void
  onFind: () => void
}

/** Commands that open the inline editor; everything else hands focus back to the map. */
const STARTS_EDITING = new Set<CommandId>(['insertChild', 'insertSibling', 'insertParent', 'summary'])

export function MapToolbar({ controller, state, view, onView, panelOpen, onTogglePanel, onFind }: MapToolbarProps) {
  const inMap = view === 'map'
  const hasTopic = state.selection.length > 0
  const primary = state.selection[state.selection.length - 1]
  const hasParent = Boolean(primary && !primary.isRoot)

  const exec = (command: CommandId) => {
    controller.run(command)
    if (inMap && !STARTS_EDITING.has(command) && command !== 'note' && command !== 'link' && command !== 'labels') controller.focus()
  }

  const markerItems: ActionBarMenuItemProps[] = [
    ...MARKER_GROUPS.map((group) => ({
      label: group.label,
      items: group.markers.map((marker) => ({ label: marker.label, onClick: () => controller.toggleMarker(marker.id) })),
    })),
    { type: 'divider' },
    { label: '清除标记', onClick: () => controller.clearMarkers() },
  ]

  return (
    <div className={styles.toolbar}>
      <div className={styles.toolbarMain}>
        <ActionBar aria-label="导图工具" size="small" flush>
          <ActionBar.IconButton icon={PlusIcon} aria-label="子主题" keybindingHint={hintFor('insertChild')} disabled={!inMap || !hasTopic} onClick={() => exec('insertChild')} />
          <ActionBar.IconButton icon={RowsIcon} aria-label="同级主题" keybindingHint={hintFor('insertSibling')} disabled={!inMap || !hasTopic} onClick={() => exec('insertSibling')} />
          <ActionBar.IconButton icon={MoveToStartIcon} aria-label="父主题" keybindingHint={hintFor('insertParent')} disabled={!inMap || !hasParent} onClick={() => exec('insertParent')} />
          <ActionBar.Divider />
          <ActionBar.IconButton
            icon={ArrowBothIcon}
            aria-label={state.linking ? '点选要联系的主题（Esc 取消）' : '联系'}
            keybindingHint={hintFor('relationship')}
            aria-pressed={state.linking}
            disabled={!inMap || !hasTopic}
            onClick={() => (state.linking ? controller.cancelLink() : exec('relationship'))}
          />
          <ActionBar.IconButton icon={StackIcon} aria-label="概要" disabled={!inMap || !hasParent} onClick={() => exec('summary')} />
          <ActionBar.Divider />
          <ActionBar.Menu aria-label="标记" icon={FlagIcon} items={markerItems} disabled={!hasTopic} />
          <ActionBar.IconButton icon={NoteIcon} aria-label="备注" keybindingHint={hintFor('note')} disabled={!hasTopic} onClick={() => exec('note')} />
          <ActionBar.IconButton icon={TagIcon} aria-label="标签" keybindingHint={hintFor('labels')} disabled={!hasTopic} onClick={() => exec('labels')} />
          <ActionBar.IconButton icon={LinkIcon} aria-label="链接" keybindingHint={hintFor('link')} disabled={!hasTopic} onClick={() => exec('link')} />
          <ActionBar.Divider />
          <ActionBar.IconButton icon={UndoIcon} aria-label="撤销" keybindingHint={hintFor('undo')} disabled={!state.canUndo} onClick={() => exec('undo')} />
          <ActionBar.IconButton icon={RedoIcon} aria-label="重做" keybindingHint={hintFor('redo')} disabled={!state.canRedo} onClick={() => exec('redo')} />
        </ActionBar>
      </div>
      <div className={styles.toolbarEnd}>
        <SegmentedControl aria-label="视图" size="small" onChange={(index) => onView(index === 0 ? 'map' : 'outline')}>
          <SegmentedControl.IconButton icon={ShareAndroidIcon} aria-label="导图" selected={view === 'map'} />
          <SegmentedControl.IconButton icon={ListUnorderedIcon} aria-label="大纲" selected={view === 'outline'} />
        </SegmentedControl>
        <IconButton icon={SearchIcon} aria-label="查找" keybindingHint={hintFor('find')} variant="invisible" size="small" onClick={onFind} />
        <IconButton
          icon={PaintbrushIcon}
          aria-label="格式"
          keybindingHint={hintFor('toggleFormat')}
          aria-pressed={panelOpen}
          variant="invisible"
          size="small"
          className={styles.pressable}
          onClick={onTogglePanel}
        />
      </div>
    </div>
  )
}
