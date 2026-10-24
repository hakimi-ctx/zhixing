import 'server-only'

/**
 * Pulls the first JSON object out of a model reply. Models often wrap JSON in
 * code fences or add a sentence before it, so try fenced blocks first, then
 * the outermost {...} span, then progressively shorter spans.
 */
export function extractJsonObject(text: string): unknown {
  const candidates: string[] = []
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) candidates.push(match[1])
  candidates.push(text)
  for (const candidate of candidates) {
    const start = candidate.indexOf('{')
    if (start < 0) continue
    let end = candidate.lastIndexOf('}')
    while (end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1))
      } catch {
        end = candidate.lastIndexOf('}', end - 1)
      }
    }
  }
  throw new Error('模型没有按要求返回 JSON。')
}
