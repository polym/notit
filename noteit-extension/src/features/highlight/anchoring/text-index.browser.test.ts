import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HOST_TAG } from '../../../ui/inpage/shadow-host.ts'
import { TEXT_INDEX_EXCLUDE, createTextIndex } from './text-index.ts'

// Excluded content only uses characters from this set, readable content never does.
const EXCLUDED_CHARS = '#@$%^~|'

const FIXTURE = `
  <h1>Title <em>with</em> emphasis</h1>
  <script>var a = "#@$%^~|";</script>
  <p>First paragraph with <strong>bold <a href="#x">link</a> text</strong> and more.</p>
  <style>.x{content:"@@@"}</style>
  <noscript>$$$ ~~~</noscript>
  <div>Before <template>%%% <b>^^^</b></template>after template.</div>
  <textarea>||| ###</textarea>
  <${HOST_TAG}>~~~ @@@</${HOST_TAG}>
  <ul><li>One</li><li>Two <span>nested <i>deep</i></span></li></ul>
  <p>Last line<script>"~~~"</script> continues here.</p>
`

/** Deterministic PRNG (mulberry32) so failures are reproducible. */
function rng(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Non-empty text nodes outside excluded elements, in document order. */
function readableTextNodes(): Text[] {
  const out: Text[] = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (n.data.length > 0 && !n.parentElement?.closest(TEXT_INDEX_EXCLUDE.join(','))) out.push(n)
  }
  return out
}

function expectSameRange(actual: Range | null, expected: Range) {
  expect(actual).not.toBeNull()
  expect(actual!.startContainer).toBe(expected.startContainer)
  expect(actual!.startOffset).toBe(expected.startOffset)
  expect(actual!.endContainer).toBe(expected.endContainer)
  expect(actual!.endOffset).toBe(expected.endOffset)
  expect(actual!.toString()).toBe(expected.toString())
}

beforeEach(() => {
  document.body.innerHTML = FIXTURE
})

afterEach(() => {
  document.body.replaceChildren()
})

describe('createTextIndex', () => {
  it('excludes every character of script, style, noscript, template, textarea and noteit-root', () => {
    const index = createTextIndex()
    for (const ch of EXCLUDED_CHARS) expect(index.text).not.toContain(ch)
    expect(index.text).toContain('Before after template.')
    expect(index.text).toContain('Last line continues here.')
    expect(TEXT_INDEX_EXCLUDE).toEqual(['script', 'style', 'noscript', 'template', 'textarea', HOST_TAG])
  })

  it('round-trips 200 random Ranges with identical text and boundaries', () => {
    const nodes = readableTextNodes()
    const index = createTextIndex()
    const random = rng(42)
    for (let n = 0; n < 200; n++) {
      // Canonical boundaries: start before the end of its node, end after the start of its node.
      const a = Math.floor(random() * nodes.length)
      const b = a + Math.floor(random() * (nodes.length - a))
      const startNode = nodes[a]
      const endNode = nodes[b]
      const startOffset = Math.floor(random() * startNode.data.length)
      const minEnd = a === b ? startOffset + 1 : 1
      const endOffset = minEnd + Math.floor(random() * (endNode.data.length - minEnd + 1))
      const range = document.createRange()
      range.setStart(startNode, startOffset)
      range.setEnd(endNode, endOffset)

      const { start, end } = index.rangeToOffsets(range)
      expectSameRange(index.offsetsToRange(start, end), range)
      // The indexed text equals the readable text of the Range (excluded nodes removed).
      const readable = nodes
        .slice(a, b + 1)
        .map((node, i) => {
          const from = i === 0 ? startOffset : 0
          const to = i === b - a ? endOffset : node.data.length
          return node.data.slice(from, to)
        })
        .join('')
      expect(index.text.slice(start, end)).toBe(readable)
    }
  })

  it('round-trips a Range across elements and inline tags', () => {
    const index = createTextIndex()
    const p = document.querySelector('p')!
    const range = document.createRange()
    range.setStart(p.firstChild!, 'First '.length)
    range.setEnd(document.querySelector('strong')!.lastChild!, ' te'.length)
    const { start, end } = index.rangeToOffsets(range)
    expect(index.text.slice(start, end)).toBe('paragraph with bold link te')
    expectSameRange(index.offsetsToRange(start, end), range)

    const cross = document.createRange()
    cross.setStart(document.querySelector('em')!.firstChild!, 1)
    cross.setEnd(document.querySelector('i')!.firstChild!, 2)
    const offsets = index.rangeToOffsets(cross)
    expect(index.text.slice(offsets.start, offsets.end)).toMatch(/^ith emphasis[\s\S]*nested de$/)
    expectSameRange(index.offsetsToRange(offsets.start, offsets.end), cross)
  })

  it('maps element boundary points and boundaries inside excluded text', () => {
    const index = createTextIndex()
    const strong = document.createRange()
    strong.selectNodeContents(document.querySelector('strong')!)
    const offsets = index.rangeToOffsets(strong)
    expect(index.text.slice(offsets.start, offsets.end)).toBe('bold link text')

    const last = document.querySelectorAll('p')[1]
    const script = last.querySelector('script')!
    const range = document.createRange()
    range.setStart(last.firstChild!, 'Last '.length)
    range.setEnd(script.firstChild!, 2)
    const r = index.rangeToOffsets(range)
    expect(index.text.slice(r.start, r.end)).toBe('line')
  })

  it('returns null for out-of-bounds or reversed offsets', () => {
    const index = createTextIndex()
    expect(index.offsetsToRange(-1, 2)).toBeNull()
    expect(index.offsetsToRange(5, 3)).toBeNull()
    expect(index.offsetsToRange(0, index.text.length + 1)).toBeNull()
    expect(index.offsetsToRange(0, index.text.length)?.toString()).toContain('Title')
  })
})
