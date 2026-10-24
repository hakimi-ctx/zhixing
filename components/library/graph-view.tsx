'use client'

import { useMemo, useState } from 'react'
import { Button, Spinner, ToggleSwitch } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { SparkleFillIcon, WorkflowIcon } from '@primer/octicons-react'
import { PageFrame } from '@/components/shell/page-frame'
import { buildGraph, type GraphNode } from '@/lib/client/graph'
import { useLibrary } from '@/lib/client/hooks'
import { canOrganize } from '@/lib/client/library'
import { useOpen } from '@/lib/client/tabs'
import { fileHref } from '@/lib/client/vault'
import { GraphCanvas } from './graph-canvas'
import { GraphDetails } from './graph-details'
import { useLibraryActions } from './library-actions'
import styles from './graph.module.css'

export function GraphView() {
  const { data: library, error } = useLibrary()
  const actions = useLibraryActions()
  const open = useOpen()
  const [withFiles, setWithFiles] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const papers = library?.papers
  const insights = library?.insights ?? null
  const layout = useMemo(() => (papers ? buildGraph(papers, insights, withFiles) : null), [papers, insights, withFiles])

  const selected = useMemo(() => layout?.nodes.find((node) => node.id === selectedId) ?? null, [layout, selectedId])

  const select = (node: GraphNode | null) => setSelectedId(node?.id ?? null)
  const openNode = (node: GraphNode, event: React.MouseEvent | React.KeyboardEvent) => {
    if (node.kind === 'paper') actions.open(node.paper, event)
    else if (node.path) open(fileHref(node.path), event)
  }

  const relationCount = layout?.links.filter((link) => link.type !== 'file').length ?? 0
  const organizable = papers ? canOrganize(papers) : false

  return (
    <PageFrame
      title="关系图谱"
      leading={<WorkflowIcon />}
      meta={layout && papers?.length ? <span>{`${papers.length} 篇论文 · ${relationCount} 条关系`}</span> : null}
      actions={
        papers?.length ? (
          <>
            <div className={styles.toggle}>
              <span id="graph-with-files">显示导图和笔记</span>
              <ToggleSwitch aria-labelledby="graph-with-files" size="small" checked={withFiles} onClick={() => setWithFiles((value) => !value)} statusLabelPosition="end" />
            </div>
            <Button
              size="small"
              leadingVisual={SparkleFillIcon}
              loading={library?.organizing}
              disabled={!organizable || !library?.aiReady}
              onClick={() => void actions.organize()}
            >
              {insights ? '重新整理' : 'AI 整理'}
            </Button>
          </>
        ) : null
      }
      body="fill"
    >
      {!layout ? (
        <div className={styles.center}>{error ? <p className={styles.hint}>文库读取失败，请稍后重试。</p> : <Spinner size="medium" srText="正在读取文库" />}</div>
      ) : !papers?.length ? (
        <div className={styles.center}>
          <Blankslate>
            <Blankslate.Visual>
              <WorkflowIcon size="medium" />
            </Blankslate.Visual>
            <Blankslate.Heading>还没有论文</Blankslate.Heading>
            <Blankslate.Description>导入论文并让 AI 整理后，这里会画出论文之间的关系。</Blankslate.Description>
          </Blankslate>
        </div>
      ) : (
        <div className={styles.layout}>
          <div className={styles.stage}>
            {!insights || library?.organizeError ? (
              <p className={styles.notice} role="status">
                {library?.organizeError
                  ? `上次整理失败：${library.organizeError}`
                  : organizable
                    ? '还没有 AI 整理，论文之间暂时没有连线。点右上角的“AI 整理”生成主题和关系。'
                    : '至少 2 篇论文完成 AI 编目后，才能整理出主题和关系。'}
              </p>
            ) : null}
            <GraphCanvas layout={layout} selected={selected?.id ?? null} onSelect={select} onOpen={openNode} />
          </div>
          <GraphDetails layout={layout} node={selected} onSelect={select} />
        </div>
      )}
    </PageFrame>
  )
}
