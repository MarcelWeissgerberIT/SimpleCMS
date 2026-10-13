/**
 * OpenRouter's catalogue on this device (multi-provider S2, D-S2-34) — a lazy part of the OpenRouter path, never on the
 * boot path:
 *  - loadCatalog(): `GET https://openrouter.ai/api/v1/models` (public, no key, no cookies) — only after OpenRouter was
 *    picked in the setup, its model picker opened, or a Jev Router request needs fresh exclusions; at most once a day
 *    unless forced. Kept compact (src/shared/ai/catalog.ts trimCatalog) in IndexedDB `one-ai-catalog` (per device: never
 *    synced, backed up or exported; a refused store keeps it in memory for the tab), memoised per tab.
 *  - endpointsOf(): `GET /api/v1/models/{author}/{slug}/endpoints` — who serves a model (the tags `provider.only` takes),
 *    only for the shortlist's models, the router, the ≤ 3 role suggestions and a picker's visible rows; ≤ 24 h old.
 *  - pinsFor() / routerPinsFor(): the endpoints a request may use under the workspace's deny list (D-S2-13, D-S2-23).
 *  - loadDecisionCatalog() (slice SJ): `GET /api/v1/models?output_modalities=decisions` — the decision models (only the
 *    Jev family is asked; the rest is listed dimmed), on demand only (setup step 03, the Vorprüfer picker, an agent's
 *    section 06, a decision without any price known); kept with its date and used at ANY age for the price (the
 *    response's `usage.cost` is the bill); fills the sync rows the registry reads (core/decisionRows.ts).
 * A Claude-only person never fetches anything here.
 */
import { createStore, get, set, type UseStore } from 'idb-keyval'
import type { UpstreamRule } from '@/shared/ai/types'
import { expandCatalog, readDecisionRows, trimCatalog, type CatalogRow, type DecisionRow, type StoredCatalog } from '@/shared/ai/catalog'
import { JEV_OPERATOR, JEV_ROUTER } from '@/shared/ai/jev'
import { OR_API } from '@/shared/ai/wire/openrouterChat'
import { noteDecisionRows } from './decisionRows'

export const CATALOG_DB = 'one-ai-catalog'
const DAY_MS = 86_400_000
/** a catalogue or endpoint list older than this is read again */
export const CATALOG_MAX_AGE = DAY_MS
export const OR_MODELS_URL = `${OR_API}/models`

let kv: UseStore | null = null
let broken = false
function store(): UseStore | null {
  if (broken || typeof indexedDB === 'undefined') return null
  try {
    return (kv ??= createStore(CATALOG_DB, 'kv'))
  } catch {
    broken = true
    return null
  }
}
const memory = new Map<string, unknown>()
async function readKey<T>(key: string): Promise<T | undefined> {
  if (memory.has(key)) return memory.get(key) as T
  const s = store()
  if (!s) return undefined
  try {
    const v = (await get(key, s)) as T | undefined
    if (v !== undefined) memory.set(key, v)
    return v
  } catch {
    broken = true
    return undefined
  }
}
async function writeKey(key: string, v: unknown): Promise<void> {
  memory.set(key, v)
  const s = store()
  if (!s) return
  try {
    await set(key, v, s)
  } catch {
    broken = true
  }
}

/** A read of the decisions catalogue or of an endpoint list never takes longer than this — a hanging answer must not
 *  hold a pre-check, a run or a picker. */
export const CATALOG_FETCH_MS = 8_000

/** One public GET → its JSON, under its own time limit (never a caller's stop: the read may be shared). */
async function getJson(url: string): Promise<unknown> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), CATALOG_FETCH_MS)
  try {
    const res = await fetch(url, { method: 'GET', credentials: 'omit', signal: ctl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as unknown
  } finally {
    clearTimeout(timer)
  }
}

/** The caller stops waiting once its signal fires (it gets `fallback`) — a shared read goes on for the others. */
function until<T>(p: Promise<T>, signal: AbortSignal | undefined, fallback: T): Promise<T> {
  if (!signal) return p
  if (signal.aborted) return Promise.resolve(fallback)
  return new Promise<T>((resolve, reject) => {
    const stop = () => resolve(fallback)
    signal.addEventListener('abort', stop, { once: true })
    p.then(
      (v) => {
        signal.removeEventListener('abort', stop)
        resolve(v)
      },
      (e: unknown) => {
        signal.removeEventListener('abort', stop)
        reject(e)
      },
    )
  })
}

/* ------------------------------------------------------------------ */
/* The catalogue                                                        */
/* ------------------------------------------------------------------ */

export interface Catalog {
  /** when it was read (ms) */
  at: number
  rows: CatalogRow[]
}

let memo: Catalog | null = null
let inflight: Promise<Catalog | null> | null = null

/**
 * The catalogue (null: none here and it could not be read). Fresh = read within a day; `force` reads it again now
 * (one public GET). A failed read keeps what the device had.
 */
export async function loadCatalog(o: { force?: boolean; signal?: AbortSignal } = {}): Promise<Catalog | null> {
  if (!o.force && memo && Date.now() - memo.at < CATALOG_MAX_AGE) return memo
  if (inflight) return inflight
  inflight = (async () => {
    if (!o.force) {
      const stored = await readKey<StoredCatalog>('models')
      if (stored && typeof stored.at === 'number' && Date.now() - stored.at < CATALOG_MAX_AGE) return (memo = { at: stored.at, rows: expandCatalog(stored) })
    }
    try {
      const res = await fetch(OR_MODELS_URL, { method: 'GET', credentials: 'omit', signal: o.signal })
      if (!res.ok) throw new Error(`catalogue: HTTP ${res.status}`)
      const trimmed = trimCatalog(await res.json())
      await writeKey('models', trimmed)
      return (memo = { at: trimmed.at, rows: expandCatalog(trimmed) })
    } catch (e) {
      console.warn('[one] the OpenRouter model list could not be read', e instanceof Error ? e.message : e)
      // what the device had, however old (the caller decides whether it is fresh enough)
      const stored = await readKey<StoredCatalog>('models')
      return stored ? (memo = { at: stored.at, rows: expandCatalog(stored) }) : memo
    }
  })().finally(() => (inflight = null))
  return inflight
}

/** One catalogue row (null: not in the catalogue, or no catalogue). Reads it (a GET) when it is missing or stale. */
export async function catalogRow(id: string): Promise<CatalogRow | null> {
  return (await loadCatalog())?.rows.find((r) => r.id === id) ?? null
}

/** The catalogue this device already holds, however old — never a request (null: none). */
export async function peekCatalog(): Promise<Catalog | null> {
  if (memo) return memo
  const stored = await readKey<StoredCatalog>('models')
  return stored ? (memo = { at: stored.at, rows: expandCatalog(stored) }) : null
}

/** Is the catalogue this tab holds fresh enough for a router request (≤ 24 h)? */
export const catalogFresh = (c: Catalog | null | undefined): c is Catalog => !!c && Date.now() - c.at < CATALOG_MAX_AGE

/* ------------------------------------------------------------------ */
/* Decision models (slice SJ)                                           */
/* ------------------------------------------------------------------ */

export const OR_DECISIONS_URL = `${OR_API}/models?output_modalities=decisions`

export interface DecisionCatalog {
  /** when it was read (ms) */
  at: number
  rows: DecisionRow[]
}

let decisionMemo: DecisionCatalog | null = null
let decisionInflight: Promise<DecisionCatalog | null> | null = null
/** a failed read is not tried again for a minute (a run of many changes asks once) */
const DECISIONS_RETRY_MS = 60_000
let decisionFailedAt = 0

const keepDecisions = (c: DecisionCatalog): DecisionCatalog => {
  noteDecisionRows(c.rows, c.at)
  return (decisionMemo = c)
}

/** A stored decisions catalogue (rows read again by this build — a newer rule wins over what was kept). */
function readStoredDecisions(v: unknown): DecisionCatalog | null {
  if (!v || typeof v !== 'object') return null
  const o = v as { at?: unknown; raw?: unknown }
  if (typeof o.at !== 'number' || !Number.isFinite(o.at)) return null
  return { at: o.at, rows: readDecisionRows(o.raw, new Date(o.at).toISOString().slice(0, 10)) }
}

/**
 * The decisions catalogue (null: none here and it could not be read). What the device holds is used at any age unless
 * `force` (one public GET now) or `maxAge` (ms — a picker that shows prices) says otherwise; nothing held → one GET (at
 * most CATALOG_FETCH_MS). `signal`: the caller stops waiting (it gets what the tab holds) — the read itself goes on.
 */
export async function loadDecisionCatalog(o: { force?: boolean; maxAge?: number; signal?: AbortSignal } = {}): Promise<DecisionCatalog | null> {
  const fresh = (c: DecisionCatalog | null) => !!c && (o.maxAge === undefined || Date.now() - c.at < o.maxAge)
  if (!o.force && fresh(decisionMemo)) return decisionMemo
  if (decisionInflight) return until(decisionInflight, o.signal, decisionMemo)
  if (!o.force && Date.now() - decisionFailedAt < DECISIONS_RETRY_MS) return decisionMemo
  decisionInflight = (async () => {
    if (!o.force) {
      const stored = readStoredDecisions(await readKey<unknown>('decisions'))
      if (stored && fresh(stored)) return keepDecisions(stored)
    }
    try {
      const json = await getJson(OR_DECISIONS_URL).catch((e: unknown) => {
        throw new Error(`decision models: ${e instanceof Error ? e.message : String(e)}`)
      })
      const at = Date.now()
      // kept as listed (trimmed to the rows One reads) — small: the decisions list holds a few dozen rows
      const raw = { data: (json && typeof json === 'object' && Array.isArray((json as { data?: unknown }).data) ? (json as { data: unknown[] }).data : []).slice(0, 200) }
      await writeKey('decisions', { at, raw })
      decisionFailedAt = 0
      return keepDecisions({ at, rows: readDecisionRows(raw, new Date(at).toISOString().slice(0, 10)) })
    } catch (e) {
      decisionFailedAt = Date.now()
      console.warn('[one] the decision models could not be read', e instanceof Error ? e.message : e)
      const stored = readStoredDecisions(await readKey<unknown>('decisions'))
      return stored ? keepDecisions(stored) : decisionMemo
    }
  })().finally(() => (decisionInflight = null))
  return until(decisionInflight, o.signal, decisionMemo)
}

/** The decisions catalogue this device already holds, however old — never a request (null: none). */
export async function peekDecisionCatalog(): Promise<DecisionCatalog | null> {
  if (decisionMemo) return decisionMemo
  const stored = readStoredDecisions(await readKey<unknown>('decisions'))
  return stored ? keepDecisions(stored) : null
}

/* ------------------------------------------------------------------ */
/* Endpoints and pins                                                   */
/* ------------------------------------------------------------------ */

export interface Endpoint {
  /** what `provider.only` takes ('nordwind', 'lindenhof/turbo') */
  tag: string
  /** the operator's name (what a deny list and a served upstream name) */
  name: string
  params: string[]
}

export interface EndpointList {
  at: number
  endpoints: Endpoint[]
}

const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,47}\/[a-z0-9][a-z0-9._:-]{0,111}$/

/** The endpoints of the /endpoints answer (synthesised from research notes — verify with a real key). */
export function readEndpoints(json: unknown): Endpoint[] {
  const data = json && typeof json === 'object' ? (json as { data?: { endpoints?: unknown } }).data : null
  const list = Array.isArray(data?.endpoints) ? data.endpoints : []
  const out: Endpoint[] = []
  for (const e of list as unknown[]) {
    if (!e || typeof e !== 'object') continue
    const x = e as Record<string, unknown>
    const tag = typeof x.tag === 'string' ? x.tag.trim().slice(0, 80) : ''
    const name = typeof x.provider_name === 'string' ? x.provider_name.trim().slice(0, 80) : ''
    if (!tag || !/^[A-Za-z0-9._/-]+$/.test(tag)) continue
    if (out.some((o) => o.tag === tag)) continue
    out.push({ tag, name: name || tag, params: Array.isArray(x.supported_parameters) ? x.supported_parameters.filter((p): p is string => typeof p === 'string').slice(0, 64) : [] })
  }
  return out
}

const epInflight = new Map<string, Promise<EndpointList | null>>()

/**
 * Who serves a model (null: the list could not be read and none is kept). `refresh` reads it again now. A read takes at
 * most CATALOG_FETCH_MS (then the kept list, however old); `signal`: the caller stops waiting (null) — the read goes on.
 */
export async function endpointsOf(id: string, o: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<EndpointList | null> {
  if (!SLUG_RE.test(id)) return null
  const key = `ep:${id}`
  if (!o.refresh) {
    const kept = await readKey<EndpointList>(key)
    if (kept && Date.now() - kept.at < CATALOG_MAX_AGE) return kept
  }
  const running = epInflight.get(id)
  if (running) return until(running, o.signal, null)
  const job = (async () => {
    try {
      const json = await getJson(`${OR_API}/models/${id}/endpoints`).catch((e: unknown) => {
        throw new Error(`endpoints: ${e instanceof Error ? e.message : String(e)}`)
      })
      const list: EndpointList = { at: Date.now(), endpoints: readEndpoints(json) }
      await writeKey(key, list)
      return list
    } catch (e) {
      console.warn('[one] who serves this OpenRouter model could not be read', e instanceof Error ? e.message : e)
      return (await readKey<EndpointList>(key)) ?? null
    }
  })().finally(() => epInflight.delete(id))
  epInflight.set(id, job)
  return until(job, o.signal, null)
}

/** Write endpoint lists (the e2e seam: specs seed them instead of fetching). */
export async function seedEndpoints(map: Record<string, Array<Partial<Endpoint> & { tag: string }>>, at = Date.now()): Promise<void> {
  for (const [id, list] of Object.entries(map)) await writeKey(`ep:${id}`, { at, endpoints: list.map((e) => ({ tag: e.tag, name: e.name ?? e.tag, params: e.params ?? [] })) })
}

const denied = (e: Endpoint, deny: readonly string[]) => deny.some((d) => d.trim().toLowerCase() === e.name.toLowerCase() || d.trim().toLowerCase() === e.tag.toLowerCase() || d.trim().toLowerCase() === e.tag.split('/')[0]!.toLowerCase())

export interface Pins {
  /** endpoint tags (`provider.only`) */
  tags: string[]
  /** their operators' names (a served upstream must be one of them) */
  names: string[]
}

/** The endpoints a request to a model may use: its list minus the deny list (null: no list, or nothing left). */
export async function pinsFor(id: string, upstream: Pick<UpstreamRule, 'deny'>, o: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<Pins | null> {
  const list = await endpointsOf(id, o)
  const ok = (list?.endpoints ?? []).filter((e) => !denied(e, upstream.deny))
  return ok.length ? { tags: ok.map((e) => e.tag), names: [...new Set(ok.map((e) => e.name))] } : null
}

/**
 * The Jev Router's pins (D-S2-23): every pool model's pins ∪ the router's own endpoints. 'denied': the deny list names
 * the router's operator or one of its endpoints (Jev reads every request it routes — it cannot be left out). A pool
 * model without pins leaves the pool (`pool` = who stays).
 */
export async function routerPinsFor(pool: readonly string[], upstream: Pick<UpstreamRule, 'deny'>): Promise<{ pins: Pins; pool: string[] } | 'denied' | null> {
  if (upstream.deny.some((d) => d.trim().toLowerCase() === JEV_OPERATOR.toLowerCase())) return 'denied'
  const own = await endpointsOf(JEV_ROUTER)
  if (own?.endpoints.some((e) => denied(e, upstream.deny))) return 'denied'
  const tags = new Set<string>()
  const names = new Set<string>()
  const kept: string[] = []
  for (const id of pool) {
    const p = await pinsFor(id, upstream)
    if (!p) continue
    kept.push(id)
    p.tags.forEach((t) => tags.add(t))
    p.names.forEach((n) => names.add(n))
  }
  if (!kept.length) return null
  for (const e of own?.endpoints ?? []) {
    tags.add(e.tag)
    names.add(e.name)
  }
  return { pins: { tags: [...tags], names: [...names] }, pool: kept }
}
