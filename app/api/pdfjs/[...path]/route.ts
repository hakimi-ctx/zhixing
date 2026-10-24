import fs from 'node:fs/promises'
import path from 'node:path'
import { HttpError, route } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

/**
 * Serves the PDF reader's worker and data files (CJK character maps, standard fonts, decoders)
 * straight from the installed pdfjs-dist, so they always match the library version in use.
 */
const ASSETS: Record<string, { dir: string; pattern: RegExp }> = {
  build: { dir: 'legacy/build', pattern: /^pdf\.worker\.min\.mjs$/ },
  cmaps: { dir: 'cmaps', pattern: /^[A-Za-z0-9_.-]+\.bcmap$/ },
  standard_fonts: { dir: 'standard_fonts', pattern: /^[A-Za-z0-9_.-]+\.(pfb|ttf)$/ },
  wasm: { dir: 'wasm', pattern: /^[A-Za-z0-9_.-]+\.(wasm|mjs|js)$/ },
  iccs: { dir: 'iccs', pattern: /^[A-Za-z0-9_.-]+\.icc$/ },
}

const CONTENT_TYPE: Record<string, string> = {
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
}

type Ctx = { params: Promise<{ path: string[] }> }

export const GET = route(async (_req, ctx: Ctx) => {
  const { path: parts } = await ctx.params
  const [kind, file, ...rest] = parts ?? []
  const asset = kind ? ASSETS[kind] : undefined
  if (!asset || !file || rest.length || !asset.pattern.test(file)) throw new HttpError(404, '找不到这个文件。')
  const abs = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', asset.dir, file)
  const body = await fs.readFile(abs).catch(() => null)
  if (!body) throw new HttpError(404, '找不到这个文件。')
  return new Response(new Uint8Array(body), {
    headers: {
      'Content-Type': CONTENT_TYPE[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=86400',
    },
  })
})
