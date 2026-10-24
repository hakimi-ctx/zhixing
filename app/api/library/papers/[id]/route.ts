import fs from 'node:fs/promises'
import { z } from 'zod'
import { HttpError, json, readBody, route } from '@/lib/server/http'
import { editPaper, forgetPaper, isPaperId, paperAbs, readIndex } from '@/lib/server/library'
import { trashEntry, vaultRoot } from '@/lib/server/vault'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

async function paperId(ctx: Ctx): Promise<string> {
  const { id } = await ctx.params
  if (!isPaperId(id)) throw new HttpError(400, '论文编号不正确。')
  return id
}

const patchSchema = z
  .object({
    title: z.string().max(400),
    authors: z.array(z.string().max(120)).max(50),
    year: z.number().int().min(1800).max(2200).nullable(),
    venue: z.string().max(200),
    tags: z.array(z.string().max(40)).max(30),
  })
  .partial()

export const PATCH = route(async (req, ctx: Ctx) => {
  const id = await paperId(ctx)
  const patch = await readBody(req, patchSchema)
  return json(await editPaper(await vaultRoot(), id, patch))
})

/** Moves the PDF to the vault's .trash folder and removes the record. The paper's mind map and note stay. */
export const DELETE = route(async (_req, ctx: Ctx) => {
  const id = await paperId(ctx)
  const root = await vaultRoot()
  const paper = (await readIndex(root)).papers.find((item) => item.id === id)
  if (!paper) throw new HttpError(404, '文库里没有这篇论文。')
  const present = await fs
    .stat(paperAbs(root, paper))
    .then(() => true)
    .catch(() => false)
  if (present) await trashEntry(paper.path)
  await forgetPaper(root, id)
  return json({ ok: true })
})
