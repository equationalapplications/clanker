import http from 'node:http'
import type { AddressInfo } from 'node:net'

export type WebhookHandler = (req: unknown, res: unknown) => Promise<void>

export interface HarnessServer {
  url: string
  close: () => Promise<void>
}

/**
 * Boots a real HTTP server on an ephemeral port that buffers the body into
 * `req.rawBody` (the single Functions-runtime contract both handlers rely on)
 * and invokes the mounted handler. The response adapter exposes exactly the
 * surface the handlers use: status(code).send(...) / status(code).json(...).
 */
export const startWebhookServer = (handler: WebhookHandler): Promise<HarnessServer> =>
  new Promise((resolve, reject) => {
    const server = http.createServer((nativeReq, nativeRes) => {
      const chunks: Buffer[] = []
      nativeReq.on('data', (chunk: Buffer) => chunks.push(chunk))
      nativeReq.on('end', () => {
        const req = nativeReq as http.IncomingMessage & { rawBody?: Buffer }
        req.rawBody = Buffer.concat(chunks)

        // Response timeout guard: a handler that never responds would leave
        // this socket open past node:test's 10s per-test timeout, keeping the
        // child process alive after the run ends. Race every response against
        // a timer under that budget (9s), destroying the connection on expiry;
        // 'finish' always clears it so normal fast responses are unaffected.
        const responseTimeout = setTimeout(() => nativeRes.destroy(), 9_000)
        nativeRes.on('finish', () => clearTimeout(responseTimeout))

        const res = {
          status: (code: number) => ({
            send: (body?: string) => {
              nativeRes.statusCode = code
              nativeRes.end(body ?? '')
            },
            json: (obj: unknown) => {
              nativeRes.statusCode = code
              nativeRes.setHeader('content-type', 'application/json')
              nativeRes.end(JSON.stringify(obj))
            },
          }),
        }

        void Promise.resolve(handler(req, res)).catch(() => {
          // Handlers catch their own errors; belt-and-braces only.
          if (!nativeRes.headersSent) {
            nativeRes.statusCode = 500
            nativeRes.end('harness error')
          }
        })
      })
    })

    server.on('error', reject)
    server.listen(0, 'localhost', () => {
      const { port } = server.address() as AddressInfo
      resolve({
        url: `http://localhost:${port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      })
    })
  })
