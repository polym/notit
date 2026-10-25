import { afterEach, describe as suite, expect, it } from 'vitest'
import { describe } from './describe.ts'
import { resolveAnchor } from './resolve.ts'
import { createTextIndex } from './text-index.ts'

afterEach(() => {
  document.body.replaceChildren()
})

/** Range over the first occurrence of `exact` inside the text node(s) of `el` (single text node only). */
function rangeOf(el: Element, exact: string): Range {
  const node = el.firstChild as Text
  const at = node.data.indexOf(exact)
  expect(at).toBeGreaterThanOrEqual(0)
  const r = document.createRange()
  r.setStart(node, at)
  r.setEnd(node, at + exact.length)
  return r
}

suite('describe + resolveAnchor', () => {
  it('restores by position on an unchanged page, across inline elements and scripts', () => {
    document.body.innerHTML =
      '<p id="a">Start of <em>emphasised</em> text<script>var s = "noise";</script> and the end.</p>'
    const p = document.getElementById('a')!
    const r = document.createRange()
    r.setStart(p.querySelector('em')!.firstChild!, 3)
    r.setEnd(p.lastChild!, 8)
    const anchor = describe(createTextIndex(), r)
    expect(anchor.exact).toBe(r.toString().replace('var s = "noise";', ''))

    const hit = resolveAnchor(createTextIndex(), anchor)
    expect(hit?.method).toBe('position')
    expect(hit!.range.startContainer).toBe(r.startContainer)
    expect(hit!.range.startOffset).toBe(r.startOffset)
    expect(hit!.range.endContainer).toBe(r.endContainer)
    expect(hit!.range.endOffset).toBe(r.endOffset)
  })

  it('restores by quote after a paragraph is inserted before it', () => {
    document.body.innerHTML = '<p>Intro paragraph text.</p><p id="t">The highlighted words sit here.</p><p>Outro.</p>'
    const target = document.getElementById('t')!
    const anchor = describe(createTextIndex(), rangeOf(target, 'highlighted words'))

    const lead = document.createElement('p')
    lead.textContent = 'A freshly inserted lead paragraph.'
    document.body.prepend(lead)

    const hit = resolveAnchor(createTextIndex(), anchor)
    expect(hit?.method).toBe('quote')
    expect(hit!.range.toString()).toBe('highlighted words')
    expect(hit!.range.startContainer.parentElement).toBe(target)
  })

  it('selects the one occurrence of three whose context matches', () => {
    document.body.innerHTML =
      '<p>First block says: read more here, then stops.</p>' +
      '<p id="t">Second block, the real one, says: read more here, and continues.</p>' +
      '<p>Third block says: read more here, then stops.</p>'
    const target = document.getElementById('t')!
    const anchor = describe(createTextIndex(), rangeOf(target, 'read more here'))
    document.body.prepend(Object.assign(document.createElement('p'), { textContent: 'Banner.' }))

    const hit = resolveAnchor(createTextIndex(), anchor)
    expect(hit?.method).toBe('quote')
    expect(hit!.range.startContainer.parentElement).toBe(target)
  })

  it('returns null when two occurrences score within the minimum lead', () => {
    // Identical cards: every occurrence has the same 32-character context, so only proximity differs.
    const filler = 'card filler text, card filler text.'
    const cardText = `${filler} caption ${filler}`
    document.body.innerHTML = `<p>${cardText}</p><p id="t">${cardText}</p><p>${cardText}</p>`
    const target = document.getElementById('t')!
    const anchor = describe(createTextIndex(), rangeOf(target, 'caption'))
    // Insert slightly less than one card of text before: the position no longer matches, the first card
    // now sits 3 characters from the stored start and the target one card away. The proximity gap is
    // below the minimum lead, so the match is ambiguous.
    document.body.prepend(Object.assign(document.createElement('p'), { textContent: 'z'.repeat(cardText.length - 3) }))
    const index = createTextIndex()
    expect(index.text.slice(anchor.start, anchor.end)).not.toBe(anchor.exact)
    expect(resolveAnchor(index, anchor)).toBeNull()
  })

  it('returns null when the text was deleted', () => {
    document.body.innerHTML = '<p id="t">Some text that will vanish soon.</p><p>Other.</p>'
    const target = document.getElementById('t')!
    const anchor = describe(createTextIndex(), rangeOf(target, 'will vanish'))
    target.remove()
    expect(resolveAnchor(createTextIndex(), anchor)).toBeNull()
  })
})
