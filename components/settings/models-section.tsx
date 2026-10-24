'use client'

import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { Button, FormControl, Select, Spinner, TextInput, ToggleSwitch } from '@primer/react'
import { CheckCircleFillIcon, XCircleFillIcon } from '@primer/octicons-react'
import { useNotice } from '@/components/ui/notices'
import { ProviderMark } from '@/components/ui/provider-mark'
import { api, errorText } from '@/lib/client/api'
import { patchConfig } from '@/lib/client/config'
import { PROVIDER_META, rankModels } from '@/lib/shared/providers'
import { PROVIDER_IDS, type AppConfig, type ConnectionTestResult, type ProviderConfig, type ProviderId } from '@/lib/shared/types'
import styles from './settings.module.css'

const MASK = '••••'
const isMasked = (value: string) => value.startsWith(MASK)

interface Draft {
  baseUrl: string
  apiKey: string
  providers: Record<ProviderId, ProviderConfig>
  supervisor: ProviderId
  tutor: ProviderId
}

function draftFrom(config: AppConfig): Draft {
  return {
    baseUrl: config.relay.baseUrl,
    apiKey: config.relay.apiKey,
    providers: structuredClone(config.providers),
    supervisor: config.work.supervisor,
    tutor: config.study.provider,
  }
}

type TestState = ConnectionTestResult | 'running' | undefined

function KeyInput({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return (
    <TextInput
      block
      monospace
      type="password"
      autoComplete="off"
      spellCheck={false}
      aria-label={label}
      value={value}
      placeholder="sk-…"
      // A masked key is only a hint; selecting it means typing or pasting replaces it instead of appending.
      onFocus={(event) => {
        if (isMasked(event.target.value)) event.target.select()
      }}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

/**
 * Primer's ToggleSwitch calls onChange again whenever the callback identity changes.
 * An inline handler therefore re-renders forever; this keeps one stable callback per provider.
 */
function ProviderSwitch({
  id,
  checked,
  labelledBy,
  onToggle,
}: {
  id: ProviderId
  checked: boolean
  labelledBy: string
  onToggle: (id: ProviderId, enabled: boolean) => void
}) {
  const onChange = useCallback((enabled: boolean) => onToggle(id, enabled), [id, onToggle])
  return (
    <ToggleSwitch
      size="small"
      aria-labelledby={labelledBy}
      checked={checked}
      onChange={onChange}
      buttonLabelOn="开"
      buttonLabelOff="关"
    />
  )
}

function TestLine({ state }: { state: TestState }) {
  if (!state) return null
  if (state === 'running') {
    return (
      <div className={styles.result}>
        <Spinner size="small" srText="正在测试" />
      </div>
    )
  }
  return (
    <div className={`${styles.result} ${state.ok ? styles.ok : styles.bad}`} role="status">
      {state.ok ? <CheckCircleFillIcon size={12} /> : <XCircleFillIcon size={12} />}{' '}
      {state.ok ? `连接成功 · ${(state.ms / 1000).toFixed(1)} 秒` : state.error}
    </div>
  )
}

export function ModelsSection({ config }: { config: AppConfig }) {
  const notify = useNotice()
  const listId = useId()
  const [draft, setDraft] = useState<Draft>(() => draftFrom(config))
  const [saving, setSaving] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [fetching, setFetching] = useState(false)
  const [tests, setTests] = useState<Partial<Record<ProviderId, TestState>>>({})

  useEffect(() => setDraft(draftFrom(config)), [config])

  const dirty = JSON.stringify(draft) !== JSON.stringify(draftFrom(config))
  const ranked = useMemo(
    () => Object.fromEntries(PROVIDER_IDS.map((id) => [id, rankModels(id, models)])) as Record<ProviderId, string[]>,
    [models],
  )

  const setProvider = (id: ProviderId, patch: Partial<ProviderConfig>) =>
    setDraft((current) => ({ ...current, providers: { ...current.providers, [id]: { ...current.providers[id], ...patch } } }))

  const toggleProvider = useCallback((id: ProviderId, enabled: boolean) => {
    setDraft((current) => ({ ...current, providers: { ...current.providers, [id]: { ...current.providers[id], enabled } } }))
  }, [])

  const save = async (quiet = false): Promise<boolean> => {
    setSaving(true)
    try {
      await patchConfig({
        relay: { baseUrl: draft.baseUrl.trim(), apiKey: draft.apiKey.trim() },
        providers: Object.fromEntries(
          PROVIDER_IDS.map((id) => {
            const item = draft.providers[id]
            return [id, { enabled: item.enabled, model: item.model.trim(), baseUrl: item.baseUrl.trim(), apiKey: item.apiKey.trim() }]
          }),
        ),
        work: { supervisor: draft.supervisor },
        study: { provider: draft.tutor },
      })
      if (!quiet) notify({ variant: 'success', text: '已保存' })
      return true
    } catch (error) {
      notify({ variant: 'danger', text: errorText(error) })
      return false
    } finally {
      setSaving(false)
    }
  }

  const fetchModels = async () => {
    setFetching(true)
    try {
      const { models: list } = await api<{ models: string[] }>('/api/models', {
        method: 'POST',
        body: { baseUrl: draft.baseUrl.trim(), apiKey: draft.apiKey.trim() },
      })
      setModels(list)
      notify({ variant: list.length ? 'success' : 'warning', text: list.length ? `获取到 ${list.length} 个模型` : '中转站没有返回模型' })
    } catch (error) {
      notify({ variant: 'danger', text: errorText(error) })
    } finally {
      setFetching(false)
    }
  }

  const test = async (id: ProviderId) => {
    if (dirty && !(await save(true))) return
    setTests((current) => ({ ...current, [id]: 'running' }))
    try {
      const result = await api<ConnectionTestResult>('/api/models/test', { method: 'POST', body: { provider: id } })
      setTests((current) => ({ ...current, [id]: result }))
    } catch (error) {
      setTests((current) => ({ ...current, [id]: { ok: false, model: '', error: errorText(error), ms: 0 } }))
    }
  }

  return (
    <section className={styles.section} aria-labelledby="settings-models">
      <div className={styles.sectionHead}>
        <h2 id="settings-models" className={styles.sectionTitle}>
          模型
        </h2>
      </div>

      <div className={styles.row}>
        <div className={styles.rowText}>
          <span className={styles.rowLabel}>中转站地址</span>
          <span className={styles.rowHint}>OpenAI 兼容接口</span>
        </div>
        <div className={styles.rowControl}>
          <TextInput
            block
            monospace
            aria-label="中转站地址"
            placeholder="https://api.example.com/v1"
            value={draft.baseUrl}
            onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))}
            className={styles.grow}
          />
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.rowText}>
          <span className={styles.rowLabel}>API Key</span>
        </div>
        <div className={styles.rowControl}>
          <div className={styles.grow}>
            <KeyInput label="API Key" value={draft.apiKey} onChange={(apiKey) => setDraft((current) => ({ ...current, apiKey }))} />
          </div>
          <Button onClick={() => void fetchModels()} loading={fetching} disabled={!draft.baseUrl.trim() || !draft.apiKey.trim()}>
            获取模型
          </Button>
        </div>
      </div>

      {PROVIDER_IDS.map((id) => {
        const item = draft.providers[id]
        const meta = PROVIDER_META[id]
        return (
          <div key={id} className={styles.modelRow}>
            <div className={styles.modelMain}>
              <span className={styles.modelName} id={`${listId}-${id}-label`}>
                <ProviderMark provider={id} />
                {meta.label}
              </span>
              <datalist id={`${listId}-${id}`}>
                {ranked[id].map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
              <TextInput
                monospace
                aria-label={`${meta.label} 模型名`}
                placeholder={meta.modelExample}
                list={`${listId}-${id}`}
                value={item.model}
                onChange={(event) => setProvider(id, { model: event.target.value })}
                className={styles.grow}
                disabled={!item.enabled}
              />
              <Button
                onClick={() => void test(id)}
                disabled={!item.enabled || !item.model.trim() || tests[id] === 'running' || saving}
              >
                测试
              </Button>
              <ProviderSwitch id={id} checked={item.enabled} labelledBy={`${listId}-${id}-label`} onToggle={toggleProvider} />
            </div>
            <TestLine state={tests[id]} />
          </div>
        )
      })}

      <div className={styles.row}>
        <div className={styles.rowText}>
          <span className={styles.rowLabel}>Work 主管</span>
        </div>
        <div className={styles.rowControl}>
          <Select
            aria-label="Work 主管"
            value={draft.supervisor}
            onChange={(event) => setDraft((current) => ({ ...current, supervisor: event.target.value as ProviderId }))}
          >
            {PROVIDER_IDS.map((id) => (
              <Select.Option key={id} value={id}>
                {PROVIDER_META[id].label}
              </Select.Option>
            ))}
          </Select>
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.rowText}>
          <span className={styles.rowLabel}>Study 导师</span>
          <span className={styles.rowHint}>也负责文库建档和整理</span>
        </div>
        <div className={styles.rowControl}>
          <Select
            aria-label="Study 导师"
            value={draft.tutor}
            onChange={(event) => setDraft((current) => ({ ...current, tutor: event.target.value as ProviderId }))}
          >
            {PROVIDER_IDS.map((id) => (
              <Select.Option key={id} value={id}>
                {PROVIDER_META[id].label}
              </Select.Option>
            ))}
          </Select>
        </div>
      </div>

      <details>
        <summary className={styles.summary}>单独接口（可选）</summary>
        <div className={styles.detailsBody}>
          {PROVIDER_IDS.map((id) => (
            <div key={id} className={styles.fieldGrid}>
              <FormControl>
                <FormControl.Label>{PROVIDER_META[id].label} 地址</FormControl.Label>
                <TextInput
                  block
                  monospace
                  placeholder="留空则用上面的中转站"
                  value={draft.providers[id].baseUrl}
                  onChange={(event) => setProvider(id, { baseUrl: event.target.value })}
                />
              </FormControl>
              <FormControl>
                <FormControl.Label>{PROVIDER_META[id].label} Key</FormControl.Label>
                <KeyInput
                  label={`${PROVIDER_META[id].label} Key`}
                  value={draft.providers[id].apiKey}
                  onChange={(apiKey) => setProvider(id, { apiKey })}
                />
              </FormControl>
            </div>
          ))}
        </div>
      </details>

      <div className={styles.footer}>
        {dirty ? (
          <Button variant="invisible" onClick={() => setDraft(draftFrom(config))} disabled={saving}>
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
