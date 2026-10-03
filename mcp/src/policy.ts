/**
 * Who may connect to the bridge's WebSocket.
 *
 * - Origin: One's own sites only — https://getonecms.com, http://localhost:<any port>,
 *   http://127.0.0.1:<any port> (development, self-hosting) — plus ONE_ORIGINS (comma-separated;
 *   "http://host:*" allows any port). Browsers always send Origin on a WebSocket handshake and a
 *   page cannot fake it, so other websites are turned away; a missing or "null" Origin (sandboxed
 *   frames, file://, non-browser clients) is refused too.
 * - Host: 127.0.0.1 / localhost / [::1] with the bridge's port only — a page that rebinds its own
 *   domain to 127.0.0.1 (DNS rebinding) still sends its own Host and is refused.
 */

export const DEFAULT_ORIGINS = ['https://getonecms.com', 'http://localhost:*', 'http://127.0.0.1:*']

/** "https://Example.com:443/" → "https://example.com"; null when it is not an http(s) origin. */
export function normalizeOrigin(raw: string): string | null {
  const s = raw.trim()
  if (!s || s === 'null') return null
  // keep a ":*" port wildcard through URL parsing
  const wild = /:\*$/.test(s)
  try {
    const u = new URL(wild ? s.replace(/:\*$/, '') : s)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (u.username || u.password || (u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) return null
    return wild ? `${u.protocol}//${u.hostname}:*` : u.origin
  } catch {
    return null
  }
}

/** The allowlist: defaults + ONE_ORIGINS entries (invalid entries are dropped and reported). */
export function allowedOrigins(extra: string | undefined, warn: (msg: string) => void = () => {}): string[] {
  const out = [...DEFAULT_ORIGINS]
  for (const raw of (extra ?? '').split(',')) {
    if (!raw.trim()) continue
    const o = normalizeOrigin(raw)
    if (!o) warn(`ignoring ONE_ORIGINS entry ${JSON.stringify(raw.trim())} (expected e.g. https://one.example.com or http://localhost:*)`)
    else if (!out.includes(o)) out.push(o)
  }
  return out
}

export function isAllowedOrigin(origin: string | undefined, allowed: string[]): boolean {
  if (!origin) return false
  const o = normalizeOrigin(origin)
  if (!o || o.endsWith(':*')) return false
  const u = new URL(o)
  return allowed.some((a) => {
    if (!a.endsWith(':*')) return a === o
    const base = new URL(a.slice(0, -2))
    return base.protocol === u.protocol && base.hostname === u.hostname
  })
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** Host header of a request to the bridge: a loopback name with the bridge's own port. */
export function isAllowedHost(host: string | undefined, port: number): boolean {
  if (!host) return false
  const m = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(host.trim().toLowerCase())
  if (!m) return false
  return LOOPBACK.has(m[1]!) && Number(m[2] ?? 80) === port
}
