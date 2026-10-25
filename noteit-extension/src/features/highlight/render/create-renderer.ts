// Renderer selection (architecture.md D7, Story 4.6): the build flag VITE_RENDERER picks the engine.
// `mark` (default) keeps MarkRenderer; `highlight-api` uses the CSS Custom Highlight API spike and falls
// back to MarkRenderer when the browser lacks the API. The default is the Story 4.7 decision recorded in
// architecture.md "M3 Spike Result"; tests/spike/spike.test.ts keeps it in sync with spike-report.json.
import { HighlightApiRenderer, highlightApiSupported } from './highlight-api-renderer.ts'
import { MarkRenderer } from './mark-renderer.ts'
import type { Renderer } from './renderer.ts'

export const RENDERER_KINDS = ['mark', 'highlight-api'] as const
export type RendererKind = (typeof RENDERER_KINDS)[number]

/** Default engine when VITE_RENDERER is unset (Story 4.7 decision). */
export const DEFAULT_RENDERER: RendererKind = 'mark'

/** Renderer kind for a raw flag value; anything unknown or empty means DEFAULT_RENDERER. */
export function rendererKind(flag: string | undefined): RendererKind {
  return (RENDERER_KINDS as readonly string[]).includes(flag ?? '') ? (flag as RendererKind) : DEFAULT_RENDERER
}

/** Renderer chosen at build time (VITE_RENDERER). */
export const BUILD_RENDERER: RendererKind = rendererKind(import.meta.env.VITE_RENDERER)

export function createRenderer(kind: RendererKind = BUILD_RENDERER): Renderer {
  if (kind === 'highlight-api' && highlightApiSupported()) return new HighlightApiRenderer()
  return new MarkRenderer()
}
