// Typed messaging client of the highlight side panel module. Reads come from core/db/read; every write
// goes to the service worker (single writer, architecture.md D4 / D12).
import { createClient } from '../../../core/messaging/index.ts'
import type { AnchorRequests, HighlightRequests, SiteRequests } from '../shared/protocol.ts'

export const client = createClient<HighlightRequests & AnchorRequests & SiteRequests>()
