// Story 3.5 review fix: useActiveTab follows only the panel's own window. Two windows each have an
// active tab; a navigation or title change in the other window must not replace this panel's page.
import { afterEach, beforeAll, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

type UpdatedListener = (tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => void

const PANEL_WINDOW = 1
const OTHER_WINDOW = 2

// Active tab per window; tabs.query({ currentWindow: true }) answers for the panel's window.
const activeByWindow = new Map<number, chrome.tabs.Tab>()
let updatedListeners: UpdatedListener[] = []

const makeTab = (id: number, windowId: number, url: string, title: string): chrome.tabs.Tab =>
  ({ id, windowId, url, title, active: true }) as chrome.tabs.Tab

function stubChrome(): void {
  const noop = () => {}
  const event = { addListener: noop, removeListener: noop }
  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    tabs: {
      query: () => {
        const tab = activeByWindow.get(PANEL_WINDOW)
        return Promise.resolve(tab ? [tab] : [])
      },
      onActivated: event,
      onUpdated: {
        addListener: (l: UpdatedListener) => updatedListeners.push(l),
        removeListener: (l: UpdatedListener) => (updatedListeners = updatedListeners.filter((x) => x !== l)),
      },
    },
  }
}

let useActiveTab: typeof import('../../src/features/highlight/sidebar/useCurrentPage.ts').useActiveTab
let root: Root | null = null
let container: HTMLElement | null = null

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeAll(async () => {
  stubChrome()
  ;({ useActiveTab } = await import('../../src/features/highlight/sidebar/useCurrentPage.ts'))
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  activeByWindow.clear()
  updatedListeners = []
  document.body.replaceChildren()
})

// Renders the hook result as JSON so the test reads it from the DOM.
function Probe() {
  return <output>{JSON.stringify(useActiveTab())}</output>
}

const seen = (): unknown => JSON.parse(container!.querySelector('output')!.textContent ?? '')

async function mount(): Promise<void> {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root!.render(<Probe />))
}

async function fireUpdated(tab: chrome.tabs.Tab, changeInfo: chrome.tabs.OnUpdatedInfo): Promise<void> {
  await act(async () => {
    for (const l of updatedListeners) l(tab.id!, changeInfo, tab)
  })
}

it('ignores url and title updates of another window active tab', async () => {
  activeByWindow.set(PANEL_WINDOW, makeTab(10, PANEL_WINDOW, 'https://a.example/post', 'A post'))
  activeByWindow.set(OTHER_WINDOW, makeTab(20, OTHER_WINDOW, 'https://b.example/', 'B home'))
  await mount()
  expect(seen()).toEqual({ url: 'https://a.example/post', tabTitle: 'A post' })

  const other = makeTab(20, OTHER_WINDOW, 'https://b.example/next', '(3) B inbox')
  activeByWindow.set(OTHER_WINDOW, other)
  await fireUpdated(other, { url: other.url, title: other.title })
  expect(seen()).toEqual({ url: 'https://a.example/post', tabTitle: 'A post' })
})

it('follows url and title updates of the panel window active tab', async () => {
  activeByWindow.set(PANEL_WINDOW, makeTab(10, PANEL_WINDOW, 'https://a.example/post', 'A post'))
  await mount()

  const own = makeTab(10, PANEL_WINDOW, 'https://a.example/other', 'A other')
  activeByWindow.set(PANEL_WINDOW, own)
  await fireUpdated(own, { url: own.url })
  expect(seen()).toEqual({ url: 'https://a.example/other', tabTitle: 'A other' })

  const retitled = makeTab(10, PANEL_WINDOW, 'https://a.example/other', '(1) A other')
  activeByWindow.set(PANEL_WINDOW, retitled)
  await fireUpdated(retitled, { title: retitled.title })
  expect(seen()).toEqual({ url: 'https://a.example/other', tabTitle: '(1) A other' })
})
