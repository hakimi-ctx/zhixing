/**
 * The open note / mind-map editor registers here so that renaming, moving or
 * deleting a file from the sidebar can first save pending edits instead of
 * losing them when the editor remounts at the new path.
 */
interface OpenEditor {
  path: string
  flush: () => Promise<void>
}

let current: OpenEditor | null = null

export function registerEditor(editor: OpenEditor): () => void {
  current = editor
  return () => {
    if (current === editor) current = null
  }
}

export async function flushEditorsWithin(path: string): Promise<void> {
  const editor = current
  if (!editor) return
  if (editor.path === path || editor.path.startsWith(`${path}/`) || path === '') await editor.flush()
}
