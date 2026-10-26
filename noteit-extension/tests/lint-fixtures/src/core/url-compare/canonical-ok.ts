// expect: none
// Reading location.href and comparing canonicalUrl() results is the allowed pattern.
import { canonicalUrl } from '../url/index.ts'
export const isSamePage = (url: string): boolean => canonicalUrl(window.location.href) === canonicalUrl(url)
