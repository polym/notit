// Component effect values from the DESIGN.md frontmatter "components" section (shadows, scrims, rings).
// They are composite CSS values rather than color tokens, so they are not --nt-* variables; they live
// here because color literals are only allowed inside src/ui/tokens (lint rule noteit/no-raw-color).
// Values that reference color tokens are written with var(--nt-*), so they work in both UI trees.
export const effects = {
  /** components.floating-menu.shadow; also the sync-error-popover base (Q68). */
  floatingMenuShadow: '0 2px 4px rgba(43,37,64,.06), 0 14px 30px rgba(43,37,64,.16)',
  /** components.color-dot.dot-border (direction C: borderless dots) */
  colorDotBorder: 'none',
  /** components.color-dot.selected-ring */
  colorDotSelectedRing: '0 0 0 2px var(--nt-background), 0 0 0 3px var(--nt-subtle-foreground)',
  /** components.comment-preview.shadow (same soft shadow as every direction C overlay) */
  commentPreviewShadow: '0 2px 4px rgba(43,37,64,.06), 0 14px 30px rgba(43,37,64,.16)',
  /** components.logout-confirm.shadow */
  dialogShadow: '0 2px 4px rgba(43,37,64,.06), 0 14px 30px rgba(43,37,64,.16)',
  /** components.logout-confirm.scrim (Q64): the original .2 strength in the direction C ink hue */
  scrim: 'rgba(43,37,64,.2)',
} as const
