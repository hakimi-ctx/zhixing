'use client'

import { useEffect, useState } from 'react'
import { IconButton } from '@primer/react'
import { CheckIcon, CopyIcon } from '@primer/octicons-react'

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}

interface CopyButtonProps {
  text: string
  label?: string
  size?: 'small' | 'medium'
}

export function CopyButton({ text, label = '复制', size = 'small' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])

  return (
    <IconButton
      icon={copied ? CheckIcon : CopyIcon}
      aria-label={copied ? '已复制' : label}
      variant="invisible"
      size={size}
      onClick={async () => setCopied(await copyText(text))}
    />
  )
}
