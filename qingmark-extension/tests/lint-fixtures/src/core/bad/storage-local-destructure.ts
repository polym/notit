// expect: error no-restricted-syntax
// Destructuring chrome.storage must not bypass the chrome.storage.local restriction.
const { local } = chrome.storage
export const area = local
