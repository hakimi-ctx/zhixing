import { z } from 'zod'
import { HttpError, json, readBody, route } from '@/lib/server/http'
import { dataRoot } from '@/lib/server/paths'
import { isValidId } from '@/lib/server/store'
import { revealInFileManager } from '@/lib/server/system'
import { resolveInVault } from '@/lib/server/vault'
import { sessionWorkspace } from '@/lib/server/work-exec'
import { resolveWorkspaceDir } from '@/lib/server/work-store'

export const dynamic = 'force-dynamic'

const schema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('vault'), path: z.string().max(1000).optional() }),
  z.object({ scope: z.literal('data') }),
  z.object({ scope: z.literal('workspace'), sessionId: z.string().max(64), executionId: z.string().max(64) }),
  z.object({ scope: z.literal('session'), sessionId: z.string().max(64) }),
])

/** Only reveals locations the app owns: the vault, the data folder, or a task's working folder. */
export const POST = route(async (req) => {
  const body = await readBody(req, schema)
  if (body.scope === 'vault') {
    const { abs } = await resolveInVault(body.path ?? '')
    await revealInFileManager(abs)
  } else if (body.scope === 'data') {
    await revealInFileManager(dataRoot())
  } else if (body.scope === 'session') {
    if (!isValidId(body.sessionId)) throw new HttpError(400, '任务编号不正确。')
    await revealInFileManager(sessionWorkspace(body.sessionId))
  } else {
    await revealInFileManager(await resolveWorkspaceDir(body.sessionId, body.executionId))
  }
  return json({ ok: true })
})
