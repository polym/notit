// Design tokens: a literal transcription of the DESIGN.md frontmatter (colors, typography, rounded,
// spacing). DESIGN.md is the single source; tokens.test.ts fails when the two drift apart.
// Color literals are only allowed inside src/ui/tokens (lint rule noteit/no-raw-color).

export const colors = {
  background: '#FFFFFF',
  foreground: '#2B2540',
  muted: '#F1EEF8',
  'muted-foreground': '#5E5776',
  'subtle-foreground': '#6A6383',
  'body-secondary': '#5A5470',
  border: '#ECE8F5',
  'border-strong': '#DDD7EC',
  // Side panel surface (direction C lavender canvas); cards, popovers and inputs stay on background.
  canvas: '#F7F5FC',
  hover: '#F1EEF8',
  selected: '#EFEBFA',
  ring: '#6B4EFF',
  // Focus ring on dark surfaces (undo-toast), where ring would vanish.
  'ring-inverse': '#FFFFFF',
  primary: '#6B4EFF',
  'primary-foreground': '#FFFFFF',
  warning: '#B7791F',
  // Highlight overlays on the host page: 8-digit hex = color with alpha (.38 for all four).
  'highlight-yellow': '#FFC94D61',
  'highlight-orange': '#FF9F6B61',
  'highlight-blue': '#7CB8FF61',
  'highlight-green': '#7ED6A061',
  // Same colors at .48, painted when the host background is dark.
  'highlight-yellow-on-dark': '#FFC94D7A',
  'highlight-orange-on-dark': '#FF9F6B7A',
  'highlight-blue-on-dark': '#7CB8FF7A',
  'highlight-green-on-dark': '#7ED6A07A',
  // Solid equivalents for sidebar color marks and floating-menu color dots.
  'highlight-yellow-solid': '#FFC94D',
  'highlight-orange-solid': '#FF9F6B',
  'highlight-blue-solid': '#7CB8FF',
  'highlight-green-solid': '#7ED6A0',
  'comment-underline': 'currentColor',
  // Commented-highlight bubble marker (MarkRenderer), and its color on a dark host page.
  'comment-marker': '#6B4EFF',
  'comment-marker-on-dark': '#B9A9FF',
} as const

export type ColorToken = keyof typeof colors

/** System font stack, no web fonts. */
export const fontFamily =
  '-apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", "Microsoft YaHei", sans-serif'

export interface TypographyToken {
  fontFamily: string
  fontSize: string
  fontWeight: string
  lineHeight: string
}

export const typography = {
  body: { fontFamily, fontSize: '13px', fontWeight: '400', lineHeight: '1.5' },
  label: { fontFamily, fontSize: '12px', fontWeight: '500', lineHeight: '1.5' },
  meta: { fontFamily, fontSize: '12px', fontWeight: '400', lineHeight: '1.5' },
  caption: { fontFamily, fontSize: '11px', fontWeight: '400', lineHeight: '1.4' },
  'group-heading': { fontFamily, fontSize: '11px', fontWeight: '600', lineHeight: '1.4' },
  tooltip: { fontFamily, fontSize: '12px', fontWeight: '400', lineHeight: '1.4' },
} as const satisfies Record<string, TypographyToken>

export type TypographyName = keyof typeof typography

export const rounded = {
  xs: '4px',
  sm: '6px',
  DEFAULT: '8px',
  md: '14px',
  lg: '18px',
  full: '9999px',
} as const

export const spacing = {
  hairline: '1px',
  '0.5': '2px',
  '1': '4px',
  '1.5': '6px',
  '2': '8px',
  '2.5': '10px',
  '3': '12px',
  'row-y': '6px',
  'row-x': '8px',
  'header-y': '8px',
  'header-x': '10px',
  'list-x': '4px',
  'color-bar': '3px',
  'panel-width': '360px',
} as const

export const tokens = { colors, typography, rounded, spacing } as const
