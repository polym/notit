// expect: error no-restricted-syntax
// chrome.storage.local is forbidden in features; go through core/settings instead.
export async function readSetting(key: string): Promise<unknown> {
  const items = await chrome.storage.local.get(key)
  return items[key]
}
