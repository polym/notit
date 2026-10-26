// expect: error noteit/no-raw-text-offset
export const quote = window.getSelection()?.getRangeAt(0).toString() ?? ''
