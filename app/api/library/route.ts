import { loadConfig } from '@/lib/server/config'
import { errorMessage, json, route } from '@/lib/server/http'
import { pendingCount, readIndex, syncIfStale } from '@/lib/server/library'
import { libraryProvider } from '@/lib/server/library-ai'
import { kickLibraryWorker, libraryStatus } from '@/lib/server/library-worker'
import { vaultRoot } from '@/lib/server/vault'
import type { LibraryState } from '@/lib/shared/types'

export const dynamic = 'force-dynamic'

/** Also scans the vault for PDFs added in Explorer (at most every few seconds) and keeps the queue moving. */
export const GET = route(async (req) => {
  let root: string
  try {
    root = await vaultRoot()
  } catch (error) {
    const empty: LibraryState = { papers: [], insights: null, pending: 0, organizing: false, aiReady: false, error: errorMessage(error) }
    return json(empty)
  }
  const forceScan = new URL(req.url).searchParams.get('sync') === '1'
  await syncIfStale(root, forceScan ? 0 : 8000)
  kickLibraryWorker()
  const [index, config] = await Promise.all([readIndex(root), loadConfig()])
  const papers = [...index.papers].sort((a, b) => b.addedAt - a.addedAt)
  const status = libraryStatus(root)
  const state: LibraryState = {
    papers,
    insights: index.insights,
    pending: pendingCount(papers),
    organizing: status.organizing,
    organizeError: status.organizeError,
    aiError: status.aiError,
    aiReady: libraryProvider(config) !== null,
  }
  return json(state)
})
