'use client'

import { useRouter } from 'next/navigation'
import { ActionList, ActionMenu } from '@primer/react'
import { BriefcaseIcon, MortarBoardIcon } from '@primer/octicons-react'
import type { AppMode } from '@/lib/shared/types'
import styles from './shell.module.css'

const MODES = [
  { mode: 'study', label: 'Study', description: 'AI 导师答疑、本地文件库和思维导图', href: '/study', icon: MortarBoardIcon },
  { mode: 'work', label: 'Work', description: '三个模型上下级分工，再交给执行器落地', href: '/work', icon: BriefcaseIcon },
] as const

export function ModeSwitcher({ mode }: { mode: AppMode }) {
  const router = useRouter()
  const current = MODES.find((item) => item.mode === mode) ?? MODES[0]
  return (
    <ActionMenu>
      <ActionMenu.Button variant="invisible" className={styles.modeButton} aria-label={`当前是 ${current.label} 模式，点击切换`}>
        {current.label}
      </ActionMenu.Button>
      <ActionMenu.Overlay width="medium">
        <ActionList selectionVariant="single" aria-label="切换模式">
          {MODES.map((item) => (
            <ActionList.Item key={item.mode} selected={item.mode === mode} onSelect={() => router.push(item.href)}>
              <ActionList.LeadingVisual>
                <item.icon />
              </ActionList.LeadingVisual>
              {item.label}
              <ActionList.Description variant="block">{item.description}</ActionList.Description>
            </ActionList.Item>
          ))}
        </ActionList>
      </ActionMenu.Overlay>
    </ActionMenu>
  )
}
