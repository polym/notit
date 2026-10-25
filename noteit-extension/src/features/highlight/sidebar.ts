// Side panel public surface of the highlight feature (Story 3.3). Kept apart from index.ts so the
// service worker and content script graphs never reach React or the side panel UI.
export { highlightModule } from './sidebar/module.ts'
export { SiteToggle } from './sidebar/SiteToggle.tsx'
