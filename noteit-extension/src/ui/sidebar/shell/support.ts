// Side Panel API detection (Story 3.11, FR44): Chrome 114+ and Edge expose chrome.sidePanel; Arc does not.

/** True when the browser exposes the Side Panel API; false in Arc. */
export function sidePanelSupported(): boolean {
  return typeof chrome !== 'undefined' && chrome.sidePanel !== undefined && chrome.sidePanel !== null
}
