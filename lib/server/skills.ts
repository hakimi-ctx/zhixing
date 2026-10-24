import 'server-only'
import fs from 'node:fs/promises'
import path from 'node:path'
import { SKILL_NAMES, skillMeta } from '@/lib/shared/skills'
import { paths } from './paths'

const cache = new Map<string, string>()

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim()
}

/**
 * The skill's SKILL.md plus as many reference files as fit the budget (smallest
 * first), formatted as reference material for the tutor prompt.
 */
export async function loadSkillGuide(name: string, budget = 36_000): Promise<string> {
  if (!SKILL_NAMES.has(name)) return ''
  const key = `${name}:${budget}`
  const cached = cache.get(key)
  if (cached !== undefined) return cached

  const dir = path.join(paths.skills(), name)
  const main = await fs.readFile(path.join(dir, 'SKILL.md'), 'utf8').catch(() => '')
  if (!main) {
    cache.set(key, '')
    return ''
  }
  const meta = skillMeta(name)
  const sections = [`# 技能：${meta?.title ?? name}（${name}）\n\n${stripFrontmatter(main)}`]
  let used = sections[0].length

  const referenceDir = path.join(dir, 'references')
  const entries = await fs.readdir(referenceDir, { withFileTypes: true }).catch(() => [])
  const references = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map(async (entry) => ({
        name: entry.name,
        text: stripFrontmatter(await fs.readFile(path.join(referenceDir, entry.name), 'utf8').catch(() => '')),
      })),
  )
  references.sort((a, b) => a.text.length - b.text.length)
  for (const reference of references) {
    if (!reference.text) continue
    const block = `## 参考文件 references/${reference.name}\n\n${reference.text}`
    if (used + block.length > budget) continue
    sections.push(block)
    used += block.length
  }

  const guide = sections.join('\n\n---\n\n')
  cache.set(key, guide)
  return guide
}
