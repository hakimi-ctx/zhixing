import { useId } from 'react'
import styles from './card.module.css'

interface CardProps {
  title?: React.ReactNode
  description?: React.ReactNode
  /** Shown at the right of the title row. */
  actions?: React.ReactNode
  leading?: React.ReactNode
  footer?: React.ReactNode
  children?: React.ReactNode
  as?: 'section' | 'div'
}

export function Card({ title, description, actions, leading, footer, children, as: Tag = 'section' }: CardProps) {
  const id = useId()
  return (
    <Tag className={styles.card} aria-labelledby={title ? id : undefined}>
      {title || actions ? (
        <div className={styles.header}>
          <div className={styles.heading}>
            {leading ? <span className={styles.leading}>{leading}</span> : null}
            <div className={styles.headingText}>
              {title ? (
                <h2 id={id} className={styles.title}>
                  {title}
                </h2>
              ) : null}
              {description ? <p className={styles.description}>{description}</p> : null}
            </div>
          </div>
          {actions ? <div className={styles.actions}>{actions}</div> : null}
        </div>
      ) : null}
      {children ? <div className={styles.body}>{children}</div> : null}
      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </Tag>
  )
}
