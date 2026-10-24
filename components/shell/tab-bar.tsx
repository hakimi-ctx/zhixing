'use client'

import { useEffect, useRef, useState } from 'react'
import { ActionList, ActionMenu, IconButton } from '@primer/react'
import { ArrowLeftIcon, ArrowRightIcon, PlusIcon, XIcon } from '@primer/octicons-react'
import { tabHref, useTabs, type Tab } from '@/lib/client/tabs'
import { useTabDescriber, type TabInfo } from './tab-info'
import styles from './tab-bar.module.css'

const DRAG_TYPE = 'application/x-zhixing-tab'

interface TabItemProps {
  tab: Tab
  info: TabInfo
  active: boolean
  dropTarget: boolean
  onActivate: () => void
  onClose: () => void
  onMenu: (anchor: HTMLElement) => void
  onDragTarget: (id: string | null) => void
  onDropOn: (fromId: string) => void
}

function TabItem({ tab, info, active, dropTarget, onActivate, onClose, onMenu, onDragTarget, onDropOn }: TabItemProps) {
  const Icon = info.icon
  return (
    <li
      className={styles.tab}
      data-tab-id={tab.id}
      data-active={active}
      data-drop={dropTarget}
      title={info.title}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, tab.id)
        event.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(DRAG_TYPE)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        onDragTarget(tab.id)
      }}
      onDragLeave={() => onDragTarget(null)}
      onDrop={(event) => {
        const from = event.dataTransfer.getData(DRAG_TYPE)
        onDragTarget(null)
        if (!from) return
        event.preventDefault()
        onDropOn(from)
      }}
      onDragEnd={() => onDragTarget(null)}
      onMouseDown={(event) => {
        // Middle-click closes the tab; stop the browser's autoscroll from starting.
        if (event.button === 1) event.preventDefault()
      }}
      onAuxClick={(event) => {
        if (event.button !== 1) return
        event.preventDefault()
        onClose()
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        onMenu(event.currentTarget)
      }}
    >
      <button type="button" className={styles.tabButton} aria-current={active ? 'page' : undefined} onClick={onActivate}>
        <Icon size={14} className={styles.tabIcon} />
        <span className={styles.tabTitle}>{info.title}</span>
      </button>
      <IconButton
        icon={XIcon}
        aria-label={`关闭“${info.title}”`}
        size="small"
        variant="invisible"
        unsafeDisableTooltip
        className={styles.close}
        onClick={onClose}
      />
    </li>
  )
}

export function TabBar() {
  const tabs = useTabs()
  const describe = useTabDescriber()
  const listRef = useRef<HTMLUListElement>(null)
  const anchorRef = useRef<HTMLElement | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  useEffect(() => {
    const item = listRef.current?.querySelector<HTMLElement>(`[data-tab-id="${tabs.activeId}"]`)
    item?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [tabs.activeId, tabs.tabs.length])

  useEffect(() => {
    const cycle = (delta: number) => {
      const index = tabs.tabs.findIndex((tab) => tab.id === tabs.activeId)
      const next = tabs.tabs[(index + delta + tabs.tabs.length) % tabs.tabs.length]
      if (next) tabs.activate(next.id)
    }
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.isComposing) return
      const key = event.key.toLowerCase()
      if (event.altKey && (key === 'arrowleft' || key === 'arrowright')) {
        event.preventDefault()
        if (key === 'arrowleft') tabs.goBack()
        else tabs.goForward()
        return
      }
      if (event.altKey) return
      if (key === 'w' && !event.shiftKey) {
        if (!tabs.inStudy) return
        event.preventDefault()
        tabs.close(tabs.activeId)
      } else if (key === 't' && !event.shiftKey) {
        event.preventDefault()
        tabs.newTab()
      } else if (key === 'tab') {
        event.preventDefault()
        cycle(event.shiftKey ? -1 : 1)
      } else if (key === 'pagedown' || key === 'pageup') {
        event.preventDefault()
        cycle(key === 'pageup' ? -1 : 1)
      }
    }
    const onMouse = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return
      event.preventDefault()
      if (event.type !== 'mouseup') return
      if (event.button === 3) tabs.goBack()
      else tabs.goForward()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onMouse)
    window.addEventListener('mouseup', onMouse)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onMouse)
      window.removeEventListener('mouseup', onMouse)
    }
  }, [tabs])

  const menuTab = menuFor ? tabs.tabs.find((tab) => tab.id === menuFor) : undefined
  const menuIndex = menuTab ? tabs.tabs.indexOf(menuTab) : -1

  return (
    <div className={styles.bar}>
      <div className={styles.history}>
        <IconButton
          icon={ArrowLeftIcon}
          aria-label="后退"
          keybindingHint="Mod+Alt+ArrowLeft"
          size="small"
          variant="invisible"
          disabled={!tabs.canGoBack}
          onClick={tabs.goBack}
        />
        <IconButton
          icon={ArrowRightIcon}
          aria-label="前进"
          keybindingHint="Mod+Alt+ArrowRight"
          size="small"
          variant="invisible"
          disabled={!tabs.canGoForward}
          onClick={tabs.goForward}
        />
      </div>
      {tabs.ready ? (
        <ul
          ref={listRef}
          className={styles.list}
          aria-label="标签页"
          onWheel={(event) => {
            const list = event.currentTarget
            if (Math.abs(event.deltaY) > Math.abs(event.deltaX) && list.scrollWidth > list.clientWidth) list.scrollLeft += event.deltaY
          }}
        >
          {tabs.tabs.map((tab) => (
            <TabItem
              key={tab.id}
              tab={tab}
              info={describe(tabHref(tab))}
              active={tabs.inStudy && tab.id === tabs.activeId}
              dropTarget={dropTarget === tab.id}
              onActivate={() => tabs.activate(tab.id)}
              onClose={() => tabs.close(tab.id)}
              onMenu={(anchor) => {
                anchorRef.current = anchor
                setMenuFor(tab.id)
              }}
              onDragTarget={setDropTarget}
              onDropOn={(fromId) => tabs.reorder(fromId, tab.id)}
            />
          ))}
        </ul>
      ) : null}
      <IconButton
        icon={PlusIcon}
        aria-label="新标签页"
        keybindingHint="Mod+T"
        size="small"
        variant="invisible"
        className={styles.add}
        onClick={() => tabs.newTab()}
      />

      <ActionMenu open={menuTab !== undefined} onOpenChange={(open) => !open && setMenuFor(null)} anchorRef={anchorRef}>
        <ActionMenu.Overlay width="small">
          <ActionList>
            <ActionList.Item onSelect={() => menuTab && tabs.close(menuTab.id)}>关闭</ActionList.Item>
            <ActionList.Item disabled={tabs.tabs.length < 2} onSelect={() => menuTab && tabs.closeOthers(menuTab.id)}>
              关闭其他标签页
            </ActionList.Item>
            <ActionList.Item disabled={menuIndex < 0 || menuIndex >= tabs.tabs.length - 1} onSelect={() => menuTab && tabs.closeToRight(menuTab.id)}>
              关闭右侧标签页
            </ActionList.Item>
          </ActionList>
        </ActionMenu.Overlay>
      </ActionMenu>
    </div>
  )
}
