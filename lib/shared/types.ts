export type AppMode = 'study' | 'work'

export type ProviderId = 'chatgpt' | 'claude' | 'gemini'
export const PROVIDER_IDS: readonly ProviderId[] = ['chatgpt', 'claude', 'gemini']

/** One OpenAI-compatible relay ("中转站") shared by all three models. */
export interface RelayConfig {
  baseUrl: string
  /** Masked (e.g. "••••abcd") when sent to the browser. */
  apiKey: string
}

export interface ProviderConfig {
  enabled: boolean
  model: string
  /** Optional per-model relay. Empty means "use the shared relay". */
  baseUrl: string
  apiKey: string
}

export interface WorkRules {
  supervisor: ProviderId
  maxSubtasks: number
  maxRevisions: number
  callTimeoutSec: number
}

export type ExecutorKind = 'workbuddy' | 'deepseek-harness'
export const EXECUTOR_KINDS: readonly ExecutorKind[] = ['workbuddy', 'deepseek-harness']
export type PromptVia = 'stdin' | 'arg'

export interface ExecutorConfig {
  id: ExecutorKind
  kind: ExecutorKind
  name: string
  enabled: boolean
  command: string
  /** Argument template. {prompt} is replaced by a short instruction that points at the handoff file. */
  args: string
  promptVia: PromptVia
  timeoutMin: number
}

export interface AppConfig {
  version: 2
  vaultPath: string
  /** Optional HTTP(S) proxy for relay calls and executors, e.g. http://127.0.0.1:7890. */
  proxy: string
  relay: RelayConfig
  providers: Record<ProviderId, ProviderConfig>
  study: { provider: ProviderId; model?: string; baseUrl?: string; apiKey?: string }
  work: WorkRules
  executors: ExecutorConfig[]
}

export interface ChatSource {
  /** Citation number used in the answer, e.g. [2]. */
  n: number
  paperId: string
  title: string
  page: number | null
}

export interface ChatMessageMeta {
  provider?: ProviderId
  model?: string
  skill?: string | null
  attachment?: string | null
  error?: string
  interrupted?: boolean
  durationMs?: number
  /** Library passages the tutor was given for this answer. */
  sources?: ChatSource[]
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  meta?: ChatMessageMeta
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  lastSkill: string | null
  messages: ChatMessage[]
}

export interface ConversationSummary {
  id: string
  title: string
  updatedAt: number
  messageCount: number
}

export type ChatStreamEvent =
  | { type: 'start'; conversationId: string; title: string; userMessage: ChatMessage; skill: string | null }
  | { type: 'status'; text: string }
  | { type: 'ping' }
  | { type: 'delta'; text: string }
  | { type: 'reset' }
  | { type: 'done'; message: ChatMessage }
  /** `saved` is the assistant message recording the failure, when it was written to the conversation. */
  | { type: 'error'; message: string; saved?: ChatMessage }

export type VaultNodeKind = 'dir' | 'note' | 'mindmap' | 'pdf' | 'other'

export interface VaultNode {
  name: string
  /** Path relative to the vault root, always using "/" separators. */
  path: string
  kind: VaultNodeKind
  mtimeMs: number
  children?: VaultNode[]
}

export interface VaultTree {
  root: string
  nodes: VaultNode[]
  truncated: boolean
  error?: string
}

export interface VaultFile {
  path: string
  kind: VaultNodeKind
  content: string
  mtimeMs: number
}

/* ---------- Paper library ---------- */

export interface PaperCard {
  /** One-sentence takeaway. */
  summary: string
  problem: string
  method: string
  findings: string
  limitations: string
  keywords: string[]
}

/** Text extraction and AI cataloguing run in the background, one paper at a time. */
export type PaperState = 'queued' | 'extracting' | 'analyzing' | 'ready' | 'failed'

export type PaperField = 'title' | 'authors' | 'year' | 'venue' | 'tags'

export interface Paper {
  /** First 24 hex characters of the PDF's SHA-256, so moving or renaming the file keeps its record. */
  id: string
  /** Vault-relative path of the PDF. */
  path: string
  size: number
  addedAt: number
  title: string
  authors: string[]
  year: number | null
  venue: string
  tags: string[]
  /** Theme assigned by the last "AI 整理". */
  topic: string
  card: PaperCard | null
  pages: number
  textChars: number
  state: PaperState
  /** `waiting` means the relay is not configured yet; cataloguing resumes once it is. */
  aiState: 'waiting' | 'pending' | 'done' | 'failed'
  error?: string
  mindmap: string | null
  note: string | null
  /** Fields the student edited by hand; AI never overwrites them. */
  edited: PaperField[]
}

export type RelationType = 'extends' | 'compares' | 'contradicts' | 'method' | 'data' | 'related'

export interface PaperRelation {
  from: string
  to: string
  type: RelationType
  note: string
}

export interface LibraryTopic {
  name: string
  description: string
  paperIds: string[]
}

export interface LibraryInsights {
  at: number
  model: string
  paperIds: string[]
  topics: LibraryTopic[]
  relations: PaperRelation[]
  /** Markdown: research threads, consensus and disagreements, gaps, what to read next. */
  overview: string
}

export interface LibraryState {
  papers: Paper[]
  insights: LibraryInsights | null
  /** Papers waiting for, or going through, extraction / cataloguing. */
  pending: number
  organizing: boolean
  organizeError?: string
  /** Set when cataloguing paused after repeated identical failures (e.g. a wrong API key). */
  aiError?: string
  aiReady: boolean
  error?: string
}

export interface UploadResult {
  added: Paper[]
  duplicates: { name: string; paperId: string; title: string }[]
  rejected: { name: string; reason: string }[]
}

export interface SearchHit {
  kind: 'paper' | 'note' | 'mindmap'
  /** Vault-relative path of the file. */
  path: string
  paperId?: string
  title: string
  page?: number | null
  snippet: string
}

export interface SearchResponse {
  query: string
  hits: SearchHit[]
}

/** One row from the online literature search (OpenAlex). */
export interface LiteratureWork {
  id: string
  title: string
  authors: string[]
  year: number | null
  venue: string
  citedBy: number
  doi: string | null
  url: string | null
  oaUrl: string | null
  abstract: string
  type: string
  language: string | null
}

export interface LiteratureSearchResponse {
  query: string
  fromYear: number | null
  toYear: number | null
  total: number
  page: number
  perPage: number
  works: LiteratureWork[]
  source: 'openalex'
  error?: string
}

/* ---------- Work mode ---------- */

export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export interface WorkAttempt {
  by: ProviderId
  feedback?: string
  output: string
  status: StepStatus
  model?: string
  error?: string
  note?: string
  startedAt?: number
  endedAt?: number
}

export interface WorkSubtask {
  id: string
  title: string
  assignee: ProviderId
  instructions: string
  deliverable: string
  attempts: WorkAttempt[]
}

export type WorkPhase = 'planning' | 'executing' | 'reviewing' | 'revising' | 'finalizing' | 'done'

export interface WorkStage {
  status: StepStatus
  model?: string
  output: string
  error?: string
  startedAt?: number
  endedAt?: number
}

export interface WorkLogEntry {
  at: number
  level: 'info' | 'warn' | 'error'
  text: string
}

export interface ExecutionRecord {
  id: string
  executorId: string
  executorName: string
  command: string
  cwd: string
  handoffFile: string
  status: 'running' | 'done' | 'failed' | 'stopped'
  exitCode: number | null
  output: string
  startedAt: number
  endedAt?: number
  error?: string
}

/** The exact command shown to the user for approval before an executor runs. */
export interface ExecutionPreview {
  executorName: string
  commandLine: string
  cwd: string
  resolvedPath: string | null
  instruction: string
}

export type WorkStatus = 'running' | 'done' | 'failed' | 'stopped'

export interface WorkSession {
  id: string
  title: string
  task: string
  createdAt: number
  updatedAt: number
  status: WorkStatus
  phase: WorkPhase
  supervisor: ProviderId
  workers: ProviderId[]
  rules: { maxSubtasks: number; maxRevisions: number }
  plan: WorkStage & { analysis: string }
  subtasks: WorkSubtask[]
  review: WorkStage & {
    decision?: 'approve' | 'revise' | 'skipped'
    requested?: { id: string; feedback: string }[]
    /** Revision rounds already used; bounded by rules.maxRevisions so the team cannot loop. */
    rounds?: number
  }
  final: WorkStage
  calls: number
  log: WorkLogEntry[]
  executions: ExecutionRecord[]
  error?: string
}

export interface WorkSessionSummary {
  id: string
  title: string
  status: WorkStatus
  phase: WorkPhase
  updatedAt: number
}

export interface ExecutorStatus {
  id: ExecutorKind
  command: string
  resolvedPath: string | null
  version: string | null
}

export interface ExecutorsStatus {
  checkedAt: number
  executors: ExecutorStatus[]
}

export interface SystemInfo {
  platform: string
  dataRoot: string
  vaultPath: string
  /** True inside the v0 preview sandbox, where the user's disk and executors are unavailable. */
  preview: boolean
  nodeVersion: string
  canOpenTerminal: boolean
  canOpenFolder: boolean
  homeDir: string
}

export interface ConnectionTestResult {
  ok: boolean
  model: string
  text?: string
  error?: string
  ms: number
}
