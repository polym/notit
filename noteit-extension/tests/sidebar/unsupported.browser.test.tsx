// Story 3.11 (FR44): with chrome.sidePanel undefined (Arc) the side panel shows only the fixed
// unsupported-notice; the auth gate, header, module tabs and content never render.
import { afterEach, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SupportGate, sidePanelSupported } from '../../src/ui/sidebar/shell/index.ts'
import { strings } from '../../src/ui/strings.ts'

let root: Root | null = null

// React act() environment flag for a non-test-renderer root.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function setChrome(value: unknown): void {
  ;(globalThis as unknown as { chrome: unknown }).chrome = value
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

async function render(): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () =>
    root!.render(
      <SupportGate>
        <div data-testid="app-content">app</div>
      </SupportGate>,
    ),
  )
  return container
}

it('detects the Side Panel API', () => {
  setChrome({ runtime: {}, sidePanel: undefined })
  expect(sidePanelSupported()).toBe(false)
  setChrome({ runtime: {}, sidePanel: { open: () => {} } })
  expect(sidePanelSupported()).toBe(true)
})

it('shows only the unsupported-notice when chrome.sidePanel is undefined', async () => {
  setChrome({ runtime: {}, sidePanel: undefined })
  const c = await render()
  const notice = c.querySelector('[data-testid="unsupported-notice"]')
  expect(notice?.textContent).toBe(strings.browserUnsupported)
  expect(c.querySelector('[data-testid="app-content"]')).toBeNull()
  // Not dismissible: nothing in it can be activated.
  expect(c.querySelectorAll('button, a, input, textarea')).toHaveLength(0)
})

it('renders the app and no notice when the Side Panel API exists', async () => {
  setChrome({ runtime: {}, sidePanel: { open: () => {} } })
  const c = await render()
  expect(c.querySelector('[data-testid="unsupported-notice"]')).toBeNull()
  expect(c.querySelector('[data-testid="app-content"]')).not.toBeNull()
})
