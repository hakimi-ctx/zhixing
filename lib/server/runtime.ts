import 'server-only'

/** The v0 preview sandbox: executors are not installed there and the "disk" is the sandbox's. */
export function isPreview(): boolean {
  return Boolean(process.env.V0_SANDBOX_URL || process.env.V0_RUNTIME_URL)
}
