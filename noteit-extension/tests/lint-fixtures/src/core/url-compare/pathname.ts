// expect: warn noteit/no-raw-url-compare
// Comparing .pathname is a local re-implementation of page identity.
export const isSamePath = (a: URL, b: URL): boolean => a.pathname === b.pathname
