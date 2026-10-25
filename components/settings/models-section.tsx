'use client'

import { useCallback, useEffect, useId, useState } from 'react'
import { Button, FormControl, Select, Spinner, TextInput, ToggleSwitch } from '@primer/react'
import { CheckCircleFillIcon, PlusIcon, XCircleFillIcon } from '@primer/octicons-react'
import { useNotice } from '@/components/ui/notices'
import { ProviderMark } from '@/components/ui/provider-mark'
import { api, errorText } from '@/lib/client/api'
import { patchConfig } from '@/lib/client/config'
import { blankSlot, canAddSlot, modelExample, rankModels } from '@/lib/shared/providers'
import {
  MAX_AI_SLOTS,
  type AiSlot,
  type AppConfig,
  type ConnectionTestResult,
  type ProviderId,
} from '@/lib/shared/types'
import styles from './settings.module.css'

const MASK = '••••'
const isMasked = (value: string) => value.startsWith(MASK)

interface Draft {
  baseUrl: string
  apiKey: string
  providers: AiSlot[]
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
 * An inline handler therefore re-renders forever; this keeps one stable callback per slot.
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

function fallbackId(slots: AiSlot[], current: string, removed: string): string {
  if (current !== removed) return current
  return slots.find((slot) => slot.enabled)?.id ?? slots[0]?.id ?? ''
}

export function ModelsSection({ config }: { config: AppConfig }) {
  const notify = useNotice()
  const listId = useId()
  const [draft, setDraft] = useState<Draft>(() => draftFrom(config))
  const [saving, setSaving] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [fetching, setFetching] = useState(false)
  const [tests, setTests] = useState<Partial<Record<string, TestState>>>({})

  useEffect(() => setDraft(draftFrom(config)), [config])

  const dirty = JSON.stringify(draft) !== JSON.stringify(draftFrom(config))

  const updateSlot = (id: ProviderId, patch: Partial<AiSlot>) =>
    setDraft((current) => ({
      ...current,
      providers: current.providers.map((slot) => (slot.id === id ? { ...slot, ...patch } : slot)),
    }))

  const toggleProvider = useCallback((id: ProviderId, enabled: boolean) => {
    setDraft((current) => ({
      ...current,
      providers: current.providers.map((slot) => (slot.id === id ? { ...slot, enabled } : slot)),
    }))
  }, [])

  const addSlot = () => {
    setDraft((current) => {
      if (!canAddSlot(current.providers.length)) return current
      const slot = blankSlot(current.providers)
      return {
        ...current,
        providers: [...current.providers, slot],
        supervisor: current.supervisor || slot.id,
        tutor: current.tutor || slot.id,
      }
    })
  }

  const removeSlot = (id: ProviderId) => {
    setDraft((current) => {
      const providers = current.providers.filter((slot) => slot.id !== id)
      return {
        ...current,
        providers,
        supervisor: fallbackId(providers, current.supervisor, id),
        tutor: fallbackId(providers, current.tutor, id),
      }
    })
    setTests((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
  }

  const save = async (quiet = false): Promise<boolean> => {
    setSaving(true)
    try {
      await patchConfig({
        relay: { baseUrl: draft.baseUrl.trim(), apiKey: draft.apiKey.trim() },
        providers: draft.providers.map((slot) => ({
          ...slot,
          label: slot.label.trim() || '未命名',
          model: slot.model.trim(),
          baseUrl: slot.baseUrl.trim(),
          apiKey: slot.apiKey.trim(),
          command: slot.command.trim(),
          args: slot.args,
          note: slot.note.trim(),
        })),
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

  const atLimit = !canAddSlot(draft.providers.length)

  return (
    <section className={styles.section} aria-labelledby="settings-models">
      <div className={styles.sectionHead}>
        <h2 id="settings-models" className={styles.sectionTitle}>
          模型
        </h2>
        <div className={styles.sectionActions}>
          <span className={styles.muted}>
            {draft.providers.length} / {MAX_AI_SLOTS}
          </span>
          <Button leadingVisual={PlusIcon} onClick={addSlot} disabled={atLimit}>
            添加槽位
          </Button>
        </div>
      </div>
      <p className={styles.intro}>
        每个槽位自己选连接方式。API 走 OpenAI 兼容中转；留空地址时用下面的共享中转站。CLI 在本机运行命令，把标准输出当作回复。本机可以只配 API。
      </p>

      <div className={styles.row}>
        <div className={styles.rowText}>
          <span className={styles.rowLabel}>中转站地址</span>
          <span className={styles.rowHint}>API 槽位的共享接口，可留空</span>
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

      {draft.providers.length === 0 ? <p className={styles.emptySlots}>还没有槽位。点「添加槽位」开始配置。</p> : null}

      {draft.providers.map((slot) => {
        const ranked = rankModels(slot, models)
        const api = slot.connection === 'api'
        const canTest = slot.enabled && (api ? Boolean(slot.model.trim()) : Boolean(slot.command.trim()))
        return (
          <div key={slot.id} className={styles.slot}>
            <div className={styles.slotHead}>
              <ProviderMark provider={slot.id} label={slot.label} />
              <TextInput
                aria-label={`${slot.label} 名称`}
                id={`${listId}-${slot.id}-label`}
                value={slot.label}
                onChange={(event) => updateSlot(slot.id, { label: event.target.value })}
                className={styles.slotName}
              />
              <Select
                aria-label={`${slot.label || '槽位'} 连接方式`}
                value={slot.connection}
                onChange={(event) =>
                  updateSlot(slot.id, { connection: event.target.value === 'cli' ? 'cli' : 'api' })
                }
              >
                <Select.Option value="api">API</Select.Option>
                <Select.Option value="cli">CLI</Select.Option>
              </Select>
              <Button variant="invisible" onClick={() => removeSlot(slot.id)}>
                移除
              </Button>
              <ProviderSwitch id={slot.id} checked={slot.enabled} labelledBy={`${listId}-${slot.id}-label`} onToggle={toggleProvider} />
            </div>

            {api ? (
              <div className={styles.slotGrid}>
                <FormControl>
                  <FormControl.Label>模型名</FormControl.Label>
                  <TextInput
                    block
                    monospace
                    aria-label={`${slot.label} 模型名`}
                    placeholder={modelExample(slot)}
                    list={`${listId}-${slot.id}`}
                    value={slot.model}
                    disabled={!slot.enabled}
                    onChange={(event) => updateSlot(slot.id, { model: event.target.value })}
                  />
                  <datalist id={`${listId}-${slot.id}`}>
                    {ranked.map((model) => (
                      <option key={model} value={model} />
                    ))}
                  </datalist>
                </FormControl>
                <FormControl>
                  <FormControl.Label>单独地址</FormControl.Label>
                  <TextInput
                    block
                    monospace
                    placeholder="留空则用上面的中转站"
                    value={slot.baseUrl}
                    disabled={!slot.enabled}
                    onChange={(event) => updateSlot(slot.id, { baseUrl: event.target.value })}
                  />
                </FormControl>
                <FormControl>
                  <FormControl.Label>单独 Key</FormControl.Label>
                  <KeyInput
                    label={`${slot.label} Key`}
                    value={slot.apiKey}
                    onChange={(apiKey) => updateSlot(slot.id, { apiKey })}
                  />
                </FormControl>
              </div>
            ) : (
              <div className={styles.slotGrid}>
                <FormControl>
                  <FormControl.Label>命令</FormControl.Label>
                  <TextInput
                    block
                    monospace
                    aria-label={`${slot.label} 命令`}
                    placeholder="claude"
                    value={slot.command}
                    disabled={!slot.enabled}
                    onChange={(event) => updateSlot(slot.id, { command: event.target.value })}
                  />
                </FormControl>
                <FormControl>
                  <FormControl.Label>参数</FormControl.Label>
                  <TextInput
                    block
                    monospace
                    aria-label={`${slot.label} 参数`}
                    placeholder="留空则把提示写入标准输入"
                    value={slot.args}
                    disabled={!slot.enabled}
                    onChange={(event) => updateSlot(slot.id, { args: event.target.value })}
                  />
                  <FormControl.Caption>可用 {'{prompt}'} 和 {'{model}'}。长对话请不要用 {'{prompt}'}，让命令读标准输入。</FormControl.Caption>
                </FormControl>
                <FormControl>
                  <FormControl.Label>模型名（可选）</FormControl.Label>
                  <TextInput
                    block
                    monospace
                    aria-label={`${slot.label} 模型名`}
                    placeholder={modelExample(slot)}
                    value={slot.model}
                    disabled={!slot.enabled}
                    onChange={(event) => updateSlot(slot.id, { model: event.target.value })}
                  />
                </FormControl>
              </div>
            )}

            <div className={styles.slotFoot}>
              <TextInput
                aria-label={`${slot.label} 擅长`}
                placeholder="擅长（可选，工作区主管分派时会看到）"
                value={slot.note}
                onChange={(event) => updateSlot(slot.id, { note: event.target.value })}
                className={styles.grow}
                disabled={!slot.enabled}
              />
              <Button onClick={() => void test(slot.id)} disabled={!canTest || tests[slot.id] === 'running' || saving}>
                测试
              </Button>
            </div>
            <TestLine state={tests[slot.id]} />
          </div>
        )
      })}

      <div className={styles.row}>
        <div className={styles.rowText}>
          <span className={styles.rowLabel}>Work 主管</span>
        </div>
        <div className={styles.rowControl}>
          {draft.providers.length ? (
            <Select
              aria-label="Work 主管"
              value={draft.supervisor}
              onChange={(event) => setDraft((current) => ({ ...current, supervisor: event.target.value }))}
            >
              {draft.providers.map((slot) => (
                <Select.Option key={slot.id} value={slot.id}>
                  {slot.label || slot.id}
                </Select.Option>
              ))}
            </Select>
          ) : (
            <span className={styles.muted}>先添加一个槽位</span>
          )}
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.rowText}>
          <span className={styles.rowLabel}>Study 导师</span>
          <span className={styles.rowHint}>也负责文库建档和整理</span>
        </div>
        <div className={styles.rowControl}>
          {draft.providers.length ? (
            <Select
              aria-label="Study 导师"
              value={draft.tutor}
              onChange={(event) => setDraft((current) => ({ ...current, tutor: event.target.value }))}
            >
              {draft.providers.map((slot) => (
                <Select.Option key={slot.id} value={slot.id}>
                  {slot.label || slot.id}
                </Select.Option>
              ))}
            </Select>
          ) : (
            <span className={styles.muted}>先添加一个槽位</span>
          )}
        </div>
      </div>

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
