// Compile-time contract for core/messaging (Story 2.3). Checked by `tsc -b` via tsconfig.tests.json;
// every @ts-expect-error must stay an error, otherwise tsc fails on the unused directive.
import { createClient, createRouter, emit, onEvent, type Result } from '../../src/core/messaging/index.ts'

type Requests = {
  'demo/get': { req: { id: string }; res: { id: string; count: number } }
  'demo/ping': { req: void; res: void }
}
type Events = {
  'demo/changed': { ids: string[] }
}

export async function messagingTypeContract(): Promise<void> {
  const client = createClient<Requests>()

  const got: Result<{ id: string; count: number }> = await client.send('demo/get', { id: 'a' })
  if (got.ok) {
    const count: number = got.data.count
    void count
  } else {
    const message: string = got.error.message
    void message
    // @ts-expect-error error codes are a closed set
    const bogus: typeof got.error.code = 'teapot'
    void bogus
  }

  // @ts-expect-error undeclared request type
  await client.send('demo/unknown', { id: 'a' })
  // @ts-expect-error wrong request shape (id must be a string)
  await client.send('demo/get', { id: 1 })
  // @ts-expect-error missing required field
  await client.send('demo/get', {})

  // @ts-expect-error response data does not have the claimed shape
  const wrong: Result<{ name: string }> = await client.send('demo/get', { id: 'a' })
  void wrong

  createRouter<Requests>({
    'demo/get': async (req) => ({ id: req.id, count: 1 }),
    'demo/ping': async () => {},
  })

  // @ts-expect-error router must handle every declared type
  createRouter<Requests>({ 'demo/get': async (req) => ({ id: req.id, count: 1 }) })

  createRouter<Requests>({
    // @ts-expect-error handler returns the wrong response shape
    'demo/get': async () => ({ id: 1 }),
    'demo/ping': async () => {},
  })

  createRouter<Requests>({
    // @ts-expect-error handlers must return a Promise
    'demo/get': (req) => ({ id: req.id, count: 1 }),
    'demo/ping': async () => {},
  })

  await emit<Events>('demo/changed', { ids: ['a'] })
  // @ts-expect-error undeclared event type
  await emit<Events>('demo/other', { ids: [] })
  // @ts-expect-error wrong event payload
  await emit<Events>('demo/changed', { ids: 'a' })

  onEvent<Events>({ 'demo/changed': (p) => void p.ids.length })
  // @ts-expect-error undeclared event in subscriber map
  onEvent<Events>({ 'demo/other': () => {} })
}
