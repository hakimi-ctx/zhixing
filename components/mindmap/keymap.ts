/**
 * Keyboard shortcuts, following XMind's default key map so students can use the same muscle
 * memory. One table drives matching, the shortcut hints in menus and tooltips, and the help dialog.
 */

export type CommandId =
  | 'insertChild'
  | 'insertSibling'
  | 'insertSiblingBefore'
  | 'insertParent'
  | 'remove'
  | 'removeSingle'
  | 'edit'
  | 'duplicate'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'selectAll'
  | 'selectCenter'
  | 'navUp'
  | 'navDown'
  | 'navLeft'
  | 'navRight'
  | 'extendUp'
  | 'extendDown'
  | 'extendLeft'
  | 'extendRight'
  | 'moveUp'
  | 'moveDown'
  | 'moveLeft'
  | 'moveRight'
  | 'moveTop'
  | 'moveBottom'
  | 'toggleFold'
  | 'toggleFoldAll'
  | 'expandAll'
  | 'collapseAll'
  | `level${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`
  | `priority${1 | 2 | 3 | 4 | 5 | 6}`
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'fontBigger'
  | 'fontSmaller'
  | 'styleVeryImportant'
  | 'styleImportant'
  | 'styleCrossOut'
  | 'styleDefault'
  | 'copyStyle'
  | 'pasteStyle'
  | 'resetStyle'
  | 'relationship'
  | 'summary'
  | 'note'
  | 'labels'
  | 'link'
  | 'page'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | 'zoomFit'
  | 'find'
  | 'toggleOutline'
  | 'toggleFormat'
  | 'toggleSource'
  | 'shortcuts'
  | 'exportImage'
  | 'undo'
  | 'redo'
  | 'save'
  | 'escape'

/**
 * `map`: only while the map canvas has focus. `editor`: anywhere in the editor except text fields.
 * `always`: also inside text fields (panel inputs, the outline).
 */
type Scope = 'map' | 'editor' | 'always'

interface ShortcutDef {
  command: CommandId
  /** Chords in canonical order: Mod, Alt, Shift, then the key. `Mod` is Ctrl (⌘ on macOS). */
  chords: string[]
  scope: Scope
}

const range = <T extends string>(count: number, make: (n: number) => [T, string]) =>
  Array.from({ length: count }, (_, index) => make(index + 1))

const DEFS: ShortcutDef[] = [
  { command: 'insertChild', chords: ['Tab', 'Insert'], scope: 'map' },
  { command: 'insertSibling', chords: ['Enter'], scope: 'map' },
  { command: 'insertSiblingBefore', chords: ['Shift+Enter'], scope: 'map' },
  { command: 'insertParent', chords: ['Mod+Enter'], scope: 'map' },
  { command: 'remove', chords: ['Delete', 'Backspace'], scope: 'map' },
  { command: 'removeSingle', chords: ['Mod+Delete', 'Mod+Backspace'], scope: 'map' },
  { command: 'edit', chords: ['Space', 'F2'], scope: 'map' },
  { command: 'duplicate', chords: ['Mod+D'], scope: 'map' },
  { command: 'selectAll', chords: ['Mod+A'], scope: 'map' },
  { command: 'selectCenter', chords: ['Mod+R'], scope: 'map' },
  { command: 'navUp', chords: ['ArrowUp'], scope: 'map' },
  { command: 'navDown', chords: ['ArrowDown'], scope: 'map' },
  { command: 'navLeft', chords: ['ArrowLeft'], scope: 'map' },
  { command: 'navRight', chords: ['ArrowRight'], scope: 'map' },
  { command: 'extendUp', chords: ['Shift+ArrowUp'], scope: 'map' },
  { command: 'extendDown', chords: ['Shift+ArrowDown'], scope: 'map' },
  { command: 'extendLeft', chords: ['Shift+ArrowLeft'], scope: 'map' },
  { command: 'extendRight', chords: ['Shift+ArrowRight'], scope: 'map' },
  { command: 'moveUp', chords: ['Alt+ArrowUp'], scope: 'map' },
  { command: 'moveDown', chords: ['Alt+ArrowDown'], scope: 'map' },
  { command: 'moveLeft', chords: ['Alt+ArrowLeft'], scope: 'map' },
  { command: 'moveRight', chords: ['Alt+ArrowRight'], scope: 'map' },
  { command: 'moveTop', chords: ['Mod+Alt+ArrowUp'], scope: 'map' },
  { command: 'moveBottom', chords: ['Mod+Alt+ArrowDown'], scope: 'map' },
  { command: 'toggleFold', chords: ['Mod+/'], scope: 'map' },
  { command: 'toggleFoldAll', chords: ['Mod+Alt+/'], scope: 'map' },
  ...range(9, (n) => [`level${n}` as CommandId, `Mod+Alt+${n}`]).map(([command, chord]) => ({ command, chords: [chord], scope: 'map' as const })),
  ...range(6, (n) => [`priority${n}` as CommandId, `Mod+${n}`]).map(([command, chord]) => ({ command, chords: [chord], scope: 'map' as const })),
  { command: 'bold', chords: ['Mod+B'], scope: 'map' },
  { command: 'italic', chords: ['Mod+I'], scope: 'map' },
  { command: 'underline', chords: ['Mod+U'], scope: 'map' },
  { command: 'fontBigger', chords: ['Mod+Shift+.'], scope: 'map' },
  { command: 'fontSmaller', chords: ['Mod+Shift+,'], scope: 'map' },
  { command: 'styleVeryImportant', chords: ['Alt+Shift+1'], scope: 'map' },
  { command: 'styleImportant', chords: ['Alt+Shift+2'], scope: 'map' },
  { command: 'styleCrossOut', chords: ['Alt+Shift+3'], scope: 'map' },
  { command: 'styleDefault', chords: ['Alt+Shift+0'], scope: 'map' },
  { command: 'copyStyle', chords: ['Mod+Alt+C'], scope: 'map' },
  { command: 'pasteStyle', chords: ['Mod+Alt+V'], scope: 'map' },
  { command: 'resetStyle', chords: ['Mod+Alt+0'], scope: 'map' },
  { command: 'relationship', chords: ['Mod+Shift+R'], scope: 'map' },
  { command: 'note', chords: ['Mod+Shift+N'], scope: 'map' },
  { command: 'labels', chords: ['Mod+Shift+L'], scope: 'map' },
  { command: 'link', chords: ['Mod+K'], scope: 'map' },
  { command: 'zoomIn', chords: ['Mod+=', 'Mod+Shift+='], scope: 'map' },
  { command: 'zoomOut', chords: ['Mod+-'], scope: 'map' },
  { command: 'zoomReset', chords: ['Mod+0'], scope: 'map' },
  { command: 'escape', chords: ['Escape'], scope: 'map' },
  { command: 'undo', chords: ['Mod+Z'], scope: 'editor' },
  { command: 'redo', chords: ['Mod+Y', 'Mod+Shift+Z'], scope: 'editor' },
  { command: 'find', chords: ['Mod+F'], scope: 'editor' },
  { command: 'save', chords: ['Mod+S'], scope: 'always' },
  { command: 'toggleOutline', chords: ['Mod+Shift+M'], scope: 'always' },
  { command: 'toggleFormat', chords: ['Mod+]'], scope: 'always' },
  { command: 'shortcuts', chords: ['Mod+Shift+/'], scope: 'always' },
  { command: 'exportImage', chords: ['F7'], scope: 'always' },
]

const BY_CHORD = new Map<string, ShortcutDef>()
const BY_COMMAND = new Map<CommandId, ShortcutDef>()
for (const def of DEFS) {
  BY_COMMAND.set(def.command, def)
  for (const chord of def.chords) BY_CHORD.set(chord, def)
}

const CODE_KEYS: Record<string, string> = {
  Period: '.',
  Comma: ',',
  Slash: '/',
  Semicolon: ';',
  Equal: '=',
  Minus: '-',
  BracketLeft: '[',
  BracketRight: ']',
  Space: 'Space',
  NumpadAdd: '=',
  NumpadSubtract: '-',
}

const IGNORED_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'Process', 'Unidentified', 'Dead', 'AltGraph', 'CapsLock'])

/** Physical keys for letters, digits and punctuation, so Shift or the keyboard layout never changes the match. */
function keyName(event: KeyboardEvent): string | null {
  const { code, key } = event
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  if (CODE_KEYS[code]) return CODE_KEYS[code]
  if (!key || IGNORED_KEYS.has(key)) return null
  if (key === ' ') return 'Space'
  return key.length === 1 ? key.toUpperCase() : key
}

export function chordOf(event: KeyboardEvent): string | null {
  const key = keyName(event)
  if (!key) return null
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('Mod')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  parts.push(key)
  return parts.join('+')
}

export function matchShortcut(event: KeyboardEvent, where: { inMap: boolean; inText: boolean }): CommandId | null {
  if (event.isComposing || event.keyCode === 229) return null
  const chord = chordOf(event)
  const def = chord ? BY_CHORD.get(chord) : undefined
  if (!def) return null
  if (def.scope === 'always') return def.command
  if (where.inText) return null
  if (def.scope === 'map' && !where.inMap) return null
  return def.command
}

const isApple = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

const KEY_LABEL: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
  Delete: 'Delete',
  Backspace: 'Backspace',
  Insert: 'Insert',
}

/** "Mod+Shift+R" → "Ctrl+Shift+R" (or "⌘⇧R" on macOS). */
export function formatChord(chord: string): string {
  const apple = isApple()
  const parts = chord.split('+').map((part) => {
    if (part === 'Mod') return apple ? '⌘' : 'Ctrl'
    if (part === 'Alt') return apple ? '⌥' : 'Alt'
    if (part === 'Shift') return apple ? '⇧' : 'Shift'
    return KEY_LABEL[part] ?? part
  })
  return apple ? parts.join('') : parts.join('+')
}

export function shortcutText(command: CommandId): string {
  const def = BY_COMMAND.get(command)
  return def ? formatChord(def.chords[0]) : ''
}

/** The command's main chord in the format Primer's `keybindingHint` and `KeybindingHint` expect. */
export function hintFor(command: CommandId): string | undefined {
  return BY_COMMAND.get(command)?.chords[0]
}

export interface ShortcutItem {
  label: string
  /** Shown instead of the command's own chord, for ranges like "Ctrl+1…6". */
  keys?: string
  command?: CommandId
}

export function shortcutKeys(item: ShortcutItem): string {
  if (item.keys) return item.keys
  return item.command ? shortcutText(item.command) : ''
}

export const SHORTCUT_GROUPS: { title: string; items: ShortcutItem[] }[] = [
  {
    title: '插入',
    items: [
      { label: '子主题', command: 'insertChild' },
      { label: '同级主题（之后）', command: 'insertSibling' },
      { label: '同级主题（之前）', command: 'insertSiblingBefore' },
      { label: '父主题', command: 'insertParent' },
      { label: '联系', command: 'relationship' },
      { label: '复制为副本', command: 'duplicate' },
    ],
  },
  {
    title: '编辑',
    items: [
      { label: '编辑文字', command: 'edit' },
      { label: '换行（编辑时）', keys: formatChord('Shift+Enter') },
      { label: '删除主题及子主题', command: 'remove' },
      { label: '只删除这个主题', command: 'removeSingle' },
      { label: '备注', command: 'note' },
      { label: '链接', command: 'link' },
      { label: '标签', command: 'labels' },
      { label: '撤销', command: 'undo' },
      { label: '重做', command: 'redo' },
      { label: '立即保存', command: 'save' },
    ],
  },
  {
    title: '选择与移动',
    items: [
      { label: '选择相邻主题', keys: '↑ ↓ ← →' },
      { label: '扩展选择', keys: `${formatChord('Shift')}+↑ ↓` },
      { label: '多选', keys: `${formatChord('Mod')}+单击` },
      { label: '全选', command: 'selectAll' },
      { label: '选中中心主题', command: 'selectCenter' },
      { label: '上移 / 下移', keys: `${formatChord('Alt')}+↑ ↓` },
      { label: '移到最前 / 最后', keys: `${formatChord('Mod+Alt')}+↑ ↓` },
    ],
  },
  {
    title: '样式与标记',
    items: [
      { label: '加粗', command: 'bold' },
      { label: '斜体', command: 'italic' },
      { label: '下划线', command: 'underline' },
      { label: '字号加大 / 减小', keys: `${shortcutText('fontBigger')} / ${shortcutText('fontSmaller')}` },
      { label: '非常重要', command: 'styleVeryImportant' },
      { label: '重要', command: 'styleImportant' },
      { label: '删除线', command: 'styleCrossOut' },
      { label: '恢复默认', command: 'styleDefault' },
      { label: '复制 / 粘贴样式', keys: `${shortcutText('copyStyle')} / ${shortcutText('pasteStyle')}` },
      { label: '优先级 1–6', keys: `${formatChord('Mod')}+1…6` },
    ],
  },
  {
    title: '视图',
    items: [
      { label: '折叠 / 展开', command: 'toggleFold' },
      { label: '全部折叠 / 展开', command: 'toggleFoldAll' },
      { label: '展开到第 N 层', keys: `${formatChord('Mod+Alt')}+1…9` },
      { label: '放大 / 缩小', keys: `${shortcutText('zoomIn')} / ${shortcutText('zoomOut')}` },
      { label: '实际大小', command: 'zoomReset' },
      { label: '查找', command: 'find' },
      { label: '导图 / 大纲', command: 'toggleOutline' },
      { label: '格式面板', command: 'toggleFormat' },
      { label: '导出图片', command: 'exportImage' },
      { label: '快捷键', command: 'shortcuts' },
    ],
  },
]
