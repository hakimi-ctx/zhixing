export interface SkillMeta {
  name: string
  title: string
  summary: string
  keywords: string[]
  starter: string
}

/** Chinese metadata for the bundled Supervisor-Skills (github.com/HKUSTDial/Supervisor-Skills). */
export const SKILLS: SkillMeta[] = [
  {
    name: 'idea-evaluator',
    title: '研究想法评估',
    summary: '用“更高、更快、更强、更省、更广”五维框架评估一个研究想法值不值得做，并排查致命缺陷。',
    keywords: ['评估', '想法', 'idea', '选题', '可行性', '值不值得', '新颖性', '创新点', 'novelty', '研究方向', '靠谱吗', '能不能做'],
    starter: '我有一个研究想法，想请你评估它值不值得做：',
  },
  {
    name: 'deep-research',
    title: '深度文献调研',
    summary: '先锁定研究问题，再从多个视角检索、核实引用，产出综述级的调研报告。',
    keywords: ['综述', '文献', '调研', 'survey', 'literature', '研究现状', 'related work', '相关工作', '前沿', '进展', '梳理一下'],
    starter: '请帮我系统调研这个方向的研究现状：',
  },
  {
    name: 'paper-writer',
    title: '论文写作',
    summary: '基于你自己的材料起草论文段落乃至全文，每个事实都有出处，不留占位符。',
    keywords: ['写一段', '写一节', '撰写', '起草', 'draft', '写论文', '方法部分', '实验部分', '摘要', 'abstract', '结论部分'],
    starter: '请根据下面的材料帮我起草论文的一节：',
  },
  {
    name: 'paper-polish',
    title: '论文润色',
    summary: '在不改变原意的前提下修语法、理顺逻辑、去掉 AI 腔，也能把中文稿改写成可投稿的英文。',
    keywords: ['润色', 'polish', '改写', '语法', '通顺', '去ai味', 'ai味', 'ai 味', '中译英', '翻译成英文', '措辞', '表达更学术'],
    starter: '请帮我润色下面这段文字（保持原意）：',
  },
  {
    name: 'intro-drafter',
    title: '引言撰写',
    summary: '按“背景—局限—本质—挑战—方案—贡献”六段逻辑写出论文引言。',
    keywords: ['引言', 'introduction', 'intro', '导言', '背景介绍'],
    starter: '请帮我按六段逻辑写这篇论文的引言，以下是我的工作：',
  },
  {
    name: 'tech-paper-template',
    title: '论文逻辑骨架',
    summary: '用思考模板表梳理论文的背景、局限、关键思想、挑战、方法模块和贡献，并做自洽检查。',
    keywords: ['论文结构', '逻辑链', '骨架', '框架', '大纲', '提纲', 'outline', '贡献点', 'contribution', '怎么组织'],
    starter: '请帮我梳理这篇论文的逻辑骨架：',
  },
  {
    name: 'benchmark-paper-template',
    title: 'Benchmark 论文',
    summary: '按五支柱框架规划 Benchmark / 评测类论文：研究缺口、构建流程、评测框架、实验发现。',
    keywords: ['benchmark', '基准', '评测集', '数据集论文', '评测论文', 'leaderboard'],
    starter: '我想做一个 Benchmark，请帮我检查思路是否站得住：',
  },
  {
    name: 'pre-submission-reviewer',
    title: '投稿前审稿',
    summary: '从宏观逻辑、写作细节、英文语法、LaTeX 格式和图表质量五个维度做投稿前自查。',
    keywords: ['投稿前', '审稿', '自查', '检查一下', 'review this paper', 'proofread', '挑毛病', '找问题', 'latex', '格式检查'],
    starter: '我快投稿了，请像审稿人一样帮我检查这篇稿子：',
  },
  {
    name: 'rebuttal-guidance',
    title: 'Rebuttal 指导',
    summary: '分析审稿人心态，给出回复审稿意见的策略和要点（不是代写全文）。',
    keywords: ['rebuttal', '审稿意见', 'reviewer', '回复审稿', '反驳', 'response to reviewers', 'openreview', '审稿人'],
    starter: '这是审稿人的意见，请指导我怎么回复：',
  },
  {
    name: 'figure-designer',
    title: '论文配图设计',
    summary: '为动机示例图、方法总览图和实验结果图推荐版式、配色和工具，并做质量检查。',
    keywords: ['配图', '画图', '图表', 'figure', '可视化', '示意图', '流程图', '柱状图', '折线图', 'plot', 'chart'],
    starter: '请帮我设计这篇论文的配图：',
  },
  {
    name: 'drawio-reconstruction',
    title: 'Draw.io 重绘',
    summary: '把参考图片重建成可编辑的 Draw.io 图（结构用原生元素，复杂图像保留为图片）。',
    keywords: ['drawio', 'draw.io', '重绘', '还原图', '可编辑的图', '矢量图'],
    starter: '我想把一张图重绘成可编辑的 Draw.io 文件，请告诉我怎么做：',
  },
  {
    name: 'vibe-research-workflow',
    title: 'AI 辅助科研工作流',
    summary: '在 Vibe Coding / Figure / Writing 三个环节里让 AI 做体力活，学术判断留给你自己。',
    keywords: ['vibe', 'ai辅助', 'ai 辅助', '用ai', '用 ai', '工具推荐', 'cursor', 'claude code', '工作流', '科研效率', '怎么用ai'],
    starter: '我想用 AI 提高科研效率，请帮我设计工作流：',
  },
]

export const SKILL_NAMES = new Set(SKILLS.map((skill) => skill.name))

export function skillMeta(name: string | null | undefined): SkillMeta | undefined {
  if (!name) return undefined
  return SKILLS.find((skill) => skill.name === name)
}

/** Keyword router: returns the best-matching skill name, or null when nothing matches. */
export function routeSkill(text: string): string | null {
  const haystack = text.toLowerCase()
  let best: { name: string; score: number } | null = null
  for (const skill of SKILLS) {
    let score = 0
    for (const keyword of skill.keywords) {
      if (haystack.includes(keyword.toLowerCase())) score += 1 + Math.floor(keyword.length / 4)
    }
    if (score > 0 && (!best || score > best.score)) best = { name: skill.name, score }
  }
  return best?.name ?? null
}
