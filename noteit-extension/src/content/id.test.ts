import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateId } from './id'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('generateId', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns an RFC 4122 v4 id', () => {
    expect(generateId()).toMatch(UUID_V4)
  })

  it('falls back to getRandomValues when randomUUID is unavailable', () => {
    const getRandomValues = <T extends ArrayBufferView>(array: T): T => {
      new Uint8Array(array.buffer).fill(0xff)
      return array
    }
    vi.stubGlobal('crypto', { getRandomValues })
    const id = generateId()
    expect(id).toMatch(UUID_V4)
    expect(id).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
  })

  it('has fake-indexeddb available in the unit project', () => {
    expect(typeof indexedDB.open).toBe('function')
  })
})
