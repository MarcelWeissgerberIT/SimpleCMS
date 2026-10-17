/**
 * The fuse keys (plan §1.9, §6 U8 / U22 / A19 / A20 / A21) — what each key writes, through the setting's own writer,
 * and the Undo of every key. Browser only (the store, the areas' index files); the plate (ui/FuseKeys.tsx) calls
 * `pressKey`, the toast's Undo, the closed plate's Undo key and Mod+Z on #/patchbay call `undoKey`.
 *
 * Key 1 — the decider off "direct":
 *  - agent → "Switch to proposals": the STORED agent with `write: 'stage'` (`upsertAgent` through patchApply, so
 *    Unreadable fields stay as they are; read back — a write the sanitizer refused counts as refused);
 *  - autofill → "Autofill by hand only": `setAutofillAuto(db, prop, false)` (refused on a locked / read-only database);
 *  - organise → "Sort mail by hand only": `setOrganise({ enabled: false })` (this device's mail settings);
 *  - bridge → "Bridge: ask before each write": `setMcpMode('ask')` (this browser);
 *  - planner (Orders B10) → "Confirm each chain": this device's consent "Ohne Bestätigung starten" dropped
 *    (`dropOrderAuto`); its Undo puts the same consent back (`restoreOrderAuto` — only while none is stored).
 * Key 2 — the trigger or the tools:
 *  - "„<field>“ by hand only" → `setHandOnly(db, prop, true)` (no profile unlock needed — Q1, §6 A19; refused locked);
 *  - "Disconnect write tools" → the stored agent's `mcpTools[server]` = its read tools ([] leaves the server out);
 *  - "{server}: no longer for autofill" → `patchServer(id, { scope: 'free' })` (this device);
 *  - the planner's server, read tools only (Orders B10): already so — never offered; an untested server's key sends the
 *    person to its connection test ("Server testen", the key's `open`).
 * Key 3 — "Allow this path" → `signOffFuse(path, sig, parts)` / "Withdraw" → `withdrawSignoff(path)` (owners / admins in
 * a team; the store answers why it refuses). Their Undo puts the entry back as it was (`restoreSignoff`: a lapsed
 * allowance a new one replaced, a withdrawn one — with its `at` and, locally, its `updatedBy`; a team server stamps the
 * owner / admin who writes it).
 *
 * Writers: every key writes as the person in the Patchbay (`you~patchbay`), every Undo as `you~undo`.
 *
 * The Undo stack lives per tab session (≤ 20 entries, newest last, in memory: the toast's Undo works from any route).
 * An Undo writes the stored previous value — and refuses when the target changed since the key ("Changed since — open
 * the editor"), compared over CONFIG fields only (an agent without its stamps, a property's type + flag, the autofill
 * config without `fills`, the organise switches, the bridge mode, a server's scope, the allowance's signature): an
 * automation's or autofill's bookkeeping never blocks it. A team: the creator never writes another member's version
 * back as their own (patch.ts undoPlan) — and before a key, the creator of an agent that waits for their confirm is
 * sent to its editor first (fuses.ts: key 1 / 2b refused with `patch.confirmFirst`).
 */
import { create } from 'zustand'
import { useWorkspace } from '../../store/store'
import { withWriter, type Writer } from '../../store/writer'
import { useCloud } from '../../cloud'
import { setAutofillAuto, setHandOnly } from '../../database'
import { readMail, setOrganise } from '../mail'
import { mcpSettings, setMcpMode, type McpAgentMode } from '../mcp'
import { patchServer, readServers } from '../ai/mcp-servers'
import { dropOrderAuto, readOrderAuto, restoreOrderAuto, type OrderAuto } from '../coding'
import { signoffAdmins } from '../../store/fuseSignoffs'
import { stable } from './source'
import { moduleKey } from './ref'
import { commitPatch, undoPatch } from './patchApply'
import type { CustomAgent, FuseSignoff, ID } from '../../store/types'
import type { Chain, FuseKey, FuseKeyKind, FuseState, MsgRef, OpenTarget, PatchWrite, Why } from './types'

const P = 'features.patchbay'
const AS_KEY: Writer = { kind: 'you', via: 'patchbay' }
const AS_UNDO: Writer = { kind: 'you', via: 'undo' }
/** Entries kept per tab session (§1.9). */
export const UNDO_MAX = 20

/** What a key wrote — enough to check "changed since" and to put the previous value back. */
export type KeyStep =
  | { t: 'agent'; writes: PatchWrite[]; inverse: PatchWrite[] }
  | { t: 'autofill'; db: ID; prop: ID; cfg: string }
  | { t: 'hand'; db: ID; prop: ID; type: string }
  | { t: 'organise'; wrote: string }
  | { t: 'bridge'; was: McpAgentMode }
  | { t: 'server'; id: ID; was: 'all' }
  /** Orders B10: the planner's consent this device held (an Undo puts the same one back) */
  | { t: 'auto'; db: ID; was: OrderAuto }
  /** `prev`: the allowance this one replaced (a lapsed one — who allowed it and when): an Undo puts it back as it was */
  | { t: 'allow'; path: string; sig: string; prev?: FuseSignoff }
  | { t: 'withdraw'; path: string; entry: FuseSignoff }

/** One key pressed in this tab session. */
export interface KeyDone {
  id: string
  /** the fuse (path key + its label when pressed) */
  fuse: { key: string; label: string }
  kind: FuseKeyKind
  n: 1 | 2 | 3
  /** the key's "what it changes" line (vars: ids) */
  what?: MsgRef
  /** the line under the key (what still fires, …) */
  note?: MsgRef
  /** the team note ("<creator> must confirm the agent afterwards") */
  team?: MsgRef
  /** this device only — other devices keep the path */
  device?: true
  /** the agent a non-creator changed: still waits for its creator after an Undo */
  waits?: { creator: string }
  /** key 2b: the read tools still connected that may carry data out in their arguments (§1.5, §6 A33 — the closed plate
   *  keeps naming them) */
  residual?: string[]
  /** the path as it was (the closed plate shows it) */
  chain: Chain
  lamps: { outside: Why; private: Why; out: Why }
  step: KeyStep
  at: number
  /** taken back (by the toast, the closed plate or Mod+Z) */
  undone?: true
}

export type KeyResult = { ok: true; done: KeyDone } | { ok: false; refused: MsgRef; open?: OpenTarget }
export type UndoResult = { ok: true; done: KeyDone } | { ok: false; refused: MsgRef; open?: OpenTarget; done?: KeyDone }

interface KeyStack {
  /** newest last; undone entries stay listed (marked) until they fall off */
  done: KeyDone[]
}

/** The Undo stack of this tab session (in memory). */
export const useKeyStack = create<KeyStack>(() => ({ done: [] }))

let seq = 0
const nextId = () => `k${Date.now().toString(36)}${(seq++).toString(36)}`

const refuse = (key: string, vars?: MsgRef['vars'], open?: OpenTarget): { ok: false; refused: MsgRef; open?: OpenTarget } => ({ ok: false, refused: vars ? { key, vars } : { key }, ...(open ? { open } : {}) })
const CHANGED = `${P}.key.changedSince`
const agentOpen = (id: ID): OpenTarget => ({ to: 'route', route: { name: 'agents', id } })
const ws = () => useWorkspace.getState()
const me = () => useCloud.getState().user?.id ?? null
const team = () => useCloud.getState().active.kind === 'cloud'
const readOnly = () => useCloud.getState().readOnly

/** A team browser agent the person created that another member changed last: confirm it in its editor first. */
function waitsForMe(a: Pick<CustomAgent, 'runner' | 'createdBy' | 'updatedBy'>): boolean {
  const id = me()
  return team() && a.runner === 'browser' && !!id && a.createdBy === id && !!a.updatedBy && a.updatedBy !== a.createdBy
}

/** The creator a non-creator's agent write leaves the agent waiting for (team browser agents). */
function waitsFor(a: Pick<CustomAgent, 'runner' | 'createdBy'>): { creator: string } | undefined {
  const id = me()
  if (!team() || a.runner !== 'browser' || !a.createdBy || a.createdBy === id) return undefined
  return { creator: a.createdBy }
}

/** The autofill config a key compares (never the `fills` records — bookkeeping). */
function autofillCfg(db: ID, prop: ID): string | null {
  const p = ws().databases[db]?.properties.find((x) => x.id === prop)
  if (!p?.autofill) return null
  const { fills: _f, ...rest } = p.autofill
  void _f
  return stable(rest)
}

const organiseNow = (): string => stable(readMail().organise)

/* ------------------------------------------------------------------ keys */

/** Key 1 / 2b on an agent: the stored agent with `change` applied, written through patchApply (read back). */
function agentKey(id: ID, change: (a: CustomAgent) => CustomAgent | null): { ok: true; step: KeyStep; waits?: { creator: string } } | { ok: false; refused: MsgRef; open?: OpenTarget } {
  const stored = ws().agents?.[id]
  if (!stored) return refuse(`${P}.patch.gone`)
  if (waitsForMe(stored)) return refuse(`${P}.patch.confirmFirst`, { agent: moduleKey({ kind: 'agent', id }), member: stored.updatedBy ?? '' }, agentOpen(id))
  const next = change(stored)
  if (!next) return refuse(CHANGED, undefined, agentOpen(id))
  const plan = { writes: [{ w: 'agent' as const, agent: next }], inverse: [{ w: 'agent' as const, agent: stored }] }
  const res = commitPatch(plan)
  if (!res.ok) return { ok: false, refused: res.refused, open: agentOpen(id) }
  // the inverse compares what is stored now with what the key wrote: keep the stored copy (the store sanitized it)
  const wrote = ws().agents?.[id] ?? next
  const waits = waitsFor(stored)
  return { ok: true, step: { t: 'agent', writes: [{ w: 'agent', agent: wrote }], inverse: plan.inverse }, ...(waits ? { waits } : {}) }
}

function write(key: FuseKey): { ok: true; step: KeyStep; waits?: { creator: string } } | { ok: false; refused: MsgRef; open?: OpenTarget } {
  const tg = key.target as Record<string, unknown>
  switch (key.kind) {
    case 'proposals':
      return agentKey(tg.agent as ID, (a) => (a.write === 'apply' ? { ...a, write: 'stage' } : null))
    case 'cutTools': {
      const server = tg.server as string
      const keep = [...((tg.keep as string[]) ?? [])]
      return agentKey(tg.agent as ID, (a) => (a.mcpServers.includes(server) ? { ...a, mcpTools: { ...(a.mcpTools ?? {}), [server]: keep } } : null))
    }
    case 'autofillHand': {
      const db = tg.db as ID
      const prop = tg.prop as ID
      const d = ws().databases[db]
      if (!d) return refuse(`${P}.patch.gone`)
      if (d.locked) return refuse(`${P}.key.locked`)
      if (readOnly()) return refuse(`${P}.key.readOnly`)
      const p = d.properties.find((x) => x.id === prop)
      if (!p?.autofill?.auto) return refuse(CHANGED, undefined, { to: 'autofill', db, prop })
      if (!withWriter(AS_KEY, () => setAutofillAuto(db, prop, false))) return refuse(`${P}.patch.failed`)
      return { ok: true, step: { t: 'autofill', db, prop, cfg: autofillCfg(db, prop) ?? '' } }
    }
    case 'handOnly': {
      const db = tg.db as ID
      const prop = tg.prop as ID
      const d = ws().databases[db]
      const p = d?.properties.find((x) => x.id === prop)
      if (!d || !p) return refuse(`${P}.patch.gone`)
      if (d.locked) return refuse(`${P}.key.locked`)
      if (readOnly()) return refuse(`${P}.key.readOnly`)
      if (p.agentReadOnly === true) return refuse(CHANGED)
      if (!withWriter(AS_KEY, () => setHandOnly(db, prop, true))) return refuse(`${P}.patch.failed`)
      return { ok: true, step: { t: 'hand', db, prop, type: p.type } }
    }
    case 'organiseHand': {
      if (!readMail().organise.enabled) return refuse(CHANGED, undefined, { to: 'settings', tab: 'mail' })
      withWriter(AS_KEY, () => setOrganise({ enabled: false }))
      if (readMail().organise.enabled) return refuse(`${P}.patch.failed`)
      return { ok: true, step: { t: 'organise', wrote: organiseNow() } }
    }
    case 'bridgeAsk': {
      const was = mcpSettings().mode
      if (was !== 'apply') return refuse(CHANGED, undefined, { to: 'settings', tab: 'mcp' })
      withWriter(AS_KEY, () => setMcpMode('ask'))
      if (mcpSettings().mode !== 'ask') return refuse(`${P}.patch.failed`)
      return { ok: true, step: { t: 'bridge', was } }
    }
    case 'noAutofill': {
      const id = tg.server as ID
      const s = readServers().find((x) => x.id === id)
      if (!s) return refuse(`${P}.patch.gone`)
      if (s.scope !== 'all') return refuse(CHANGED, undefined, { to: 'mcp', server: id })
      withWriter(AS_KEY, () => patchServer(id, { scope: 'free' }))
      if (readServers().find((x) => x.id === id)?.scope === 'all') return refuse(`${P}.patch.failed`)
      return { ok: true, step: { t: 'server', id, was: 'all' } }
    }
    case 'autoOff': {
      const db = tg.orders as ID
      if (!readOrderAuto(db)) return refuse(`${P}.key.autoOffAlready`)
      const was = withWriter(AS_KEY, () => dropOrderAuto(db))
      if (!was || readOrderAuto(db)) return refuse(`${P}.patch.failed`)
      return { ok: true, step: { t: 'auto', db, was } }
    }
    case 'readTools':
      return refuse(key.refusal?.key ?? `${P}.patch.failed`, key.refusal?.vars, key.open)
    case 'allow':
    case 'withdraw':
      return refuse(`${P}.patch.failed`)
  }
}

/** The store's answer to an allowance write, in words (owners / admins named where rights are missing). */
function signoffWhy(why: string | undefined, admins?: string[]): MsgRef {
  if (why === 'rights') {
    const names = (admins ?? signoffAdmins()).filter(Boolean)
    return names.length ? { key: `${P}.key.adminsOnly`, vars: { names: names.join(', ') } } : { key: `${P}.key.adminsOnlyNone` }
  }
  if (why === 'server') return { key: `${P}.key.serverOld` }
  if (why === 'readOnly') return { key: `${P}.key.readOnly` }
  return { key: `${P}.patch.failed` }
}

function allow(f: FuseState, withdraw: boolean): { ok: true; step: KeyStep } | { ok: false; refused: MsgRef } {
  const path = f.key
  if (withdraw) {
    const entry = ws().fuseSignoffs?.[path]
    if (!entry) return refuse(CHANGED)
    const r = withWriter(AS_KEY, () => ws().withdrawSignoff(path))
    if (!r.ok) return { ok: false, refused: signoffWhy(r.why, r.admins) }
    return { ok: true, step: { t: 'withdraw', path, entry } }
  }
  if (!f.sig || !f.parts) return refuse(`${P}.patch.failed`)
  const prev = ws().fuseSignoffs?.[path]
  const r = withWriter(AS_KEY, () => ws().signOffFuse(path, f.sig!, f.parts!))
  if (!r.ok) return { ok: false, refused: signoffWhy(r.why, r.admins) }
  return { ok: true, step: { t: 'allow', path, sig: f.sig, ...(prev && prev.sig !== f.sig ? { prev } : {}) } }
}

/**
 * Press a fuse key: the setting it names, written now (refused: why — and where it is changed instead). A key the
 * model refuses (`offered` false) is never written; its reason comes back as the refusal.
 */
export function pressKey(f: FuseState, key: FuseKey): KeyResult {
  if (!key.offered) return { ok: false, refused: key.refusal ?? { key: `${P}.key.readOnly` }, ...(key.open ? { open: key.open } : {}) }
  if (readOnly()) return refuse(`${P}.key.readOnly`)
  const r: { ok: true; step: KeyStep; waits?: { creator: string } } | { ok: false; refused: MsgRef; open?: OpenTarget } = key.kind === 'allow' || key.kind === 'withdraw' ? allow(f, key.kind === 'withdraw') : write(key)
  if (!r.ok) return r
  const done: KeyDone = {
    id: nextId(),
    fuse: { key: f.key, label: f.label },
    kind: key.kind,
    n: key.n,
    ...(key.what ? { what: key.what } : {}),
    ...(key.note ? { note: key.note } : {}),
    ...(key.team ? { team: key.team } : {}),
    ...(key.device ? { device: true as const } : {}),
    ...(r.waits ? { waits: r.waits } : {}),
    ...(key.kind === 'cutTools' && f.residual?.length ? { residual: [...f.residual] } : {}),
    chain: f.chain,
    lamps: f.lamps,
    step: r.step,
    at: Date.now(),
  }
  const list = [...useKeyStack.getState().done, done]
  useKeyStack.setState({ done: list.slice(-UNDO_MAX) })
  return { ok: true, done }
}

/* ------------------------------------------------------------------ undo */

/** Does the target still hold what the key wrote (config fields only)? */
function stillWritten(step: KeyStep): boolean {
  switch (step.t) {
    case 'agent':
      return true // patch.ts undoPlan compares (config fields, stamps aside)
    case 'autofill':
      return autofillCfg(step.db, step.prop) === step.cfg
    case 'hand': {
      const p = ws().databases[step.db]?.properties.find((x) => x.id === step.prop)
      return !!p && p.type === step.type && p.agentReadOnly === true
    }
    case 'organise':
      return organiseNow() === step.wrote
    case 'bridge':
      return mcpSettings().mode === 'ask'
    case 'server':
      // the reader keeps 'all' only — "free" reads back as no scope
      return readServers().some((x) => x.id === step.id && x.scope !== 'all')
    case 'allow':
      return ws().fuseSignoffs?.[step.path]?.sig === step.sig
    case 'withdraw':
      return !ws().fuseSignoffs?.[step.path]
    case 'auto':
      // dropped and not given again since (B11's switch writes a new one)
      return readOrderAuto(step.db) === null
  }
}

/** Where a refused Undo sends the person (the setting's editor). */
function editorOf(step: KeyStep): OpenTarget | undefined {
  switch (step.t) {
    case 'agent': {
      const w = step.inverse[0]
      return w?.w === 'agent' ? agentOpen(w.agent.id) : undefined
    }
    case 'autofill':
      return { to: 'autofill', db: step.db, prop: step.prop }
    case 'hand':
      return { to: 'route', route: { name: 'page', id: step.db } }
    case 'organise':
      return { to: 'settings', tab: 'mail' }
    case 'bridge':
      return { to: 'settings', tab: 'mcp' }
    case 'server':
      return { to: 'mcp', server: step.id }
    case 'auto':
      return { to: 'route', route: { name: 'page', id: step.db } }
    default:
      return undefined
  }
}

function putBack(step: KeyStep): { ok: true } | { ok: false; refused: MsgRef } {
  switch (step.t) {
    case 'agent': {
      const r = undoPatch({ writes: step.writes, inverse: step.inverse })
      return r.ok ? { ok: true } : r
    }
    case 'autofill': {
      const d = ws().databases[step.db]
      if (d?.locked) return refuse(`${P}.key.locked`)
      return withWriter(AS_UNDO, () => setAutofillAuto(step.db, step.prop, true)) ? { ok: true } : refuse(`${P}.patch.failed`)
    }
    case 'hand': {
      const d = ws().databases[step.db]
      if (d?.locked) return refuse(`${P}.key.locked`)
      return withWriter(AS_UNDO, () => setHandOnly(step.db, step.prop, false)) ? { ok: true } : refuse(`${P}.patch.failed`)
    }
    case 'organise':
      withWriter(AS_UNDO, () => setOrganise({ enabled: true }))
      return readMail().organise.enabled ? { ok: true } : refuse(`${P}.patch.failed`)
    case 'bridge':
      withWriter(AS_UNDO, () => setMcpMode(step.was))
      return mcpSettings().mode === step.was ? { ok: true } : refuse(`${P}.patch.failed`)
    case 'server':
      withWriter(AS_UNDO, () => patchServer(step.id, { scope: step.was }))
      return readServers().find((x) => x.id === step.id)?.scope === step.was ? { ok: true } : refuse(`${P}.patch.failed`)
    case 'allow': {
      // the allowance it replaced comes back as it was (lapsed, its by / at); none: the path is withdrawn again
      const prev = step.prev
      const r = withWriter(AS_UNDO, () => (prev ? ws().restoreSignoff(step.path, prev) : ws().withdrawSignoff(step.path)))
      return r.ok ? { ok: true } : { ok: false, refused: signoffWhy(r.why, r.admins) }
    }
    case 'auto':
      return withWriter(AS_UNDO, () => restoreOrderAuto(step.db, step.was)) ? { ok: true } : refuse(`${P}.patch.failed`)
    case 'withdraw': {
      // the withdrawn allowance back as it was — who allowed it and when (a team server stamps the owner / admin writing)
      const r = withWriter(AS_UNDO, () => ws().restoreSignoff(step.path, step.entry))
      return r.ok ? { ok: true } : { ok: false, refused: signoffWhy(r.why, r.admins) }
    }
  }
}

/**
 * Take a key back (`id`; none: the newest one not taken back yet) as `you~undo`. Refused when the target changed since
 * (config fields only), a locked database, the rights — with where it is changed instead.
 */
export function undoKey(id?: string): UndoResult {
  const list = useKeyStack.getState().done
  const done = id ? list.find((d) => d.id === id) : [...list].reverse().find((d) => !d.undone)
  if (!done) return refuse(`${P}.keys.nothing`)
  if (done.undone) return { ok: false, refused: { key: `${P}.keys.undoneAlready` }, done }
  if (readOnly()) return { ...refuse(`${P}.key.readOnly`), done }
  if (!stillWritten(done.step)) return { ...refuse(CHANGED, undefined, editorOf(done.step)), done }
  const r = putBack(done.step)
  if (!r.ok) return { ok: false, refused: r.refused, open: editorOf(done.step), done }
  useKeyStack.setState({ done: useKeyStack.getState().done.map((d) => (d.id === done.id ? { ...d, undone: true as const } : d)) })
  return { ok: true, done: { ...done, undone: true } }
}

/** The newest key this tab session can still take back (null: none). */
export function lastKey(): KeyDone | null {
  return [...useKeyStack.getState().done].reverse().find((d) => !d.undone) ?? null
}

/* ------------------------------------------------------------------ seam */

const seamOn = (() => {
  try {
    return import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e')
  } catch {
    return false
  }
})()

if (seamOn && typeof window !== 'undefined') {
  ;(window as unknown as { __onePatchbayKeys?: unknown }).__onePatchbayKeys = {
    stack: () => useKeyStack.getState().done.map((d) => ({ id: d.id, kind: d.kind, fuse: d.fuse.key, undone: !!d.undone })),
    undo: (id?: string) => {
      const r = undoKey(id)
      return r.ok ? { ok: true } : { ok: false, refused: r.refused.key }
    },
  }
}
