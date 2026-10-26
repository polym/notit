// Story 3.3 module boundary test (FR25, NFR24): the shell built with the real highlight module plus
// a fake second module (tests/sidebar/features/fake) shows two module tabs and switches between them.
// scripts/check-highlight-untouched.ts asserts src/features/highlight has no diff for this change.
import { afterEach, beforeAll, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { SidebarModule } from '../../src/ui/sidebar/shell/index.ts'
import { fakeModule } from './features/fake/index.ts'

// Minimal extension API stub: the highlight module asks auth/getState on mount, queries the active
// tab and subscribes to events. Every request fails, so it settles on an empty view.
function stubChrome(): void {
  const noop = () => {}
  const event = { addListener: noop, removeListener: noop }
  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      id: 'test-extension',
      sendMessage: () => Promise.reject(new Error('no service worker in this test')),
      onMessage: event,
    },
    tabs: { query: () => Promise.resolve([]), sendMessage: noop, onActivated: event, onUpdated: event },
    storage: { onChanged: { addListener: noop, removeListener: noop } },
  }
}

let Shell: typeof import('../../src/ui/sidebar/shell/index.ts').Shell
let highlightModule: SidebarModule
let root: Root | null = null

// React act() environment flag for a non-test-renderer root.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeAll(async () => {
  stubChrome()
  ;({ Shell } = await import('../../src/ui/sidebar/shell/index.ts'))
  ;({ highlightModule } = await import('../../src/features/highlight/sidebar.ts'))
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

async function render(modules: readonly SidebarModule[]): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root!.render(<Shell modules={modules} />))
  return container
}

const tabs = (c: HTMLElement) => [...c.querySelectorAll<HTMLButtonElement>('[role="tab"]')]

it('shows one tab per injected module and switches between them', async () => {
  const c = await render([highlightModule, fakeModule])

  expect(tabs(c).map((t) => t.textContent)).toEqual([highlightModule.label, fakeModule.label])
  expect(tabs(c).map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false'])
  expect(c.querySelector('[data-testid="fake-view"]')).toBeNull()

  await act(async () => tabs(c)[1].click())
  expect(tabs(c).map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true'])
  expect(c.querySelector('[data-testid="fake-view"]')).not.toBeNull()
  const panel = c.querySelector('[role="tabpanel"]')!
  expect(panel.getAttribute('aria-labelledby')).toBe(tabs(c)[1].id)

  await act(async () => tabs(c)[0].click())
  expect(c.querySelector('[data-testid="fake-view"]')).toBeNull()
})

it('moves between tabs with the arrow keys (roving tabindex)', async () => {
  const c = await render([highlightModule, fakeModule])
  tabs(c)[0].focus()
  await act(async () => {
    tabs(c)[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  })
  expect(document.activeElement).toBe(tabs(c)[1])
  expect(tabs(c).map((t) => t.tabIndex)).toEqual([-1, 0])
  expect(c.querySelector('[data-testid="fake-view"]')).not.toBeNull()
})

it('keeps the option A order with a single module: header, module tabs, content', async () => {
  const c = await render([highlightModule])
  const shell = c.querySelector('[data-testid="sidebar-shell"]')!
  expect([...shell.children].map((e) => e.getAttribute('data-testid'))).toEqual([
    'sidebar-header',
    'module-tabs',
    'module-content',
  ])
  expect(tabs(c).map((t) => t.textContent)).toEqual([highlightModule.label])
})
