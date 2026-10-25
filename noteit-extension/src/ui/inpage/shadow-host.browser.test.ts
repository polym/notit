import { afterEach, describe, expect, it } from 'vitest'
import { HOST_TAG, mountShadowHost } from './shadow-host.ts'

afterEach(() => {
  for (const el of document.querySelectorAll(HOST_TAG)) el.remove()
})

describe('mountShadowHost', () => {
  it('appends one <noteit-root> with an open shadow root at the end of documentElement', () => {
    const a = mountShadowHost()!
    const b = mountShadowHost()
    expect(a).toBe(b)
    expect(document.querySelectorAll(HOST_TAG)).toHaveLength(1)
    expect(document.documentElement.lastElementChild).toBe(a.host)
    expect(a.host.shadowRoot).toBe(a.root)
    expect(a.root.mode).toBe('open')
    a.destroy()
  })

  it('is a fixed, top-most layer that takes no pointer events and exposes the token variables', () => {
    const { host, destroy } = mountShadowHost()!
    const style = getComputedStyle(host)
    expect(style.position).toBe('fixed')
    expect(style.pointerEvents).toBe('none')
    expect(style.zIndex).toBe('2147483647')
    expect(style.getPropertyValue('--nt-foreground').trim()).not.toBe('')
    destroy()
  })

  it('adopts component stylesheets once', () => {
    const shadow = mountShadowHost()!
    const before = shadow.root.adoptedStyleSheets.length
    const sheet = shadow.adoptStyles('.x { color: inherit; }')
    shadow.adoptStyles(sheet)
    expect(shadow.root.adoptedStyleSheets.length).toBe(before + 1)
    shadow.destroy()
  })

  it('replaces a stale host left by a previous instance', () => {
    document.documentElement.append(document.createElement(HOST_TAG))
    const shadow = mountShadowHost()!
    expect(document.querySelectorAll(HOST_TAG)).toHaveLength(1)
    shadow.destroy()
  })

  it('does not mount on a non-HTML document (SVG/XML) and does not throw', () => {
    const svg = new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'image/svg+xml')
    expect(mountShadowHost(svg)).toBeNull()
    const xml = new DOMParser().parseFromString('<root/>', 'application/xml')
    expect(mountShadowHost(xml)).toBeNull()
  })
})
