// expect: error noteit/no-raw-text-offset
export const offset = document.body.textContent?.indexOf('quote') ?? -1
