// Lost decision for the current page (architecture.md "lost decision", Q54).
// The window starts with the first restore pass after document_idle. Highlights that are not
// rendered stay pending while mutation-driven reloads retry them; when the window ends they are
// reported as lost. Any later pass that renders one reports it as found. Each id is reported only
// when its verdict changes, so steady pages send nothing after the first report.
import type { AnchorReport } from '../features/highlight/index.ts';

type Verdict = 'found' | 'lost';

/**
 * Whether text marked at the stored offsets is still the saved highlight text (whitespace-insensitive:
 * a selection across blocks carries line breaks the text nodes do not have).
 */
export const sameText = (marked: string, saved: string): boolean =>
  marked.replace(/\s+/g, '') === saved.replace(/\s+/g, '');

export interface AnchorTrackerDeps {
  /** Ids of the live highlights the page should show. */
  expectedIds: () => Iterable<string>;
  isRendered: (id: string) => boolean;
  /** True while a render pass is running; the window end waits for it. */
  isBusy: () => boolean;
  canonicalUrl: () => string | null;
  send: (report: AnchorReport) => void;
  windowMs: number;
}

const BUSY_RETRY_MS = 100;

export class AnchorTracker {
  /** started: first pass ran; over: the lost window has ended. */
  private state: 'idle' | 'started' | 'over' = 'idle';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly reported = new Map<string, Verdict>();
  private readonly deps: AnchorTrackerDeps;

  constructor(deps: AnchorTrackerDeps) {
    this.deps = deps;
  }

  /** Called after every render pass. The first call opens the lost window. */
  afterRender(): void {
    if (this.state === 'idle') {
      this.state = 'started';
      this.timer = setTimeout(() => this.onWindowEnd(), this.deps.windowMs);
    }
    this.evaluate();
  }

  /** Forgets every verdict and closes the window (site turned off). */
  reset(): void {
    clearTimeout(this.timer);
    this.state = 'idle';
    this.reported.clear();
  }

  private onWindowEnd(): void {
    // A render pass still running at the window end gets to finish first.
    if (this.deps.isBusy()) {
      this.timer = setTimeout(() => this.onWindowEnd(), BUSY_RETRY_MS);
      return;
    }
    this.state = 'over';
    this.evaluate();
  }

  private evaluate(): void {
    const canonical = this.deps.canonicalUrl();
    if (canonical === null || this.state === 'idle') return;
    const windowOver = this.state === 'over';
    const found: string[] = [];
    const lost: string[] = [];
    for (const id of this.deps.expectedIds()) {
      const previous = this.reported.get(id);
      if (this.deps.isRendered(id)) {
        if (previous !== 'found') found.push(id);
      } else if (windowOver && previous !== 'lost') {
        lost.push(id);
      }
    }
    if (found.length === 0 && lost.length === 0) return;
    for (const id of found) this.reported.set(id, 'found');
    for (const id of lost) this.reported.set(id, 'lost');
    this.deps.send({ canonicalUrl: canonical, found, lost });
  }
}
