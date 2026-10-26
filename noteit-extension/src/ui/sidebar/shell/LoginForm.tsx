// login-form (Story 3.4, FR26, Q62, Q63; DESIGN.md "Components", mockups/key-login.html).
// Email + password + full-width primary button, no sign-up or recovery link. Enter submits; while the
// request runs the button is disabled and shows a spinner. Wrong credentials clear the password,
// a network failure keeps it; the email is always kept.
import { useState, type FormEvent } from 'react'
import type { AuthState } from '../../../core/auth/protocol.ts'
import { errorText, strings } from '../../strings.ts'
import { Button } from '../components/button.tsx'
import { Input } from '../components/input.tsx'
import { authClient } from './auth.ts'

const LABEL_STYLE = {
  fontSize: 'var(--nt-meta-font-size)',
  fontWeight: 'var(--nt-meta-font-weight)',
  lineHeight: 'var(--nt-meta-line-height)',
} as const

function Spinner() {
  return (
    <svg
      aria-hidden="true"
      data-testid="login-spinner"
      className="animate-spin"
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <path d="M8 2a6 6 0 1 1-6 6" />
    </svg>
  )
}

function Field({ id, label, ...input }: { id: string; label: string } & Parameters<typeof Input>[0]) {
  return (
    <div className="flex flex-col" style={{ gap: 'var(--nt-space-1)' }}>
      <label htmlFor={id} className="text-muted-foreground" style={LABEL_STYLE}>
        {label}
      </label>
      <Input id={id} required {...input} />
    </div>
  )
}

// disabled: no Supabase server is configured yet (spec "login-supabase-config"), so sign-in cannot work.
export function LoginForm({ onSignedIn, disabled = false }: { onSignedIn: (state: AuthState) => void; disabled?: boolean }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (disabled || submitting || !email.trim() || !password) return
    setSubmitting(true)
    setError(null)
    const result = await authClient.send('auth/login', { email: email.trim(), password })
    setSubmitting(false)
    if (result.ok) {
      onSignedIn(result.data)
      return
    }
    const invalid = result.error.code === 'unauthenticated'
    setError(invalid ? strings.loginInvalidCredentials : errorText(result.error.code))
    if (invalid) setPassword('')
  }

  return (
    <form
      data-testid="login-form"
      aria-label={strings.loginSubmit}
      noValidate
      onSubmit={(e) => void submit(e)}
      className="flex flex-col bg-background text-foreground"
      style={{ padding: '24px var(--nt-space-header-x)', gap: 'var(--nt-space-2-5)' }}
    >
      <Field
        id="noteit-login-email"
        label={strings.loginEmail}
        type="email"
        autoComplete="username"
        autoFocus={!disabled}
        disabled={disabled}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Field
        id="noteit-login-password"
        label={strings.loginPassword}
        type="password"
        autoComplete="current-password"
        disabled={disabled}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Button
        type="submit"
        className="w-full"
        style={{ height: '30px', marginTop: 'var(--nt-space-1)' }}
        disabled={disabled || submitting}
        aria-busy={submitting}
      >
        {submitting && <Spinner />}
        {strings.loginSubmit}
      </Button>
      {error && (
        <p role="alert" className="m-0 text-foreground" style={LABEL_STYLE}>
          {error}
        </p>
      )}
    </form>
  )
}
