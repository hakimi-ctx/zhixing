/** A stable, valid DOM id for arbitrary text such as a file path or a topic name (FNV-1a hash). */
export function domId(prefix: string, text: string): string {
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `${prefix}-${(hash >>> 0).toString(36)}-${text.length}`
}
