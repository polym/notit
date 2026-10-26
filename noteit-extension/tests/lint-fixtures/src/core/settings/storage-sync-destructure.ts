// expect: error no-restricted-syntax
// The synced storage area stays forbidden even where chrome.storage.local is allowed.
const { sync } = chrome.storage
export const area = sync
