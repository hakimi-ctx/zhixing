import 'server-only'
import type { z } from 'zod'

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/**
 * The app can read/write local files and launch CLI agents, so every API call is
 * checked: browsers must mark it same-origin (blocks CSRF from other sites and
 * other localhost ports), mutating calls must be JSON (forces a CORS preflight
 * cross-origin), and when started by the local launcher (ZHIXING_LOCAL=1) the Host
 * header must be loopback (blocks DNS rebinding).
 */
export interface RouteOptions {
  /**
   * Accept multipart uploads. They must carry the X-Zhixing-Upload header: a custom header
   * forces the same CORS preflight that the JSON rule relies on.
   */
  upload?: boolean
}

export const UPLOAD_HEADER = 'x-zhixing-upload'

export function checkRequest(req: Request, options: RouteOptions = {}): Response | null {
  const host = req.headers.get('host') ?? ''
  if (process.env.ZHIXING_LOCAL === '1') {
    const hostname = host.replace(/:\d+$/, '').toLowerCase()
    if (!LOCAL_HOSTNAMES.has(hostname)) return json({ error: '只允许从本机访问。' }, 403)
  }

  const fetchSite = req.headers.get('sec-fetch-site')
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return json({ error: '已拒绝来自其他网站的请求。' }, 403)
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.get('origin')
    if (!fetchSite && origin) {
      const allowedHosts = [host, req.headers.get('x-forwarded-host') ?? ''].filter(Boolean)
      let originHost = ''
      try {
        originHost = new URL(origin).host
      } catch {
        originHost = ''
      }
      if (!allowedHosts.includes(originHost)) return json({ error: '已拒绝来自其他网站的请求。' }, 403)
    }
    const contentType = (req.headers.get('content-type') ?? '').toLowerCase()
    const upload = options.upload && contentType.startsWith('multipart/form-data') && req.headers.get(UPLOAD_HEADER) === '1'
    if (!upload && !contentType.includes('application/json')) {
      return json({ error: '请求必须使用 JSON 格式。' }, 415)
    }
  }
  return null
}

export async function readBody<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown
  try {
    const text = await req.text()
    raw = text ? JSON.parse(text) : {}
  } catch {
    throw new HttpError(400, '请求内容不是有效的 JSON。')
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue?.path?.length ? `（${issue.path.join('.')}）` : ''
    throw new HttpError(400, `参数不正确${where}：${issue?.message ?? '未知错误'}`)
  }
  return parsed.data
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : '未知错误'
}

export function route<C = unknown>(handler: (req: Request, ctx: C) => Promise<Response>, options: RouteOptions = {}) {
  return async (req: Request, ctx: C): Promise<Response> => {
    const blocked = checkRequest(req, options)
    if (blocked) return blocked
    try {
      return await handler(req, ctx)
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status)
      console.error('[zhixing] request failed:', error)
      return json({ error: errorMessage(error) || '服务器内部错误' }, 500)
    }
  }
}
