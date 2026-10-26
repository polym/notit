// expect: none
// chrome.storage.local is allowed in core/auth/storage-adapter.ts (Supabase session adapter).
export async function readSession(key: string): Promise<unknown> {
  const items = await chrome.storage.local.get(key)
  return items[key]
}
