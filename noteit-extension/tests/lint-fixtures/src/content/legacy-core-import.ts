// expect: none
// Legacy directories may import core (shared model and pure functions) while migrating.
import { canonicalUrl } from '../core/url/index.ts'
export const value = canonicalUrl
