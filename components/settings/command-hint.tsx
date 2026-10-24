import { CopyButton } from '@/components/ui/copy-button'
import styles from './settings.module.css'

export function CommandHint({ label, command }: { label: string; command: string }) {
  return (
    <div className={styles.command}>
      <span className={styles.commandLabel}>{label}</span>
      <code className={styles.commandText}>{command}</code>
      <CopyButton text={command} label={`复制${label}`} />
    </div>
  )
}
