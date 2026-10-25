// Inbound side of typed messaging. A router validates the sender and the type, runs the handler
// and always answers with a Result<T>; handler exceptions never reach the caller (architecture.md D6).
import { HandlerError, REQUEST_KIND, err, ok, type RequestMap, type RequestType, type Result } from './types.ts'

export type Handler<M extends RequestMap, K extends RequestType<M>> = (
  req: M[K]['req'],
  sender: chrome.runtime.MessageSender,
) => Promise<M[K]['res']>

// Written out instead of Handler<M, K> so handler maps of two features can be merged: TypeScript
// would otherwise compare Handler<A, K> and Handler<A & B, K> by the variance of M and reject it.
export type Handlers<M extends RequestMap> = {
  [K in RequestType<M>]: (req: M[K]['req'], sender: chrome.runtime.MessageSender) => Promise<M[K]['res']>
}

type OnMessageListener = Parameters<typeof chrome.runtime.onMessage.addListener>[0]

export interface Router {
  /** Resolves a raw incoming message to a Result, or null when the message is not a request. */
  handle(message: unknown, sender: chrome.runtime.MessageSender): Promise<Result<unknown>> | null
  /** Registers the router on chrome.runtime.onMessage; returns a function that unregisters it. */
  listen(): () => void
}

function isRequestEnvelope(message: unknown): message is { kind: string; type: unknown; req: unknown } {
  return typeof message === 'object' && message !== null && (message as { kind?: unknown }).kind === REQUEST_KIND
}

export function createRouter<M extends RequestMap>(handlers: Handlers<M>): Router {
  const known = new Set<string>(Object.keys(handlers))

  async function dispatch(
    type: RequestType<M>,
    req: unknown,
    sender: chrome.runtime.MessageSender,
  ): Promise<Result<unknown>> {
    try {
      const handler = handlers[type] as Handler<M, RequestType<M>>
      return ok(await handler(req as M[RequestType<M>]['req'], sender))
    } catch (e) {
      if (e instanceof HandlerError) return err(e.code, e.message)
      console.error(`[NoteIt] handler "${type}" failed:`, e)
      return err('internal', e instanceof Error ? e.message : String(e))
    }
  }

  function handle(message: unknown, sender: chrome.runtime.MessageSender): Promise<Result<unknown>> | null {
    if (!isRequestEnvelope(message)) return null
    if (sender.id !== chrome.runtime.id) {
      return Promise.resolve(err('bad_request', 'sender is not this extension'))
    }
    const { type } = message
    if (typeof type !== 'string' || !known.has(type)) {
      return Promise.resolve(err('bad_request', `unknown message type: ${String(type)}`))
    }
    return dispatch(type as RequestType<M>, message.req, sender)
  }

  function listen(): () => void {
    // Chrome keeps the response channel open only when the listener returns true synchronously;
    // that detail lives here once so handlers just return Promises.
    const listener: OnMessageListener = (message, sender, sendResponse) => {
      const pending = handle(message, sender)
      if (!pending) return false
      void pending.then(sendResponse)
      return true
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }

  return { handle, listen }
}
