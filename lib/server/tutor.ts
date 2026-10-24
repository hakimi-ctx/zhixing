import 'server-only'
import { SKILLS, routeSkill, skillMeta } from '@/lib/shared/skills'
import type { ChatMessage, ChatSource } from '@/lib/shared/types'
import { libraryContext, paperForPrompt } from './library-context'
import type { ChatTurn, ModelRequest } from './llm'
import { loadSkillGuide } from './skills'
import { normalizeRel, readForPrompt, vaultRoot } from './vault'

export const AUTO_SKILL = 'auto'
export const NO_SKILL = 'none'

/** "auto" routes by keywords and otherwise keeps the conversation's previous method. */
export function chooseSkill(requested: string, text: string, previous: string | null): string | null {
  if (requested === NO_SKILL) return null
  if (requested !== AUTO_SKILL) return skillMeta(requested) ? requested : null
  return routeSkill(text) ?? (skillMeta(previous) ? previous : null)
}

function systemPrompt(skill: string | null, withLibrary: boolean): string {
  const meta = skillMeta(skill)
  const catalog = SKILLS.map((item) => `- ${item.title}（${item.name}）：${item.summary}`).join('\n')
  const lines = [
    '你是“知行”学习软件里的 AI 导师，像一位耐心、严谨的研究生导师那样指导学生：先弄清学生真正想解决的问题，再给出具体、可执行的建议。',
    '',
    '工作方式：',
    '1. 默认用简体中文回答；学生用其他语言提问时，用学生的语言回答。',
    '2. 用 Markdown 组织回答：先给结论，再给理由和步骤。信息不够时，直接列出需要学生补充的问题。',
    '3. 不编造文献、数据、实验结果或引用。不确定的内容明确说不确定，并告诉学生怎么核实。',
    '4. 学术判断留给学生本人：你给出依据和选项，帮学生自己做决定。思维导图由学生自己画，你可以点评和提问，但不要替学生画。',
    '5. 你通过 API 被调用，看不到学生电脑上的文件；需要的材料会直接附在消息里。',
  ]
  if (withLibrary) {
    lines.push(
      '6. 学生读过并上传的论文组成了“文库”，这是你的知识库。参考资料里的<文库目录>列出了全部论文，<文库检索结果>是和问题最相关的原文段落。回答涉及这些论文时，优先依据检索结果，并在相应句子末尾用 [1]、[2] 这样的编号标注出处（编号对应检索结果）。检索结果里没有的内容，要说明是你自己的知识，不要假装出自文库。',
    )
  }
  lines.push('', '你掌握下面这套 Supervisor-Skills 指导方法，可以按问题需要选用：', catalog)
  if (meta) {
    lines.push(
      '',
      `本轮使用“${meta.title}”（${meta.name}）方法。参考资料里附有这套方法的完整说明，请按其中的流程和标准指导学生，只输出对学生有用的内容，不要复述方法说明本身。`,
    )
  }
  return lines.join('\n')
}

function latestAttachment(history: ChatMessage[]): string | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const attachment = history[index].role === 'user' ? history[index].meta?.attachment : null
    if (attachment) return attachment
  }
  return null
}

async function readAttachment(rel: string): Promise<{ name: string; text: string }> {
  if (rel.toLowerCase().endsWith('.pdf')) return paperForPrompt(await vaultRoot(), normalizeRel(rel))
  return readForPrompt(rel)
}

/** The last two questions, so follow-ups like "那第二篇呢" still retrieve the right passages. */
function retrievalQuery(history: ChatMessage[]): string {
  return history
    .filter((message) => message.role === 'user')
    .slice(-2)
    .map((message) => message.content)
    .reverse()
    .join('\n')
    .slice(0, 4000)
}

/**
 * Builds the tutor request from the stored history (ending with the user turn being answered).
 * The newest attachment is re-read on every turn so follow-up questions see its current content.
 * A file attached to the current message must be readable; older attachments are skipped if gone.
 */
export async function buildTutorRequest(options: {
  history: ChatMessage[]
  skill: string | null
  currentAttachment: string | null
  useLibrary: boolean
}): Promise<{ request: ModelRequest; sources: ChatSource[] }> {
  const references: string[] = []
  const attachment = options.currentAttachment ?? latestAttachment(options.history)
  if (attachment) {
    try {
      const file = await readAttachment(attachment)
      references.push(`<学生附上的文件 name="${file.name}">\n${file.text}\n</学生附上的文件>`)
    } catch (error) {
      if (options.currentAttachment) throw error
    }
  }
  let sources: ChatSource[] = []
  let withLibrary = false
  if (options.useLibrary) {
    const context = await libraryContext(await vaultRoot(), retrievalQuery(options.history)).catch((error: unknown) => {
      console.error('[zhixing] library context failed:', error)
      return null
    })
    if (context) {
      references.push(context.reference)
      sources = context.sources
      withLibrary = true
    }
  }
  if (options.skill) {
    const guide = await loadSkillGuide(options.skill)
    if (guide) references.push(`<指导方法说明>\n${guide}\n</指导方法说明>`)
  }
  const messages: ChatTurn[] = options.history
    .filter((message) => message.content.trim() && !(message.role === 'assistant' && message.meta?.error))
    .map((message) => ({ role: message.role, content: message.content }))
  return {
    request: { system: systemPrompt(options.skill, withLibrary), reference: references.join('\n\n'), messages },
    sources,
  }
}
