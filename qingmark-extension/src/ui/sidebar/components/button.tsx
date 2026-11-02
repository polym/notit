// shadcn Button, trimmed to the variants the side panel uses and styled only with token utilities
// (DESIGN.md "Components": shadcn inherited as-is, tokens swapped). Kept dependency-free: no cva,
// clsx or Radix Slot, since none is pinned in architecture.md.
import type { ButtonHTMLAttributes, Ref } from 'react'

type Variant = 'default' | 'outline'

const VARIANTS: Record<Variant, string> = {
  // Primary: {colors.primary} fill, {colors.primary-foreground} text.
  default: 'bg-primary text-primary-foreground',
  // button-outline: 1px {colors.border-strong}, white background, hover {colors.hover}.
  outline: 'border border-input bg-background text-foreground hover:bg-hover',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  ref?: Ref<HTMLButtonElement>
}

export function Button({ variant = 'default', className = '', style, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 rounded whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${className}`}
      style={{
        fontSize: 'var(--nt-label-font-size)',
        fontWeight: 'var(--nt-label-font-weight)',
        lineHeight: 'var(--nt-label-line-height)',
        ...style,
      }}
      {...props}
    />
  )
}
