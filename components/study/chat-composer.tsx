'use client'

import { useEffect, useMemo } from 'react'
import { ActionList, ActionMenu, Button, IconButton } from '@primer/react'
import {
  FileIcon,
  MortarBoardIcon,
  NoteIcon,
  PaperAirplaneIcon,
  PaperclipIcon,
  ShareAndroidIcon,
  SquareFillIcon,
  XIcon,
} from '@primer/octicons-react'
import { useLibrary, useVaultTree } from '@/lib/client/hooks'
import { baseName, flattenNodes } from '@/lib/client/vault'
import { displayName } from '@/lib/shared/mindmap'
import { SKILLS, skillMeta } from '@/lib/shared/skills'
import styles from './chat.module.css'

export const AUTO_SKILL = 'auto'
export const NO_SKILL = 'none'

function skillLabel(skill: string): string {
  if (skill === NO_SKILL) return '不用指导方法'
  return skillMeta(skill)?.title ?? '自动选择方法'
}

interface ChatComposerProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onStop: () => void
  busy: boolean
  stopping: boolean
  disabled?: boolean
  skill: string
  onSkillChange: (skill: string) => void
  attachment: string | null
  onAttachmentChange: (path: string | null) => void
  /** The file attached earlier in this conversation, which the tutor keeps reading. */
  stickyAttachment: string | null
  inputRef: React.RefObject<HTMLTextAreaElement | null>
}

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  onStop,
  busy,
  stopping,
  disabled = false,
  skill,
  onSkillChange,
  attachment,
  onAttachmentChange,
  stickyAttachment,
  inputRef,
}: ChatComposerProps) {
  const { data: tree } = useVaultTree()
  const { data: library } = useLibrary()
  const files = useMemo(
    () =>
      flattenNodes(tree?.nodes ?? [])
        .filter((node) => node.kind === 'note' || node.kind === 'mindmap')
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(0, 30),
    [tree],
  )
  const papers = useMemo(() => (library?.papers ?? []).filter((paper) => paper.textChars > 0).slice(0, 30), [library])
  const labelOf = (path: string) => library?.papers.find((paper) => paper.path === path)?.title ?? displayName(baseName(path))

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 280)}px`
  }, [value, inputRef])

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    event.preventDefault()
    if (!busy && !disabled) onSubmit()
  }

  return (
    <div className={styles.composerWrap}>
      <form
        className={styles.composer}
        onSubmit={(event) => {
          event.preventDefault()
          if (!busy && !disabled) onSubmit()
        }}
      >
        {attachment || stickyAttachment ? (
          <div className={styles.attachmentRow}>
            {attachment ? (
              <span className={styles.chip}>
                <PaperclipIcon size={12} />
                <span className={styles.chipLabel}>{labelOf(attachment)}</span>
                <IconButton icon={XIcon} aria-label="移除附件" size="small" variant="invisible" onClick={() => onAttachmentChange(null)} />
              </span>
            ) : (
              <span>
                <PaperclipIcon size={12} /> 继续参考「{labelOf(stickyAttachment ?? '')}」
              </span>
            )}
          </div>
        ) : null}
        <textarea
          ref={inputRef}
          className={styles.input}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="问导师任何学习或科研上的问题…"
          aria-label="给导师的消息"
          rows={2}
          disabled={disabled}
        />
        <div className={styles.composerBar}>
          <div className={styles.composerTools}>
            <ActionMenu>
              <ActionMenu.Button size="small" variant="invisible" leadingVisual={MortarBoardIcon}>
                {skillLabel(skill)}
              </ActionMenu.Button>
              <ActionMenu.Overlay width="medium" maxHeight="large" overflow="auto">
                <ActionList selectionVariant="single" aria-label="指导方法">
                  <ActionList.Item selected={skill === AUTO_SKILL} onSelect={() => onSkillChange(AUTO_SKILL)}>
                    自动选择
                    <ActionList.Description variant="block">按问题内容自动选用最合适的 Supervisor-Skills 方法</ActionList.Description>
                  </ActionList.Item>
                  <ActionList.Item selected={skill === NO_SKILL} onSelect={() => onSkillChange(NO_SKILL)}>
                    不用指导方法
                    <ActionList.Description variant="block">普通问答，不套用固定流程</ActionList.Description>
                  </ActionList.Item>
                  <ActionList.Divider />
                  <ActionList.Group>
                    <ActionList.GroupHeading>Supervisor-Skills</ActionList.GroupHeading>
                    {SKILLS.map((item) => (
                      <ActionList.Item key={item.name} selected={skill === item.name} onSelect={() => onSkillChange(item.name)}>
                        {item.title}
                        <ActionList.Description variant="block">{item.summary}</ActionList.Description>
                      </ActionList.Item>
                    ))}
                  </ActionList.Group>
                </ActionList>
              </ActionMenu.Overlay>
            </ActionMenu>
            <ActionMenu>
              <ActionMenu.Button size="small" variant="invisible" leadingVisual={PaperclipIcon}>
                附上文件
              </ActionMenu.Button>
              <ActionMenu.Overlay width="medium" maxHeight="large" overflow="auto">
                <ActionList aria-label="选择要附上的论文、笔记或思维导图">
                  {files.length === 0 && papers.length === 0 ? <ActionList.Item disabled>文库里还没有可附上的文件</ActionList.Item> : null}
                  {papers.length ? (
                    <ActionList.Group>
                      <ActionList.GroupHeading>论文</ActionList.GroupHeading>
                      {papers.map((paper) => (
                        <ActionList.Item key={paper.id} onSelect={() => onAttachmentChange(paper.path)}>
                          <ActionList.LeadingVisual>
                            <FileIcon />
                          </ActionList.LeadingVisual>
                          {paper.title}
                        </ActionList.Item>
                      ))}
                    </ActionList.Group>
                  ) : null}
                  {files.length ? (
                    <ActionList.Group>
                      <ActionList.GroupHeading>笔记与导图</ActionList.GroupHeading>
                      {files.map((file) => (
                        <ActionList.Item key={file.path} onSelect={() => onAttachmentChange(file.path)}>
                          <ActionList.LeadingVisual>{file.kind === 'mindmap' ? <ShareAndroidIcon /> : <NoteIcon />}</ActionList.LeadingVisual>
                          {displayName(file.name)}
                          <ActionList.Description variant="block">{file.path}</ActionList.Description>
                        </ActionList.Item>
                      ))}
                    </ActionList.Group>
                  ) : null}
                </ActionList>
              </ActionMenu.Overlay>
            </ActionMenu>
          </div>
          {busy ? (
            <Button type="button" size="small" leadingVisual={SquareFillIcon} onClick={onStop} disabled={stopping}>
              {stopping ? '正在停止' : '停止'}
            </Button>
          ) : (
            <Button type="submit" size="small" variant="primary" leadingVisual={PaperAirplaneIcon} disabled={disabled || !value.trim()}>
              发送
            </Button>
          )}
        </div>
      </form>
      <p className={styles.hint}>Enter 发送 · Shift + Enter 换行</p>
    </div>
  )
}
