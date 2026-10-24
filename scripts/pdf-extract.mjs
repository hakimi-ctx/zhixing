// Extracts the text of one PDF and prints it as JSON. Runs in its own process so a huge or
// malformed PDF can neither block nor crash the 知行 server; the server kills it on timeout.
import fs from 'node:fs/promises'
import process from 'node:process'
import { extractText, getDocumentProxy, getMeta } from 'unpdf'

const MAX_PAGES = 1500
const MAX_PAGE_CHARS = 30_000
const CJK = '\\u3400-\\u9fff\\uf900-\\ufaff'
const CJK_BREAK = new RegExp(`([${CJK}])\\n(?=[${CJK}])`, 'g')

function cleanPage(raw) {
  return String(raw ?? '')
    .replace(/\u0000/g, '')
    .replace(/([A-Za-z])-\n(?=[a-z])/g, '$1')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(CJK_BREAK, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_PAGE_CHARS)
}

function describe(error) {
  const name = error?.name ?? ''
  if (name === 'PasswordException') return '这份 PDF 设置了密码，无法读取。'
  if (name === 'InvalidPDFException') return '文件已损坏，或者不是有效的 PDF。'
  return `读取 PDF 失败：${error instanceof Error ? error.message : String(error)}`
}

function reply(value) {
  process.stdout.write(JSON.stringify(value), () => process.exit(0))
}

async function main() {
  const file = process.argv[2]
  if (!file) return reply({ ok: false, error: '没有指定文件。' })
  let pdf
  try {
    pdf = await getDocumentProxy(new Uint8Array(await fs.readFile(file)), { isEvalSupported: false })
  } catch (error) {
    return reply({ ok: false, error: describe(error) })
  }
  try {
    const { text } = await extractText(pdf, { mergePages: false })
    const meta = await getMeta(pdf).catch(() => null)
    const info = meta?.info ?? {}
    reply({
      ok: true,
      totalPages: text.length,
      pages: text.slice(0, MAX_PAGES).map(cleanPage),
      title: typeof info.Title === 'string' ? info.Title.trim() : '',
      author: typeof info.Author === 'string' ? info.Author.trim() : '',
    })
  } catch (error) {
    reply({ ok: false, error: describe(error) })
  }
}

main().catch((error) => reply({ ok: false, error: describe(error) }))
