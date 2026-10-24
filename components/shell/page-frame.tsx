import styles from './page-frame.module.css'

interface PageFrameProps {
  title: React.ReactNode
  /** Shown before the title, e.g. a file-type icon. */
  leading?: React.ReactNode
  meta?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  /** "scroll": the body scrolls; "fill": the child manages its own layout (chat, editors). */
  body?: 'scroll' | 'fill'
}

export function PageFrame({ title, leading, meta, actions, children, body = 'scroll' }: PageFrameProps) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleArea}>
          {leading ? <span className={styles.leading}>{leading}</span> : null}
          <h1 className={styles.title}>{title}</h1>
          {meta ? <div className={styles.meta}>{meta}</div> : null}
        </div>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </header>
      <div className={body === 'scroll' ? styles.scrollBody : styles.fillBody}>{children}</div>
    </div>
  )
}
