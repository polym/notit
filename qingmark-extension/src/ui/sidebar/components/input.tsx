// shadcn Input styled with token utilities (DESIGN.md login-form: 30px high, 1px border-strong,
// {rounded.DEFAULT}, {typography.body}).
import type { InputHTMLAttributes } from 'react'

export function Input({ className = '', style, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded border border-input bg-background text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:opacity-60 ${className}`}
      style={{
        height: '30px',
        padding: '0 var(--nt-space-2)',
        fontSize: 'var(--nt-body-font-size)',
        lineHeight: 'var(--nt-body-line-height)',
        ...style,
      }}
      {...props}
    />
  )
}
