// Public surface of the translate feature for the service worker (entries import only this file).
export { translateHandlers } from './background/handlers.ts'
export { TRANSLATE_MENU_ID, createTranslateMenu, registerTranslateMenu } from './background/menu.ts'
export type {
  TextResult,
  TranslateConfigInput,
  TranslateConfigView,
  TranslateReq,
  TranslateRequests,
  TranslateResult,
  WordResult,
} from './shared/protocol.ts'
