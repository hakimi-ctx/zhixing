import type { AiSlot, LegacyProviderId } from './types'
import { LEGACY_PROVIDER_IDS, MAX_AI_SLOTS } from './types'

export interface ProviderMeta {
  id: LegacyProviderId
  label: string
  vendor: string
  strengths: string
  /** Shown as the placeholder of the model field; relays usually use the vendor's own model IDs. */
  modelExample: string
  /** Lower-case fragments that identify this vendor's models in a relay's model list. */
  modelHints: string[]
}

/** Brand info for the three providers that older configs stored by fixed id. */
export const LEGACY_PROVIDER_META: Record<LegacyProviderId, ProviderMeta> = {
  chatgpt: {
    id: 'chatgpt',
    label: 'ChatGPT',
    vendor: 'OpenAI',
    strengths: '统筹规划、严密推理和代码',
    modelExample: 'gpt-6.1-sol',
    modelHints: ['gpt', 'o1', 'o3', 'o4', 'chatgpt', 'openai'],
  },
  claude: {
    id: 'claude',
    label: 'Claude',
    vendor: 'Anthropic',
    strengths: '长文写作、细致分析和审校',
    modelExample: 'claude-sonnet-5.5',
    modelHints: ['claude', 'anthropic'],
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    vendor: 'Google',
    strengths: '资料检索、多模态理解和发散思考',
    modelExample: 'gemini-3.8-flash',
    modelHints: ['gemini', 'google'],
  },
}

const SLOT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

export function isLegacyProvider(id: string): id is LegacyProviderId {
  return (LEGACY_PROVIDER_IDS as readonly string[]).includes(id)
}

export function legacyMeta(id: string): ProviderMeta | undefined {
  return isLegacyProvider(id) ? LEGACY_PROVIDER_META[id] : undefined
}

export function findSlot<T extends { id: string }>(slots: readonly T[] | undefined, id: string | undefined): T | undefined {
  if (!id || !slots) return undefined
  return slots.find((slot) => slot.id === id)
}

/** Display name for a slot id, including slots that were removed after a chat or work session was saved. */
export function providerLabel(id: string | undefined, slots?: readonly { id: string; label: string }[]): string {
  if (!id) return '导师'
  const slot = findSlot(slots, id)
  const named = slot?.label.trim()
  if (named) return named
  return legacyMeta(id)?.label ?? id
}

/** What the work supervisor is told this slot is good at. */
export function providerStrength(slot: AiSlot): string {
  const note = slot.note.trim()
  if (note) return note
  const legacy = legacyMeta(slot.id)
  if (legacy) return legacy.strengths
  return slot.connection === 'cli' ? '本地命令行模型' : '通用对话与写作'
}

export function modelExample(slot: { id: string; label: string }): string {
  return legacyMeta(slot.id)?.modelExample ?? 'model-id'
}

export function newSlotId(existing: readonly { id: string }[]): string {
  const taken = new Set(existing.map((item) => item.id))
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const id = `s${Math.random().toString(36).slice(2, 10)}`
    if (SLOT_ID.test(id) && !taken.has(id)) return id
  }
  return `s${Date.now().toString(36)}`
}

export function blankSlot(existing: readonly { id: string }[]): AiSlot {
  return {
    id: newSlotId(existing),
    label: `模型 ${existing.length + 1}`,
    enabled: true,
    connection: 'api',
    model: '',
    baseUrl: '',
    apiKey: '',
    command: '',
    args: '',
    note: '',
  }
}

export function canAddSlot(count: number): boolean {
  return count < MAX_AI_SLOTS
}

/** Sorts a relay's model list so models that look like this slot come first. */
export function rankModels(slot: { id: string; label: string }, models: string[]): string[] {
  const hints = legacyMeta(slot.id)?.modelHints ?? slot.label.toLowerCase().split(/[^a-z0-9]+/).filter((part) => part.length >= 3)
  const score = (id: string) => (hints.some((hint) => id.toLowerCase().includes(hint)) ? 0 : 1)
  return [...models].sort((a, b) => score(a) - score(b) || a.localeCompare(b))
}
