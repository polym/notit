// Dynamic pages (architecture.md D7 "dynamic pages", FR11): one MutationObserver on <body> with
// {childList, subtree, characterData}. Changes made by the renderer itself (Renderer.isOwnMutation),
// changes inside a Shadow host and NoteIt's own nodes are ignored; any other change restarts a 300ms
// debounce, after which `onChange` runs once (the caller rebuilds the TextIndex and re-resolves).
// A burst never delays `onChange` by more than OBSERVER_MAX_WAIT_MS from its first foreign change, so
// pages that never go quiet (ticking clocks, counters) still get restored.
import { HOST_TAG } from '../../../ui/inpage/shadow-host.ts'

/** Quiet time after the last foreign mutation before `onChange` runs. */
export const OBSERVER_DEBOUNCE_MS = 300
/** Longest time from the first foreign mutation of a burst until `onChange` runs. */
export const OBSERVER_MAX_WAIT_MS = 800

export interface PageObserverOptions {
  root?: Node
  /** True for mutations this extension caused (renderer paint / unpaint). */
  isOwnMutation: (record: MutationRecord) => boolean
  /** Runs once per quiet period after foreign mutations. */
  onChange: () => void
  debounceMs?: number
  maxWaitMs?: number
  /** Clock in milliseconds (tests inject a fake one). */
  now?: () => number
}

/** NoteIt's own nodes outside the renderer (the Shadow host, the one-line error message). */
const isOwnNode = (node: Node) =>
  node instanceof Element && (node.localName === HOST_TAG || (node.getAttribute('id')?.startsWith('noteit-') ?? false))

/** True when `node` sits inside a Shadow root or inside the NoteIt host element. */
function insideShadow(node: Node): boolean {
  if (node.getRootNode() instanceof ShadowRoot) return true
  const el = node instanceof Element ? node : node.parentElement
  return el?.closest(HOST_TAG) != null
}

export class PageObserver {
  /** Foreign mutation records seen (tests assert own paints add nothing). */
  foreignMutations = 0
  /** Times `onChange` ran. */
  changes = 0

  private readonly options: PageObserverOptions
  private readonly observer: MutationObserver
  private timer: ReturnType<typeof setTimeout> | undefined
  /** Time of the first foreign mutation of the current burst; null when no run is pending. */
  private burstStart: number | null = null

  constructor(options: PageObserverOptions) {
    this.options = options
    this.observer = new MutationObserver((records) => this.handle(records))
  }

  start(): void {
    this.observer.observe(this.options.root ?? document.body, { childList: true, subtree: true, characterData: true })
  }

  stop(): void {
    this.observer.disconnect()
    clearTimeout(this.timer)
    this.timer = undefined
    this.burstStart = null
  }

  /** True when the record should restart the debounce. */
  isForeign(record: MutationRecord): boolean {
    if (this.options.isOwnMutation(record)) return false
    if (insideShadow(record.target)) return false
    if (record.type === 'childList') {
      const nodes = [...record.addedNodes, ...record.removedNodes]
      if (nodes.length > 0 && nodes.every(isOwnNode)) return false
    }
    return true
  }

  private handle(records: MutationRecord[]): void {
    const foreign = records.filter((r) => this.isForeign(r)).length
    if (foreign === 0) return
    this.foreignMutations += foreign
    const now = this.options.now ?? (() => Date.now())
    const debounce = this.options.debounceMs ?? OBSERVER_DEBOUNCE_MS
    const maxWait = this.options.maxWaitMs ?? OBSERVER_MAX_WAIT_MS
    this.burstStart ??= now()
    const delay = Math.max(0, Math.min(debounce, this.burstStart + maxWait - now()))
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.fire(), delay)
  }

  private fire(): void {
    this.timer = undefined
    this.burstStart = null
    this.changes++
    this.options.onChange()
  }
}
