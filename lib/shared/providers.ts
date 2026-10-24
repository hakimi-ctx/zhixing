import type { ProviderId } from './types'

export interface ProviderMeta {
  id: ProviderId
  label: string
  vendor: string
  strengths: string
  /** Shown as the placeholder of the model field; relays usually use the vendor's own model IDs. */
  modelExample: string
  /** Lower-case fragments that identify this vendor's models in a relay's model list. */
  modelHints: string[]
}

export const PROVIDER_META: Record<ProviderId, ProviderMeta> = {
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

/** Sorts a relay's model list so this vendor's models come first. */
export function rankModels(provider: ProviderId, models: string[]): string[] {
  const hints = PROVIDER_META[provider].modelHints
  const score = (id: string) => (hints.some((hint) => id.toLowerCase().includes(hint)) ? 0 : 1)
  return [...models].sort((a, b) => score(a) - score(b) || a.localeCompare(b))
}
