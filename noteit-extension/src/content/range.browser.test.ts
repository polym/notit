import { afterEach, expect, it } from 'vitest'

afterEach(() => {
  document.body.replaceChildren()
})

it('creates a Range across elements and reads its text in Chromium', () => {
  const p = document.createElement('p')
  p.innerHTML = 'Hello <strong>bold</strong> world'
  document.body.append(p)

  const first = p.firstChild as Text
  const last = p.lastChild as Text
  const range = document.createRange()
  range.setStart(first, 'Hel'.length)
  range.setEnd(last, ' wor'.length)

  expect(range.toString()).toBe('lo bold wor')
  expect(navigator.userAgent).toContain('Chrome')
})
