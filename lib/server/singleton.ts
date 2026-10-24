import 'server-only'

const registry = globalThis as typeof globalThis & { __zhixing?: Map<string, unknown> }

/**
 * One instance per Node process. Next.js can bundle the same module into several
 * route handlers (and re-evaluate it on hot reload), so plain module-level state
 * would not be shared; locks and running jobs must live on globalThis instead.
 */
export function singleton<T>(key: string, create: () => T): T {
  registry.__zhixing ??= new Map()
  if (!registry.__zhixing.has(key)) registry.__zhixing.set(key, create())
  return registry.__zhixing.get(key) as T
}
