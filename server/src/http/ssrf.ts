import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP } from 'node:net'

/**
 * Outbound HTTPS for a member's request (POST …/files/fetch) — the SSRF guard:
 *  - https only, no credentials in the URL, default port (443) or 8443;
 *  - every address the name resolves to must be public: no loopback, private (RFC 1918), CGNAT, link-local
 *    (169.254 — cloud metadata), multicast, reserved, documentation, unique-local / link-local IPv6, NAT64 /
 *    6to4 and IPv4-mapped forms of those. The connection goes to the address that was checked (the lookup is
 *    pinned), so a second DNS answer can't swap it (rebinding);
 *  - redirects are followed by hand (at most 3) and every hop is checked again;
 *  - timeouts for the answer and the whole download.
 * Tests (DEV_MODE only): `hosts` maps a made-up name to a local address — reached over plain HTTP, and only
 * that exact name; everything else goes through the guard.
 */

export class FetchRefused extends Error {
  readonly code: 'url_blocked' | 'fetch_failed' | 'too_many_redirects'
  readonly status?: number
  constructor(code: FetchRefused['code'], message: string, status?: number) {
    super(message)
    this.name = 'FetchRefused'
    this.code = code
    this.status = status
  }
}

const blocked = new BlockList()
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(net, bits, 'ipv4')
for (const [net, bits] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const)
  blocked.addSubnet(net, bits, 'ipv6')

/** An IPv4 address embedded as IPv4-mapped / -compatible IPv6 ("::ffff:10.0.0.1", "::ffff:a00:1"), else null. */
function embeddedV4(ip: string): string | null {
  const v = ip.toLowerCase()
  const dotted = /^(?:0*:)*:?(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(v.replace(/^\[|\]$/g, ''))
  const d = dotted?.[1]
  if (d && isIP(d) === 4) return d
  const hex = /^(?:0*:)*:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v)
  if (hex) {
    const a = parseInt(hex[1] ?? '0', 16)
    const b = parseInt(hex[2] ?? '0', 16)
    return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`
  }
  return null
}

/** The address must not be fetched (anything that is not plainly public). */
export function isBlockedAddress(ip: string): boolean {
  const addr = ip.replace(/^\[|\]$/g, '').split('%')[0] ?? ''
  const fam = isIP(addr)
  if (fam === 4) return blocked.check(addr, 'ipv4')
  if (fam === 6) {
    const v4 = embeddedV4(addr)
    if (v4) return blocked.check(v4, 'ipv4')
    return blocked.check(addr, 'ipv6')
  }
  return true
}

const LOCAL_NAMES = /(^|\.)(localhost|local|internal|intranet|home|lan|corp|localdomain)$/i

/** Why a URL is refused before any lookup ('' = fine). */
export function urlProblem(raw: string, hosts: Record<string, string> = {}): string {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return 'not a URL'
  }
  if (u.username || u.password) return 'credentials in the URL'
  const host = u.hostname.toLowerCase()
  if (hosts[host]) return u.protocol === 'https:' || u.protocol === 'http:' ? '' : 'https only'
  if (u.protocol !== 'https:') return 'https only'
  if (u.port && u.port !== '443' && u.port !== '8443') return 'port not allowed'
  if (!host || LOCAL_NAMES.test(host.replace(/\.$/, ''))) return 'local name'
  if (isIP(host.replace(/^\[|\]$/g, '')) && isBlockedAddress(host)) return 'private address'
  return ''
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void

/** A lookup that refuses names resolving to any blocked address (all of them are checked). */
export function guardedLookup(hostname: string, options: { all?: boolean; family?: number } | number | undefined, cb: LookupCb): void {
  const opts = typeof options === 'object' && options ? options : {}
  dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return cb(err, '')
    const list = (addresses as LookupAddress[]).filter((a) => !opts.family || a.family === opts.family)
    if (!list.length) return cb(Object.assign(new Error(`no address for ${hostname}`), { code: 'ENOTFOUND' }), '')
    const bad = list.find((a) => isBlockedAddress(a.address))
    if (bad) return cb(Object.assign(new Error('address not allowed'), { code: 'EBLOCKED' }), '')
    if (opts.all) return cb(null, list)
    const first = list[0]!
    cb(null, first.address, first.family)
  })
}

export interface GuardedResponse {
  status: number
  headers: IncomingMessage['headers']
  body: IncomingMessage
  /** the address the bytes came from (after redirects) */
  url: string
}

export interface GuardOptions {
  /** DEV_MODE test hosts: name → "ip:port" (plain HTTP, no guard for exactly these names) */
  hosts?: Record<string, string>
  /** ms until the answer's headers (default 15 s) */
  timeoutMs?: number
  maxRedirects?: number
  signal?: AbortSignal
}

/** GET `raw` through the guard; resolves with the answer (body unread) or throws FetchRefused. */
export async function guardedGet(raw: string, opts: GuardOptions = {}): Promise<GuardedResponse> {
  const hosts = opts.hosts ?? {}
  let url = raw
  for (let hop = 0; ; hop++) {
    const problem = urlProblem(url, hosts)
    if (problem) throw new FetchRefused('url_blocked', problem)
    const res = await getOnce(url, hosts, opts)
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      res.body.resume()
      if (hop >= (opts.maxRedirects ?? 3)) throw new FetchRefused('too_many_redirects', 'too many redirects')
      try {
        url = new URL(String(res.headers.location), url).href
      } catch {
        throw new FetchRefused('fetch_failed', 'bad redirect')
      }
      continue
    }
    return { ...res, url }
  }
}

function getOnce(raw: string, hosts: Record<string, string>, opts: GuardOptions): Promise<Omit<GuardedResponse, 'url'>> {
  const u = new URL(raw)
  const mapped = hosts[u.hostname.toLowerCase()]
  return new Promise((resolve, reject) => {
    const headers = { 'user-agent': 'SimpleCMS-One-media-fetch/1', accept: 'image/*, video/*, audio/*;q=0.9, */*;q=0.1', 'accept-encoding': 'identity' }
    const done = (err: unknown) => {
      const e = err as NodeJS.ErrnoException
      if (e?.code === 'EBLOCKED') reject(new FetchRefused('url_blocked', 'private address'))
      else reject(new FetchRefused('fetch_failed', e?.code || (e instanceof Error ? e.message : String(e))))
    }
    let req
    if (mapped) {
      // DEV_MODE test host: the fixture on this machine, plain HTTP, the name kept as Host
      const [host, port] = mapped.split(':')
      req = httpRequest({ host, port: Number(port), path: `${u.pathname}${u.search}`, method: 'GET', headers: { ...headers, host: u.host }, signal: opts.signal })
    } else {
      req = httpsRequest(raw, { method: 'GET', headers, lookup: guardedLookup as never, signal: opts.signal })
    }
    req.setTimeout(opts.timeoutMs ?? 15_000, () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })))
    req.on('error', done)
    req.on('response', (res) => {
      req.setTimeout(0)
      resolve({ status: res.statusCode ?? 0, headers: res.headers, body: res })
    })
    req.end()
  })
}
