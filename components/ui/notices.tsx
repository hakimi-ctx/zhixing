'use client'

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { Flash, IconButton, Stack, Text } from '@primer/react'
import { XIcon } from '@primer/octicons-react'
import styles from './notices.module.css'

type NoticeVariant = 'default' | 'success' | 'warning' | 'danger'

interface Notice {
  id: number
  variant: NoticeVariant
  text: string
}

type Notify = (notice: { variant?: NoticeVariant; text: string }) => void

const NoticeContext = createContext<Notify>(() => undefined)

export function NoticeProvider({ children }: { children: React.ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([])
  const counter = useRef(0)

  const dismiss = useCallback((id: number) => {
    setNotices((current) => current.filter((notice) => notice.id !== id))
  }, [])

  const notify = useCallback<Notify>(
    ({ variant = 'default', text }) => {
      counter.current += 1
      const id = counter.current
      setNotices((current) => [...current.slice(-2), { id, variant, text }])
      window.setTimeout(() => dismiss(id), variant === 'danger' || variant === 'warning' ? 9000 : 4000)
    },
    [dismiss],
  )

  const value = useMemo(() => notify, [notify])

  return (
    <NoticeContext.Provider value={value}>
      {children}
      <div className={styles.region} role="status" aria-live="polite">
        {notices.map((notice) => (
          <Flash key={notice.id} variant={notice.variant} className={styles.notice}>
            <Stack direction="horizontal" align="start" justify="space-between" gap="condensed">
              <Text size="small" className={styles.text}>
                {notice.text}
              </Text>
              <IconButton icon={XIcon} aria-label="关闭提示" variant="invisible" size="small" onClick={() => dismiss(notice.id)} />
            </Stack>
          </Flash>
        ))}
      </div>
    </NoticeContext.Provider>
  )
}

export function useNotice(): Notify {
  return useContext(NoticeContext)
}
