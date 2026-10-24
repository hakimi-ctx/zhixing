import { HttpError, json, route } from '@/lib/server/http'
import { importPdf, MAX_PDF_BYTES } from '@/lib/server/library'
import { kickLibraryWorker } from '@/lib/server/library-worker'
import { vaultRoot } from '@/lib/server/vault'
import type { UploadResult } from '@/lib/shared/types'

export const dynamic = 'force-dynamic'

const MAX_FILES = 50

export const POST = route(
  async (req) => {
    const root = await vaultRoot()
    let form: FormData
    try {
      form = await req.formData()
    } catch {
      throw new HttpError(400, '上传的内容无法解析，请重试。')
    }
    const files = form.getAll('files').filter((item): item is File => typeof item === 'object' && item !== null && 'arrayBuffer' in item)
    if (!files.length) throw new HttpError(400, '没有收到文件。')
    if (files.length > MAX_FILES) throw new HttpError(400, `一次最多上传 ${MAX_FILES} 个文件。`)

    const result: UploadResult = { added: [], duplicates: [], rejected: [] }
    for (const file of files) {
      const name = (file.name || '未命名.pdf').slice(0, 300)
      if (!/\.pdf$/i.test(name) && file.type !== 'application/pdf') {
        result.rejected.push({ name, reason: '只支持 PDF' })
        continue
      }
      if (file.size > MAX_PDF_BYTES) {
        result.rejected.push({ name, reason: '超过 200 MB' })
        continue
      }
      const outcome = await importPdf(root, name, new Uint8Array(await file.arrayBuffer()))
      if (outcome.status === 'added') result.added.push(outcome.paper)
      else if (outcome.status === 'duplicate') result.duplicates.push({ name, paperId: outcome.paper.id, title: outcome.paper.title })
      else result.rejected.push({ name, reason: outcome.reason })
    }
    if (result.added.length) kickLibraryWorker()
    return json(result)
  },
  { upload: true },
)
