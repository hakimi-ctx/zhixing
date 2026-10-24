'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button, Flash, IconButton, Spinner, TextInput } from '@primer/react'
import { ChevronLeftIcon, ChevronRightIcon, QuoteIcon, ScreenFullIcon, XIcon, ZoomInIcon, ZoomOutIcon } from '@primer/octicons-react'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { SOURCE_PAGE_MIME } from './controller'
import styles from './mindmap.module.css'

type PdfJs = typeof import('pdfjs-dist')
type Size = { width: number; height: number }

let loader: Promise<PdfJs> | null = null

/** The legacy build carries the polyfills older WebViews need; worker and data come from /api/pdfjs. */
function loadPdfJs(): Promise<PdfJs> {
  if (!loader) {
    loader = (import('pdfjs-dist/legacy/build/pdf.mjs') as unknown as Promise<PdfJs>).then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = '/api/pdfjs/build/pdf.worker.min.mjs'
      return pdfjs
    })
    loader.catch(() => {
      loader = null
    })
  }
  return loader
}

const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]

function pageOf(node: Node | null): number | null {
  const element = node instanceof Element ? node : (node?.parentElement ?? null)
  const value = element?.closest<HTMLElement>('[data-page]')?.dataset.page
  return value ? Number(value) : null
}

export interface PageRequest {
  page: number
  at: number
}

interface SourcePaneProps {
  paperId: string
  title: string
  request: PageRequest | null
  onQuote: (text: string, page: number | null) => void
  onClose: () => void
}

/**
 * The paper next to the map. Selected text can be dragged onto a topic or added with 摘录; either
 * way the new topic remembers its page, and clicking that page badge scrolls back here.
 */
export function SourcePane({ paperId, title, request, onQuote, onClose }: SourcePaneProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [pdfjs, setPdfjs] = useState<PdfJs | null>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [base, setBase] = useState<Size | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const [available, setAvailable] = useState(0)
  const [current, setCurrent] = useState(1)
  const [pageDraft, setPageDraft] = useState('1')
  const [selection, setSelection] = useState<{ text: string; page: number | null } | null>(null)
  const pendingPage = useRef<number | null>(null)
  const scrollFrame = useRef(0)

  useEffect(() => {
    let cancelled = false
    let task: PDFDocumentLoadingTask | null = null
    setDoc(null)
    setBase(null)
    setError(null)
    loadPdfJs()
      .then(async (lib) => {
        if (cancelled) return
        setPdfjs(lib)
        task = lib.getDocument({
          url: `/api/library/papers/${paperId}/pdf`,
          cMapUrl: '/api/pdfjs/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: '/api/pdfjs/standard_fonts/',
          wasmUrl: '/api/pdfjs/wasm/',
          iccUrl: '/api/pdfjs/iccs/',
        })
        const loaded = await task.promise
        const viewport = (await loaded.getPage(1)).getViewport({ scale: 1 })
        if (cancelled) return
        setBase({ width: viewport.width, height: viewport.height })
        setDoc(loaded)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error && err.name === 'PasswordException' ? '这个 PDF 设置了密码，无法在这里打开。' : '无法打开这篇论文的 PDF。')
      })
    return () => {
      cancelled = true
      void task?.destroy()
    }
  }, [paperId])

  useLayoutEffect(() => {
    const element = scrollerRef.current
    if (!element) return
    const update = () => setAvailable(element.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Quantised so dragging the divider does not re-render every page on every pixel.
  const fitScale = base && available ? Math.max(0.3, Math.floor(((available - 32) / base.width) * 20) / 20) : 1
  const scale = zoom === 'fit' ? fitScale : zoom
  const numPages = doc?.numPages ?? 0

  const goTo = useCallback(
    (page: number) => {
      const element = scrollerRef.current?.querySelector<HTMLElement>(`[data-page="${page}"]`)
      if (!element) {
        pendingPage.current = page
        return
      }
      element.scrollIntoView({ block: 'start' })
      setCurrent(page)
      setPageDraft(String(page))
    },
    [],
  )

  useEffect(() => {
    if (request) goTo(Math.max(1, request.page))
  }, [request, goTo])

  useEffect(() => {
    if (!doc || pendingPage.current === null) return
    const page = Math.min(pendingPage.current, doc.numPages)
    pendingPage.current = null
    const frame = requestAnimationFrame(() => goTo(page))
    return () => cancelAnimationFrame(frame)
  }, [doc, goTo])

  useEffect(() => {
    const onChange = () => {
      const selected = window.getSelection()
      const root = scrollerRef.current
      if (!selected || selected.isCollapsed || !root || !selected.anchorNode || !root.contains(selected.anchorNode)) {
        setSelection(null)
        return
      }
      const text = selected.toString().trim()
      setSelection(text ? { text, page: pageOf(selected.anchorNode) } : null)
    }
    document.addEventListener('selectionchange', onChange)
    return () => document.removeEventListener('selectionchange', onChange)
  }, [])

  const onScroll = () => {
    if (scrollFrame.current) return
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = 0
      const root = scrollerRef.current
      if (!root) return
      const line = root.scrollTop + root.clientHeight / 3
      for (const element of root.querySelectorAll<HTMLElement>('[data-page]')) {
        if (element.offsetTop + element.offsetHeight > line) {
          const page = Number(element.dataset.page)
          setCurrent(page)
          if (!document.activeElement?.hasAttribute('data-page-input')) setPageDraft(String(page))
          break
        }
      }
    })
  }

  useEffect(() => () => cancelAnimationFrame(scrollFrame.current), [])

  const zoomBy = (direction: 1 | -1) => {
    const now = scale
    const next = direction > 0 ? ZOOM_STEPS.find((step) => step > now + 0.001) : [...ZOOM_STEPS].reverse().find((step) => step < now - 0.001)
    setZoom(next ?? now)
  }

  const quote = () => {
    if (!selection) return
    onQuote(selection.text, selection.page)
    window.getSelection()?.removeAllRanges()
    setSelection(null)
  }

  return (
    <section className={styles.source} aria-label={`原文：${title}`}>
      <div className={styles.sourceBar}>
        <div className={styles.sourceNav}>
          <IconButton icon={ChevronLeftIcon} aria-label="上一页" size="small" variant="invisible" disabled={current <= 1} onClick={() => goTo(current - 1)} />
          <TextInput
            size="small"
            aria-label="页码"
            data-page-input=""
            value={pageDraft}
            className={styles.pageBox}
            onChange={(event) => setPageDraft(event.target.value.replace(/\D/g, '').slice(0, 5))}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              const page = Number.parseInt(pageDraft, 10)
              if (Number.isInteger(page) && numPages) goTo(Math.min(Math.max(page, 1), numPages))
            }}
            onBlur={() => setPageDraft(String(current))}
          />
          <span className={styles.pageTotal}>/ {numPages || '–'}</span>
          <IconButton icon={ChevronRightIcon} aria-label="下一页" size="small" variant="invisible" disabled={!numPages || current >= numPages} onClick={() => goTo(current + 1)} />
        </div>
        <div className={styles.sourceNav}>
          <IconButton icon={ZoomOutIcon} aria-label="缩小" size="small" variant="invisible" onClick={() => zoomBy(-1)} />
          <span className={styles.zoomText}>{Math.round(scale * 100)}%</span>
          <IconButton icon={ZoomInIcon} aria-label="放大" size="small" variant="invisible" onClick={() => zoomBy(1)} />
          <IconButton icon={ScreenFullIcon} aria-label="适合宽度" size="small" variant="invisible" aria-pressed={zoom === 'fit'} className={styles.pressable} onClick={() => setZoom('fit')} />
        </div>
        <div className={styles.sourceEnd}>
          <Button
            size="small"
            leadingVisual={QuoteIcon}
            disabled={!selection}
            onMouseDown={(event) => event.preventDefault()}
            onClick={quote}
            aria-description="把选中的原文加到导图里选中的主题下"
          >
            摘录
          </Button>
          <IconButton icon={XIcon} aria-label="关闭原文" size="small" variant="invisible" onClick={onClose} />
        </div>
      </div>
      <div ref={scrollerRef} className={styles.sourceScroller} onScroll={onScroll} tabIndex={0} aria-label="原文页面">
        {error ? (
          <div className={styles.sourceMessage}>
            <Flash variant="danger">{error}</Flash>
          </div>
        ) : !doc || !base || !pdfjs ? (
          <div className={styles.sourceMessage}>
            <Spinner srText="正在打开原文" />
          </div>
        ) : (
          <div
            className={styles.pdfPages}
            onDragStart={(event) => {
              const page = pageOf(event.target as Node) ?? selection?.page ?? null
              if (page) event.dataTransfer.setData(SOURCE_PAGE_MIME, String(page))
              event.dataTransfer.effectAllowed = 'copy'
            }}
          >
            {Array.from({ length: numPages }, (_, index) => (
              <PdfPage key={index} pdfjs={pdfjs} doc={doc} pageNumber={index + 1} scale={scale} base={base} rootRef={scrollerRef} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

interface PdfPageProps {
  pdfjs: PdfJs
  doc: PDFDocumentProxy
  pageNumber: number
  scale: number
  base: Size
  rootRef: React.RefObject<HTMLDivElement | null>
}

/** Rendered only near the viewport; pages far away give their canvas memory back. */
function PdfPage({ pdfjs, doc, pageNumber, scale, base, rootRef }: PdfPageProps) {
  const ref = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [size, setSize] = useState<Size>(base)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { root: rootRef.current, rootMargin: '800px 0px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [rootRef])

  useEffect(() => {
    const canvas = canvasRef.current
    const text = textRef.current
    if (!canvas || !text) return
    if (!visible) {
      canvas.width = 0
      canvas.height = 0
      text.replaceChildren()
      return
    }
    let cancelled = false
    let renderTask: RenderTask | null = null
    let textLayer: InstanceType<PdfJs['TextLayer']> | null = null
    void (async () => {
      const page = await doc.getPage(pageNumber)
      if (cancelled) return
      const natural = page.getViewport({ scale: 1 })
      setSize((previous) => (previous.width === natural.width && previous.height === natural.height ? previous : { width: natural.width, height: natural.height }))
      const viewport = page.getViewport({ scale })
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.floor(viewport.width * ratio)
      canvas.height = Math.floor(viewport.height * ratio)
      renderTask = page.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] })
      await renderTask.promise
      if (cancelled) return
      text.replaceChildren()
      textLayer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport })
      await textLayer.render()
      if (!cancelled) setFailed(false)
    })().catch((err: unknown) => {
      if (!cancelled && !(err instanceof pdfjs.RenderingCancelledException)) setFailed(true)
    })
    return () => {
      cancelled = true
      renderTask?.cancel()
      textLayer?.cancel()
    }
  }, [visible, scale, doc, pdfjs, pageNumber])

  const style = {
    width: Math.floor(size.width * scale),
    height: Math.floor(size.height * scale),
    '--scale-factor': scale,
    '--total-scale-factor': scale,
    '--scale-round-x': '1px',
    '--scale-round-y': '1px',
  } as React.CSSProperties

  return (
    <div ref={ref} className={styles.pdfPage} data-page={pageNumber} style={style} aria-label={`第 ${pageNumber} 页`} role="group">
      <canvas ref={canvasRef} className={styles.pdfCanvas} aria-hidden="true" />
      <div ref={textRef} className={styles.textLayer} />
      {failed ? <span className={styles.pageError}>这一页显示失败</span> : null}
    </div>
  )
}
