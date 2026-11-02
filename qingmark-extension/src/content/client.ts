// Typed messaging client of the content script. Every highlight read and write goes to the
// service worker (single writer, architecture.md D4 / D6); the content script never touches storage.
import { createClient } from '../core/messaging';
import type { AnchorRequests, HighlightRequests, SiteRequests } from '../features/highlight/index.ts';

export const client = createClient<HighlightRequests & SiteRequests & AnchorRequests>();
