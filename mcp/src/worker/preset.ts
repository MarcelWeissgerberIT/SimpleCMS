/**
 * one-worker — the preset a download from One carries (`globalThis.ONE_WORKER_PRESET`, the line One writes
 * right after the shebang; protocol.ts WorkerPreset). It fixes the connection: the workspace, the One site
 * the download came from (the ONLY page origin accepted — plus any loopback port when `dev`), the port and
 * the pairing secret every tab must say hello with. Everything is checked here; a preset that does not
 * check out is ignored as a whole (the worker then behaves like a plain download: worker.json).
 *
 * A cloud preset (`cloud: { token }`, team workspaces) dials the team server at `origin` instead of waiting
 * for a tab on 127.0.0.1; `pair` then keys the end-to-end encryption of every frame through the relay (box.ts).
 */
import { timingSafeEqual, createHash } from 'node:crypto'
import { PAIR_SECRET, PRESET_GLOBAL, RELAY_WORKER_PATH, WORKER_TOKEN, WORKSPACE_ID, type WorkerPreset } from '../../../src/app/features/coding/protocol.ts'
import { allowedOrigins, normalizeOrigin } from '../policy.ts'

export type { WorkerPreset }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** The loopback origins a `dev` preset adds (One served by a dev server on this machine). */
export const DEV_ORIGINS = ['http://localhost:*', 'http://127.0.0.1:*']

/** Check a preset. Returns null (and why) when anything is off. */
export function readPreset(raw: unknown): { preset: WorkerPreset | null; problem: string | null } {
  if (raw === undefined || raw === null) return { preset: null, problem: null }
  if (!isObj(raw)) return { preset: null, problem: 'the preset is not an object' }
  const workspace = typeof raw.workspace === 'string' ? raw.workspace.trim() : ''
  if (!WORKSPACE_ID.test(workspace)) return { preset: null, problem: `the preset's workspace ${JSON.stringify(raw.workspace)} is not a workspace id` }
  const origin = typeof raw.origin === 'string' ? normalizeOrigin(raw.origin) : null
  if (!origin || origin.endsWith(':*')) return { preset: null, problem: `the preset's origin ${JSON.stringify(raw.origin)} is not a site origin` }
  const port = typeof raw.port === 'number' && Number.isInteger(raw.port) && raw.port >= 1024 && raw.port <= 65535 ? raw.port : null
  if (port === null) return { preset: null, problem: `the preset's port ${JSON.stringify(raw.port)} is not a port (1024–65535)` }
  const pair = typeof raw.pair === 'string' && PAIR_SECRET.test(raw.pair) ? raw.pair : null
  if (!pair) return { preset: null, problem: 'the preset has no pairing secret' }
  const name = (typeof raw.name === 'string' ? raw.name : '').replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, '').trim().slice(0, 120) || 'One'
  let cloud: WorkerPreset['cloud'] | undefined
  if (raw.cloud !== undefined) {
    // a cloud worker dials the team server's relay: a team workspace, TLS (plain http only to this machine), its own token
    const c = isObj(raw.cloud) ? raw.cloud : {}
    if (typeof c.token !== 'string' || !WORKER_TOKEN.test(c.token)) return { preset: null, problem: "the preset's cloud token is not a worker token" }
    if (!workspace.startsWith('team:')) return { preset: null, problem: 'a cloud worker needs a team workspace' }
    const url = new URL(origin)
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) return { preset: null, problem: 'a cloud worker needs an https origin (plain http only on this computer)' }
    cloud = { token: c.token }
  }
  return { preset: { workspace, origin, port, pair, name, ...(raw.dev === true ? { dev: true } : {}), ...(cloud ? { cloud } : {}) }, problem: null }
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/** The relay a cloud worker dials: https \u2192 wss, http (this computer only) \u2192 ws. */
export function relayUrl(origin: string): string {
  const url = new URL(RELAY_WORKER_PATH, origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.href
}

/** The preset of this file (set by the line after the shebang), checked. */
export function filePreset(): { preset: WorkerPreset | null; problem: string | null } {
  return readPreset((globalThis as Record<string, unknown>)[PRESET_GLOBAL])
}

/**
 * The page origins the worker accepts. With a preset: the preset's origin (+ any loopback port when `dev`) and
 * what the person added themselves (ONE_ORIGINS, "origins" in worker.json) — not the general defaults.
 * Without: the bridge's defaults (getonecms.com, localhost) + those additions.
 */
export function workerOrigins(preset: WorkerPreset | null, extra: string[], warn: (msg: string) => void = () => {}): string[] {
  const added = extra.filter(Boolean).join(',')
  if (!preset) return allowedOrigins(added, warn)
  const out = [preset.origin, ...(preset.dev ? DEV_ORIGINS : [])]
  for (const raw of added.split(',')) {
    if (!raw.trim()) continue
    const o = normalizeOrigin(raw)
    if (!o) warn(`ignoring the origin ${JSON.stringify(raw.trim())} (expected e.g. https://one.example.com or http://localhost:*)`)
    else if (!out.includes(o)) out.push(o)
  }
  return out
}

/** Constant-time comparison of a secret — the pairing secret, the setup page token (both hashed first: equal lengths, no early exit). */
export function sameSecret(expected: string, given: unknown): boolean {
  if (typeof given !== 'string' || given.length > 200) return false
  const a = createHash('sha256').update(expected).digest()
  const b = createHash('sha256').update(given).digest()
  return timingSafeEqual(a, b)
}
