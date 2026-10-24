'use client'

import { useEffect, useState } from 'react'
import { Button, FormControl, Select, TextInput } from '@primer/react'
import { FileDirectoryIcon } from '@primer/octicons-react'
import { mutate } from 'swr'
import { useNotice } from '@/components/ui/notices'
import { api, errorText } from '@/lib/client/api'
import { patchConfig } from '@/lib/client/config'
import { useDesktop } from '@/lib/client/desktop'
import { KEYS } from '@/lib/client/hooks'
import type { AppConfig, SystemInfo, WorkRules } from '@/lib/shared/types'
import styles from './settings.module.css'

function useSaver() {
  const notify = useNotice()
  const [saving, setSaving] = useState(false)
  const run = async (task: () => Promise<unknown>) => {
    setSaving(true)
    try {
      await task()
      notify({ variant: 'success', text: '已保存' })
    } catch (error) {
      notify({ variant: 'danger', text: errorText(error) })
    } finally {
      setSaving(false)
    }
  }
  return { saving, run }
}

async function reveal(body: Record<string, unknown>, notify: ReturnType<typeof useNotice>) {
  try {
    await api('/api/system/reveal', { method: 'POST', body })
  } catch (error) {
    notify({ variant: 'danger', text: errorText(error) })
  }
}

export function VaultSection({ config, system }: { config: AppConfig; system?: SystemInfo }) {
  const notify = useNotice()
  const desktop = useDesktop()
  const [value, setValue] = useState(config.vaultPath)
  const { saving, run } = useSaver()
  useEffect(() => setValue(config.vaultPath), [config.vaultPath])
  const dirty = value.trim() !== config.vaultPath

  const save = () =>
    void run(async () => {
      await patchConfig({ vaultPath: value.trim() })
      await Promise.all([mutate(KEYS.system), mutate(KEYS.vaultTree), mutate(KEYS.library)])
    })

  const pick = async () => {
    const chosen = await desktop?.pickFolder(system?.vaultPath)
    if (chosen) setValue(chosen)
  }

  return (
    <section className={styles.section} aria-labelledby="settings-vault">
      <div className={styles.sectionHead}>
        <h2 id="settings-vault" className={styles.sectionTitle}>
          文件库
        </h2>
      </div>
      <div className={styles.row}>
        <div className={styles.rowText}>
          <span className={styles.rowLabel}>位置</span>
          <span className={styles.rowHint}>论文、笔记和导图都在这个文件夹里</span>
        </div>
        <div className={styles.rowControl}>
          <TextInput
            block
            monospace
            aria-label="文件库位置"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className={styles.grow}
          />
          {desktop ? (
            <Button leadingVisual={FileDirectoryIcon} onClick={() => void pick()}>
              选择
            </Button>
          ) : null}
        </div>
      </div>
      <div className={styles.footer}>
        {system?.canOpenFolder ? (
          <Button variant="invisible" onClick={() => void reveal({ scope: 'vault', path: '' }, notify)}>
            在资源管理器中打开
          </Button>
        ) : null}
        <Button variant="primary" onClick={save} disabled={!dirty} loading={saving}>
          保存
        </Button>
      </div>
    </section>
  )
}

const TIMEOUTS = [300, 600, 1200, 1800, 3600]

export function AdvancedSection({ config, system }: { config: AppConfig; system?: SystemInfo }) {
  const notify = useNotice()
  const [proxy, setProxy] = useState(config.proxy)
  const [rules, setRules] = useState<WorkRules>(config.work)
  const { saving, run } = useSaver()
  useEffect(() => setProxy(config.proxy), [config.proxy])
  useEffect(() => setRules(config.work), [config.work])
  const dirty = proxy.trim() !== config.proxy || JSON.stringify(rules) !== JSON.stringify(config.work)
  const update = (patch: Partial<WorkRules>) => setRules((current) => ({ ...current, ...patch }))

  return (
    <section className={styles.section} aria-labelledby="settings-advanced">
      <div className={styles.sectionHead}>
        <h2 id="settings-advanced" className={styles.sectionTitle}>
          高级
        </h2>
      </div>
      <div className={styles.row}>
        <div className={styles.rowText}>
          <span className={styles.rowLabel}>网络代理</span>
          <span className={styles.rowHint}>一般不需要，留空即可</span>
        </div>
        <div className={styles.rowControl}>
          <TextInput
            block
            monospace
            aria-label="网络代理"
            placeholder="http://127.0.0.1:7890"
            value={proxy}
            onChange={(event) => setProxy(event.target.value)}
            className={styles.grow}
          />
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.rowText}>
          <span className={styles.rowLabel}>Work 规则</span>
          <span className={styles.rowHint}>子任务上限 · 返工轮数 · 单次等待</span>
        </div>
        <div className={styles.rowControl}>
          <FormControl>
            <FormControl.Label visuallyHidden>最多子任务</FormControl.Label>
            <Select value={String(rules.maxSubtasks)} onChange={(event) => update({ maxSubtasks: Number(event.target.value) })}>
              {[1, 2, 3, 4, 5, 6].map((count) => (
                <Select.Option key={count} value={String(count)}>
                  {count} 个子任务
                </Select.Option>
              ))}
            </Select>
          </FormControl>
          <FormControl>
            <FormControl.Label visuallyHidden>返工轮数</FormControl.Label>
            <Select value={String(rules.maxRevisions)} onChange={(event) => update({ maxRevisions: Number(event.target.value) })}>
              <Select.Option value="0">不返工</Select.Option>
              <Select.Option value="1">返工 1 轮</Select.Option>
              <Select.Option value="2">返工 2 轮</Select.Option>
            </Select>
          </FormControl>
          <FormControl>
            <FormControl.Label visuallyHidden>单次等待</FormControl.Label>
            <Select value={String(rules.callTimeoutSec)} onChange={(event) => update({ callTimeoutSec: Number(event.target.value) })}>
              {TIMEOUTS.concat(TIMEOUTS.includes(rules.callTimeoutSec) ? [] : [rules.callTimeoutSec]).map((seconds) => (
                <Select.Option key={seconds} value={String(seconds)}>
                  {Math.round(seconds / 60)} 分钟
                </Select.Option>
              ))}
            </Select>
          </FormControl>
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.rowText}>
          <span className={styles.rowLabel}>数据位置</span>
          <span className={`${styles.rowHint} ${styles.mono}`}>{system?.dataRoot ?? '…'}</span>
        </div>
        <div className={styles.rowControl}>
          {system?.canOpenFolder ? <Button onClick={() => void reveal({ scope: 'data' }, notify)}>打开</Button> : null}
        </div>
      </div>
      <div className={styles.footer}>
        {dirty ? (
          <Button
            variant="invisible"
            onClick={() => {
              setProxy(config.proxy)
              setRules(config.work)
            }}
            disabled={saving}
          >
            撤销
          </Button>
        ) : null}
        <Button
          variant="primary"
          disabled={!dirty}
          loading={saving}
          onClick={() => void run(() => patchConfig({ proxy: proxy.trim(), work: { maxSubtasks: rules.maxSubtasks, maxRevisions: rules.maxRevisions, callTimeoutSec: rules.callTimeoutSec } }))}
        >
          保存
        </Button>
      </div>
    </section>
  )
}
