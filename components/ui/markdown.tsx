'use client'

import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { TabLink } from '@/lib/client/tabs'
import styles from './markdown.module.css'

const isInternal = (href: string | undefined): href is string => Boolean(href && href.startsWith('/') && !href.startsWith('//'))

const components: Components = {
  a: ({ node: _node, href, ...props }) =>
    isInternal(href) ? <TabLink href={href} {...props} /> : <a href={href} {...props} target="_blank" rel="noreferrer noopener" />,
}

/** Raw HTML is not rendered and unsafe URLs are stripped by react-markdown's defaults. App links open in tabs. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className={styles.markdown}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
