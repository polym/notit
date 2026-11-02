// expect: warn qingmark/no-raw-url-compare
export const isOtherPage = (url: string): boolean => url !== location.href
