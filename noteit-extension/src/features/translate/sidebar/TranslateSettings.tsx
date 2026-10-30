// translate-settings (spec "selection translation"): a disclosure row in the side panel, shown on the
// login page and in the account panel so translation works signed in or out. Fields: base URL, model,
// API key (masked, never prefilled: the worker only returns its last 4 characters). "Test" sends one
// tiny lookup; "Save" asks Chrome for the provider origin inside the click and saves in parallel, so
// a permission prompt left open never blocks the save.
import { useEffect, useState, type KeyboardEvent } from 'react'
import { createClient } from '../../../core/messaging/index.ts'
import type { ErrorCode } from '../../../core/messaging/index.ts'
import { strings, translateErrorText } from '../../../ui/strings.ts'
import { Button } from '../../../ui/sidebar/components/button.tsx'
import { Input } from '../../../ui/sidebar/components/input.tsx'
import type { TranslateConfigView, TranslateRequests } from '../shared/protocol.ts'

const translateClient = createClient<TranslateRequests>()

const META_STYLE = {
  fontSize: 'var(--nt-meta-font-size)',
  fontWeight: 'var(--nt-meta-font-weight)',
  lineHeight: 'var(--nt-meta-line-height)',
} as const
const ACTION_STYLE = { height: 28, padding: '0 var(--nt-space-2-5)' } as const
const PANEL_ID = 'noteit-translate-panel'

type Request =
  | { kind: 'running'; what: 'test' | 'save' }
  | { kind: 'ok'; what: 'test' | 'save' }
  | { kind: 'error'; code: ErrorCode }
  | null

interface FieldErrors {
  baseUrl?: string
  model?: string
  apiKey?: string
}

/** Same rule as the worker: https, or http on localhost; no query or fragment. */
function validUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim())
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null
    return url.search || url.hash ? null : url
  } catch {
    return null
  }
}

/**
 * Asks for the provider origin. Must run synchronously inside the click (user gesture). Resolves
 * true when granted or not needed (http localhost is never an optional host permission).
 */
function requestOrigin(url: URL): Promise<boolean> {
  if (url.protocol !== 'https:' || !chrome.permissions?.request) return Promise.resolve(true)
  try {
    return chrome.permissions.request({ origins: [`${url.origin}/*`] }).catch(() => false)
  } catch {
    return Promise.resolve(false)
  }
}

function FieldError({ id, text }: { id: string; text?: string }) {
  if (!text) return null
  return (
    <p id={id} className="m-0 text-foreground" style={META_STYLE}>
      {text}
    </p>
  )
}

function statusText(request: Request): { role: 'status' | 'alert'; text: string } | null {
  if (request === null) return null
  if (request.kind === 'running') return { role: 'status', text: strings.translateTesting }
  if (request.kind === 'ok') return { role: 'status', text: request.what === 'test' ? strings.translateTestOk : strings.translateSaved }
  return { role: 'alert', text: translateErrorText(request.code) }
}

export function TranslateSettings() {
  const [view, setView] = useState<TranslateConfigView | null>(null)
  const [open, setOpen] = useState(false)
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [request, setRequest] = useState<Request>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const busy = request?.kind === 'running'

  useEffect(() => {
    let active = true
    void translateClient.send('translate/getConfig', undefined).then((result) => {
      if (active && result.ok) setView(result.data)
    })
    return () => {
      active = false
    }
  }, [])

  if (!view) return null

  const toggle = () => {
    setBaseUrl(view.baseUrl)
    setModel(view.model)
    setApiKey('')
    setShowKey(false)
    setErrors({})
    setRequest(null)
    setPermissionDenied(false)
    setOpen(!open)
  }

  /** Local checks shared by test and save; returns the parsed URL when every field is usable. */
  const checked = (): URL | null => {
    const url = validUrl(baseUrl)
    const next: FieldErrors = {}
    if (!url) next.baseUrl = strings.translateBaseUrlInvalid
    if (!model.trim()) next.model = strings.translateModelMissing
    if (!view.hasKey && !apiKey.trim()) next.apiKey = strings.translateKeyMissing
    setErrors(next)
    if (Object.keys(next).length > 0) setRequest(null)
    return Object.keys(next).length === 0 ? url : null
  }

  const input = () => ({ baseUrl: baseUrl.trim(), model: model.trim(), apiKey: apiKey.trim() || undefined })

  const test = async () => {
    const url = checked()
    if (busy || !url) return
    setRequest({ kind: 'running', what: 'test' })
    const result = await translateClient.send('translate/testConfig', input())
    setRequest(result.ok ? { kind: 'ok', what: 'test' } : { kind: 'error', code: result.error.code })
  }

  const save = () => {
    const url = checked()
    if (busy || !url) return
    // Started first, while the click's user gesture is still active; not awaited before saving.
    const granted = requestOrigin(url)
    setPermissionDenied(false)
    setRequest({ kind: 'running', what: 'save' })
    void granted.then((ok) => setPermissionDenied(!ok))
    void translateClient.send('translate/saveConfig', input()).then((result) => {
      if (!result.ok) {
        setRequest({ kind: 'error', code: result.error.code })
        return
      }
      setView(result.data)
      setApiKey('')
      setRequest({ kind: 'ok', what: 'save' })
    })
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && open) {
      event.stopPropagation()
      setOpen(false)
    }
  }

  const status = statusText(request)

  return (
    <section
      data-testid="translate-settings"
      onKeyDown={onKeyDown}
      className="flex flex-col border-t border-border bg-background text-foreground"
      style={{ padding: 'var(--nt-space-2-5) var(--nt-space-header-x) 24px', gap: 'var(--nt-space-2-5)' }}
    >
      <button
        type="button"
        data-testid="translate-toggle"
        aria-expanded={open}
        aria-controls={open ? PANEL_ID : undefined}
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
          style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 150ms' }}
        >
          <path d="M6 3l5 5-5 5" />
        </svg>
        <span>{strings.translateSettings}</span>
        <span data-testid="translate-state" className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-foreground">
          {view.hasKey && view.keyHint ? strings.translateConfigured(view.keyHint) : strings.translateNotConfigured}
        </span>
      </button>

      {open && (
        <form
          id={PANEL_ID}
          noValidate
          aria-label={strings.translateSettings}
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
          className="flex flex-col"
          style={{ gap: 'var(--nt-space-2-5)' }}
        >
          <p data-testid="translate-privacy" className="m-0 text-muted-foreground" style={META_STYLE}>
            {strings.translatePrivacyNote}
          </p>
          <div className="flex flex-col" style={{ gap: 'var(--nt-space-1)' }}>
            <label htmlFor="noteit-translate-url" className="text-muted-foreground" style={META_STYLE}>
              {strings.translateBaseUrl}
            </label>
            <Input
              id="noteit-translate-url"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={baseUrl}
              aria-invalid={errors.baseUrl ? true : undefined}
              aria-describedby={errors.baseUrl ? 'noteit-translate-url-error' : undefined}
              onChange={(e) => {
                setBaseUrl(e.target.value)
                setRequest(null)
              }}
            />
            <FieldError id="noteit-translate-url-error" text={errors.baseUrl} />
          </div>
          <div className="flex flex-col" style={{ gap: 'var(--nt-space-1)' }}>
            <label htmlFor="noteit-translate-model" className="text-muted-foreground" style={META_STYLE}>
              {strings.translateModel}
            </label>
            <Input
              id="noteit-translate-model"
              autoComplete="off"
              spellCheck={false}
              value={model}
              aria-invalid={errors.model ? true : undefined}
              aria-describedby={errors.model ? 'noteit-translate-model-error' : undefined}
              onChange={(e) => {
                setModel(e.target.value)
                setRequest(null)
              }}
            />
            <FieldError id="noteit-translate-model-error" text={errors.model} />
          </div>
          <div className="flex flex-col" style={{ gap: 'var(--nt-space-1)' }}>
            <label htmlFor="noteit-translate-key" className="text-muted-foreground" style={META_STYLE}>
              {strings.translateApiKey}
            </label>
            <div className="relative">
              <Input
                id="noteit-translate-key"
                type={showKey ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                value={apiKey}
                placeholder={view.hasKey ? strings.translateApiKeyKeep : undefined}
                aria-invalid={errors.apiKey ? true : undefined}
                aria-describedby={errors.apiKey ? 'noteit-translate-key-error' : undefined}
                onChange={(e) => {
                  setApiKey(e.target.value)
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
            <FieldError id="noteit-translate-key-error" text={errors.apiKey} />
          </div>
          {permissionDenied && (
            <p data-testid="translate-permission" role="note" className="m-0 text-muted-foreground" style={META_STYLE}>
              {strings.translatePermissionDenied}
            </p>
          )}
          <div className="flex items-center justify-between" style={{ gap: 'var(--nt-space-2)' }}>
            <p data-testid="translate-status" role={status?.role} className="m-0 min-w-0 text-foreground" style={META_STYLE}>
              {status?.text}
            </p>
            <div className="flex shrink-0 items-center" style={{ gap: 'var(--nt-space-1-5)' }}>
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
