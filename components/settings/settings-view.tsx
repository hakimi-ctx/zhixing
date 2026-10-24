'use client'

import { Flash, Spinner } from '@primer/react'
import { PageFrame } from '@/components/shell/page-frame'
import { errorText } from '@/lib/client/api'
import { useConfig, useSystem } from '@/lib/client/hooks'
import { ExecutorsSection } from './executors-section'
import { AdvancedSection, VaultSection } from './general-sections'
import { ModelsSection } from './models-section'
import styles from './settings.module.css'

export function SettingsView() {
  const { data: config, error } = useConfig()
  const { data: system } = useSystem()

  return (
    <PageFrame title="设置">
      <div className={styles.column}>
        {error ? <Flash variant="danger">读取设置失败：{errorText(error)}</Flash> : null}
        {!config ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--base-size-48)' }}>
            <Spinner size="medium" srText="正在读取设置" />
          </div>
        ) : (
          <>
            <ModelsSection config={config} />
            <ExecutorsSection config={config} system={system} />
            <VaultSection config={config} system={system} />
            <AdvancedSection config={config} system={system} />
          </>
        )}
      </div>
    </PageFrame>
  )
}
