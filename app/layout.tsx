import type { Metadata, Viewport } from 'next'
import './globals.css'
import { Providers } from '@/components/providers'

export const metadata: Metadata = {
  title: { default: '知行', template: '%s · 知行' },
  description: '知行：Study 模式里有 AI 导师、本地文件库和思维导图；Work 模式让 ChatGPT、Claude、Gemini 按上下级分工协作，再交给执行器落地。',
  applicationName: '知行',
}

export const viewport: Viewport = {
  themeColor: '#ffffff',
  colorScheme: 'light',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" data-color-mode="light" data-light-theme="light" data-dark-theme="dark" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
