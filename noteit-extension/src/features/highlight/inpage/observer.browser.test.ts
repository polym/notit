import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HighlightRecord } from '../../../core/model/index.ts'
import { createTextIndex } from '../anchoring/text-index.ts'
import { describeSelection } from '../anchoring/describe.ts'
import { MarkRenderer } from '../render/mark-renderer.ts'
import { OBSERVER_DEBOUNCE_MS, OBSERVER_MAX_WAIT_MS, PageObserver } from './observer.ts'
import { runRestorePass } from './restore-pass.ts'

const STYLE = { color: 'yellow', commented: false } as const
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const settle = () => wait(OBSERVER_DEBOUNCE_MS + 100)

let observer: PageObserver | null = null
afterEach(() => {
  observer?.stop()
  observer = null
  document.body.replaceChildren()
  document.querySelector('noteit-root')?.remove()
})

function record(id: string, text: string): HighlightRecord {
  const index = createTextIndex()
  const at = index.text.indexOf(text)
  const anchor = describeSelection(index, index.offsetsToRange(at, at + text.length)!)
  return {
    id,
    userId: 'u',
    canonicalUrl: 'https://example.test/',
    siteKey: 'example.test',
    url: 'https://example.test/',
    text,
    color: 'yellow',
    comment: null,
    anchor,
    pageTitle: null,
    favicon: null,
    createdAt: 0,
    editedAt: 0,
    deviceId: 'd',
    deletedAt: null,
    schemaVersion: 1,
  }
}

function setup() {
  const paragraphs = Array.from({ length: 30 }, (_, i) => `<p id="p${i}">Paragraph ${i} says <b>something</b> number ${i}.</p>`)
  document.body.innerHTML = `<main>${paragraphs.join('')}</main>`
  const renderer = new MarkRenderer()
  const records = Array.from({ length: 30 }, (_, i) => record(`h${i}`, `says something number ${i}.`))
  const changes: number[] = []
  observer = new PageObserver({ isOwnMutation: (r) => renderer.isOwnMutation(r), onChange: () => changes.push(Date.now()) })
  observer.start()
  return { renderer, records, changes, observer }
}

describe('PageObserver', () => {
  it('ignores mutations from the renderer own paints, restyles and removals (count)', async () => {
    const { renderer, records, changes, observer } = setup()
    let builds = 0
    const result = await runRestorePass(records, { renderer, styleOf: () => STYLE, onIndexBuilt: () => builds++ })
    expect(result).toMatchObject({ resolved: 30, painted: 30, completed: true })
    expect(builds).toBe(1)
    renderer.restyle('h3', { color: 'blue', commented: true })
    renderer.flash('h4')
    renderer.remove('h5')
    await settle()
    expect(observer.foreignMutations).toBe(0)
    expect(changes).toHaveLength(0)
  })

  it('ignores the shadow host and NoteIt nodes but reacts to page changes after a 300ms quiet period', async () => {
    const { changes, observer } = setup()
    const host = document.createElement('noteit-root')
    document.body.append(host)
    await wait(0)
    const before = observer.foreignMutations
    host.append(document.createElement('div'))
    const error = Object.assign(document.createElement('div'), { id: 'noteit-error' })
    document.body.append(error)
    await settle()
    expect(observer.foreignMutations).toBe(before)

    const started = Date.now()
    document.getElementById('p1')!.append(' more')
    await wait(OBSERVER_DEBOUNCE_MS / 2)
    document.getElementById('p2')!.firstChild!.textContent = 'Changed text '
    await settle()
    expect(changes).toHaveLength(1)
    expect(changes[0] - started).toBeGreaterThanOrEqual(OBSERVER_DEBOUNCE_MS)
  })

  it('treats a host rewrite of a highlighted element as foreign and repaints it', async () => {
    const { renderer, records, changes, observer } = setup()
    await runRestorePass(records, { renderer, styleOf: () => STYLE })
    await settle()
    const p = document.getElementById('p4')!
    expect(p.querySelector('mark')).not.toBeNull()
    // Same text, but the marks (and the split text nodes) are replaced by one fresh text node.
    const flat = p.textContent
    p.textContent = flat
    await settle()
    expect(observer.foreignMutations).toBeGreaterThan(0)
    expect(changes).toHaveLength(1)
    expect(renderer.isPainted('h4')).toBe(false)
    const pending = records.filter((r) => !renderer.isPainted(r.id))
    expect(pending.map((r) => r.id)).toEqual(['h4'])
    const result = await runRestorePass(pending, { renderer, styleOf: () => STYLE })
    expect(result.painted).toBe(1)
    const marks = Array.from(p.querySelectorAll('mark[data-noteit-id="h4"]'))
    expect(marks.map((m) => m.textContent).join('')).toBe('says something number 4.')
  })

  it('treats a host text edit inside a painted paragraph as foreign', async () => {
    const { renderer, records, changes } = setup()
    await runRestorePass(records, { renderer, styleOf: () => STYLE })
    await settle()
    const text = document.getElementById('p6')!.firstChild as Text
    text.data = 'Paragraph 6 now '
    await settle()
    expect(changes).toHaveLength(1)
  })

  it('re-resolves only records whose range is gone after a node leaves and comes back', async () => {
    const { renderer, records, changes } = setup()
    await runRestorePass(records, { renderer, styleOf: () => STYLE })
    await settle()
    const main = document.querySelector('main')!
    const row = document.getElementById('p7')!
    // Virtual list: the row is replaced by a fresh copy without marks.
    const fresh = document.createElement('p')
    fresh.id = 'p7'
    fresh.innerHTML = 'Paragraph 7 says <b>something</b> number 7.'
    main.replaceChild(fresh, row)
    await settle()
    expect(changes).toHaveLength(1)
    const pending = records.filter((r) => !renderer.isPainted(r.id))
    expect(pending.map((r) => r.id)).toEqual(['h7'])
    let builds = 0
    const result = await runRestorePass(pending, { renderer, styleOf: () => STYLE, onIndexBuilt: () => builds++ })
    expect(result).toMatchObject({ resolved: 1, painted: 1 })
    expect(builds).toBe(1)
    expect(fresh.querySelector('mark[data-noteit-id="h7"]')).not.toBeNull()
    expect(records.every((r) => renderer.isPainted(r.id))).toBe(true)
  })
})

describe('PageObserver max wait', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs onChange while mutations keep arriving every 100ms for 2s', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<p id="clock">0</p>'
    const fired: number[] = []
    observer = new PageObserver({ isOwnMutation: () => false, onChange: () => fired.push(Date.now()) })
    observer.start()
    const clock = document.getElementById('clock')!.firstChild as Text
    const started = Date.now()
    for (let tick = 1; tick <= 20; tick++) {
      clock.data = String(tick)
      // MutationObserver callbacks are microtasks; flush them before advancing the fake clock.
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(100)
    }
    expect(fired.length).toBeGreaterThanOrEqual(1)
    expect(fired[0] - started).toBeLessThanOrEqual(OBSERVER_MAX_WAIT_MS)
  })
})

describe('runRestorePass', () => {
  it('skips a hit whose text changed between the resolve and paint slices', async () => {
    const { renderer, records } = setup()
    let slices = 0
    const result = await runRestorePass(records, {
      renderer,
      styleOf: () => STYLE,
      yieldFn: async () => {
        slices++
        // After the resolve slices (30 records, 10 per slice), the host edits one paragraph in place.
        if (slices === 4) (document.querySelector('#p9 b')!.firstChild as Text).data = 'SOMETHING'
      },
    })
    expect(result).toMatchObject({ resolved: 30, painted: 29, completed: true })
    expect(renderer.isPainted('h9')).toBe(false)
    expect(document.querySelector('mark[data-noteit-id="h9"]')).toBeNull()
  })

  it('paints overlapping and adjacent highlights correctly across chunks', async () => {
    document.body.innerHTML = '<p>alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu</p>'
    const renderer = new MarkRenderer()
    const words = ['alpha beta', 'beta gamma', 'gamma delta', 'epsilon', 'zeta', 'eta theta iota', 'iota kappa', 'lambda', 'mu']
    const extra = Array.from({ length: 12 }, (_, i) => `x${i}`)
    document.body.insertAdjacentHTML('beforeend', extra.map((w) => `<p>word ${w} end</p>`).join(''))
    const records = [...words, ...extra.map((w) => `word ${w} end`)].map((w, i) => record(`r${i}`, w))
    const result = await runRestorePass(records, { renderer, styleOf: () => STYLE })
    expect(result.completed).toBe(true)
    expect(result.painted).toBe(records.length)
    for (const r of records) {
      const marks = Array.from(document.querySelectorAll(`mark[data-noteit-id="${r.id}"]`))
      expect(marks.map((m) => m.textContent).join('')).toBe(r.text)
    }
  })

  it('skips records removed meanwhile and stops when cancelled', async () => {
    const { renderer, records } = setup()
    const removed = new Set(['h1', 'h2'])
    const first = await runRestorePass(records, { renderer, styleOf: (id) => (removed.has(id) ? null : STYLE) })
    expect(first.painted).toBe(28)
    renderer.clear()
    let slices = 0
    const second = await runRestorePass(records, {
      renderer,
      styleOf: () => STYLE,
      yieldFn: async () => {
        slices++
      },
      cancelled: () => slices > 3,
    })
    expect(second.completed).toBe(false)
    expect(second.painted).toBeLessThan(30)
  })
})
