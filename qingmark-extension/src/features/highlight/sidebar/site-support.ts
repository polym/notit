// Which tabs the side panel can switch on (Story 3.6, EXPERIENCE "non-web tabs"): http(s) pages only,
// and not PDF tabs, which run Chrome's viewer where content scripts cannot highlight.
import { siteKey } from '../../../core/url/index.ts'

const isPdf = (url: string): boolean => {
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.pdf')
  } catch {
    return false
  }
}

/** Site key the panel may switch, or null for pages the extension does not support. */
export const supportedSiteKey = (url: string): string | null => (isPdf(url) ? null : siteKey(url))
