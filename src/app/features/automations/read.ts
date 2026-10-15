/**
 * Automations — the reader (pure, no store: Node specs and the Patchbay's model use it). Every reader of
 * `Database.automations` goes through readAutomations: the engine (what runs), AutomationsModal (what is shown and
 * edited), Workspace › Automation and the Patchbay (what is drawn). Plan §1.14 (B15).
 *
 * The sanitizer (fresh objects only — nothing of the stored value is shared):
 *  - an automation is an object with an id (`[\w.:-]`, ≤ 120), a name (a string, ≤ 200, control characters out), a
 *    switch (`enabled` only when it is `true`), a known trigger and known actions; at most AUTOMATION_LIMITS.automations
 *    per database, the first of a repeated id;
 *  - trigger: `row_created` · `row_deleted` · `property_changed` (`propertyId` an id or null = any; `toValue` a plain
 *    value — string, finite number, boolean, null, a list of strings, a date — else dropped);
 *  - actions (≤ AUTOMATION_LIMITS.actions): `webhook` — the URL text kept as typed (≤ 2048, trimmed), but one with a
 *    scheme other than https / http is emptied (javascript:, data:, file: … never reach the engine, which sends only
 *    to http(s) URLs with a host anyway); method POST or PUT (anything else → POST); headers string → string (≤ 20,
 *    names `[!#$%&'*+.^_`|~0-9A-Za-z-]`, values ≤ 1000, no line breaks) · `set_property` (propertyId, a plain value) ·
 *    `notify` (message ≤ 500) · `run_script` (scriptId an id or null);
 *  - bookkeeping kept as it is when it is well formed: `lastRunAt` (finite or null), `lastStatus` ('ok' | 'error' |
 *    null), `lastMessage` (≤ 200 or null).
 * An automation this build cannot read (an unknown trigger or action type — a newer build's, or a broken one) is left
 * out of what every reader sees: it never runs here and is never shown or edited here. saveAutomations keeps such
 * entries as they are (`unreadableAutomations`), so an older tab never deletes what a newer one made.
 *
 * The same stored array gives the same result object (a WeakMap by reference) — the engine reads on every store change.
 */
import type { Automation, AutomationAction, AutomationTrigger, DateValue, ID, PropertyValue } from '../../store/types'

export const AUTOMATION_LIMITS = { automations: 100, actions: 20, name: 200, url: 2048, headers: 20, headerValue: 1000, message: 500, lastMessage: 200 } as const

const ID_RE = /^[\w.:-]{1,120}$/
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const own = (o: Record<string, unknown>, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined)
const idOf = (v: unknown): ID | null => (typeof v === 'string' && ID_RE.test(v) ? v : null)
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(CONTROL, ' ').slice(0, max) : '')

/** A plain property value (what a set_property action writes / a trigger waits for) — null when it is none. */
function plainValue(v: unknown): PropertyValue | undefined {
  if (v === null) return null
  if (typeof v === 'string') return v.slice(0, 10_000)
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'boolean') return v
  if (Array.isArray(v)) return v.every((x) => typeof x === 'string') && v.length <= 200 ? (v as string[]).map((x) => x.slice(0, 1000)) : undefined
  if (isObj(v) && typeof own(v, 'start') === 'string') {
    const d: DateValue = { start: String(own(v, 'start')).slice(0, 40) }
    const end = own(v, 'end')
    if (typeof end === 'string') d.end = end.slice(0, 40)
    else if (end === null) d.end = null
    if (typeof own(v, 'includeTime') === 'boolean') d.includeTime = own(v, 'includeTime') as boolean
    const reminder = own(v, 'reminder')
    if (typeof reminder === 'string' && reminder.length <= 12) d.reminder = reminder
    else if (reminder === null) d.reminder = null
    return d
  }
  return undefined
}

/** The webhook URL as typed — unless it names a scheme other than https / http (then empty: never sent). */
export function webhookUrlOf(v: unknown): string {
  const s = typeof v === 'string' ? v.replace(CONTROL, '').trim().slice(0, AUTOMATION_LIMITS.url) : ''
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(s)
  if (scheme && !/^https?$/i.test(scheme[1])) return ''
  return s
}

function headersOf(v: unknown): Record<string, string> | undefined {
  if (!isObj(v)) return undefined
  const out: Record<string, string> = {}
  let n = 0
  for (const [k, raw] of Object.entries(v)) {
    if (n >= AUTOMATION_LIMITS.headers) break
    if (!HEADER_NAME.test(k) || typeof raw !== 'string' || /[\r\n]/.test(raw)) continue
    out[k] = raw.slice(0, AUTOMATION_LIMITS.headerValue)
    n++
  }
  return n ? out : undefined
}

function triggerOf(v: unknown): AutomationTrigger | null {
  if (!isObj(v)) return null
  const type = own(v, 'type')
  if (type === 'row_created' || type === 'row_deleted') return { type }
  if (type !== 'property_changed') return null
  const pid = own(v, 'propertyId')
  const propertyId = pid === null || pid === undefined ? null : idOf(pid)
  if (pid !== null && pid !== undefined && !propertyId) return null
  const t: AutomationTrigger = { type, propertyId }
  if (Object.prototype.hasOwnProperty.call(v, 'toValue')) {
    const to = plainValue(own(v, 'toValue'))
    if (to !== undefined) t.toValue = to
  }
  return t
}

function actionOf(v: unknown): AutomationAction | null {
  if (!isObj(v)) return null
  const type = own(v, 'type')
  if (type === 'webhook') {
    const headers = headersOf(own(v, 'headers'))
    return { type, url: webhookUrlOf(own(v, 'url')), method: own(v, 'method') === 'PUT' ? 'PUT' : 'POST', ...(headers ? { headers } : {}) }
  }
  if (type === 'set_property') {
    const propertyId = own(v, 'propertyId')
    const value = plainValue(own(v, 'value'))
    // a property not picked yet is '' (the editor's blank action)
    return { type, propertyId: typeof propertyId === 'string' && (propertyId === '' || ID_RE.test(propertyId)) ? propertyId : '', value: value === undefined ? null : value }
  }
  if (type === 'notify') return { type, message: text(own(v, 'message'), AUTOMATION_LIMITS.message) }
  if (type === 'run_script') {
    const sid = own(v, 'scriptId')
    return { type, scriptId: sid === null || sid === undefined ? null : idOf(sid) }
  }
  return null
}

/** One stored automation → a clean copy, or null when this build cannot read it. */
export function sanitizeAutomation(raw: unknown): Automation | null {
  if (!isObj(raw)) return null
  const id = idOf(own(raw, 'id'))
  if (!id) return null
  const trigger = triggerOf(own(raw, 'trigger'))
  if (!trigger) return null
  const rawActions = own(raw, 'actions')
  if (rawActions !== undefined && !Array.isArray(rawActions)) return null
  const actions: AutomationAction[] = []
  for (const a of (rawActions as unknown[] | undefined) ?? []) {
    if (actions.length >= AUTOMATION_LIMITS.actions) break
    const clean = actionOf(a)
    // an action this build does not know: the automation is a newer build's — kept, never run or edited here
    if (!clean) return null
    actions.push(clean)
  }
  const lastRunAt = own(raw, 'lastRunAt')
  const lastStatus = own(raw, 'lastStatus')
  const lastMessage = own(raw, 'lastMessage')
  return {
    id,
    name: text(own(raw, 'name'), AUTOMATION_LIMITS.name),
    enabled: own(raw, 'enabled') === true,
    trigger,
    actions,
    lastRunAt: typeof lastRunAt === 'number' && Number.isFinite(lastRunAt) ? lastRunAt : null,
    lastStatus: lastStatus === 'ok' || lastStatus === 'error' ? lastStatus : null,
    lastMessage: typeof lastMessage === 'string' ? text(lastMessage, AUTOMATION_LIMITS.lastMessage) : null,
  }
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
    if (out.length >= AUTOMATION_LIMITS.automations) break
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
