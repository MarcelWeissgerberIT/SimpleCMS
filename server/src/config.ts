import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

declare const __VERSION__: string
export const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : '0.0.0-dev'

export type SignupPolicy = { mode: 'open' } | { mode: 'invite' } | { mode: 'domains'; domains: string[] }

export interface Config {
  production: boolean
  devMode: boolean
  port: number
  host: string
  /** Origin without trailing slash, e.g. https://cloud.example.com. Finalised after listen() when derived. */
  publicUrl: string
  publicUrlFromEnv: boolean
  dataDir: string
  secret: Buffer
  /** Master key (KEK, DATA_KEY): wraps every workspace's data key. Never the same as SECRET. */
  dataKey: Buffer
  smtpUrl: string | null
  mailFrom: string
  signup: SignupPolicy
  /** Server admins (ADMIN_EMAILS, normalised): they create registration links and may always create their account. */
  adminEmails: string[]
  maxUploadBytes: number
  appDir: string
  trustProxy: boolean
  /** Sign-in link requests per client IP per 15 minutes (20; only DEV_MODE may change it, via AUTH_IP_LIMIT). */
  authIpLimit: number
  /** Public API (/api/v1): requests per minute per token and per incoming webhook (API_RATE_LIMIT, default 120). */
  apiRateLimit: number
  /** AGPL §13: where users of this server can get its source (set it when you run a modified version). */
  sourceUrl: string
  version: string
  /** Custom agents on the server (docs/CLOUD.md § Agents). */
  agents: AgentConfig
  /**
   * DEV_MODE test servers only (MEDIA_FETCH_HOSTS="media.e2e.test=127.0.0.1:4601,…"): made-up names that
   * POST …/files/fetch reaches on this machine over plain HTTP — every other address goes through the SSRF
   * guard (http/ssrf.ts). Empty in every deployment.
   */
  mediaFetchHosts: Record<string, string>
  /** The coding relay for cloud workers (docs/CLOUD.md § Coding relay): CODING_RELAY=off switches it off. */
  codingRelay: boolean
  /** How often the relay pings its sockets (25 s; only DEV_MODE may change it, via CODING_PING_MS). */
  codingPingMs: number
}

export interface AgentConfig {
  /** AGENTS=off turns the server runner off (no scheduler, no runs, no outbound calls to Claude). */
  enabled: boolean
  /** The Messages API (ANTHROPIC_BASE_URL, default https://api.anthropic.com). */
  apiUrl: string
  /** Runs at the same time, over all workspaces (AGENT_CONCURRENCY, default 4); per workspace at most 2. */
  concurrency: number
  /** How often schedules are checked (30 s; only DEV_MODE may change it, via AGENT_TICK_MS). */
  tickMs: number
  /** Row triggers collect changes this long into one run (60 s; DEV_MODE: AGENT_COALESCE_MS). */
  coalesceMs: number
}

export class ConfigError extends Error {}

/** Default sign-in link requests per client IP per 15 minutes (docs/CLOUD.md § Security notes). */
export const AUTH_IP_LIMIT = 20

/** Default public API requests per minute per token / per incoming webhook (docs/API.md § Limits). */
export const API_RATE_LIMIT = 120

/** server/ — the bundle lives in server/dist, sources in server/src. */
const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production'
  const devMode = flag(env.DEV_MODE)
  if (production && devMode) throw new ConfigError('DEV_MODE must not be enabled when NODE_ENV=production')

  const port = int(env.PORT, 8080, 0, 65535, 'PORT')
  const dataDir = resolveDataDir(env)
  mkdirSync(dataDir, { recursive: true })

  let publicUrl = `http://localhost:${port}`
  if (env.PUBLIC_URL) publicUrl = parsePublicUrl(env.PUBLIC_URL)
  else if (production) throw new ConfigError('PUBLIC_URL is required in production (e.g. https://cloud.example.com)')

  // test suites sign many accounts in from one address; a deployment keeps the documented limit
  if (env.AUTH_IP_LIMIT && !devMode) throw new ConfigError('AUTH_IP_LIMIT is only honoured with DEV_MODE=1 (test servers); deployments keep 20 sign-in requests per IP per 15 minutes')
  const authIpLimit = devMode ? int(env.AUTH_IP_LIMIT, AUTH_IP_LIMIT, 1, 100_000, 'AUTH_IP_LIMIT') : AUTH_IP_LIMIT

  if (env.MEDIA_FETCH_HOSTS && !devMode) throw new ConfigError('MEDIA_FETCH_HOSTS is only honoured with DEV_MODE=1 (test servers); deployments fetch media through the SSRF guard only')
  if (env.CODING_PING_MS && !devMode) throw new ConfigError('CODING_PING_MS is only honoured with DEV_MODE=1 (test servers); deployments ping relay sockets every 25 s')
  for (const name of ['AGENT_TICK_MS', 'AGENT_COALESCE_MS']) {
    if (env[name] && !devMode) throw new ConfigError(`${name} is only honoured with DEV_MODE=1 (test servers); deployments check schedules every 30 s and collect row changes for 60 s`)
  }

  const smtpUrl = env.SMTP_URL?.trim() || null
  const host = new URL(publicUrl).hostname
  const mailFrom = env.MAIL_FROM?.trim() || `SimpleCMS One <no-reply@${host.includes('.') ? host : 'localhost.localdomain'}>`
  const secret = loadSecret(env.SECRET, production, dataDir)

  return {
    production,
    devMode,
    port,
    host: env.HOST || '0.0.0.0',
    publicUrl,
    publicUrlFromEnv: !!env.PUBLIC_URL,
    dataDir,
    secret,
    dataKey: loadDataKey(env, production, dataDir, secret),
    smtpUrl,
    mailFrom,
    signup: parseSignup(env.SIGNUP),
    adminEmails: parseAdminEmails(env.ADMIN_EMAILS),
    maxUploadBytes: Math.round(num(env.MAX_UPLOAD_MB, 25, 'MAX_UPLOAD_MB') * 1024 * 1024),
    appDir: resolve(env.APP_DIR || join(serverRoot, '..', 'dist')),
    trustProxy: flag(env.TRUST_PROXY),
    authIpLimit,
    apiRateLimit: int(env.API_RATE_LIMIT, API_RATE_LIMIT, 1, 100_000, 'API_RATE_LIMIT'),
    sourceUrl: env.SOURCE_URL?.trim() || 'https://github.com/MarcelWeissgerberIT/SimpleCMS',
    version: VERSION,
    agents: {
      enabled: !['0', 'off', 'false', 'no'].includes((env.AGENTS ?? '').trim().toLowerCase()),
      apiUrl: parseApiUrl(env.ANTHROPIC_BASE_URL),
      concurrency: int(env.AGENT_CONCURRENCY, 4, 1, 32, 'AGENT_CONCURRENCY'),
      tickMs: devMode ? int(env.AGENT_TICK_MS, 30_000, 50, 3_600_000, 'AGENT_TICK_MS') : 30_000,
      coalesceMs: devMode ? int(env.AGENT_COALESCE_MS, 60_000, 0, 3_600_000, 'AGENT_COALESCE_MS') : 60_000,
    },
    mediaFetchHosts: devMode ? parseFetchHosts(env.MEDIA_FETCH_HOSTS) : {},
    codingRelay: !['0', 'off', 'false', 'no'].includes((env.CODING_RELAY ?? '').trim().toLowerCase()),
    codingPingMs: devMode ? int(env.CODING_PING_MS, 25_000, 50, 600_000, 'CODING_PING_MS') : 25_000,
  }
}

/** MEDIA_FETCH_HOSTS (DEV_MODE): "name=ip:port,…" — made-up test names mapped to local fixtures. */
function parseFetchHosts(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (raw ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = /^([a-z0-9.-]+)=(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/i.exec(part)
    if (!m) throw new ConfigError(`MEDIA_FETCH_HOSTS entries look like name=127.0.0.1:4601 (got "${part}")`)
    out[(m[1] ?? '').toLowerCase()] = `${m[2]}:${m[3]}`
  }
  return out
}

/** ANTHROPIC_BASE_URL: the Messages API origin (a proxy in front of it, or a fake one in tests). */
function parseApiUrl(raw: string | undefined): string {
  const v = raw?.trim()
  if (!v) return 'https://api.anthropic.com'
  let url: URL
  try {
    url = new URL(v)
  } catch {
    throw new ConfigError(`ANTHROPIC_BASE_URL is not a valid URL: ${v}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new ConfigError('ANTHROPIC_BASE_URL must start with https:// (or http:// for a local proxy)')
  if (url.username || url.password) throw new ConfigError('ANTHROPIC_BASE_URL must not contain credentials')
  return v.replace(/\/+$/, '')
}

export const isSecureUrl = (url: string) => url.startsWith('https://')

/** DATA_DIR, default /data in production and server/.data in development. */
export const resolveDataDir = (env: NodeJS.ProcessEnv = process.env) =>
  resolve(env.DATA_DIR || (env.NODE_ENV === 'production' ? '/data' : join(serverRoot, '.data')))

function flag(v: string | undefined): boolean {
  return v === '1' || v === 'true' || v === 'yes'
}

function int(v: string | undefined, fallback: number, min: number, max: number, name: string): number {
  if (v === undefined || v === '') return fallback
  const n = Number(v)
  if (!Number.isInteger(n) || n < min || n > max) throw new ConfigError(`${name} must be an integer between ${min} and ${max}`)
  return n
}

function num(v: string | undefined, fallback: number, name: string): number {
  if (v === undefined || v === '') return fallback
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0 || n > 4096) throw new ConfigError(`${name} must be a positive number (MB)`)
  return n
}

function parsePublicUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new ConfigError(`PUBLIC_URL is not a valid URL: ${raw}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new ConfigError('PUBLIC_URL must start with https:// or http://')
  if (url.pathname !== '/' || url.search || url.hash) throw new ConfigError('PUBLIC_URL must be an origin without a path (the app is served at /app/)')
  return url.origin
}

/** An email domain as SIGNUP, invites and registration links take it: lower case, no "@", at least one dot. */
export const normalizeDomain = (d: string) => d.trim().toLowerCase().replace(/^@/, '')
export const isDomain = (d: string) => d.length <= 253 && /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(d)

export function parseSignup(raw: string | undefined): SignupPolicy {
  const v = (raw ?? 'open').trim()
  if (v === '' || v === 'open') return { mode: 'open' }
  if (v === 'invite') return { mode: 'invite' }
  if (v.startsWith('domains:')) {
    const domains = v.slice('domains:'.length).split(',').map(normalizeDomain).filter(Boolean)
    if (!domains.length || domains.some((d) => !isDomain(d))) throw new ConfigError(`SIGNUP domains are invalid: ${v}`)
    return { mode: 'domains', domains }
  }
  throw new ConfigError(`SIGNUP must be "open", "invite" or "domains:example.com,example.de" (got "${v}")`)
}

/** ADMIN_EMAILS: comma- (or space-) separated addresses of the server admins; empty = none. */
export function parseAdminEmails(raw: string | undefined): string[] {
  const list = (raw ?? '')
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  const bad = list.filter((e) => e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
  if (bad.length) throw new ConfigError(`ADMIN_EMAILS must be a comma-separated list of email addresses (not valid: ${bad.join(', ')})`)
  return [...new Set(list)]
}

/**
 * SECRET keys the HMAC that stores tokens. Production refuses to start without one; in development a
 * random secret is generated once and kept in DATA_DIR so sessions survive restarts.
 */
function loadSecret(raw: string | undefined, production: boolean, dataDir: string): Buffer {
  if (raw && raw.trim()) {
    const s = raw.trim()
    const bytes = /^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0 ? Buffer.from(s, 'hex') : Buffer.from(s, 'base64')
    if (bytes.length < 32) throw new ConfigError('SECRET must be at least 32 random bytes, hex or base64 encoded (try: openssl rand -hex 32)')
    return bytes
  }
  if (production) throw new ConfigError('SECRET is required in production (generate one with: openssl rand -hex 32)')
  const file = join(dataDir, 'dev-secret')
  if (existsSync(file)) return Buffer.from(readFileSync(file, 'utf8').trim(), 'hex')
  const secret = randomBytes(32)
  writeFileSync(file, secret.toString('hex'), { mode: 0o600 })
  return secret
}

/** How to make a DATA_KEY — part of every message about it. */
export const DATA_KEY_HINT = 'generate one with: openssl rand -base64 32'

/** A 32-byte key, hex (64 chars) or base64 / base64url (43–44 chars). */
export function parseKey(raw: string, name: string): Buffer {
  const s = raw.trim()
  let bytes: Buffer | null = null
  if (/^[0-9a-fA-F]{64}$/.test(s)) bytes = Buffer.from(s, 'hex')
  else if (/^[A-Za-z0-9+/]{43}=?$/.test(s)) bytes = Buffer.from(s, 'base64')
  else if (/^[A-Za-z0-9_-]{43}$/.test(s)) bytes = Buffer.from(s, 'base64url')
  if (!bytes || bytes.length !== 32) throw new ConfigError(`${name} must be exactly 32 random bytes, base64 or hex encoded (${DATA_KEY_HINT})`)
  return bytes
}

/**
 * DATA_KEY wraps every workspace's data key (encryption at rest, docs/CLOUD.md § Tenancy & encryption
 * at rest). Production refuses to start without one; in development a key is generated once into
 * DATA_DIR/dev-data-key. It must not be SECRET: rotating SECRET (sign everyone out) must never touch data.
 */
export function loadDataKey(env: NodeJS.ProcessEnv, production: boolean, dataDir: string, secret?: Buffer): Buffer {
  let key: Buffer
  if (env.DATA_KEY?.trim()) key = parseKey(env.DATA_KEY, 'DATA_KEY')
  else if (production) {
    throw new ConfigError(
      `DATA_KEY is required in production: it encrypts every workspace's documents and files at rest. ${DATA_KEY_HINT[0]!.toUpperCase()}${DATA_KEY_HINT.slice(1)}, ` +
        'put it into .env as DATA_KEY=… and keep a copy apart from your backups (password manager) — backups cannot be read without it',
    )
  } else {
    const file = join(dataDir, 'dev-data-key')
    if (existsSync(file)) key = parseKey(readFileSync(file, 'utf8'), `DATA_KEY (from ${file})`)
    else {
      key = randomBytes(32)
      writeFileSync(file, key.toString('base64'), { mode: 0o600 })
    }
  }
  if (secret && secret.equals(key)) throw new ConfigError('DATA_KEY must not be the same as SECRET (rotating SECRET must never touch the data) — ' + DATA_KEY_HINT)
  return key
}
