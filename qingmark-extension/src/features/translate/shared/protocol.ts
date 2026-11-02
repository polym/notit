// Message catalogue of the translate feature (spec "selection translation"). Type-only: safe to
// import from the content script, the side panel and the service worker.

export interface TranslateReq {
  /** Caller-generated id; translate/cancel with the same id aborts the request. */
  requestId: string
  /** The selected text (trimmed by the worker; at most MAX_TEXT_LENGTH characters). */
  text: string
  /** The sentence(s) around the selection, used to pick the sense; truncated by the worker. */
  context: string
}

export interface WordResult {
  mode: 'word'
  /** The word as selected (punctuation trimmed). */
  word: string
  /** Dictionary form, e.g. "run" for "running". */
  lemma: string
  /** IPA without slashes; null when the model gave none. */
  ipa: { us: string | null; uk: string | null }
  /** Part of speech as used in the context, e.g. "v.". */
  pos: string
  /** Chinese meaning as used in the context. */
  sense: string
  /** Up to 3 other common Chinese meanings. */
  otherSenses: string[]
}

export interface TextResult {
  mode: 'text'
  translation: string
}

export type TranslateResult = WordResult | TextResult

/** The provider config as the side panel may see it: never the API key itself. */
export interface TranslateConfigView {
  baseUrl: string
  model: string
  hasKey: boolean
  /** Last 4 characters of the saved key, for recognition; null without a key. */
  keyHint: string | null
}

export interface TranslateConfigInput {
  baseUrl: string
  model: string
  /** Omitted or empty keeps the saved key (the panel never receives it back). */
  apiKey?: string
}

export type TranslateRequests = {
  'translate/lookup': { req: TranslateReq; res: TranslateResult }
  'translate/cancel': { req: { requestId: string }; res: void }
  'translate/getConfig': { req: void; res: TranslateConfigView }
  'translate/saveConfig': { req: TranslateConfigInput; res: TranslateConfigView }
  /** Sends one tiny lookup with the given config (falling back to the saved key). */
  'translate/testConfig': { req: TranslateConfigInput; res: { reachable: true } }
  /** From the translate card: opens the side panel of the sender's window on the settings. */
  'translate/openSettings': { req: void; res: void }
}

/** Worker -> content script (context menu): translate the tab's current selection. */
export type TranslatePageRequests = {
  'page/translateSelection': { req: void; res: { shown: boolean } }
}
