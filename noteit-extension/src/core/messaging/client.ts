// Outbound side of typed messaging: one-shot sendMessage only, no long-lived ports (architecture.md D6).
import {
  EVENT_KIND,
  REQUEST_KIND,
  err,
  type EventEnvelope,
  type EventMap,
  type EventType,
  type RequestEnvelope,
  type RequestMap,
  type RequestType,
  type Result,
} from './types.ts'

export interface SendOptions {
  /** Send to the content script of this tab (chrome.tabs.sendMessage) instead of the service worker. */
  tabId?: number
}

export interface Client<M extends RequestMap> {
  send<K extends RequestType<M>>(type: K, req: M[K]['req'], options?: SendOptions): Promise<Result<M[K]['res']>>
}

function isResult(value: unknown): value is Result<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as { ok?: unknown }).ok === 'boolean'
}

async function transmit(message: unknown, tabId: number | undefined): Promise<unknown> {
  return tabId === undefined ? chrome.runtime.sendMessage(message) : chrome.tabs.sendMessage(tabId, message)
}

export function createClient<M extends RequestMap>(): Client<M> {
  return {
    async send(type, req, options) {
      const envelope: RequestEnvelope<M, typeof type> = { kind: REQUEST_KIND, type, req }
      let response: unknown
      try {
        response = await transmit(envelope, options?.tabId)
      } catch (e) {
        // No receiver (tab without content script, SW not reachable) or a closed channel.
        return err('internal', e instanceof Error ? e.message : String(e))
      }
      return isResult(response) ? response : err('internal', `no valid response for "${type}"`)
    },
  }
}

/**
 * Broadcasts an event. Without tabId it goes to extension pages (side panel); with tabId to that
 * tab's content script. Delivery failures are ignored: a missing receiver is not an error.
 */
export async function emit<E extends EventMap, K extends EventType<E> = EventType<E>>(
  type: K,
  payload: E[K],
  options?: SendOptions,
): Promise<void> {
  const envelope: EventEnvelope<E, K> = { kind: EVENT_KIND, type, payload }
  try {
    await transmit(envelope, options?.tabId)
  } catch {
    // Intentionally ignored (see above).
  }
}

export type EventHandlers<E extends EventMap> = { [K in EventType<E>]?: (payload: E[K]) => void }

/** Subscribes to events from this extension; returns a function that unsubscribes. */
export function onEvent<E extends EventMap>(handlers: EventHandlers<E>): () => void {
  const listener = (message: unknown, sender: chrome.runtime.MessageSender): false => {
    if (sender.id !== chrome.runtime.id) return false
    if (typeof message !== 'object' || message === null) return false
    const { kind, type, payload } = message as { kind?: unknown; type?: unknown; payload?: unknown }
    if (kind !== EVENT_KIND || typeof type !== 'string' || !Object.hasOwn(handlers, type)) return false
    const handler = handlers[type as EventType<E>]
    handler?.(payload as E[EventType<E>])
    return false
  }
  chrome.runtime.onMessage.addListener(listener)
  return () => chrome.runtime.onMessage.removeListener(listener)
}
