// module-tab row (DESIGN.md "Components"): icon + label, 2px foreground underline on the selected
// tab. Shown even with a single module so adding one later does not shift the layout.
// WAI-ARIA tabs pattern: roving tabindex, Left / Right / Home / End move between tabs.
import type { KeyboardEvent } from 'react'
import { strings } from '../../strings.ts'
import { panelId, tabId } from './ids.ts'
import type { SidebarModule } from './types.ts'

export function ModuleTabs({
  modules,
  activeId,
  onSelect,
  hidden = false,
}: {
  modules: readonly SidebarModule[]
  activeId: string
  onSelect: (id: string) => void
  /** Hidden (not unmounted) while the account-panel replaces the content area. */
  hidden?: boolean
}) {
  const focusTab = (index: number) => {
    const next = modules[(index + modules.length) % modules.length]
    onSelect(next.id)
    document.getElementById(tabId(next.id))?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowRight') focusTab(index + 1)
    else if (event.key === 'ArrowLeft') focusTab(index - 1)
    else if (event.key === 'Home') focusTab(0)
    else if (event.key === 'End') focusTab(modules.length - 1)
    else return
    event.preventDefault()
  }

  return (
    <div
      role="tablist"
      aria-label={strings.moduleTabs}
      data-testid="module-tabs"
      hidden={hidden}
      className="flex border-b border-border bg-canvas"
      style={{ paddingInline: 'var(--nt-space-header-x)' }}
    >
      {modules.map((m, index) => {
        const selected = m.id === activeId
        const Icon = m.icon
        return (
          <button
            key={m.id}
            id={tabId(m.id)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId(m.id)}
            tabIndex={selected ? 0 : -1}
            data-testid={`module-tab-${m.id}`}
            onClick={() => onSelect(m.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={`flex items-center gap-1 border-b-2 bg-transparent focus-visible:outline-2 focus-visible:outline-ring ${
              selected ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground'
            }`}
            style={{
              padding: '6px 6px 5px',
              marginBottom: '-1px',
              fontSize: 'var(--nt-label-font-size)',
              fontWeight: 'var(--nt-label-font-weight)',
              lineHeight: 'var(--nt-label-line-height)',
            }}
          >
            <span aria-hidden="true" className="flex">
              <Icon />
            </span>
            {m.label}
          </button>
        )
      })}
    </div>
  )
}
