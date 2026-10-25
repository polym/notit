// expect: warn noteit/no-raw-url-compare
// Same-page checks must use canonicalUrl() instead of comparing location.href.
export const isSamePage = (url: string): boolean => window.location.href === url
