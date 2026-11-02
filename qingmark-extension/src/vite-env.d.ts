/// <reference types="vite/client" />

// Build-time Supabase config (public values, architecture.md "Authentication & Security").
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  /** Highlight renderer (Story 4.6): 'mark' (default) or 'highlight-api'. */
  readonly VITE_RENDERER?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
