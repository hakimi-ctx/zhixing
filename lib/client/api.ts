export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

interface ApiInit {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
}

/** JSON fetch for the local API. Mutations always send a JSON body because the server rejects anything else. */
export async function api<T>(url: string, init: ApiInit = {}): Promise<T> {
  const method = init.method ?? 'GET'
  const mutating = method !== 'GET'
  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers: mutating ? { 'Content-Type': 'application/json' } : undefined,
      body: mutating ? JSON.stringify(init.body ?? {}) : undefined,
      signal: init.signal,
      cache: 'no-store',
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError('连不上知行的本地服务。请确认启动窗口还开着。', 0)
  }
  const data = (await response.json().catch(() => null)) as { error?: string } | null
  if (!response.ok) throw new ApiError(data?.error ?? `请求失败（${response.status}）`, response.status)
  return data as T
}

export const fetcher = <T>(url: string) => api<T>(url)

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : '出了点问题，请重试。'
}
