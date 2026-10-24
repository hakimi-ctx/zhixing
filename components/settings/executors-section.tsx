'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button, FormControl, Label, Select, Spinner, TextInput, ToggleSwitch } from '@primer/react'
import { SyncIcon } from '@primer/octicons-react'
import { useNotice } from '@/components/ui/notices'
import { api, errorText } from '@/lib/client/api'
import { patchConfig, type ExecutorPatch } from '@/lib/client/config'
import { useExecutors } from '@/lib/client/hooks'
import { EXECUTOR_PRESETS } from '@/lib/shared/executors'
import type { AppConfig, ExecutorStatus, SystemInfo } from '@/lib/shared/types'
import styles from './settings.module.css'

const TIMEOUTS = [10, 30, 60, 120, 240]

function toPatch(config: AppConfig): ExecutorPatch[] {
  return config.executors.map(({ id, enabled, command, args, timeoutMin }) => ({ id, enabled, command, args, timeoutMin }))
}

/** Primer ToggleSwitch re-invokes onChange when the function identity changes, so the handler must be stable. */
function ExecutorSwitch({
  id,
  checked,
  labelledBy,
  onToggle,
}: {
  id: ExecutorPatch['id']
  checked: boolean
  labelledBy: string
  onToggle: (id: ExecutorPatch['id'], enabled: boolean) => void
}) {
  const onChange = useCallback((enabled: boolean) => onToggle(id, enabled), [id, onToggle])
  return (
    <ToggleSwitch size="small" aria-labelledby={labelledBy} checked={checked} onChange={onChange} buttonLabelOn="开" buttonLabelOff="关" />
  )
}

function StatusLabel({ status, checking }: { status?: ExecutorStatus; checking: boolean }) {
  if (checking && !status) return <Spinner size="small" srText="正在检测" />
  if (!status) return null
  if (status.resolvedPath) return <Label variant="success">已就绪{status.version ? ` · ${status.version}` : ''}</Label>
  return <Label variant="attention">未找到</Label>
}

export function ExecutorsSection({ config, system }: { config: AppConfig; system?: SystemInfo }) {
  const notify = useNotice()
  const { data: status, isValidating: checking, mutate: recheck } = useExecutors()
  const [draft, setDraft] = useState<ExecutorPatch[]>(() => toPatch(config))
  const [saving, setSaving] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)

  useEffect(() => setDraft(toPatch(config)), [config])
  const dirty = JSON.stringify(draft) !== JSON.stringify(toPatch(config))

  const update = (id: ExecutorPatch['id'], patch: Partial<ExecutorPatch>) =>
    setDraft((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))

  const toggle = useCallback((id: ExecutorPatch['id'], enabled: boolean) => {
    setDraft((current) => current.map((item) => (item.id === id ? { ...item, enabled } : item)))
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      await patchConfig({ executors: draft })
      void recheck()
      notify({ variant: 'success', text: '已保存' })
    } catch (error) {
      notify({ variant: 'danger', text: errorText(error) })
    } finally {
      setSaving(false)
    }
  }

  const install = async (id: ExecutorPatch['id']) => {
    setInstalling(id)
    try {
      await api('/api/executors/install', { method: 'POST', body: { id } })
      notify({ text: '已打开安装窗口，装好后点“检测”' })
    } catch (error) {
      notify({ variant: 'danger', text: errorText(error) })
    } finally {
      setInstalling(null)
    }
  }

  return (
    <section className={styles.section} aria-labelledby="settings-executors">
      <div className={styles.sectionHead}>
        <h2 id="settings-executors" className={styles.sectionTitle}>
          执行器
        </h2>
        <div className={styles.sectionActions}>
          <Button size="small" variant="invisible" leadingVisual={SyncIcon} onClick={() => void recheck()} loading={checking}>
            检测
          </Button>
        </div>
      </div>

      {draft.map((item) => {
        const preset = EXECUTOR_PRESETS[item.id]
        const itemStatus = status?.executors.find((entry) => entry.id === item.id)
        const missing = Boolean(itemStatus && !itemStatus.resolvedPath)
        return (
          <div key={item.id} className={styles.modelRow}>
            <div className={styles.row} style={{ borderBottom: 'none', padding: 0 }}>
              <div className={styles.rowText}>
                <span className={styles.rowLabel}>
                  <span id={`executor-${item.id}-label`}>{preset.name}</span>
                  <StatusLabel status={itemStatus} checking={checking} />
                </span>
                <span className={styles.rowHint}>{preset.setupHint}</span>
              </div>
              <div className={styles.rowControl}>
                {missing && system?.canOpenTerminal ? (
                  <Button size="small" onClick={() => void install(item.id)} loading={installing === item.id}>
                    安装
                  </Button>
                ) : null}
                <ExecutorSwitch id={item.id} checked={item.enabled} labelledBy={`executor-${item.id}-label`} onToggle={toggle} />
              </div>
            </div>
            {missing && !system?.canOpenTerminal ? (
              <span className={`${styles.mono} ${styles.muted}`}>{preset.installCommand}</span>
            ) : null}
            <details>
              <summary className={styles.summary}>命令</summary>
              <div className={styles.detailsBody}>
                <div className={styles.fieldGrid}>
                  <FormControl>
                    <FormControl.Label>命令</FormControl.Label>
                    <TextInput block monospace value={item.command} onChange={(event) => update(item.id, { command: event.target.value })} />
                  </FormControl>
                  <FormControl>
                    <FormControl.Label>最长运行</FormControl.Label>
                    <Select value={String(item.timeoutMin)} onChange={(event) => update(item.id, { timeoutMin: Number(event.target.value) })}>
                      {TIMEOUTS.concat(TIMEOUTS.includes(item.timeoutMin) ? [] : [item.timeoutMin]).map((minutes) => (
                        <Select.Option key={minutes} value={String(minutes)}>
                          {minutes} 分钟
                        </Select.Option>
                      ))}
                    </Select>
                  </FormControl>
                </div>
                <FormControl>
                  <FormControl.Label>参数</FormControl.Label>
                  <TextInput block monospace value={item.args} onChange={(event) => update(item.id, { args: event.target.value })} />
                  <FormControl.Caption>{'{prompt} 会替换成执行指令'}</FormControl.Caption>
                </FormControl>
                {itemStatus?.resolvedPath ? <span className={`${styles.mono} ${styles.muted}`}>{itemStatus.resolvedPath}</span> : null}
              </div>
            </details>
          </div>
        )
      })}

      <div className={styles.footer}>
        {dirty ? (
          <Button variant="invisible" onClick={() => setDraft(toPatch(config))} disabled={saving}>
            撤销
          </Button>
        ) : null}
        <Button variant="primary" onClick={() => void save()} disabled={!dirty} loading={saving}>
          保存
        </Button>
      </div>
    </section>
  )
}
