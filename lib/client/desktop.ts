'use client'

import { useEffect, useState } from 'react'

/** Exposed by electron/preload.cjs when 知行 runs as the desktop app. */
export interface DesktopBridge {
  isDesktop: true
  version: string
  pickFolder: (defaultPath?: string) => Promise<string | null>
  openExternal: (url: string) => Promise<void>
}

declare global {
  interface Window {
    zhixing?: DesktopBridge
  }
}

export function desktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null
  return window.zhixing?.isDesktop ? window.zhixing : null
}

/** False during SSR and the first client render, so server and client markup match. */
export function useDesktop(): DesktopBridge | null {
  const [bridge, setBridge] = useState<DesktopBridge | null>(null)
  useEffect(() => setBridge(desktopBridge()), [])
  return bridge
}
