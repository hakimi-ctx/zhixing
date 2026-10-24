'use client'

import { useMemo, useRef, useState } from 'react'
import { ActionList, Dialog, FormControl, Text, TextInput } from '@primer/react'
import { FileDirectoryIcon, RepoIcon } from '@primer/octicons-react'
import { errorText } from '@/lib/client/api'
import { isWithin, parentOf } from '@/lib/client/vault'
import type { VaultNode } from '@/lib/shared/types'

interface NameDialogProps {
  title: string
  label: string
  initialValue: string
  confirmLabel: string
  caption?: string
  onSubmit: (name: string) => Promise<void>
  onClose: () => void
}

export function NameDialog({ title, label, initialValue, confirmLabel, caption, onSubmit, onClose }: NameDialogProps) {
  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const submit = async () => {
    const name = value.trim()
    if (!name) {
      setError('名称不能为空。')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSubmit(name)
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={title}
      onClose={() => {
        if (!busy) onClose()
      }}
      initialFocusRef={inputRef}
      footerButtons={[
        { buttonType: 'default', content: '取消', onClick: onClose, disabled: busy },
        { buttonType: 'primary', content: confirmLabel, onClick: () => void submit(), loading: busy },
      ]}
    >
      <FormControl>
        <FormControl.Label>{label}</FormControl.Label>
        <TextInput
          ref={inputRef}
          block
          value={value}
          maxLength={120}
          validationStatus={error ? 'error' : undefined}
          onChange={(event) => {
            setValue(event.target.value)
            if (error) setError(null)
          }}
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229) return
            event.preventDefault()
            void submit()
          }}
        />
        {error ? (
          <FormControl.Validation variant="error">{error}</FormControl.Validation>
        ) : caption ? (
          <FormControl.Caption>{caption}</FormControl.Caption>
        ) : null}
      </FormControl>
    </Dialog>
  )
}

interface MoveDialogProps {
  node: VaultNode
  directories: VaultNode[]
  onSubmit: (toDir: string) => Promise<void>
  onClose: () => void
}

export function MoveDialog({ node, directories, onSubmit, onClose }: MoveDialogProps) {
  const currentParent = parentOf(node.path)
  const options = useMemo(() => {
    const list = [{ path: '', label: '文件库（最外层）', depth: 0 }]
    for (const dir of directories) {
      if (node.kind === 'dir' && isWithin(dir.path, node.path)) continue
      list.push({ path: dir.path, label: dir.name, depth: dir.path.split('/').length })
    }
    return list
  }, [directories, node])
  const [target, setTarget] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (target === null) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(target)
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={`移动“${node.name}”`}
      subtitle="选择要移动到的文件夹"
      onClose={() => {
        if (!busy) onClose()
      }}
      width="medium"
      footerButtons={[
        { buttonType: 'default', content: '取消', onClick: onClose, disabled: busy },
        { buttonType: 'primary', content: '移动到这里', onClick: () => void submit(), loading: busy, disabled: target === null },
      ]}
    >
      <ActionList selectionVariant="single" role="listbox" aria-label="目标文件夹" showDividers={false}>
        {options.map((option) => {
          const isCurrent = option.path === currentParent
          return (
            <ActionList.Item
              key={option.path || '__root__'}
              role="option"
              selected={target === option.path}
              aria-selected={target === option.path}
              disabled={isCurrent}
              onSelect={() => setTarget(option.path)}
              style={{ paddingInlineStart: `calc(var(--base-size-8) + ${Math.max(0, option.depth - 1)} * var(--base-size-16))` }}
            >
              <ActionList.LeadingVisual>{option.path ? <FileDirectoryIcon /> : <RepoIcon />}</ActionList.LeadingVisual>
              {option.label}
              {isCurrent ? <ActionList.Description>当前位置</ActionList.Description> : null}
            </ActionList.Item>
          )
        })}
      </ActionList>
      {error ? (
        <Text as="p" size="small" style={{ color: 'var(--fgColor-danger)', marginTop: 'var(--base-size-8)' }}>
          {error}
        </Text>
      ) : null}
    </Dialog>
  )
}
