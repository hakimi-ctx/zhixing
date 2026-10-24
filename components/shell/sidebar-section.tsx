import { useId } from 'react'
import styles from './shell.module.css'

interface SidebarSectionProps {
  title: string
  actions?: React.ReactNode
  children: React.ReactNode
}

export function SidebarSection({ title, actions, children }: SidebarSectionProps) {
  const id = useId()
  return (
    <section className={styles.section} aria-labelledby={id}>
      <div className={styles.sectionHeader}>
        <h2 id={id} className={styles.sectionTitle}>
          {title}
        </h2>
        {actions ? <div className={styles.sectionActions}>{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}

interface SidebarPaneProps {
  title: string
  /** Small text after the title, e.g. a count. */
  meta?: React.ReactNode
  actions?: React.ReactNode
  /** Fixed row under the header, e.g. a filter box. */
  toolbar?: React.ReactNode
  children: React.ReactNode
}

/** One Study sidebar view: a header with actions and its own scroll area. */
export function SidebarPane({ title, meta, actions, toolbar, children }: SidebarPaneProps) {
  const id = useId()
  return (
    <section className={styles.pane} aria-labelledby={id}>
      <div className={styles.paneHeader}>
        <h2 id={id} className={styles.paneTitle}>
          {title}
          {meta !== undefined && meta !== null ? <span className={styles.paneMeta}>{meta}</span> : null}
        </h2>
        {actions ? <div className={styles.paneActions}>{actions}</div> : null}
      </div>
      {toolbar ? <div className={styles.paneToolbar}>{toolbar}</div> : null}
      <div className={styles.paneBody}>{children}</div>
    </section>
  )
}

export function SidebarEmpty({ children }: { children: React.ReactNode }) {
  return <p className={styles.emptyHint}>{children}</p>
}
