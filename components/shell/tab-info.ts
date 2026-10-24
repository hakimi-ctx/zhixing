'use client'

import { useMemo } from 'react'
import { BookIcon, CommentDiscussionIcon, FileIcon, NoteIcon, ShareAndroidIcon, WorkflowIcon, type Icon } from '@primer/octicons-react'
import { useConversations, useLibrary } from '@/lib/client/hooks'
import { baseName } from '@/lib/client/vault'
import { displayName, MINDMAP_EXT } from '@/lib/shared/mindmap'

export interface TabInfo {
  title: string
  icon: Icon
}

function describe(href: string, papers: Map<string, string>, chats: Map<string, string>): TabInfo {
  let url: URL
  try {
    url = new URL(href, 'http://zhixing.local')
  } catch {
    return { title: '页面', icon: FileIcon }
  }
  const path = url.pathname
  if (path === '/study') return { title: '文库', icon: BookIcon }
  if (path === '/study/chat') return { title: '新对话', icon: CommentDiscussionIcon }
  if (path === '/study/graph') return { title: '关系图谱', icon: WorkflowIcon }
  if (path === '/study/file') {
    const file = url.searchParams.get('path') ?? ''
    return { title: displayName(baseName(file)) || '文件', icon: file.endsWith(MINDMAP_EXT) ? ShareAndroidIcon : NoteIcon }
  }
  const chat = path.match(/^\/study\/chat\/([^/]+)$/)
  if (chat) return { title: chats.get(decodeURIComponent(chat[1])) ?? '对话', icon: CommentDiscussionIcon }
  const paper = path.match(/^\/study\/paper\/([^/]+)$/)
  if (paper) return { title: papers.get(paper[1]) ?? '论文', icon: FileIcon }
  return { title: '页面', icon: FileIcon }
}

/** Titles come from data the shell already keeps fresh (the library and the conversation list). */
export function useTabDescriber(): (href: string) => TabInfo {
  const { data: library } = useLibrary()
  const { data: conversations } = useConversations()
  return useMemo(() => {
    const papers = new Map((library?.papers ?? []).map((paper) => [paper.id, paper.title]))
    const chats = new Map((conversations ?? []).map((conversation) => [conversation.id, conversation.title]))
    return (href: string) => describe(href, papers, chats)
  }, [library, conversations])
}
