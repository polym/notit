// expect: error no-restricted-syntax
// Direct member access (split over two lines; the rule matches the AST, not the text).
export const area = chrome.storage
  .sync
