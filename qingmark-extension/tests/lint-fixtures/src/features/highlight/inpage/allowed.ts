// expect: none
// Element textContent and non-Range toString() calls are fine.
export function label(el: Element, count: number): string {
  return `${el.textContent ?? ''} ${count.toString()}`
}
