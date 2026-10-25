// expect: none
// chrome.storage.local is allowed in core/settings.
export async function readSetting(key: string): Promise<unknown> {
  const items = await chrome.storage.local.get(key)
  return items[key]
}
