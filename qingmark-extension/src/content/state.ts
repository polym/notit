// Shared content-script state. Lives in its own module so index.ts and SelectionManager.ts do
// not import each other (architecture.md debt #10: no import cycles).
import type { HighlightRecord } from '../core/model';

let enabled = false;
// Login gate (Story 2.15): false until the service worker says otherwise (page/getState, page/sync).
let signedIn = false;
export function isExtensionEnabled(): boolean {
  return enabled;
}

export function setExtensionEnabled(value: boolean): void {
  enabled = value;
}

export function isSignedIn(): boolean {
  return signedIn;
}

export function setSignedIn(value: boolean): void {
  signedIn = value;
}

/** Records of the current page as last returned by the service worker, keyed by id. */
export const pageRecords = new Map<string, HighlightRecord>();
