---
name: NoteIt
description: Chromium 侧边栏网页摘抄扩展。侧栏基于 shadcn/ui（Tailwind + Radix），页内 UI 为 Shadow DOM 内的 Preact，两者共享本文件的 token。本文件只写相对 shadcn 默认值的增量。仅浅色模式。
status: final
updated: 2026-10-24
sources:
  - .memlog.md
  - mockups/nav-placement-options.html
  - mockups/highlight-palette-options.html
  - mockups/key-sidebar-current-page.html
  - mockups/key-in-page-overlays.html
  - mockups/key-login.html
  - ../../../architecture-current-state.md
  - ../../../component-inventory.md
colors:
  # shadcn semantic overrides (direction C "Soft": violet-tinted neutrals, one violet accent).
  # Unlisted shadcn tokens (card, popover, input, etc.) map to background / border below.
  background: '#FFFFFF'
  foreground: '#2B2540'          # 14.57:1 on #FFFFFF
  muted: '#F1EEF8'
  muted-foreground: '#5E5776'    # 6.77:1 on #FFFFFF, 5.78:1 on selected
  subtle-foreground: '#6A6383'   # 5.64:1 on #FFFFFF, 4.81:1 on selected
  body-secondary: '#5A5470'
  border: '#ECE8F5'
  border-strong: '#DDD7EC'
  canvas: '#F7F5FC'              # side panel surface; cards, popovers and inputs stay on background
  hover: '#F1EEF8'
  selected: '#EFEBFA'
  ring: '#6B4EFF'                # 5.05:1 on #FFFFFF
  ring-inverse: '#FFFFFF'        # focus ring on dark surfaces (undo-toast), 14.57:1 on foreground
  primary: '#6B4EFF'
  primary-foreground: '#FFFFFF'  # 5.05:1 on primary
  warning: '#B7791F'
  # Highlight overlays on the host page. 8-digit hex = rgba with alpha; blends with the host
  # background and keeps host text color. One alpha (.38) for all four so they read equally heavy.
  highlight-yellow: '#FFC94D61'   # rgba(255,201,77,.38)  摘抄 (default)
  highlight-orange: '#FF9F6B61'   # rgba(255,159,107,.38) 重点
  highlight-blue: '#7CB8FF61'     # rgba(124,184,255,.38) 疑问
  highlight-green: '#7ED6A061'    # rgba(126,214,160,.38) 收藏
  # Same colors at .48 for dark host pages (the renderer picks them when the host background is dark).
  highlight-yellow-on-dark: '#FFC94D7A'
  highlight-orange-on-dark: '#FF9F6B7A'
  highlight-blue-on-dark: '#7CB8FF7A'
  highlight-green-on-dark: '#7ED6A07A'
  # Solid equivalents for sidebar color marks and floating-menu color dots.
  highlight-yellow-solid: '#FFC94D'
  highlight-orange-solid: '#FF9F6B'
  highlight-blue-solid: '#7CB8FF'
  highlight-green-solid: '#7ED6A0'
  comment-underline: 'currentColor'
  comment-marker: '#6B4EFF'           # commented-highlight bubble marker
  comment-marker-on-dark: '#B9A9FF'
typography:
  # System font stack, no web fonts.
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", "Microsoft YaHei", sans-serif'
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.5'
  label:
    fontFamily: '{typography.body.fontFamily}'
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1.5'
  meta:
    fontFamily: '{typography.body.fontFamily}'
    fontSize: 12px
    fontWeight: '400'
    lineHeight: '1.5'
  caption:
    fontFamily: '{typography.body.fontFamily}'
    fontSize: 11px
    fontWeight: '400'
    lineHeight: '1.4'
  group-heading:
    fontFamily: '{typography.body.fontFamily}'
    fontSize: 11px
    fontWeight: '600'
    lineHeight: '1.4'
  tooltip:
    fontFamily: '{typography.body.fontFamily}'
    fontSize: 12px
    fontWeight: '400'
    lineHeight: '1.4'
rounded:
  # Direction C: soft, large radii; --radius = 8px. md for cards and popovers, lg for the hero card.
  xs: 4px
  sm: 6px
  DEFAULT: 8px
  md: 14px
  lg: 18px
  full: 9999px
spacing:
  # Tailwind 4-based scale inherited; named tokens below are the deltas.
  hairline: 1px
  '0.5': 2px
  '1': 4px
  '1.5': 6px
  '2': 8px
  '2.5': 10px
  '3': 12px
  row-y: 6px
  row-x: 8px
  header-y: 8px
  header-x: 10px
  list-x: 4px
  color-bar: 3px
  panel-width: 360px
components:
  sidebar-header:
    background: '{colors.canvas}'
    border-bottom: '{colors.border}'
    padding: '{spacing.header-y} {spacing.header-x}'
    typography: '{typography.meta}'
    foreground: '{colors.body-secondary}'
  site-toggle:
    width: 24px
    height: 14px
    radius: '{rounded.full}'
    on-background: '{colors.primary}'
    off-background: '{colors.subtle-foreground}'
    knob: '{colors.background}'
  icon-button:
    size: 22px
    radius: '{rounded.DEFAULT}'
    foreground: '{colors.muted-foreground}'
    hover-background: '{colors.selected}'
  sync-status:
    size: 22px
    foreground: '{colors.muted-foreground}'
    pending-label: '{typography.caption}'
    failed-foreground: '{colors.warning}'
  module-tab:
    typography: '{typography.label}'
    foreground: '{colors.foreground}'
    inactive-foreground: '{colors.muted-foreground}'
    active-indicator: '2px solid {colors.foreground}'
    padding: '6px 6px 5px'
    row-border-bottom: '{colors.border}'
  item-count:
    typography: '{typography.meta}'
    foreground: '{colors.muted-foreground}'
  view-segmented-control:
    track: '{colors.muted}'
    track-radius: '{rounded.DEFAULT}'
    track-padding: '{spacing.0.5}'
    item-radius: '{rounded.sm}'
    item-padding: '1px 10px'
    item-foreground: '{colors.muted-foreground}'
    active-background: '{colors.background}'
    active-foreground: '{colors.foreground}'
    active-ring: '0 0 0 1px {colors.border-strong}'
    typography: '{typography.label}'
  highlight-item:
    padding: '{spacing.row-y} {spacing.row-x}'
    gap: '{spacing.2}'
    radius: '{rounded.DEFAULT}'
    divider: '1px solid {colors.muted}'
    hover-background: '{colors.hover}'
    text: '{typography.body}'
    text-clamp: 2
    comment: '{typography.meta}'
    comment-foreground: '{colors.muted-foreground}'
    color-bar-width: '{spacing.color-bar}'
    color-bar-radius: '{rounded.xs}'
    hover-actions: '{components.floating-menu}'
    hover-actions-position: 'top 4px, right 6px'
    hover-text-padding-right: 136px
  highlight-item-lost:
    text-foreground: '{colors.muted-foreground}'
    color-bar-opacity: 0.35
    message: '{typography.caption}'
    message-foreground: '{colors.muted-foreground}'
  page-group:
    header-typography: '{typography.body}'
    count-typography: '{typography.meta}'
    count-foreground: '{colors.muted-foreground}'
    favicon-size: 14px
    hover-background: '{colors.hover}'
    chevron-size: 12px
    chevron-foreground: '{colors.muted-foreground}'
  date-group-heading:
    typography: '{typography.group-heading}'
    foreground: '{colors.muted-foreground}'
    padding: '{spacing.2} {spacing.row-x} {spacing.1}'
  floating-menu:
    background: '{colors.background}'
    radius: '{rounded.full}'
    padding: 6px
    gap: 4px
    content: 'four color-chips and a round accent comment button; with the editor open it becomes an 18px-radius card'
    shadow: '0 2px 4px rgba(43,37,64,.06), 0 14px 30px rgba(43,37,64,.16)'
  color-chip:
    height: 30px
    padding: '0 12px 0 8px'
    radius: '{rounded.full}'
    dot-size: 14px
    background: 'highlight solid at 22% over {colors.background}'
    selected: 'inset 2px ring in the highlight solid, 34% tint, weight 600'
  color-dot:
    hit-size: 22px
    dot-size: 12px
    dot-border: 'none'
    hit-radius: '{rounded.DEFAULT}'
    selected-background: '{colors.selected}'
    selected-ring: '0 0 0 2px {colors.background}, 0 0 0 3px {colors.subtle-foreground}'
  highlight-popover:
    background: '{colors.background}'
    radius: '{rounded.lg}'
    padding: 14px
    width: 330px
    shadow: '{components.floating-menu.shadow}'
    content: 'color-chip row, then the comment-editor with a round soft delete button leading its footer'
    delete-foreground: '{colors.subtle-foreground}'
  comment-editor:
    background: '{colors.canvas}'
    border: none
    radius: 12px
    padding: '10px 12px'
    typography: '{typography.body}'
    min-rows: 2
    footer: 'save hint ({typography.caption}, {colors.subtle-foreground}) and a pill {colors.primary} save button'
  comment-preview:
    background: '{colors.background}'
    foreground: '{colors.foreground}'
    radius: '16px, the corner toward the highlight 4px (tail)'
    padding: '10px 14px'
    typography: '{typography.body}'
    title: '{typography.caption} 600 {colors.primary}'
    shadow: '0 2px 4px rgba(43,37,64,.06), 0 14px 30px rgba(43,37,64,.16)'
  highlight-mark:
    background: '{colors.highlight-yellow}'
    background-on-dark: '{colors.highlight-yellow-on-dark}'
    dark-host: 'nearest opaque background or gradient first stop, else a dark color-scheme canvas; dark when relative luminance < 0.2; repainted on host theme change'
    foreground: 'inherit'
    padding: '1px 0'
    radius: 5px
    hover: 'inset tint of the highlight solid at 22%, text unchanged'
  highlight-mark-commented:
    marker: '10x9px speech-bubble after the last fragment, {colors.comment-marker}'
    marker-on-dark: '{colors.comment-marker-on-dark}'
    highlight-api: 'underline dotted {colors.comment-underline}, 1.5px, offset 3px (::highlight() cannot draw the marker)'
  highlight-flash:
    background: '{colors.highlight-yellow}'
    duration: 1200ms
  undo-toast:
    background: '{colors.foreground}'
    foreground: '{colors.primary-foreground}'
    radius: '{rounded.DEFAULT}'
    typography: '{typography.meta}'
    padding: '6px 12px'
    action: 'underline, weight 500'
    inpage: 'pill, {rounded.full}, 42px high, padding 0 6px 0 18px; the action is a white pill button'
    action-focus-ring: '2px solid {colors.ring-inverse}'
    sidebar-position: 'bottom 16px, horizontally centered'
    duration: 5000ms
  login-form:
    label: '{typography.meta}'
    label-foreground: '{colors.muted-foreground}'
    label-gap: '{spacing.1}'
    input-height: 30px
    input-border: '1px solid {colors.border-strong}'
    input-radius: '{rounded.DEFAULT}'
    input-typography: '{typography.body}'
    button-background: '{colors.primary}'
    button-foreground: '{colors.primary-foreground}'
    button-radius: '{rounded.DEFAULT}'
  empty-state:
    typography: '{typography.body}'
    foreground: '{colors.muted-foreground}'
    action: '{components.button-outline}'
  button-outline:
    border: '1px solid {colors.border-strong}'
    radius: '{rounded.DEFAULT}'
    typography: '{typography.label}'
    hover-background: '{colors.hover}'
  focus-ring:
    outline: '2px solid {colors.ring}'
    offset: 1px
  account-panel:
    background: '{colors.background}'
    row-padding: '{spacing.2} {spacing.header-x}'
    row-divider: '1px solid {colors.border}'
    label: '{typography.meta}'
    label-foreground: '{colors.muted-foreground}'
    value: '{typography.body}'
    value-foreground: '{colors.foreground}'
    logout: '{components.button-outline}'
  logout-confirm:
    background: '{colors.background}'
    border: '1px solid {colors.border-strong}'
    radius: '{rounded.md}'
    shadow: '0 2px 4px rgba(43,37,64,.06), 0 14px 30px rgba(43,37,64,.16)'
    typography: '{typography.body}'
    padding: '14px 14px 12px'
    confirm: '{components.button-outline}'
    scrim: 'rgba(43,37,64,.2)'
  sync-error-popover:
    base: '{components.floating-menu}'
    typography: '{typography.meta}'
    retry: '{components.button-outline}'
  action-badge:
    background: '{colors.foreground}'
    foreground: '{colors.primary-foreground}'
  unsupported-notice:
    background: '{colors.hover}'
    border: '1px solid {colors.border}'
    radius: '{rounded.DEFAULT}'
    typography: '{typography.meta}'
---

<!-- Generated by scripts/sync-design-frontmatter.ts from the UX DESIGN.md. Do not edit. -->
