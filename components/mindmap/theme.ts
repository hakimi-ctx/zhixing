import type { Theme } from 'mind-elixir'
import type { MindTheme } from '@/lib/shared/mindmap'

/**
 * Mind map skins. Everything that ends up in CSS uses Primer tokens directly; branch lines are SVG
 * presentation attributes, which cannot read CSS variables, so their palette is resolved from the
 * same tokens at runtime.
 */

export const HUES = ['blue', 'green', 'orange', 'purple', 'pink', 'teal', 'yellow', 'red'] as const
export type Hue = (typeof HUES)[number]

export const THEME_LABEL: Record<MindTheme, string> = {
  classic: '经典',
  colorful: '彩色',
  minimal: '简约',
  dark: '夜间',
}

export function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

let probe: HTMLSpanElement | null = null

/** Turns any CSS color (including `var(--token)`) into `#rrggbb`, for SVG attributes and exported files. */
export function resolveColor(value: string): string | undefined {
  if (!value) return undefined
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return value
  if (!probe) {
    probe = document.createElement('span')
    probe.style.display = 'none'
    document.body.appendChild(probe)
  }
  probe.style.color = ''
  probe.style.color = value
  if (!probe.style.color) return undefined
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(getComputedStyle(probe).color)
  if (!match || match[4] === '0') return undefined
  return `#${[match[1], match[2], match[3]].map((part) => Number(part).toString(16).padStart(2, '0')).join('')}`
}

function palette(token: (hue: Hue) => string, fallback: string[]): string[] {
  const colors = HUES.map((hue) => resolveColor(`var(${token(hue)})`))
  return colors.every(Boolean) ? (colors as string[]) : fallback
}

const LAYOUT_VARS = {
  '--node-gap-x': '30px',
  '--node-gap-y': '10px',
  '--main-gap-x': '64px',
  '--main-gap-y': '40px',
  '--topic-padding': '4px 6px',
  '--map-padding': '50px 80px',
  '--root-radius': 'var(--borderRadius-large)',
  '--main-radius': 'var(--borderRadius-medium)',
  '--selected': 'var(--fgColor-accent)',
  '--accent-color': 'var(--fgColor-accent)',
  '--panel-color': 'var(--fgColor-default)',
  '--panel-bgcolor': 'var(--bgColor-default)',
  '--panel-border-color': 'var(--borderColor-default)',
}

export function buildTheme(name: MindTheme, fallbackPalette: string[]): Theme {
  const strong = palette((hue) => `--data-${hue}-color-emphasis`, fallbackPalette)
  switch (name) {
    case 'dark':
      return {
        name: 'zhixing-dark',
        type: 'dark',
        palette: palette((hue) => `--display-${hue}-scale-3`, fallbackPalette),
        cssVar: {
          ...LAYOUT_VARS,
          '--bgcolor': 'var(--bgColor-emphasis)',
          '--color': 'var(--fgColor-onEmphasis)',
          '--root-color': 'var(--fgColor-onEmphasis)',
          '--root-bgcolor': 'var(--bgColor-accent-emphasis)',
          '--root-border-color': 'transparent',
          '--main-color': 'var(--fgColor-onEmphasis)',
          '--main-bgcolor': 'var(--bgColor-neutral-emphasis)',
          '--main-bgcolor-transparent': 'var(--bgColor-neutral-emphasis)',
          '--main-border': '',
          '--selected': 'var(--fgColor-onEmphasis)',
        },
      }
    case 'minimal':
      return {
        name: 'zhixing-minimal',
        type: 'light',
        palette: palette((hue) => `--display-${hue}-scale-4`, fallbackPalette),
        cssVar: {
          ...LAYOUT_VARS,
          '--bgcolor': 'var(--bgColor-default)',
          '--color': 'var(--fgColor-default)',
          '--root-color': 'var(--fgColor-default)',
          '--root-bgcolor': 'var(--bgColor-default)',
          '--root-border-color': 'var(--borderColor-emphasis)',
          '--main-color': 'var(--fgColor-default)',
          '--main-bgcolor': 'transparent',
          '--main-bgcolor-transparent': 'transparent',
          '--main-border': 'none',
        },
      }
    case 'colorful':
    case 'classic':
    default:
      return {
        name: name === 'colorful' ? 'zhixing-colorful' : 'zhixing-classic',
        type: 'light',
        palette: strong,
        cssVar: {
          ...LAYOUT_VARS,
          '--bgcolor': 'var(--bgColor-default)',
          '--color': 'var(--fgColor-default)',
          '--root-color': 'var(--fgColor-onEmphasis)',
          '--root-bgcolor': 'var(--bgColor-emphasis)',
          '--root-border-color': 'transparent',
          '--main-color': name === 'colorful' ? 'var(--fgColor-onEmphasis)' : 'var(--fgColor-default)',
          '--main-bgcolor': 'var(--bgColor-default)',
          '--main-bgcolor-transparent': 'var(--bgColor-default)',
          '--main-border': '',
        },
      }
  }
}

/** Swatches offered in the format panel. Stored as token references so the map follows the theme. */
export const TEXT_SWATCHES = HUES.map((hue) => ({ hue, value: `var(--display-${hue}-fgColor)` }))
export const FILL_SWATCHES = HUES.map((hue) => ({ hue, value: `var(--display-${hue}-bgColor-muted)` }))
export const STRONG_FILL_SWATCHES = HUES.map((hue) => ({ hue, value: `var(--display-${hue}-bgColor-emphasis)` }))
export const BORDER_SWATCHES = HUES.map((hue) => ({ hue, value: `2px solid var(--display-${hue}-borderColor-emphasis)` }))

export const HUE_LABEL: Record<Hue, string> = {
  blue: '蓝',
  green: '绿',
  orange: '橙',
  purple: '紫',
  pink: '粉',
  teal: '青',
  yellow: '黄',
  red: '红',
}

export const ON_EMPHASIS = 'var(--fgColor-onEmphasis)'
