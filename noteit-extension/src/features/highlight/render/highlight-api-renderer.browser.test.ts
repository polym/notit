import { afterEach, describe, expect, it } from 'vitest'
import { describeSelection } from '../anchoring/describe.ts'
import { resolveAnchor } from '../anchoring/resolve.ts'
import { createTextIndex } from '../anchoring/text-index.ts'
import { createRenderer, rendererKind } from './create-renderer.ts'
import { FLASH_HIGHLIGHT_NAME, HighlightApiRenderer, highlightName } from './highlight-api-renderer.ts'
import { MarkRenderer } from './mark-renderer.ts'
import { HIGHLIGHT_FLASH_MS } from './renderer.ts'

const STYLE = { color: 'yellow', commented: false } as const

afterEach(() => {
  document.body.replaceChildren()
})

const rangeOf = (exact: string, occurrence = 0) => {
  const index = createTextIndex()
  let at = -1
  for (let i = 0; i <= occurrence; i++) at = index.text.indexOf(exact, at + 1)
  return index.offsetsToRange(at, at + exact.length)!
}

/** Viewport point inside the n-th character of `exact` (first occurrence). */
const pointAt = (exact: string, char: number) => {
  const index = createTextIndex()
  const at = index.text.indexOf(exact) + char
  const r = index.offsetsToRange(at, at + 1)!.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

const rangesIn = (name: string) => {
  const out: string[] = []
  CSS.highlights.get(name)?.forEach((range) => {
    const index = createTextIndex()
    const { start, end } = index.rangeToOffsets(range as Range)
    out.push(index.text.slice(start, end))
  })
  return out
}

describe('HighlightApiRenderer', () => {
  it('registers one Highlight per {color, commented} plus noteit-flash and never changes the DOM', async () => {
    document.body.innerHTML = '<p>alpha <b>beta</b> gamma delta</p>'
    const before = document.body.innerHTML
    const renderer = new HighlightApiRenderer()
    const seen: MutationRecord[] = []
    const observer = new MutationObserver((records) => seen.push(...records))
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true })
    renderer.paint('a', rangeOf('alpha beta'), STYLE)
    renderer.paint('b', rangeOf('gamma'), { color: 'blue', commented: true })
    const names = [...CSS.highlights.keys()].filter((n) => n.startsWith('noteit-'))
    expect(names).toHaveLength(9)
    expect(names).toContain(FLASH_HIGHLIGHT_NAME)
    expect(rangesIn('noteit-yellow')).toEqual(['alpha beta'])
    expect(rangesIn('noteit-blue-commented')).toEqual(['gamma'])
    renderer.restyle('b', { color: 'green', commented: false })
    expect(rangesIn('noteit-blue-commented')).toEqual([])
    expect(rangesIn(highlightName({ color: 'green', commented: false }))).toEqual(['gamma'])
    renderer.clear()
    expect(rangesIn('noteit-yellow')).toEqual([])
    await new Promise((r) => setTimeout(r, 0))
    observer.disconnect()
    expect(seen).toEqual([])
    expect(document.body.innerHTML).toBe(before)
    expect(renderer.isOwnMutation()).toBe(false)
    // One host stylesheet with the ::highlight() rules.
    expect(document.querySelectorAll('#noteit-highlight-api-styles')).toHaveLength(1)
    expect(document.getElementById('noteit-highlight-api-styles')!.textContent).toContain('::highlight(noteit-yellow-commented)')
  })

  it('paints the same text resolveAnchor returns (random ranges, same TextIndex)', () => {
    document.body.innerHTML =
      '<article><p>Opening words <script>var x = 1;</script>with <b>bold part</b> and</p><p>closing <i>italic</i> sentence.</p></article>'
    const renderer = new HighlightApiRenderer()
    const base = createTextIndex()
    let seed = 11
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n)
    for (let i = 0; i < 25; i++) {
      const a = rand(base.text.length)
      const b = rand(base.text.length)
      const index = createTextIndex()
      const anchor = describeSelection(index, index.offsetsToRange(Math.min(a, b), Math.max(a, b) + 1)!)
      if (!anchor) continue
      const hit = resolveAnchor(createTextIndex(), anchor)!
      renderer.paint('h', hit.range, STYLE)
      expect(rangesIn('noteit-yellow')).toEqual([anchor.exact])
    }
    renderer.clear()
  })

  it('hitTest is correct for adjacent, overlapping and cross-element highlights', () => {
    document.body.innerHTML = '<p style="font: 20px monospace">one two three <b>four</b> five six</p>'
    const renderer = new HighlightApiRenderer()
    renderer.paint('adjA', rangeOf('one'), STYLE)
    renderer.paint('adjB', rangeOf(' two'), STYLE)
    renderer.paint('cross', rangeOf('three four five'), STYLE)
    // Painted later and inside "cross": wins on the overlap, like the innermost mark.
    renderer.paint('inner', rangeOf('four'), { color: 'blue', commented: false })
    const at = (exact: string, char: number) => {
      const p = pointAt(exact, char)
      return renderer.hitTest(p.x, p.y)
    }
    expect(at('one', 1)).toBe('adjA')
    expect(at(' two', 2)).toBe('adjB')
    expect(at('three', 1)).toBe('cross')
    expect(at('four', 1)).toBe('inner')
    expect(at('five', 1)).toBe('cross')
    expect(at('six', 1)).toBeNull()
    renderer.remove('inner')
    expect(at('four', 1)).toBe('cross')
  })

  it('flash adds the Range to noteit-flash for HIGHLIGHT_FLASH_MS', async () => {
    document.body.innerHTML = '<p>flash me here</p>'
    const renderer = new HighlightApiRenderer()
    renderer.paint('f', rangeOf('flash me'), STYLE)
    expect(renderer.flash('missing')).toBe(false)
    expect(renderer.flash('f')).toBe(true)
    expect(rangesIn(FLASH_HIGHLIGHT_NAME)).toEqual(['flash me'])
    await new Promise((r) => setTimeout(r, HIGHLIGHT_FLASH_MS + 50))
    expect(rangesIn(FLASH_HIGHLIGHT_NAME)).toEqual([])
  })

  it('a highlight whose text node left the page is no longer painted', () => {
    document.body.innerHTML = '<div><p id="x">virtual row text</p></div>'
    const renderer = new HighlightApiRenderer()
    renderer.paint('v', rangeOf('row text'), STYLE)
    expect(renderer.isPainted('v')).toBe(true)
    expect(renderer.boundingRect('v')).not.toBeNull()
    const row = document.getElementById('x')!
    row.remove()
    expect(renderer.isPainted('v')).toBe(false)
    expect(renderer.boundingRect('v')).toBeNull()
    // The live Range collapsed onto the parent on removal, so re-inserting the node does not bring it
    // back by itself; the observer's incremental pass re-resolves and repaints unpainted records.
    document.querySelector('div')!.append(row)
    expect(renderer.isPainted('v')).toBe(false)
    renderer.paint('v', rangeOf('row text'), STYLE)
    expect(renderer.isPainted('v')).toBe(true)
    // A fresh node (framework re-render) also needs a repaint, which replaces the entry.
    row.replaceWith(Object.assign(document.createElement('p'), { textContent: 'virtual row text' }))
    expect(renderer.isPainted('v')).toBe(false)
    renderer.paint('v', rangeOf('row text'), STYLE)
    expect(renderer.isPainted('v')).toBe(true)
  })

  it('does not move host layout (getBoundingClientRect before / after)', () => {
    document.body.innerHTML = '<p id="p" style="font: 16px serif">some <span id="s">host</span> layout text</p>'
    const rects = () => ['p', 's'].map((id) => JSON.stringify(document.getElementById(id)!.getBoundingClientRect()))
    const before = rects()
    const renderer = new HighlightApiRenderer()
    renderer.paint('l', rangeOf('some host layout'), { color: 'orange', commented: true })
    expect(rects()).toEqual(before)
  })
})

describe('createRenderer', () => {
  it('defaults to mark and picks the Highlight API only for highlight-api', () => {
    expect(rendererKind(undefined)).toBe('mark')
    expect(rendererKind('')).toBe('mark')
    expect(rendererKind('nope')).toBe('mark')
    expect(rendererKind('highlight-api')).toBe('highlight-api')
    expect(createRenderer()).toBeInstanceOf(MarkRenderer)
    expect(createRenderer('mark').paintsElements).toBe(true)
    const api = createRenderer('highlight-api')
    expect(api).toBeInstanceOf(HighlightApiRenderer)
    expect(api.paintsElements).toBe(false)
  })
})
