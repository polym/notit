import { afterEach, expect, it, vi } from 'vitest'
import type { CreateHighlightReq } from '../features/highlight/index.ts'
import { MarkRenderer } from '../features/highlight/inpage.ts'

const sent: CreateHighlightReq[] = []
vi.mock('./client', () => ({
  client: {
    send: vi.fn(async (_type: string, req: CreateHighlightReq) => {
      sent.push(req)
      return { ok: true, data: req }
    }),
  },
}))

const { SelectionManager } = await import('./SelectionManager.ts')

afterEach(() => {
  document.body.replaceChildren()
  sent.length = 0
})

it('stores the TextIndex quote as record.text for a selection across an inline script', async () => {
  document.body.innerHTML = '<p id="p">Before <script>var hidden = "script text";</script>after words.</p>'
  const manager = new SelectionManager(new MarkRenderer())
  const p = document.getElementById('p')!
  const range = document.createRange()
  range.setStart(p.firstChild!, 0)
  range.setEnd(p.lastChild!, 'after'.length)
  expect(range.toString()).toContain('script text')
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)

  const result = await manager.triggerHighlight('yellow')
  expect(result?.ok).toBe(true)
  expect(sent).toHaveLength(1)
  expect(sent[0].text).toBe(sent[0].anchor!.exact)
  expect(sent[0].text).toBe('Before after')
})
