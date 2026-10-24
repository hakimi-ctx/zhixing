import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { HttpError, route } from '@/lib/server/http'
import { isPaperId, paperAbs, readIndex } from '@/lib/server/library'
import { vaultRoot } from '@/lib/server/vault'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export const GET = route(async (_req, ctx: Ctx) => {
  const { id } = await ctx.params
  if (!isPaperId(id)) throw new HttpError(400, '论文编号不正确。')
  const root = await vaultRoot()
  const paper = (await readIndex(root)).papers.find((item) => item.id === id)
  if (!paper) throw new HttpError(404, '文库里没有这篇论文。')
  const abs = paperAbs(root, paper)
  const stat = await fs.stat(abs).catch(() => null)
  if (!stat?.isFile()) throw new HttpError(404, 'PDF 文件不见了，可能已被移动或删除。')
  const name = path.basename(abs)
  const stream = Readable.toWeb(createReadStream(abs)) as ReadableStream<Uint8Array>
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(stat.size),
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'private, no-cache',
    },
  })
})
