// Public surface of the highlight feature (entries import only this file).
export {
  anchorHandlers,
  highlightHandlers,
  debugHandlers,
  notifyCommitted,
  notifyWiped,
  setAfterLocalCommit,
  setBeforeLocalWrite,
  siteHandlers,
} from './background/handlers.ts'
export { startBadge } from './background/badge.ts'
export { registerCommands } from './background/commands.ts'
export { broadcastAuthChanged } from './background/broadcast.ts'
export { isSignedIn, setCachedSignedIn, setSignedInChangeListener, setSignedInSource } from './background/auth-gate.ts'
export type {
  AnchorReport,
  AnchorRequests,
  CreateHighlightReq,
  DebugDump,
  DebugRequests,
  HighlightEvents,
  HighlightPatch,
  HighlightRequests,
  PageEvents,
  PageRequests,
  PageState,
  PageSync,
  SiteChanged,
  SiteRequests,
} from './shared/protocol.ts'
