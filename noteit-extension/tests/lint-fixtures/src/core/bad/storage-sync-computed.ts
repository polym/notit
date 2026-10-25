// expect: error no-restricted-syntax
// Computed literal access must not bypass the synced storage restriction.
export const area = chrome.storage['sync']
