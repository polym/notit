// Minimal static file server bound to 127.0.0.1 on a random port.
// E2E, corpus and perf tests serve their fixture pages from here so no test touches the network.
import { createServer, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

/** Requests under this prefix are answered with an empty 204 after SLOW_DELAY_MS (slow favicon tests). */
export const SLOW_PREFIX = '/__slow/'
export const SLOW_DELAY_MS = 3000

export interface StaticServer {
  /** Origin such as http://127.0.0.1:54321 (no trailing slash). */
  origin: string
  /** Paths of every request received under SLOW_PREFIX, in arrival order. */
  slowHits: string[]
  close(): Promise<void>
}

export async function startStaticServer(rootDir: string): Promise<StaticServer> {
  const root = resolve(rootDir)
  const slowHits: string[] = []
  const server: Server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
    if (pathname.startsWith(SLOW_PREFIX)) {
      slowHits.push(pathname)
      setTimeout(() => res.writeHead(204).end(), SLOW_DELAY_MS)
      return
    }
    const filePath = normalize(join(root, pathname.endsWith('/') ? `${pathname}index.html` : pathname))
    // Refuse anything that escapes the served directory.
    if (filePath !== root && !filePath.startsWith(root + sep)) {
      res.writeHead(403).end()
      return
    }
    readFile(filePath).then(
      (body) => {
        res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' })
        res.end(body)
      },
      () => {
        res.writeHead(404).end()
      },
    )
  })
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('static server has no port')
  return {
    origin: `http://127.0.0.1:${address.port}`,
    slowHits,
    close: () =>
      new Promise<void>((resolveClose) => {
        server.close(() => resolveClose())
        // A still-open browser keeps keep-alive sockets; without this close() waits for them to time out.
        server.closeAllConnections()
      }),
  }
}
