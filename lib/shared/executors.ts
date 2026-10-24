import { EXECUTOR_KINDS, type ExecutorConfig, type ExecutorKind } from './types'

export interface ExecutorPreset {
  kind: ExecutorKind
  name: string
  command: string
  args: string
  promptVia: ExecutorConfig['promptVia']
  installCommand: string
  /** One short line shown under the executor in settings. */
  setupHint: string
  docsUrl: string
}

export const EXECUTOR_PRESETS: Record<ExecutorKind, ExecutorPreset> = {
  workbuddy: {
    kind: 'workbuddy',
    name: 'WorkBuddy',
    // WorkBuddy's automation engine is the CodeBuddy Code CLI; -p runs one task headless, -y lets it edit files.
    command: 'codebuddy',
    args: '--print --dangerously-skip-permissions {prompt}',
    promptVia: 'arg',
    installCommand: 'npm install -g @tencent-ai/codebuddy-code',
    setupHint: '首次使用先在终端运行 codebuddy 登录腾讯账号',
    docsUrl: 'https://www.codebuddy.ai/docs/cli/cli-reference',
  },
  'deepseek-harness': {
    kind: 'deepseek-harness',
    name: 'DeepSeek Harness',
    command: 'dsh',
    args: '--profile headless {prompt}',
    promptVia: 'arg',
    installCommand: 'npm install -g @deepseek-ai/dsh',
    setupHint: '首次使用先运行 dsh web 配置模型（需要 Node.js 22.19 以上）',
    docsUrl: 'https://github.com/deepseek-ai/deepseek-harness',
  },
}

export function executorFromPreset(kind: ExecutorKind): ExecutorConfig {
  const preset = EXECUTOR_PRESETS[kind]
  return {
    id: kind,
    kind,
    name: preset.name,
    enabled: true,
    command: preset.command,
    args: preset.args,
    promptVia: preset.promptVia,
    timeoutMin: 30,
  }
}

export function defaultExecutors(): ExecutorConfig[] {
  return EXECUTOR_KINDS.map((kind) => executorFromPreset(kind))
}
