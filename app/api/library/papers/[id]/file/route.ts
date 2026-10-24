import { z } from 'zod'
import { HttpError, json, readBody, route } from '@/lib/server/http'
import { ensurePaperFile, isPaperId } from '@/lib/server/library'
import { vaultRoot } from '@/lib/server/vault'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

const schema = z.object({ kind: z.enum(['mindmap', 'note']) })

/** Opens the paper's own mind map or note, creating an empty one next to the PDF the first time. */
export const POST = route(async (req, ctx: Ctx) => {
  const { id } = await ctx.params
  if (!isPaperId(id)) throw new HttpError(400, '论文编号不正确。')
  const { kind } = await readBody(req, schema)
  return json({ path: await ensurePaperFile(await vaultRoot(), id, kind) })
})
