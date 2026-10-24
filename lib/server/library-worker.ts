import 'server-only'
import type { AppConfig, Paper, ProviderId } from '@/lib/shared/types'
import { loadConfig } from './config'
import { HttpError, errorMessage } from './http'
import { loadPaperText, paperAbs, readIndex, savePaperText, updateIndex } from './library'
import { cataloguePaper, libraryProvider, organizePapers } from './library-ai'
import { readPdf } from './pdf-text'
import { singleton } from './singleton'
import { vaultRoot } from './vault'

interface WorkerState {
  running: boolean
  again: boolean
  /** Vaults whose papers stuck mid-step (from a previous run of the app) were already reset. */
  recovered: Set<string>
  organizing: Set<string>
  organizeError: Map<string, string>
  /** Cataloguing pauses here after the same error repeats, so a wrong key does not fail every paper. */
  paused: Map<string, string>
}

const worker = singleton<WorkerState>('library-worker', () => ({
  running: false,
  again: false,
  recovered: new Set(),
  organizing: new Set(),
  organizeError: new Map(),
  paused: new Map(),
}))

const PAUSE_AFTER_SAME_ERRORS = 3

export function libraryStatus(root: string) {
  return {
    organizing: worker.organizing.has(root),
    organizeError: worker.organizeError.get(root),
    aiError: worker.paused.get(root),
  }
}

export function resumeCataloguing(root?: string) {
  if (root) worker.paused.delete(root)
  else worker.paused.clear()
}

/** Starts the background queue if it is idle; otherwise makes it look again when it finishes. */
export function kickLibraryWorker(): void {
  if (worker.running) {
    worker.again = true
    return
  }
  worker.running = true
  void (async () => {
    try {
      do {
        worker.again = false
        await drain()
      } while (worker.again)
    } catch (error) {
      console.error('[zhixing] library worker failed:', error)
    } finally {
      worker.running = false
    }
  })()
}

async function recoverStuck(root: string) {
  if (worker.recovered.has(root)) return
  worker.recovered.add(root)
  await updateIndex(root, (index) => {
    for (const paper of index.papers) {
      if (paper.state === 'extracting') paper.state = 'queued'
      if (paper.state === 'analyzing') {
        paper.state = 'ready'
        paper.aiState = 'pending'
      }
    }
  })
}

async function patchPaper(root: string, id: string, change: (paper: Paper) => void): Promise<Paper | null> {
  return updateIndex(root, (index) => {
    const paper = index.papers.find((item) => item.id === id)
    if (!paper) return null
    change(paper)
    return structuredClone(paper)
  })
}

const BAD_TITLE = /^(untitled|microsoft word|title|document|paper|无标题|文档)\b|\.(dvi|docx?|tex|pdf|ps)$/i

function usableTitle(raw: string): string {
  const title = raw.replace(/\s+/g, ' ').trim()
  if (title.length < 6 || title.length > 300 || BAD_TITLE.test(title) || !/[a-z\u3400-\u9fff]/i.test(title)) return ''
  return title
}

function splitAuthors(raw: string): string[] {
  return raw
    .split(/\s*(?:;|,|，|、|\band\b)\s*/i)
    .map((item) => item.trim())
    .filter((item) => item.length > 1 && item.length <= 80)
    .slice(0, 20)
}

async function extract(root: string, id: string, aiReady: boolean) {
  const paper = await patchPaper(root, id, (item) => {
    item.state = 'extracting'
    delete item.error
  })
  if (!paper) return
  try {
    const content = await readPdf(paperAbs(root, paper))
    const textChars = content.pages.reduce((sum, page) => sum + page.length, 0)
    await savePaperText(root, id, content.pages)
    await patchPaper(root, id, (item) => {
      item.pages = content.totalPages
      item.textChars = textChars
      if (!item.edited.includes('title') && !item.card) {
        const title = usableTitle(content.title)
        if (title) item.title = title
      }
      if (!item.edited.includes('authors') && !item.authors.length && content.author) item.authors = splitAuthors(content.author)
      item.state = 'ready'
      if (textChars < 200) {
        item.aiState = 'failed'
        item.error = '这份 PDF 几乎没有可提取的文字（可能是扫描件），AI 无法建档。'
      } else if (item.aiState !== 'done' || !item.card) {
        item.aiState = aiReady ? 'pending' : 'waiting'
      }
    })
  } catch (error) {
    await patchPaper(root, id, (item) => {
      item.state = 'failed'
      item.error = errorMessage(error)
    })
  }
}

async function catalogue(root: string, id: string, config: AppConfig, provider: ProviderId): Promise<string | null> {
  const paper = await patchPaper(root, id, (item) => {
    item.state = 'analyzing'
    delete item.error
  })
  if (!paper) return null
  const content = await loadPaperText(root, id)
  if (!content) {
    await patchPaper(root, id, (item) => {
      item.state = 'queued'
    })
    return null
  }
  try {
    const result = await cataloguePaper(config, provider, paper, content.pages)
    await patchPaper(root, id, (item) => {
      item.card = result.card
      if (!item.edited.includes('title') && result.title) item.title = result.title
      if (!item.edited.includes('authors') && result.authors.length) item.authors = result.authors
      if (!item.edited.includes('year') && result.year) item.year = result.year
      if (!item.edited.includes('venue') && result.venue) item.venue = result.venue
      item.state = 'ready'
      item.aiState = 'done'
      delete item.error
    })
    return null
  } catch (error) {
    const message = errorMessage(error)
    await patchPaper(root, id, (item) => {
      item.state = 'ready'
      item.aiState = 'failed'
      item.error = message
    })
    return message
  }
}

async function drain(): Promise<void> {
  let lastError: string | null = null
  let repeats = 0
  for (let step = 0; step < 100_000; step++) {
    const root = await vaultRoot().catch(() => null)
    if (!root) return
    await recoverStuck(root)
    const config = await loadConfig()
    const provider = libraryProvider(config)
    const index = await readIndex(root)

    if (provider && index.papers.some((paper) => paper.aiState === 'waiting')) {
      await updateIndex(root, (current) => {
        for (const paper of current.papers) if (paper.aiState === 'waiting') paper.aiState = 'pending'
      })
      continue
    }
    if (!provider && index.papers.some((paper) => paper.state === 'ready' && paper.aiState === 'pending')) {
      await updateIndex(root, (current) => {
        for (const paper of current.papers) if (paper.state === 'ready' && paper.aiState === 'pending') paper.aiState = 'waiting'
      })
    }

    const queued = index.papers.find((paper) => paper.state === 'queued')
    if (queued) {
      await extract(root, queued.id, Boolean(provider))
      continue
    }
    if (!provider || worker.paused.has(root)) return
    const pending = index.papers.find((paper) => paper.state === 'ready' && paper.aiState === 'pending')
    if (!pending) return
    const failure = await catalogue(root, pending.id, config, provider)
    if (!failure) {
      lastError = null
      repeats = 0
      continue
    }
    repeats = failure === lastError ? repeats + 1 : 1
    lastError = failure
    if (repeats >= PAUSE_AFTER_SAME_ERRORS) {
      worker.paused.set(root, failure)
      return
    }
  }
}

/** Runs "AI 整理" in the background; progress is reported through libraryStatus(). */
export async function startOrganize(): Promise<void> {
  const root = await vaultRoot()
  if (worker.organizing.has(root)) throw new HttpError(409, 'AI 正在整理文库，请稍等。')
  const index = await readIndex(root)
  const ready = index.papers.filter((paper) => paper.card).sort((a, b) => a.addedAt - b.addedAt)
  if (ready.length < 2) throw new HttpError(400, '至少需要 2 篇已建档的论文。')
  const config = await loadConfig()
  const provider = libraryProvider(config)
  if (!provider) throw new HttpError(400, '还没有接入中转站。请先到设置里填写接口地址、API Key 和模型。')
  worker.organizing.add(root)
  worker.organizeError.delete(root)
  void (async () => {
    try {
      const insights = await organizePapers(config, provider, ready)
      await updateIndex(root, (current) => {
        current.insights = insights
        const topicOf = new Map<string, string>()
        for (const topic of insights.topics) for (const id of topic.paperIds) topicOf.set(id, topic.name)
        for (const paper of current.papers) {
          if (insights.paperIds.includes(paper.id)) paper.topic = topicOf.get(paper.id) ?? ''
        }
      })
    } catch (error) {
      worker.organizeError.set(root, errorMessage(error))
    } finally {
      worker.organizing.delete(root)
    }
  })()
}
