import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '../../../core/db/schema.ts'
import { HandlerError } from '../../../core/messaging/index.ts'
import {
  cachedSignedIn,
  isSignedIn,
  requireAuth,
  setCachedSignedIn,
  setSignedInChangeListener,
  setSignedInSource,
} from './auth-gate.ts'
import { broadcastAuthChanged } from './broadcast.ts'

const PAGE = 'https://example.com/post'

function installChromeMock() {
  const chromeMock = {
    runtime: { id: 'ext' },
    storage: { local: { get: vi.fn(async () => ({})) } },
    tabs: {
      query: vi.fn(async () => [{ id: 1, url: PAGE }] as chrome.tabs.Tab[]),
      sendMessage: vi.fn(async () => {}),
    },
    action: { setBadgeText: vi.fn(async () => {}), setBadgeBackgroundColor: vi.fn(async () => {}) },
  }
  vi.stubGlobal('chrome', chromeMock)
  return chromeMock
}

describe('login gate sign-in cache', () => {
  beforeEach(async () => {
    await Promise.all(getDb().tables.map((t) => t.clear()))
  })
  afterEach(() => {
    setSignedInChangeListener(null)
    setCachedSignedIn(null)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('a create that finds the session gone tells open tabs signedIn:false through page/sync', async () => {
    const chromeMock = installChromeMock()
    setSignedInChangeListener((signedIn) => void broadcastAuthChanged(signedIn))
    setCachedSignedIn(true)
    // The session was revoked without core/auth emitting auth/changed.
    setSignedInSource(async () => false)
    const create = vi.fn(async () => 'created')
    const gated = requireAuth({ 'highlight/create': create } as never) as Record<string, (r: unknown, s: unknown) => Promise<unknown>>

    await expect(gated['highlight/create']({}, {})).rejects.toBeInstanceOf(HandlerError)
    expect(create).not.toHaveBeenCalled()
    expect(cachedSignedIn()).toBe(false)
    await vi.waitFor(() =>
      expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(1, {
        kind: 'noteit/event',
        type: 'page/sync',
        payload: expect.objectContaining({ canonicalUrl: PAGE, signedIn: false }),
      }),
    )
  })

  it('notifies only on a change, not on the first warm-up read or a repeated value', async () => {
    const listener = vi.fn()
    setSignedInChangeListener(listener)
    setCachedSignedIn(null)
    setSignedInSource(async () => false)
    await isSignedIn()
    await isSignedIn()
    expect(listener).not.toHaveBeenCalled()
    setSignedInSource(async () => true)
    await isSignedIn()
    expect(listener).toHaveBeenCalledExactlyOnceWith(true)
  })
})
