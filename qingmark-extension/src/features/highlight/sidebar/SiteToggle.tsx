// site-toggle in the sidebar-header (Story 3.6, FR18; DESIGN.md "site-toggle": 24 x 14 pill, on
// {colors.primary}, off {colors.subtle-foreground}, 10px white knob). Disabled on pages the extension
// does not support and until the service worker has answered.
import { strings } from '../../../ui/strings.ts'
import { useActiveTab } from './useCurrentPage.ts'
import { useSiteState } from './useSiteState.ts'

export function SiteToggle() {
  const tab = useActiveTab()
  const { status, setEnabled } = useSiteState(tab.url)
  const on = status === 'on'
  const disabled = status === 'loading' || status === 'unsupported'
  const label = on ? strings.siteOn : strings.siteOff

  return (
    <span data-testid="site-toggle-row" className="flex items-center" style={{ gap: 'var(--nt-space-1-5)' }}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        data-testid="site-toggle"
        disabled={disabled}
        onClick={() => void setEnabled(!on)}
        className={`relative shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 ${
          on ? 'bg-primary' : 'bg-subtle-foreground'
        }`}
        style={{ width: 24, height: 14, padding: 0, border: 0 }}
      >
        <span
          aria-hidden="true"
          className="absolute rounded-full bg-background"
          style={{ top: 2, left: on ? 12 : 2, width: 10, height: 10 }}
        />
      </button>
      <span data-testid="site-toggle-text">{label}</span>
    </span>
  )
}
