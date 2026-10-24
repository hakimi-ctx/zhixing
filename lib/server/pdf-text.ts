import 'server-only'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import path from 'node:path'

export interface PdfContent {
  totalPages: number
  pages: string[]
  title: string
  author: string
}

const EXTRACT_TIMEOUT_MS = 180_000
const MAX_OUTPUT_BYTES = 80 * 1024 * 1024

/** SHA-256 of the file, streamed so large PDFs never sit in memory twice. */
export function hashFile(abs: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(abs)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

/** Extracts text page by page in a separate Node process (scripts/pdf-extract.mjs). */
export function readPdf(abs: string): Promise<PdfContent> {
  const script = path.join(process.cwd(), 'scripts', 'pdf-extract.mjs')
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, abs], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      // When 知行 runs inside Electron, execPath is the Electron binary; this makes it behave as plain Node.
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    })
    const chunks: Buffer[] = []
    let size = 0
    let stderr = ''
    let settled = false
    const finish = (error: Error | null, value?: PdfContent) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(value as PdfContent)
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(new Error('读取 PDF 超时（超过 3 分钟），文件可能过大或已损坏。'))
    }, EXTRACT_TIMEOUT_MS)
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_OUTPUT_BYTES) {
        child.kill()
        finish(new Error('PDF 的文字太多，超出了知行能处理的范围。'))
        return
      }
      chunks.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 4000) stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => finish(new Error(`无法启动 PDF 读取程序：${error.message}`)))
    child.on('close', (code) => {
      if (settled) return
      let parsed: { ok?: boolean; error?: string; totalPages?: number; pages?: unknown; title?: unknown; author?: unknown } | null = null
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        parsed = null
      }
      if (!parsed) {
        const detail = stderr.trim().split('\n').slice(-3).join(' ').slice(0, 300)
        finish(new Error(`读取 PDF 失败（退出码 ${code ?? '未知'}）${detail ? `：${detail}` : ''}`))
        return
      }
      if (!parsed.ok) {
        finish(new Error(parsed.error || '读取 PDF 失败。'))
        return
      }
      const pages = Array.isArray(parsed.pages) ? parsed.pages.map((page) => (typeof page === 'string' ? page : '')) : []
      finish(null, {
        totalPages: typeof parsed.totalPages === 'number' ? parsed.totalPages : pages.length,
        pages,
        title: typeof parsed.title === 'string' ? parsed.title : '',
        author: typeof parsed.author === 'string' ? parsed.author : '',
      })
    })
  })
}
