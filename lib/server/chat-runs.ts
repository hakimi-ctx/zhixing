import 'server-only'
import { singleton } from './singleton'

export interface ChatRun {
  runId: string
  conversationId: string
  controller: AbortController
  startedAt: number
}

/** Tutor replies in flight. They keep running if the page is closed, and stop only on request. */
const runs = singleton('chat-runs', () => new Map<string, ChatRun>())

export function registerChat(run: ChatRun): void {
  runs.set(run.runId, run)
}

export function finishChat(runId: string): void {
  runs.delete(runId)
}

export function stopChat(runId: string): boolean {
  const run = runs.get(runId)
  if (!run) return false
  run.controller.abort()
  return true
}

export function activeChatFor(conversationId: string): ChatRun | undefined {
  for (const run of runs.values()) if (run.conversationId === conversationId) return run
  return undefined
}
