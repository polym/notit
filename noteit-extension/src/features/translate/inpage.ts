// Content script public surface of the translate feature. Kept apart from index.ts so the service
// worker graph never reaches Preact or the in-page UI.
export {
  hideTranslateCard,
  isInsideTranslateCard,
  isTranslateCardOpen,
  showTranslateCard,
  type TranslateCardHandlers,
} from './inpage/translate-card-controller.ts'
export { selectionContext } from './inpage/context.ts'
export { translatePanelRenderer } from './inpage/translate-panel.ts'
export type { TranslatePageRequests } from './shared/protocol.ts'
