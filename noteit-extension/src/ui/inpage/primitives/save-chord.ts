/** True for the save chord: Cmd+Enter on macOS, Ctrl+Enter elsewhere (either is accepted). */
export function isSaveChord(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>): boolean {
  return e.key === 'Enter' && (e.metaKey || e.ctrlKey)
}
