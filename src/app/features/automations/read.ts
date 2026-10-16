/**
 * Automations — the reader (pure, no store: Node specs and the Patchbay's model use it). Every reader of
 * `Database.automations` goes through readAutomations: the engine (what runs), AutomationsModal (what is shown and
 * edited), Workspace › Automation and the Patchbay (what is drawn). Plan §1.14 (B15).
 *
 * The sanitizer (fresh objects only — nothing of the stored value is shared). It NEVER shortens what a person made:
 * every writer stores what this reader returns (the modal, the engine's bookkeeping after each run, the Patchbay), so a
 * cut here would be lost for good. A value beyond AUTOMATION_READ makes the automation unreadable instead — kept as it
 * is, never run or edited here, counted in the modal (fix safety-data). The editor's own caps are AUTOMATION_LIMITS.
 *  - an automation is an object with an id (`[\w.:-]`, ≤ 120), a name (a string, control characters → spaces), a
 *    switch (`enabled` only when it is `true`), a known trigger and known actions; at most AUTOMATION_READ.automations
 *    per database (the rest kept as they are), the first of a repeated id;
 *  - trigger: `row_created` · `row_deleted` · `property_changed` (`propertyId` an id or null = any; `toValue` a plain
 *    value — string, finite number, boolean, null, a list of strings, a date; anything else makes it unreadable: a
 *    dropped condition would fire on every change);
 *  - actions: `webhook` — the URL text kept as typed (trimmed), but one that names another scheme is emptied:
 *    `<scheme>://…` other than https / http, or a scheme that runs or reads something (javascript:, data:, file:,
 *    vbscript: … — UNSAFE_SCHEMES). "host:port/path" being typed is kept (the engine sends only to http(s) URLs with a
 *    host anyway); method POST or PUT (anything else → POST); headers string → string (names
 *    `[!#$%&'*+.^_`|~0-9A-Za-z-]`, no line breaks — a header no request could carry is left out) · `set_property`
 *    (propertyId, a plain value — anything else makes it unreadable) · `notify` (message) · `run_script` (scriptId an
 *    id or null);
 *  - bookkeeping kept as it is when it is well formed: `lastRunAt` (finite or null), `lastStatus` ('ok' | 'error' |
 *    null), `lastMessage` (≤ 200 or null);
 *  - keys this build does not know (a newer build's field on an automation, its trigger or an action) are KEPT as they
 *    are (a JSON copy; `__proto__` / `constructor` / `prototype` never) — every write goes through this reader (the
 *    modal, the engine's bookkeeping, the Patchbay), so an older tab never strips what a newer one added.
 * An automation this build cannot read (an unknown trigger or action type — a newer build's, or a broken one) is left
 * out of what every reader sees: it never runs here and is never shown or edited here. saveAutomations keeps such
 * entries as they are (`unreadableAutomations`), so an older tab never deletes what a newer one made.
 *
 * The same stored array gives the same result object (a WeakMap by reference) — the engine reads on every store change.
 */
import type { Automation, AutomationAction, AutomationTrigger, DateValue, ID, PropertyValue } from '../../store/types'

/** What the editor lets a person make: a further action is refused there (with a message), its fields take no more. */
export const AUTOMATION_LIMITS = { actions: 20, name: 200, url: 2048, message: 500 } as const

/**
 * What the reader takes — never shortened; an automation beyond one of these is unreadable (kept as it is, never run or
 * edited here). Wider than the editor's caps on purpose: an automation an earlier editor made without them (more
 * actions, a long bearer token in a header) keeps running. `lastMessage` is the engine's own status line (cut, not kept).
 */
export const AUTOMATION_READ = { automations: 500, actions: 200, name: 2000, url: 16_384, headers: 50, headerValue: 16_384, message: 10_000, value: 10_000, list: 200, item: 1000, lastMessage: 200 } as const

/** Why an automation is not read: a newer build's trigger or action, or a value beyond AUTOMATION_READ. */
type NotRead = 'newer' | 'limits'

const ID_RE = /^[\w.:-]{1,120}$/
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Keys never copied from a stored object (they would reach the prototype). */
const NEVER_COPY = new Set(['__proto__', 'constructor', 'prototype'])

/** A JSON copy of an unknown key's value (undefined: not JSON — left out). */
function jsonCopy(v: unknown): unknown {
  if (v === undefined || typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint') return undefined
  try {
    return JSON.parse(JSON.stringify(v)) as unknown
  } catch {
    return undefined
  }
}

/** The keys of `raw` this build does not read (`known`), copied — a newer build's fields, kept through every save. */
function unknownKeys(raw: Record<string, unknown>, known: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(raw)) {
    if (known.includes(k) || NEVER_COPY.has(k)) continue
    const v = jsonCopy(raw[k])
    if (v !== undefined) Object.defineProperty(out, k, { value: v, enumerable: true, writable: true, configurable: true })
  }
  return out
}

/** `clean` (the fields this build reads) with the stored object's other keys kept after it. */
const withUnknown = <T extends object>(clean: T, raw: Record<string, unknown>, known: readonly string[]): T => Object.assign(clean, unknownKeys(raw, known))

const AUTOMATION_KEYS = ['id', 'name', 'enabled', 'trigger', 'actions', 'lastRunAt', 'lastStatus', 'lastMessage'] as const
const TRIGGER_KEYS = ['type', 'propertyId', 'toValue'] as const
const ACTION_KEYS: Record<AutomationAction['type'], readonly string[]> = {
  webhook: ['type', 'url', 'method', 'headers'],
  set_property: ['type', 'propertyId', 'value'],
  notify: ['type', 'message'],
  run_script: ['type', 'scriptId'],
}

const own = (o: Record<string, unknown>, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined)
const idOf = (v: unknown): ID | null => (typeof v === 'string' && ID_RE.test(v) ? v : null)
/** A text field: control characters → spaces; null when it is longer than this build reads (never cut). */
const text = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return ''
  return v.length > max ? null : v.replace(CONTROL, ' ')
}

/** Thrown inside one automation's read: a value beyond AUTOMATION_READ or no plain value — the automation is not read. */
class Unreadable extends Error {
  constructor(readonly why: NotRead) {
    super(why)
  }
}
const limits = (): never => {
  throw new Unreadable('limits')
}
const newer = (): never => {
  throw new Unreadable('newer')
}

/** A plain property value (what a set_property action writes / a trigger waits for); anything else is unreadable (thrown). */
function plainValue(v: unknown): PropertyValue {
  if (v === null) return null
  if (typeof v === 'string') return v.length > AUTOMATION_READ.value ? limits() : v
  if (typeof v === 'number') return Number.isFinite(v) ? v : newer()
  if (typeof v === 'boolean') return v
  if (Array.isArray(v)) {
    if (!v.every((x) => typeof x === 'string')) return newer()
    if (v.length > AUTOMATION_READ.list || v.some((x: string) => x.length > AUTOMATION_READ.item)) return limits()
    return [...(v as string[])]
  }
  if (isObj(v) && typeof own(v, 'start') === 'string') {
    const start = String(own(v, 'start'))
    const end = own(v, 'end')
    if (start.length > 40 || (typeof end === 'string' && end.length > 40)) return limits()
    const d: DateValue = { start }
    if (typeof end === 'string') d.end = end
    else if (end === null) d.end = null
    if (typeof own(v, 'includeTime') === 'boolean') d.includeTime = own(v, 'includeTime') as boolean
    const reminder = own(v, 'reminder')
    if (typeof reminder === 'string' && reminder.length <= 12) d.reminder = reminder
    else if (reminder === null) d.reminder = null
    return d
  }
  // a value of a shape this build does not know (a newer build's)
  return newer()
}

/** Schemes that run or read something in a browser — a webhook URL naming one is emptied however it goes on. */
const UNSAFE_SCHEMES = new Set(['javascript', 'vbscript', 'data', 'file', 'blob', 'filesystem', 'about', 'view-source', 'jar'])

/**
 * The webhook URL as typed — unless it names another scheme (then empty: never sent): `<scheme>://` other than https /
 * http, or an unsafe scheme (UNSAFE_SCHEMES) with or without slashes. "localhost:5678/hook" — a host and port typed
 * without a scheme — is no scheme and stays (the editor saves on each key; the engine refuses a URL it cannot send to).
 */
export function webhookUrlOf(v: unknown): string {
  const s = typeof v === 'string' ? v.replace(CONTROL, '').trim() : ''
  const scheme = /^([a-z][a-z0-9+.-]*):(\/\/)?/i.exec(s)
  if (!scheme || /^https?$/i.test(scheme[1])) return s
  return scheme[2] || UNSAFE_SCHEMES.has(scheme[1].toLowerCase()) ? '' : s
}

function headersOf(v: unknown): Record<string, string> | undefined {
  if (!isObj(v)) return undefined
  const out: Record<string, string> = {}
  let n = 0
  for (const [k, raw] of Object.entries(v)) {
    // a header no request could carry (no name, a line break) is left out; a long value (a bearer token) is kept whole
    if (!HEADER_NAME.test(k) || typeof raw !== 'string' || /[\r\n]/.test(raw)) continue
    if (++n > AUTOMATION_READ.headers || raw.length > AUTOMATION_READ.headerValue) limits()
    out[k] = raw
  }
  return n ? out : undefined
}

function triggerOf(v: unknown): AutomationTrigger | null {
  if (!isObj(v)) return null
  const type = own(v, 'type')
  if (type === 'row_created' || type === 'row_deleted') return withUnknown<AutomationTrigger>({ type }, v, TRIGGER_KEYS)
  if (type !== 'property_changed') return null
  const pid = own(v, 'propertyId')
  const propertyId = pid === null || pid === undefined ? null : idOf(pid)
  if (pid !== null && pid !== undefined && !propertyId) return null
  const t: AutomationTrigger = { type, propertyId }
  // a condition this build cannot read makes the automation unreadable (dropped, it would fire on every change)
  if (Object.prototype.hasOwnProperty.call(v, 'toValue') && own(v, 'toValue') !== undefined) t.toValue = plainValue(own(v, 'toValue'))
  return withUnknown(t, v, TRIGGER_KEYS)
}

function actionOf(v: unknown): AutomationAction | null {
  if (!isObj(v)) return null
  const clean = knownActionOf(v)
  return clean ? withUnknown(clean, v, ACTION_KEYS[clean.type]) : null
}

function knownActionOf(v: Record<string, unknown>): AutomationAction | null {
  const type = own(v, 'type')
  if (type === 'webhook') {
    const headers = headersOf(own(v, 'headers'))
    const url = webhookUrlOf(own(v, 'url'))
    if (url.length > AUTOMATION_READ.url) limits()
    return { type, url, method: own(v, 'method') === 'PUT' ? 'PUT' : 'POST', ...(headers ? { headers } : {}) }
  }
  if (type === 'set_property') {
    const propertyId = own(v, 'propertyId')
    const raw = own(v, 'value')
    // a property not picked yet is '' (the editor's blank action, value null)
    return { type, propertyId: typeof propertyId === 'string' && (propertyId === '' || ID_RE.test(propertyId)) ? propertyId : '', value: raw === undefined ? null : plainValue(raw) }
  }
  if (type === 'notify') {
    const message = text(own(v, 'message'), AUTOMATION_READ.message)
    return { type, message: message ?? limits() }
  }
  if (type === 'run_script') {
    const sid = own(v, 'scriptId')
    return { type, scriptId: sid === null || sid === undefined ? null : idOf(sid) }
  }
  return null
}

/** One stored automation → a clean copy, or why this build does not read it (null: no automation at all — junk). */
function readOne(raw: unknown): Automation | NotRead | null {
  if (!isObj(raw)) return null
  const id = idOf(own(raw, 'id'))
  if (!id) return null
  try {
    const trigger = triggerOf(own(raw, 'trigger'))
    if (!trigger) return 'newer'
    const rawActions = own(raw, 'actions')
    if (rawActions !== undefined && !Array.isArray(rawActions)) return 'newer'
    const list = (rawActions as unknown[] | undefined) ?? []
    if (list.length > AUTOMATION_READ.actions) return 'limits'
    const actions: AutomationAction[] = []
    for (const a of list) {
      const clean = actionOf(a)
      // an action this build does not know: the automation is a newer build's — kept, never run or edited here
      if (!clean) return 'newer'
      actions.push(clean)
    }
    const name = text(own(raw, 'name'), AUTOMATION_READ.name)
    if (name === null) return 'limits'
    const lastRunAt = own(raw, 'lastRunAt')
    const lastStatus = own(raw, 'lastStatus')
    const lastMessage = own(raw, 'lastMessage')
    const clean: Automation = {
      id,
      name,
      enabled: own(raw, 'enabled') === true,
      trigger,
      actions,
      lastRunAt: typeof lastRunAt === 'number' && Number.isFinite(lastRunAt) ? lastRunAt : null,
      lastStatus: lastStatus === 'ok' || lastStatus === 'error' ? lastStatus : null,
      // the engine's own status line: cut to its length (it writes it again on the next run)
      lastMessage: typeof lastMessage === 'string' ? lastMessage.replace(CONTROL, ' ').slice(0, AUTOMATION_READ.lastMessage) : null,
    }
    return withUnknown(clean, raw, AUTOMATION_KEYS)
  } catch (e) {
    if (e instanceof Unreadable) return e.why
    throw e
  }
}

/** One stored automation → a clean copy, or null when this build cannot read it. */
export function sanitizeAutomation(raw: unknown): Automation | null {
  const r = readOne(raw)
  return r && typeof r === 'object' ? r : null
}

const cache = new WeakMap<object, Automation[]>()

/** A database's automations as every reader takes them: sanitized, unreadable ones left out (the same array → the same result). */
export function readAutomations(raw: unknown): Automation[] {
  if (!Array.isArray(raw)) return []
  const hit = cache.get(raw)
  if (hit) return hit
  const out: Automation[] = []
  const seen = new Set<ID>()
  for (const x of raw) {
    if (out.length >= AUTOMATION_READ.automations) break
    const a = sanitizeAutomation(x)
    if (!a || seen.has(a.id)) continue
    seen.add(a.id)
    out.push(a)
  }
  cache.set(raw, out)
  // a read list reads as itself (saveAutomations stores it: the next read is the same object)
  cache.set(out, out)
  return out
}

/**
 * The stored entries readAutomations leaves out but saveAutomations keeps as they are: objects with an id this build
 * cannot read (a newer build's trigger or action) — junk (no object, no id) and repeated ids are dropped.
 */
export function unreadableAutomations(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return []
  const readable = new Set(readAutomations(raw).map((a) => a.id))
  const out: Array<Record<string, unknown>> = []
  const seen = new Set<string>()
  for (const x of raw) {
    if (!isObj(x)) continue
    const id = idOf(own(x, 'id'))
    if (!id || readable.has(id) || seen.has(id)) continue
    seen.add(id)
    out.push(x)
  }
  return out
}

/**
 * How many stored automations this build does not read, by why (the modal names both): a newer build's trigger or
 * action, or beyond AUTOMATION_READ (a value too long, too many actions, or past the database's count).
 */
export function unreadableCounts(raw: unknown): { newer: number; limits: number } {
  const out = { newer: 0, limits: 0 }
  for (const x of unreadableAutomations(raw)) out[readOne(x) === 'newer' ? 'newer' : 'limits']++
  return out
}

/** An automation's config fields (no `lastRunAt` / `lastStatus` / `lastMessage`) — what the lock rule and Undo compare. */
export const automationConfigOf = (a: Automation): Pick<Automation, 'id' | 'name' | 'enabled' | 'trigger' | 'actions'> => ({ id: a.id, name: a.name, enabled: a.enabled, trigger: a.trigger, actions: a.actions })

/** Stable JSON (sorted keys) of a value — equal configs give equal strings. */
export function stableJson(v: unknown): string {
  if (v === undefined) return 'null'
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
    .join(',')}}`
}

/** Why a change of a locked database's automations is refused (null: it only removes capability, §1.14). */
export type LockRefusal = 'added' | 'changed' | 'armed' | 'reordered'

/**
 * The lock rule (§1.14, owner question Q2 — default): on a locked database a new list may only remove capability —
 * switch an automation off, remove an action, remove an automation. Every automation left must be one that was there
 * (same id, in the same order), with the same name and trigger, its actions a subsequence of the old ones (each the same
 * action), and switched on only when it was on. Bookkeeping (`last*`) is not compared. Null: allowed.
 */
export function lockRefusal(before: readonly Automation[], after: readonly Automation[]): LockRefusal | null {
  const old = new Map(before.map((a, i) => [a.id, { a, i }]))
  let at = -1
  for (const a of after) {
    const o = old.get(a.id)
    if (!o) return 'added'
    if (o.i < at) return 'reordered'
    at = o.i
    if (a.name !== o.a.name || stableJson(a.trigger) !== stableJson(o.a.trigger)) return 'changed'
    if (a.enabled && !o.a.enabled) return 'armed'
    let j = 0
    for (const act of a.actions) {
      const k = stableJson(act)
      while (j < o.a.actions.length && stableJson(o.a.actions[j]) !== k) j++
      if (j >= o.a.actions.length) return 'changed'
      j++
    }
  }
  return null
}
