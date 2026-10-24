import 'server-only'
import os from 'node:os'
import path from 'node:path'

/** All app data lives outside the project folder so it survives updates and never triggers dev reloads. */
export function dataRoot(): string {
  const custom = process.env.ZHIXING_HOME?.trim()
  return custom ? path.resolve(expandHome(custom)) : path.join(os.homedir(), 'Zhixing')
}

export function expandHome(input: string): string {
  if (input === '~') return os.homedir()
  if (input.startsWith('~/') || input.startsWith('~\\')) return path.join(os.homedir(), input.slice(2))
  return input
}

export const paths = {
  config: () => path.join(dataRoot(), 'config.json'),
  defaultVault: () => path.join(dataRoot(), 'vault'),
  conversations: () => path.join(dataRoot(), 'study', 'conversations'),
  workSessions: () => path.join(dataRoot(), 'work', 'sessions'),
  workspaces: () => path.join(dataRoot(), 'workspaces'),
  scratch: () => path.join(dataRoot(), 'runtime', 'scratch'),
  skills: () => path.join(process.cwd(), 'content', 'supervisor-skills'),
}

export const isWindows = process.platform === 'win32'
