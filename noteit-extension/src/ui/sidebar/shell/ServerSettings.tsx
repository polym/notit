// server-settings (spec "login-supabase-config", variant A): a disclosure row under the login form
// showing the active Supabase server and its source; expanding it edits the server in place. Without
// any config it is forced open. "Test" asks the worker to reach the server; "Save" validates and
// saves through the worker (auth/setConfig). The anon key never comes back to the panel.
import { useState, type KeyboardEvent } from 'react'
import { validateSupabaseConfig, type ConfigErrors, type ConfigSource, type SupabaseConfig } from '../../../core/auth/config.ts'
import type { ServerConfigState } from '../../../core/auth/protocol.ts'
import type { ErrorCode } from '../../../core/messaging/types.ts'
import { errorText, strings } from '../../strings.ts'
import { Button } from '../components/button.tsx'
import { Input } from '../components/input.tsx'
import { authClient } from './auth.ts'

const META_STYLE = {
  fontSize: 'var(--nt-meta-font-size)',
  fontWeight: 'var(--nt-meta-font-weight)',
  lineHeight: 'var(--nt-meta-line-height)',
} as const

const ACTION_STYLE = { height: 28, padding: '0 var(--nt-space-2-5)' } as const
const PANEL_ID = 'noteit-server-panel'

/** Progress of the last test / save / reset request. */
type Request = { kind: 'running' } | { kind: 'ok' } | { kind: 'error'; code: ErrorCode } | null

const URL_ERROR = { invalid: strings.serverUrlInvalid, insecure: strings.serverUrlInsecure } as const
const KEY_ERROR = { missing: strings.serverKeyMissing, invalid: strings.serverKeyInvalid, secret: strings.serverKeySecret } as const

// Neutral fills only: DESIGN.md keeps {colors.warning} for the sync failure icon.
const SOURCE_BADGE: Record<ConfigSource, { label: string; className: string }> = {
  user: { label: strings.serverSourceUser, className: 'bg-selected text-primary' },
  build: { label: strings.serverSourceBuild, className: 'bg-muted text-muted-foreground' },
  none: { label: strings.serverNotConfigured, className: 'bg-muted text-foreground' },
}

/** Status line text; a refused key gets its own copy, like the login form's credential error. */
function requestText(request: Request): { role: 'status' | 'alert'; text: string } | null {
  if (request === null) return null
  if (request.kind === 'running') return { role: 'status', text: strings.serverTesting }
  if (request.kind === 'ok') return { role: 'status', text: strings.serverTestOk }
  return { role: 'alert', text: request.code === 'unauthenticated' ? strings.serverTestRejected : errorText(request.code) }
}

function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, '')
}

function SourceBadge({ source }: { source: ConfigSource }) {
  const { label, className } = SOURCE_BADGE[source]
  return (
    <span
      data-testid="server-source"
      className={`shrink-0 rounded-full ${className}`}
      style={{ ...META_STYLE, padding: '0 var(--nt-space-2)' }}
    >
      {label}
    </span>
  )
}

function FieldError({ id, text }: { id: string; text: string | undefined }) {
  if (!text) return null
  return (
    <p id={id} className="m-0 text-foreground" style={META_STYLE}>
      {text}
    </p>
  )
}

export function ServerSettings({ config, onChange }: { config: ServerConfigState; onChange: (next: ServerConfigState) => void }) {
  const forced = config.source === 'none'
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState(config.url ?? '')
  const [anonKey, setAnonKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [errors, setErrors] = useState<ConfigErrors>({})
  const [request, setRequest] = useState<Request>(null)
  const expanded = open || forced
  const busy = request?.kind === 'running'

  const toggle = () => {
    if (forced) return
    // Each opening starts from the active server; the key is never prefilled.
    setUrl(config.url ?? '')
    setAnonKey('')
    setShowKey(false)
    setErrors({})
    setRequest(null)
    setOpen(!open)
  }

  /** Local validation shared by test and save; shows the field errors and returns the clean config. */
  const checked = (): SupabaseConfig | null => {
    const result = validateSupabaseConfig({ url, anonKey })
    setErrors(result.ok ? {} : result.errors)
    if (!result.ok) setRequest(null)
    return result.ok ? result.config : null
  }

  const test = async () => {
    const candidate = checked()
    if (busy || !candidate) return
    setRequest({ kind: 'running' })
    const result = await authClient.send('auth/testConfig', candidate)
    setRequest(result.ok ? { kind: 'ok' } : { kind: 'error', code: result.error.code })
  }

  const save = async () => {
    const candidate = checked()
    if (busy || !candidate) return
    setRequest({ kind: 'running' })
    const result = await authClient.send('auth/setConfig', candidate)
    if (!result.ok) {
      setRequest({ kind: 'error', code: result.error.code })
      return
    }
    setOpen(false)
    onChange({ url: result.data.url, source: 'user', hasBuildDefault: config.hasBuildDefault })
  }

  const reset = async () => {
    if (busy) return
    setRequest({ kind: 'running' })
    const result = await authClient.send('auth/resetConfig', undefined)
    if (!result.ok) {
      setRequest({ kind: 'error', code: result.error.code })
      return
    }
    setOpen(false)
    onChange({ url: result.data.url, source: result.data.source, hasBuildDefault: config.hasBuildDefault })
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && open && !forced) {
      event.stopPropagation()
      setOpen(false)
    }
  }

  const status = requestText(request)

  return (
    <section
      data-testid="server-settings"
      onKeyDown={onKeyDown}
      className="flex flex-col border-t border-border bg-background text-foreground"
      style={{ padding: 'var(--nt-space-2-5) var(--nt-space-header-x) 24px', gap: 'var(--nt-space-2-5)' }}
    >
      <button
        type="button"
        data-testid="server-toggle"
        aria-expanded={expanded}
        aria-controls={expanded ? PANEL_ID : undefined}
        aria-disabled={forced || undefined}
        onClick={toggle}
        className="flex w-full items-center rounded bg-transparent text-left text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        style={{ ...META_STYLE, gap: 'var(--nt-space-2)', border: 0, padding: 'var(--nt-space-0-5) 0' }}
      >
        <svg
          aria-hidden="true"
          width="10"
          height="10"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ transform: expanded ? 'rotate(90deg)' : undefined, transition: 'transform 150ms' }}
        >
          <path d="M6 3l5 5-5 5" />
        </svg>
        <span>{strings.server}</span>
        <span data-testid="server-url" className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-foreground">
          {config.url ? hostOf(config.url) : strings.serverNotConfigured}
        </span>
        <SourceBadge source={config.source} />
      </button>

      {expanded && (
        <form
          id={PANEL_ID}
          noValidate
          aria-label={strings.server}
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
          className="flex flex-col"
          style={{ gap: 'var(--nt-space-2-5)' }}
        >
          <div className="flex flex-col" style={{ gap: 'var(--nt-space-1)' }}>
            <label htmlFor="noteit-server-url" className="text-muted-foreground" style={META_STYLE}>
              {strings.serverUrl}
            </label>
            <Input
              id="noteit-server-url"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://xxxx.supabase.co"
              value={url}
              aria-invalid={errors.url ? true : undefined}
              aria-describedby={errors.url ? 'noteit-server-url-error' : undefined}
              onChange={(e) => {
                setUrl(e.target.value)
                setRequest(null)
              }}
            />
            <FieldError id="noteit-server-url-error" text={errors.url && URL_ERROR[errors.url]} />
          </div>
          <div className="flex flex-col" style={{ gap: 'var(--nt-space-1)' }}>
            <label htmlFor="noteit-server-key" className="text-muted-foreground" style={META_STYLE}>
              {strings.serverAnonKey}
            </label>
            <div className="relative">
              <Input
                id="noteit-server-key"
                type={showKey ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                value={anonKey}
                aria-invalid={errors.anonKey ? true : undefined}
                aria-describedby={errors.anonKey ? 'noteit-server-key-error' : undefined}
                onChange={(e) => {
                  setAnonKey(e.target.value)
                  setRequest(null)
                }}
                style={{ paddingRight: 44 }}
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                aria-pressed={showKey}
                className="absolute rounded bg-transparent text-subtle-foreground focus-visible:outline-2 focus-visible:outline-ring"
                style={{
                  ...META_STYLE,
                  right: 'var(--nt-space-1-5)',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  border: 0,
                  padding: '0 var(--nt-space-1)',
                }}
              >
                {showKey ? strings.serverHideKey : strings.serverShowKey}
              </button>
            </div>
            <FieldError id="noteit-server-key-error" text={errors.anonKey && KEY_ERROR[errors.anonKey]} />
          </div>
          <div className="flex items-center justify-between" style={{ gap: 'var(--nt-space-2)' }}>
            <p data-testid="server-test-status" role={status?.role} className="m-0 min-w-0 text-foreground" style={META_STYLE}>
              {status?.text}
            </p>
            <div className="flex shrink-0 items-center" style={{ gap: 'var(--nt-space-1-5)' }}>
              {config.source === 'user' && config.hasBuildDefault && (
                <Button variant="outline" onClick={() => void reset()} disabled={busy} aria-busy={busy} style={ACTION_STYLE}>
                  {strings.serverReset}
                </Button>
              )}
              <Button variant="outline" onClick={() => void test()} disabled={busy} aria-busy={busy} style={ACTION_STYLE}>
                {strings.serverTest}
              </Button>
              <Button type="submit" disabled={busy} aria-busy={busy} style={ACTION_STYLE}>
                {strings.serverSave}
              </Button>
            </div>
          </div>
        </form>
      )}
    </section>
  )
}
