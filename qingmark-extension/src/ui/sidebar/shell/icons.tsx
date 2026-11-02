// Header line icons (DESIGN.md "Iconography": 1.3-1.8px strokes, currentColor). Decorative: the
// buttons that use them carry an aria-label.
export function SyncIcon() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 0 0-15-6.7L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 15 6.7l3-2.7" />
      <path d="M16 16h5v5" />
    </svg>
  )
}

export function AccountIcon() {
  return (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <circle cx="8" cy="6" r="2.6" />
      <path d="M3 13.5c.8-2.4 2.8-3.5 5-3.5s4.2 1.1 5 3.5" />
    </svg>
  )
}
