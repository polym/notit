// Side panel read hook (architecture.md D12, "Frontend Architecture"): runs a read-only local
// database query and re-runs it whenever the service worker broadcasts db/changed, or deps change.
// No caching layer and no optimistic updates: the query result is the only copy of the data.
import { useEffect, useState, type DependencyList } from 'react'
import { onEvent } from '../../../core/messaging/index.ts'

// Declared locally so ui does not import a feature; the service worker emits it after each commit.
type DbEvents = { 'db/changed': { ids: string[] } }

export interface QueryState<T> {
  /** undefined until the first run resolves. */
  data: T | undefined
  error: unknown
}

export function useQuery<T>(fn: () => Promise<T>, deps: DependencyList): QueryState<T> {
  const [state, setState] = useState<QueryState<T>>({ data: undefined, error: null })
  const [version, setVersion] = useState(0)

  useEffect(() => onEvent<DbEvents>({ 'db/changed': () => setVersion((v) => v + 1) }), [])

  useEffect(() => {
    let current = true
    fn().then(
      (data) => {
        if (current) setState({ data, error: null })
      },
      (error: unknown) => {
        if (current) setState((prev) => ({ data: prev.data, error }))
      },
    )
    return () => {
      current = false
    }
    // fn is recreated each render; callers list what it reads in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version])

  return state
}
