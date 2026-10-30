// Side panel public surface of the translate feature. Kept apart from index.ts so the service worker
// and content script graphs never reach React or the side panel UI.
export { TranslateSettings } from './sidebar/TranslateSettings.tsx'
