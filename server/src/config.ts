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
  smtpUrl: string | null
  mailFrom: string
  signup: SignupPolicy
  maxUploadBytes: number
  appDir: string
  trustProxy: boolean
  /** AGPL §13: where users of this server can get its source (set it when you run a modified version). */
  sourceUrl: string
  version: string
}

export class ConfigError extends Error {}

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

  const smtpUrl = env.SMTP_URL?.trim() || null
  const host = new URL(publicUrl).hostname
  const mailFrom = env.MAIL_FROM?.trim() || `SimpleCMS One <no-reply@${host.includes('.') ? host : 'localhost.localdomain'}>`

  return {
    production,
    devMode,
    port,
    host: env.HOST || '0.0.0.0',
    publicUrl,
    publicUrlFromEnv: !!env.PUBLIC_URL,
    dataDir,
    secret: loadSecret(env.SECRET, production, dataDir),
    smtpUrl,
    mailFrom,
    signup: parseSignup(env.SIGNUP),
    maxUploadBytes: Math.round(num(env.MAX_UPLOAD_MB, 25, 'MAX_UPLOAD_MB') * 1024 * 1024),
    appDir: resolve(env.APP_DIR || join(serverRoot, '..', 'dist')),
    trustProxy: flag(env.TRUST_PROXY),
    sourceUrl: env.SOURCE_URL?.trim() || 'https://github.com/MarcelWeissgerberIT/SimpleCMS',
    version: VERSION,
  }
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

export function parseSignup(raw: string | undefined): SignupPolicy {
  const v = (raw ?? 'open').trim()
  if (v === '' || v === 'open') return { mode: 'open' }
  if (v === 'invite') return { mode: 'invite' }
  if (v.startsWith('domains:')) {
    const domains = v
      .slice('domains:'.length)
      .split(',')
      .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean)
    if (!domains.length || domains.some((d) => !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d))) throw new ConfigError(`SIGNUP domains are invalid: ${v}`)
    return { mode: 'domains', domains }
  }
  throw new ConfigError(`SIGNUP must be "open", "invite" or "domains:example.com,example.de" (got "${v}")`)
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
