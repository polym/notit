// Typed messaging contracts (architecture.md D6). Every cross-runtime response is a Result<T>.

/** Error codes shared by messaging, sync and auth. UI text maps from these codes only. */
export const ERROR_CODES = [
  'unauthenticated',
  'network',
  'server',
  'conflict_rejected',
  'bad_request',
  'not_found',
  'quota',
  /** No Supabase config: neither saved on the login page nor injected at build time. */
  'not_configured',
  'internal',
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]

export interface ResultError {
  code: ErrorCode
  message: string
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: ResultError }

export function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}

/**
 * Thrown by a handler to answer with a specific error code instead of 'internal'.
 * The router converts it to {ok:false, error:{code, message}}.
 */
export class HandlerError extends Error {
  readonly code: ErrorCode
  constructor(code: ErrorCode, message: string) {
    super(message)
    this.name = 'HandlerError'
    this.code = code
  }
}

export function err<T = never>(code: ErrorCode, message: string): Result<T> {
  return { ok: false, error: { code, message } }
}

/** Request-response catalogue declared by each feature's protocol.ts: type -> {req, res}. */
export type RequestMap = Record<string, { req: unknown; res: unknown }>

/** One-way event catalogue: type -> payload. */
export type EventMap = Record<string, unknown>

export type RequestType<M extends RequestMap> = Extract<keyof M, string>
export type EventType<E extends EventMap> = Extract<keyof E, string>

/** Wire format of a request. `kind` lets routers ignore event broadcasts on the same channel. */
export interface RequestEnvelope<M extends RequestMap, K extends RequestType<M> = RequestType<M>> {
  kind: 'noteit/request'
  type: K
  req: M[K]['req']
}

/** Wire format of an event. */
export interface EventEnvelope<E extends EventMap, K extends EventType<E> = EventType<E>> {
  kind: 'noteit/event'
  type: K
  payload: E[K]
}

export const REQUEST_KIND = 'noteit/request'
export const EVENT_KIND = 'noteit/event'
