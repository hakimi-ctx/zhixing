'use client'

import { useRef } from 'react'
import { ActionList, ActionMenu } from '@primer/react'
import { KeybindingHint } from '@primer/react/experimental'
import type { MapState } from './controller'
import { hintFor, type CommandId } from './keymap'
import styles from './mindmap.module.css'

export type MenuCommand = CommandId | 'copy' | 'cut' | 'paste'

export interface MenuPosition {
  x: number
  y: number
  onTopic: boolean
}

interface ItemDef {
  command: MenuCommand
  label: string
  disabled?: boolean
  danger?: boolean
}

const CLIPBOARD_KEYS: Partial<Record<MenuCommand, string>> = { copy: 'Mod+C', cut: 'Mod+X', paste: 'Mod+V' }

function keysOf(command: MenuCommand): string | undefined {
  return CLIPBOARD_KEYS[command] ?? hintFor(command as CommandId)
}

interface MapContextMenuProps {
  menu: MenuPosition | null
  state: MapState
  onCommand: (command: MenuCommand) => void
  onClose: () => void
}

export function MapContextMenu({ menu, state, onCommand, onClose }: MapContextMenuProps) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const primary = state.selection[state.selection.length - 1]
  const isRoot = !primary || primary.isRoot
  const folds = Boolean(primary && primary.childCount > 0 && !primary.isRoot)

  const groups: ItemDef[][] = menu?.onTopic
    ? [
        [
          { command: 'insertChild', label: '子主题' },
          { command: 'insertSibling', label: '同级主题' },
          { command: 'insertParent', label: '父主题', disabled: isRoot },
        ],
        [
          { command: 'copy', label: '复制' },
          { command: 'cut', label: '剪切', disabled: isRoot },
          { command: 'paste', label: '粘贴' },
          { command: 'duplicate', label: '复制为副本', disabled: isRoot },
        ],
        [
          { command: 'relationship', label: '联系' },
          { command: 'summary', label: '概要', disabled: isRoot },
          { command: 'note', label: '备注' },
          { command: 'labels', label: '标签' },
          { command: 'link', label: '链接' },
        ],
        [
          ...(folds ? [{ command: 'toggleFold' as const, label: primary?.node.expanded === false ? '展开' : '折叠' }] : []),
          { command: 'toggleFoldAll', label: '全部折叠 / 展开分支' },
        ],
        [
          { command: 'remove', label: '删除', disabled: isRoot, danger: true },
          { command: 'removeSingle', label: '只删除这个主题', disabled: isRoot, danger: true },
        ],
      ]
    : [
        [{ command: 'paste', label: '粘贴' }],
        [
          { command: 'expandAll', label: '全部展开' },
          { command: 'collapseAll', label: '只显示分支主题' },
          { command: 'selectCenter', label: '选中中心主题' },
          { command: 'zoomFit', label: '适应窗口' },
        ],
        [{ command: 'exportImage', label: '导出图片' }],
      ]

  return (
    <>
      <div ref={anchorRef} className={styles.menuAnchor} style={menu ? { left: menu.x, top: menu.y } : undefined} aria-hidden="true" />
      <ActionMenu open={menu !== null} onOpenChange={(open) => (open ? undefined : onClose())} anchorRef={anchorRef}>
        <ActionMenu.Overlay width="medium" side="outside-bottom" align="start">
          <ActionList>
            {groups
              .filter((group) => group.length)
              .map((group, index) => (
                <ActionList.Group key={index}>
                  {index > 0 ? <ActionList.Divider /> : null}
                  {group.map((item) => {
                    const keys = keysOf(item.command)
                    return (
                      <ActionList.Item
                        key={item.command}
                        disabled={item.disabled}
                        variant={item.danger ? 'danger' : 'default'}
                        onSelect={() => {
                          onClose()
                          onCommand(item.command)
                        }}
                      >
                        {item.label}
                        {keys ? (
                          <ActionList.TrailingVisual>
                            <KeybindingHint keys={keys} size="small" />
                          </ActionList.TrailingVisual>
                        ) : null}
                      </ActionList.Item>
                    )
                  })}
                </ActionList.Group>
              ))}
          </ActionList>
        </ActionMenu.Overlay>
      </ActionMenu>
    </>
  )
}
