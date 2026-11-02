// expect: error no-restricted-syntax
// chrome.storage.local is only allowed in core/settings and core/auth/storage-adapter.ts.
export const area = chrome.storage.local
