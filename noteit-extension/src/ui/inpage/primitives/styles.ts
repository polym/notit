// Component CSS for the in-page primitives (DESIGN.md "Components": floating-menu, color-chip,
// icon-button, comment-editor). Adopted once into the Shadow root; values come from the --nt-*
// variables declared on :host, so no color literal is repeated here.
import { effects } from '../../tokens/index.ts'

export const PRIMITIVES_CSS = `
.nt-pill {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px;
  background: var(--nt-background);
  border-radius: var(--nt-radius-full);
  box-shadow: ${effects.floatingMenuShadow};
}
.nt-card {
  box-sizing: border-box;
  background: var(--nt-background);
  border-radius: var(--nt-radius-lg);
  padding: 14px;
  box-shadow: ${effects.floatingMenuShadow};
}
.nt-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.nt-chip {
  all: unset;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px 0 8px;
  border-radius: var(--nt-radius-full);
  background: color-mix(in srgb, var(--nt-chip) 22%, var(--nt-background));
  color: var(--nt-foreground);
  font-family: var(--nt-font-family);
  font-size: var(--nt-body-font-size);
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
}
.nt-chip:hover {
  background: color-mix(in srgb, var(--nt-chip) 40%, var(--nt-background));
}
.nt-chip[aria-pressed='true'] {
  background: color-mix(in srgb, var(--nt-chip) 34%, var(--nt-background));
  box-shadow: inset 0 0 0 2px var(--nt-chip);
  font-weight: 600;
}
.nt-chip-dot {
  width: 14px;
  height: 14px;
  flex: none;
  border-radius: 50%;
  background: var(--nt-chip);
}
.nt-round {
  all: unset;
  box-sizing: border-box;
  width: 30px;
  height: 30px;
  flex: none;
  display: inline-grid;
  place-items: center;
  border-radius: 50%;
  cursor: pointer;
}
.nt-round-accent {
  background: var(--nt-primary);
  color: var(--nt-primary-foreground);
}
.nt-round-accent[aria-pressed='true'] {
  box-shadow: 0 0 0 2px var(--nt-background), 0 0 0 4px var(--nt-primary);
}
.nt-round-soft {
  background: var(--nt-canvas);
  color: var(--nt-subtle-foreground);
}
.nt-round-soft:hover {
  background: var(--nt-hover);
}
.nt-chip:focus-visible, .nt-round:focus-visible, .nt-save:focus-visible, .nt-comment-editor:focus-visible {
  outline: 2px solid var(--nt-ring);
  outline-offset: 2px;
}
.nt-editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.nt-comment-editor {
  all: unset;
  box-sizing: border-box;
  display: block;
  width: 100%;
  min-height: calc(2lh + 20px);
  max-height: 160px;
  overflow: auto;
  padding: 10px 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--nt-font-family);
  font-size: var(--nt-body-font-size);
  font-weight: var(--nt-body-font-weight);
  line-height: var(--nt-body-line-height);
  color: var(--nt-foreground);
  background: var(--nt-canvas);
  border-radius: 12px;
  cursor: text;
}
.nt-comment-editor::placeholder {
  color: var(--nt-subtle-foreground);
}
.nt-editor-foot {
  display: flex;
  align-items: center;
  gap: 8px;
}
.nt-editor-hint {
  margin-left: auto;
  font-family: var(--nt-font-family);
  font-size: var(--nt-caption-font-size);
  line-height: var(--nt-caption-line-height);
  color: var(--nt-subtle-foreground);
}
.nt-save {
  all: unset;
  box-sizing: border-box;
  height: 32px;
  padding: 0 18px;
  display: inline-flex;
  align-items: center;
  border-radius: var(--nt-radius-full);
  background: var(--nt-primary);
  color: var(--nt-primary-foreground);
  font-family: var(--nt-font-family);
  font-size: var(--nt-body-font-size);
  font-weight: 600;
  cursor: pointer;
}
`
