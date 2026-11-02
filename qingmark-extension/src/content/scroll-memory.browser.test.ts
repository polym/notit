import { afterEach, describe, expect, it } from 'vitest'
import { ScrollMemory, scrollParent } from './scroll-memory.ts'

describe('ScrollMemory', () => {
  afterEach(() => document.body.replaceChildren())

  function feed(): { box: HTMLDivElement; target: HTMLParagraphElement } {
    const box = document.createElement('div')
    box.style.cssText = 'height: 200px; overflow-y: auto; position: relative'
    const spacer = document.createElement('div')
    spacer.style.cssText = 'height: 4000px; position: relative'
    const target = document.createElement('p')
    target.textContent = 'a reply far down the list'
    target.style.cssText = 'position: absolute; top: 3000px; margin: 0'
    spacer.append(target)
    box.append(spacer)
    document.body.append(box)
    return { box, target }
  }

  it('finds the scrolling container, or null for the document', () => {
    const { box, target } = feed()
    expect(scrollParent(target.firstChild!)).toBe(box)
    expect(scrollParent(document.body)).toBeNull()
  })

  it('scrolls the container back to an unmounted highlight', () => {
    const { box, target } = feed()
    const memory = new ScrollMemory()
    memory.remember('r', target.firstChild!, target.getBoundingClientRect().top)
    // The list unmounts the row and the reader is back at the top.
    target.remove()
    box.scrollTop = 0
    expect(memory.restore('r')).toBe(true)
    expect(box.scrollTop).toBe(3000 - 100)
  })

  it('knows nothing about unseen ids, nor after clear', () => {
    const { target } = feed()
    const memory = new ScrollMemory()
    expect(memory.restore('x')).toBe(false)
    memory.remember('r', target, target.getBoundingClientRect().top)
    memory.clear()
    expect(memory.restore('r')).toBe(false)
  })
})
