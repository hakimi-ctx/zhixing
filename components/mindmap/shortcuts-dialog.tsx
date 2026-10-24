'use client'

import { Dialog } from '@primer/react'
import { KeybindingHint } from '@primer/react/experimental'
import { SHORTCUT_GROUPS, hintFor, shortcutKeys } from './keymap'
import styles from './mindmap.module.css'

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="快捷键" subtitle="与 XMind 默认快捷键一致" width="xlarge" onClose={onClose}>
      <div className={styles.shortcutGroups}>
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title} className={styles.shortcutGroup} aria-label={group.title}>
            <h3 className={styles.groupTitle}>{group.title}</h3>
            <dl className={styles.shortcutList}>
              {group.items.map((item) => {
                const chord = item.command && !item.keys ? hintFor(item.command) : undefined
                return (
                  <div key={item.label} className={styles.shortcutItem}>
                    <dt>{item.label}</dt>
                    <dd>{chord ? <KeybindingHint keys={chord} size="small" /> : <kbd className={styles.kbd}>{shortcutKeys(item)}</kbd>}</dd>
                  </div>
                )
              })}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  )
}
