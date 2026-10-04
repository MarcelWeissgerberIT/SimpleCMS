import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import * as Y from 'yjs'

const SERVER = new URL('../dist/index.js', import.meta.url).pathname

/**
 * A FAKE master key for test servers that need an explicit DATA_KEY (production mode): 32 ASCII bytes
 * that say what they are. Never use it anywhere else (`openssl rand -base64 32` makes a real one).
 */
export const TEST_DATA_KEY = Buffer.from('test-only-data-key-not-a-secret!', 'utf8').toString('base64')

const created: string[] = []
/** A temp directory removed when the test process exits. */
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'one-test-'))
  created.push(dir)
  return dir
}
process.on('exit', () => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
})

export interface TestServer {
  url: string
  port: number
  dataDir: string
  env: Record<string, string>
  logs: () => string
  stop(): Promise<number | null>
}

/** Spawns the built server (dist/index.js) on a random port with a temp DATA_DIR and DEV_MODE=1. */
export async function startServer(env: Record<string, string> = {}, dataDir = tempDir()): Promise<TestServer> {
  const fullEnv: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    PORT: '0',
    HOST: '127.0.0.1',
    DATA_DIR: dataDir,
    DEV_MODE: '1',
    APP_DIR: join(dataDir, 'no-app-build'),
    ...env,
  }
  const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SERVER], { env: fullEnv, stdio: ['ignore', 'pipe', 'pipe'] })
  const out: string[] = []
  proc.stdout.on('data', (b: Buffer) => out.push(b.toString()))
  proc.stderr.on('data', (b: Buffer) => out.push(b.toString()))
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${out.join('')}`)), 10_000)
    proc.stdout.on('data', () => {
      const m = /listening port=(\d+)/.exec(out.join(''))
      if (m) {
        clearTimeout(timer)
        resolve(Number(m[1]))
      }
    })
    proc.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`server exited with ${code}:\n${out.join('')}`))
    })
  })
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    dataDir,
    env: fullEnv,
    logs: () => out.join(''),
    stop: () => stopProcess(proc),
  }
}

function stopProcess(proc: ChildProcess): Promise<number | null> {
  if (proc.exitCode !== null) return Promise.resolve(proc.exitCode)
  return new Promise((resolve) => {
    proc.once('exit', (code) => resolve(code))
    proc.kill('SIGTERM')
  })
}

/** Runs the server process to completion (for configs that must refuse to start). */
export function runServerExpectingExit(env: Record<string, string>): Promise<{ code: number | null; output: string }> {
  const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SERVER], {
    env: { PATH: process.env.PATH ?? '', PORT: '0', HOST: '127.0.0.1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  proc.stdout.on('data', (b: Buffer) => (output += b.toString()))
  proc.stderr.on('data', (b: Buffer) => (output += b.toString()))
  const timer = setTimeout(() => proc.kill('SIGKILL'), 10_000)
  return new Promise((resolve) =>
    proc.once('exit', (code) => {
      clearTimeout(timer)
      resolve({ code, output })
    }),
  )
}

export interface JsonResult<T = any> {
  status: number
  body: T
  res: Response
}

/** fetch with a cookie jar and JSON helpers; never follows redirects. */
export class Client {
  readonly base: string
  readonly cookies = new Map<string, string>()

  constructor(base: string) {
    this.base = base
  }

  cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
  }

  async fetch(path: string, init: { method?: string; json?: unknown; body?: RequestInit["body"]; headers?: Record<string, string> } = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    let body = init.body
    if (init.json !== undefined) {
      headers.set('content-type', 'application/json')
      body = JSON.stringify(init.json)
    }
    if (this.cookies.size) headers.set('cookie', this.cookieHeader())
    const res = await fetch(this.base + path, { method: init.method ?? 'GET', headers, body, redirect: 'manual', duplex: 'half' } as RequestInit)
    for (const line of res.headers.getSetCookie()) {
      const [pair = '', ...attrs] = line.split(';')
      const i = pair.indexOf('=')
      const name = pair.slice(0, i).trim()
      const value = pair.slice(i + 1).trim()
      if (!value || attrs.some((a) => /^\s*max-age=0\s*$/i.test(a))) this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
    return res
  }

  async json<T = any>(method: string, path: string, json?: unknown): Promise<JsonResult<T>> {
    const res = await this.fetch(path, { method, json: json ?? (method === 'GET' ? undefined : {}) })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null, res }
  }

  get = <T = any>(path: string) => this.json<T>('GET', path)
  post = <T = any>(path: string, json?: unknown) => this.json<T>('POST', path, json)
  patch = <T = any>(path: string, json?: unknown) => this.json<T>('PATCH', path, json)
  del = <T = any>(path: string) => this.json<T>('DELETE', path)
}

export async function mailbox(server: TestServer, to?: string): Promise<Array<{ to: string; subject: string; text: string; link: string }>> {
  const res = await fetch(`${server.url}/api/dev/mailbox${to ? `?to=${encodeURIComponent(to)}` : ''}`)
  return (await res.json()) as Array<{ to: string; subject: string; text: string; link: string }>
}

/** Full magic-link sign-in in one browser (request → mailbox → verify). */
export async function signIn(server: TestServer, email: string): Promise<Client> {
  const client = new Client(server.url)
  const req = await client.post('/api/auth/request', { email })
  if (req.status !== 204) throw new Error(`auth request failed: ${req.status} ${JSON.stringify(req.body)}`)
  const [mail] = await mailbox(server, email)
  if (!mail) throw new Error(`no mail for ${email}`)
  const url = new URL(mail.link)
  const res = await client.fetch(url.pathname + url.search)
  if (res.status !== 302) throw new Error(`verify failed: ${res.status}`)
  return client
}

export async function waitFor(check: () => boolean | Promise<boolean>, timeout = 5000, label = 'condition'): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await check()) return
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error(`timed out waiting for ${label}`)
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface DocClient {
  doc: Y.Doc
  provider: HocuspocusProvider
  closes: string[]
  /** resolves with 'read-write' | 'readonly', rejects with the server's reason */
  ready: Promise<string>
  synced: Promise<void>
  destroy(): void
}

/** A Hocuspocus provider that carries the client's session cookie on the WebSocket upgrade. */
export function openDoc(server: TestServer, client: Client | null, name: string, extraHeaders: Record<string, string> = {}): DocClient {
  const headers = { ...extraHeaders, ...(client?.cookies.size ? { cookie: client.cookieHeader() } : {}) }
  class CookieWebSocket extends WebSocket {
    constructor(url: string | URL) {
      super(url, { headers } as unknown as string[])
    }
  }
  const socket = new HocuspocusProviderWebsocket({ url: `${server.url.replace(/^http/, 'ws')}/collab`, WebSocketPolyfill: CookieWebSocket, maxAttempts: 1 })
  const doc = new Y.Doc()
  const provider = new HocuspocusProvider({ websocketProvider: socket, name, document: doc })
  const closes: string[] = []
  provider.on('close', ({ event }: { event: { reason: string } }) => closes.push(event.reason))
  const ready = new Promise<string>((resolve, reject) => {
    provider.on('authenticated', ({ scope }: { scope: string }) => resolve(scope))
    provider.on('authenticationFailed', ({ reason }: { reason: string }) => reject(new Error(reason)))
  })
  ready.catch(() => {})
  const synced = new Promise<void>((resolve) => provider.on('synced', () => resolve()))
  provider.attach()
  return {
    doc,
    provider,
    closes,
    ready,
    synced,
    destroy() {
      provider.destroy()
      socket.destroy()
    },
  }
}

/** Waits until the server acknowledged every local change. */
export const flushed = (d: DocClient) => waitFor(() => d.provider.unsyncedChanges === 0 && d.provider.isSynced, 5000, 'server ack')

/**
 * A minimal SMTP server (so a test server runs with SMTP, as deployments do). It accepts every mail —
 * except to recipients `reject` names, which get "550" (the server's mail then fails, as a bounce would).
 */
export async function smtpSink(opts: { reject?: (rcpt: string) => boolean } = {}): Promise<{ port: number; mails: string[]; close: () => Promise<void> }> {
  const mails: string[] = []
  const server: Server = createServer((sock) => {
    sock.setEncoding('utf8')
    let buf = ''
    let inData = false
    sock.write('220 sink ESMTP\r\n')
    sock.on('data', (chunk: string) => {
      buf += chunk
      for (;;) {
        if (inData) {
          const end = buf.indexOf('\r\n.\r\n')
          if (end === -1) return
          mails.push(buf.slice(0, end))
          buf = buf.slice(end + 5)
          inData = false
          sock.write('250 queued\r\n')
          continue
        }
        const nl = buf.indexOf('\r\n')
        if (nl === -1) return
        const line = buf.slice(0, nl)
        const verb = line.slice(0, 4).toUpperCase()
        buf = buf.slice(nl + 2)
        if (verb === 'EHLO') sock.write('250-sink\r\n250 8BITMIME\r\n')
        else if (verb === 'RCPT' && opts.reject?.(/<([^>]*)>/.exec(line)?.[1] ?? '')) sock.write('550 no such user\r\n')
        else if (verb === 'DATA') {
          inData = true
          sock.write('354 go ahead\r\n')
        } else if (verb === 'QUIT') {
          sock.end('221 bye\r\n')
          return
        } else sock.write('250 ok\r\n')
      }
    })
    sock.on('error', () => {})
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  return { port, mails, close: () => new Promise((resolve) => server.close(() => resolve())) }
}

/** The text of a MIME mail with quoted-printable and base64 parts decoded. */
export function decodeMail(raw: string): string {
  const qp = raw.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
  const b64 = [...raw.matchAll(/\r\n\r\n([A-Za-z0-9+/=\r\n]{40,})(?:\r\n--|$)/g)].map((m) => Buffer.from(m[1]!.replace(/\r\n/g, ''), 'base64').toString('utf8'))
  return [qp, ...b64].join('\n')
}
