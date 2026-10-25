// expect: error noteit/no-cjk-literal
// Escapes keep this file ASCII; the rule checks the decoded value.
export const label = '\u6458\u6284'
