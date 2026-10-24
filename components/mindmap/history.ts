/**
 * Snapshot undo history. mind-elixir ships one too, but it cannot see changes made outside its own
 * operations (format panel, outline view, imports) and breaks in focus mode, so the editor keeps
 * its own: every change records the whole map, and undo loads the previous snapshot back.
 */
export interface HistoryEntry {
  snapshot: string
  /** Topics selected just before the change; restored when the change is undone. */
  before: string[]
  /** Topics selected right after the change; restored when it is redone. */
  after: string[]
}

export interface HistoryStep {
  snapshot: string
  selection: string[]
}

const MAX_ENTRIES = 200
const LARGE_SNAPSHOT = 400_000
const MAX_LARGE_ENTRIES = 30
/** Typing in a panel field within this window of the previous keystroke extends the same undo step. */
const COALESCE_MS = 1500

export class SnapshotHistory {
  private entries: HistoryEntry[] = []
  private index = -1
  private lastKey: string | null = null
  private lastTime = 0

  reset(snapshot: string, selection: string[] = []): void {
    this.entries = [{ snapshot, before: selection, after: selection }]
    this.index = 0
    this.lastKey = null
  }

  get current(): string | null {
    return this.entries[this.index]?.snapshot ?? null
  }

  /**
   * Returns false when nothing changed since the last snapshot. Changes sharing a `coalesce` key
   * in quick succession (typing a note) are merged into one undo step.
   */
  record(entry: HistoryEntry, coalesce?: string): boolean {
    if (this.current === entry.snapshot) return false
    const now = Date.now()
    const atTop = this.index === this.entries.length - 1
    if (coalesce && coalesce === this.lastKey && now - this.lastTime < COALESCE_MS && atTop && this.index > 0) {
      const top = this.entries[this.index]
      this.entries[this.index] = { ...top, snapshot: entry.snapshot, after: entry.after }
      this.lastTime = now
      return true
    }
    this.entries = this.entries.slice(0, this.index + 1)
    this.entries.push(entry)
    const limit = entry.snapshot.length > LARGE_SNAPSHOT ? MAX_LARGE_ENTRIES : MAX_ENTRIES
    if (this.entries.length > limit) this.entries = this.entries.slice(this.entries.length - limit)
    this.index = this.entries.length - 1
    this.lastKey = coalesce ?? null
    this.lastTime = now
    return true
  }

  /** Swaps the current snapshot for an equivalent one, e.g. after the map normalised it on load. */
  replaceCurrent(snapshot: string): void {
    const entry = this.entries[this.index]
    if (entry) this.entries[this.index] = { ...entry, snapshot }
  }

  get canUndo(): boolean {
    return this.index > 0
  }

  get canRedo(): boolean {
    return this.index < this.entries.length - 1
  }

  undo(): HistoryStep | null {
    if (!this.canUndo) return null
    const undone = this.entries[this.index]
    this.index -= 1
    this.lastKey = null
    return { snapshot: this.entries[this.index].snapshot, selection: undone.before }
  }

  redo(): HistoryStep | null {
    if (!this.canRedo) return null
    this.lastKey = null
    this.index += 1
    const entry = this.entries[this.index]
    return { snapshot: entry.snapshot, selection: entry.after }
  }
}
