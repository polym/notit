// sync_push and pull pages over supabase-js (architecture.md D2, D3). Kept apart from engine.ts so
// integration tests can drive pushAll / pullAll with their own signed-in clients.
import type { SupabaseClient } from '@supabase/supabase-js'
import { HandlerError, type ErrorCode } from '../../messaging/index.ts'
import type { PushRow } from '../mapping.ts'
import type { SyncPushResponse, SyncPushRpc } from './push.ts'
import type { PullPageFetch } from './pull.ts'

/** Maps a PostgREST rpc error to an ErrorCode. Status 0 means no answer (offline). */
export function rpcErrorCode(status: number, code: string | undefined): ErrorCode {
  if (status === 0) return 'network'
  if (status === 401 || status === 403 || code === 'PGRST301' || code === '42501') return 'unauthenticated'
  if (status >= 500) return 'server'
  return 'bad_request'
}

/** sync_push through the shared client; failures throw HandlerError with a mapped code. */
export function supabaseRpc(supabase: SupabaseClient): SyncPushRpc {
  return async (rows: PushRow[]) => {
    const { data, error, status } = await supabase.rpc('sync_push', { rows })
    if (error) throw new HandlerError(rpcErrorCode(status, error.code), error.message)
    return data as SyncPushResponse
  }
}

/**
 * One pull page over PostgREST (D3): `select * where server_seq > cursor order by server_seq
 * limit n`. RLS limits the rows to the signed-in account; soft-deleted rows are included.
 */
export function supabasePullPage(supabase: SupabaseClient): PullPageFetch {
  return async (cursor, limit) => {
    const { data, error, status } = await supabase
      .from('highlights')
      .select('*')
      .gt('server_seq', cursor)
      .order('server_seq', { ascending: true })
      .limit(limit)
    if (error) throw new HandlerError(rpcErrorCode(status, error.code), error.message)
    return Array.isArray(data) ? (data as unknown[]) : []
  }
}
