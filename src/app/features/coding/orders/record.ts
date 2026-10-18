/**
 * Work orders — this device's record of a request (types.ts OrderRecord; IndexedDB `one-coding` `<scope>|order|<rowId>`)
 * as every reader keeps it. Pure (a Node spec reads it). The chain engine acts only on what this reader returns: a
 * record it cannot read is no record (null) — nothing runs on a guess.
 *
 *  - `v` must be 1 (a later build's record is unreadable: null, never overwritten by this build — the sink checks).
 *  - The chain: a run id, its times, 1–24 steps with unique numbers (1–999) and task ids, each with its kind, project,
 *    confirmed pipeline line, Approvals, pinned refs (≤ 8), slot block and own blocks, its title and revision as made
 *    and the sig of what was confirmed for it; who finished which step; the sticky halt; the checkpoint (on unless
 *    stored as false); the budget (clamped like the config's); the steps made while creating, skipped and started; the
 *    older chain it replaced at its start (one level, with the parked steps that went to the trash then); the done step
 *    of that chain a chain planned again from it takes its Grundlage from (`basis`). Anything
 *    outside these bounds is dropped; a chain without readable steps is no chain.
 *  - The draft is kept only in its outline (plan, hash, run, time); plan.ts readPlan (B5) reads the plan itself.
 *  - Orders B12 (a team): `asked` (a Planen that arrived from another device) and `pressed` (this device's last press),
 *    both times only.
 */
import type { ID } from '../../../store/types'
import { BUDGET_RANGE, ORDER_KINDS } from './config'
import { ORDER_HALT_WHYS, type OrderChain, type OrderChainStep, type OrderDoneBy, type OrderDraft, type OrderHaltWhy, type OrderKind, type OrderPress, type OrderPressHow, type OrderProv, type OrderRecord, type OrderState } from './types'

/**
 * Whose records (records.ts orderScope): 'local:local', or in a team workspace this member's own —
 * 'cloud:<ws>:u:<account>' (the work-orders rows are private per member; another member signing in on this browser
 * never reads, follows or halts them). A team account not known yet: '…:u:-' (holds nothing).
 */
export const orderScopeOf = (ref: { kind: string; id: string }, uid: string | null | undefined): string => (ref.kind === 'cloud' ? `cloud:${ref.id}:u:${uid || '-'}` : `${ref.kind}:${ref.id}`)

const STATES: readonly OrderState[] = ['draft', 'creating', 'interrupted', 'running', 'halted', 'done', 'discarded']
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
/** a block id (UUIDs, nanoids, ids an import brought) */
const BLOCK_RE = /^[A-Za-z0-9_-]{1,128}$/
const MAX_STEPS = 24
const MAX_REFS = 8
const MAX_OWN = 8
const MAX_LINE = 4000
const MAX_TITLE = 200
const SIG_RE = /^[0-9a-f]{64}$/
/** a fingerprint (SHA-256 hex) — '' = unknown */
const isFp = (v: unknown): v is string => typeof v === 'string' && (v === '' || SIG_RE.test(v))
const MAX_FOREIGN = 48

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const isId = (v: unknown): v is ID => typeof v === 'string' && ID_RE.test(v)
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const isStepN = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 999
const stepKey = (k: string): number | null => (/^[1-9][0-9]{0,2}$/.test(k) ? Number(k) : null)

function readStep(v: unknown): OrderChainStep | null {
  if (!isObj(v)) return null
  if (!isStepN(v.n) || !isId(v.id) || !(ORDER_KINDS as readonly unknown[]).includes(v.kind) || !isId(v.project)) return null
  if (typeof v.line !== 'string' || v.line.length > MAX_LINE) return null
  if (v.approvals !== 'all' && v.approvals !== 'review' && v.approvals !== 'none') return null
  // each page it takes along → its pinned fingerprint ('' = unknown: an older record's revision — it asks)
  const refs: Record<ID, string> = {}
  if (isObj(v.refs))
    for (const [id, fp] of Object.entries(v.refs).slice(0, MAX_REFS)) if (isId(id)) {
      if (isFp(fp)) refs[id] = fp
      else if (typeof fp === 'number' && Number.isInteger(fp) && fp >= 0) refs[id] = ''
    }
  const basisBlock = typeof v.basisBlock === 'string' && BLOCK_RE.test(v.basisBlock) ? v.basisBlock : null
  const own = Array.isArray(v.own) ? [...new Set(v.own.filter((b): b is string => typeof b === 'string' && BLOCK_RE.test(b)))].slice(0, MAX_OWN) : []
  return {
    n: v.n,
    id: v.id,
    kind: v.kind as OrderKind,
    project: v.project,
    line: v.line,
    approvals: v.approvals,
    refs,
    basisBlock,
    ...(own.length ? { own } : {}),
    ...(typeof v.title === 'string' && v.title.length <= MAX_TITLE ? { title: v.title } : {}),
    ...(typeof v.rev === 'number' && Number.isInteger(v.rev) && v.rev >= 0 ? { rev: v.rev } : {}),
    ...(typeof v.sig === 'string' && SIG_RE.test(v.sig) ? { sig: v.sig } : {}),
  }
}

function readDoneBy(v: unknown): OrderDoneBy | null {
  if (!isObj(v) || typeof v.kind !== 'string' || !/^[a-z]{1,32}$/.test(v.kind) || !isTime(v.at)) return null
  return {
    kind: v.kind as OrderDoneBy['kind'],
    ...(typeof v.via === 'string' && /^[a-z]{1,32}$/.test(v.via) ? { via: v.via } : {}),
    at: v.at,
    ...(v.sawNext === true ? { sawNext: true } : {}),
  }
}

/** A chain as the engine acts on it (null: no readable chain). `nested`: the older chain one replaced (never one more level). */
export function readOrderChain(v: unknown, nested = false): OrderChain | null {
  if (!isObj(v) || !isId(v.run) || !isTime(v.confirmedAt) || !isTime(v.startAt) || !Array.isArray(v.steps)) return null
  const steps: OrderChainStep[] = []
  for (const raw of v.steps.slice(0, MAX_STEPS)) {
    const s = readStep(raw)
    // one step per number and per task — a record holding two of either is not this build's: no chain
    if (!s || steps.some((x) => x.n === s.n || x.id === s.id)) return null
    steps.push(s)
  }
  if (!steps.length || v.steps.length > MAX_STEPS) return null
  steps.sort((a, b) => a.n - b.n)
  const ns = new Set(steps.map((s) => s.n))
  const doneBy: Record<number, OrderDoneBy> = {}
  if (isObj(v.doneBy))
    for (const [k, d] of Object.entries(v.doneBy)) {
      const n = stepKey(k)
      const by = readDoneBy(d)
      if (n !== null && ns.has(n) && by) doneBy[n] = by
    }
  let halted: OrderChain['halted'] = null
  if (isObj(v.halted) && isTime(v.halted.at) && (ORDER_HALT_WHYS as readonly unknown[]).includes(v.halted.why))
    halted = { at: v.halted.at, why: v.halted.why as OrderHaltWhy, by: typeof v.halted.by === 'string' ? v.halted.by.slice(0, 200) : '', ...(isStepN(v.halted.step) ? { step: v.halted.step } : {}) }
  else if (v.halted !== null && v.halted !== undefined)
    // a halt this build cannot read stays a halt (the reason unknown): never a chain that runs on by accident
    halted = { at: isObj(v.halted) && isTime(v.halted.at) ? v.halted.at : 0, why: 'status', by: '' }
  const nums = (raw: unknown): Record<number, number> => {
    const out: Record<number, number> = {}
    if (isObj(raw))
      for (const [k, at] of Object.entries(raw)) {
        const n = stepKey(k)
        if (n !== null && ns.has(n) && isTime(at)) out[n] = at
      }
    return out
  }
  const made: Record<number, ID> = {}
  if (isObj(v.made))
    for (const [k, id] of Object.entries(v.made)) {
      const n = stepKey(k)
      if (n !== null && ns.has(n) && isId(id)) made[n] = id
    }
  const skipped = Array.isArray(v.skipped) ? [...new Set(v.skipped.filter((n): n is number => isStepN(n) && ns.has(n)))].sort((a, b) => a - b) : []
  const seenNext = Array.isArray(v.seenNext) ? [...new Set(v.seenNext.filter((n): n is number => isStepN(n) && ns.has(n)))].sort((a, b) => a - b) : []
  const passed: Record<number, Array<'evidence' | 'checkpoint'>> = {}
  if (isObj(v.passed))
    for (const [k, list] of Object.entries(v.passed)) {
      const n = stepKey(k)
      const why = Array.isArray(list) ? [...new Set(list.filter((w): w is 'evidence' | 'checkpoint' => w === 'evidence' || w === 'checkpoint'))] : []
      if (n !== null && ns.has(n) && why.length) passed[n] = why
    }
  const advanced = nums(v.advanced)
  const moved = nums(v.moved)
  const back = nums(v.back)
  const foreign: Record<ID, number> = {}
  if (isObj(v.foreign))
    for (const [id, at] of Object.entries(v.foreign).slice(0, MAX_FOREIGN)) if (isId(id) && isTime(at)) foreign[id] = at
  const basisSeen: Record<number, string> = {}
  if (isObj(v.basisSeen))
    for (const [k, fp] of Object.entries(v.basisSeen)) {
      const n = stepKey(k)
      if (n !== null && ns.has(n) && typeof fp === 'string' && SIG_RE.test(fp)) basisSeen[n] = fp
    }
  // the older chain this one replaced at its start, and the parked steps of it that went to the trash then
  let replaced: OrderChain['replaced']
  if (!nested && isObj(v.replaced)) {
    const older = readOrderChain(v.replaced.chain, true)
    const trashed = Array.isArray(v.replaced.trashed) ? [...new Set(v.replaced.trashed.filter(isId))].slice(0, MAX_STEPS) : []
    if (older) replaced = { chain: older, trashed }
  }
  // a chain planned again from a done step of the chain it replaced: that step, whose result its first step takes along
  let basis: OrderChain['basis']
  if (isObj(v.basis) && isStepN(v.basis.n) && isId(v.basis.id) && (ORDER_KINDS as readonly unknown[]).includes(v.basis.kind) && typeof v.basis.title === 'string') {
    const drop = Array.isArray(v.basis.drop) ? [...new Set(v.basis.drop.filter((b): b is string => typeof b === 'string' && BLOCK_RE.test(b)))].slice(0, MAX_OWN + 1) : []
    basis = { n: v.basis.n, id: v.basis.id, kind: v.basis.kind as OrderKind, title: v.basis.title.slice(0, MAX_TITLE), drop }
  }
  let budgetUsd: number | undefined
  if (typeof v.budgetUsd === 'number' && Number.isFinite(v.budgetUsd)) budgetUsd = Math.min(BUDGET_RANGE[1], Math.max(BUDGET_RANGE[0], v.budgetUsd))
  return {
    run: v.run,
    confirmedAt: v.confirmedAt,
    startAt: v.startAt,
    steps,
    doneBy,
    halted,
    ...(isTime(v.resumedAt) ? { resumedAt: v.resumedAt } : {}),
    // "Stop after the analysis": on unless stored as false
    checkpoint: v.checkpoint !== false,
    ...(budgetUsd !== undefined ? { budgetUsd } : {}),
    ...(Object.keys(made).length ? { made } : {}),
    ...(skipped.length ? { skipped } : {}),
    ...(seenNext.length ? { seenNext } : {}),
    ...(Object.keys(passed).length ? { passed } : {}),
    ...(Object.keys(advanced).length ? { advanced } : {}),
    ...(Object.keys(moved).length ? { moved } : {}),
    ...(Object.keys(back).length ? { back } : {}),
    ...(Object.keys(foreign).length ? { foreign } : {}),
    ...(Object.keys(basisSeen).length ? { basisSeen } : {}),
    ...(isTime(v.finishing) ? { finishing: v.finishing } : {}),
    ...(isTime(v.adopted) ? { adopted: v.adopted } : {}),
    ...(replaced ? { replaced } : {}),
    ...(basis ? { basis } : {}),
  }
}

const HOWS: readonly OrderPressHow[] = ['status', 'command', 'plate', 'send', 'card']
const MAX_PROV = 9
const by = (v: unknown): string | null => (typeof v === 'string' && v.length <= 200 ? v : null)

/** A kept press (its run, time, how; provenance of ≤ 9 pages — the row and 8 linked — and their pinned revisions). */
export function readPress(v: unknown): OrderPress | null {
  if (!isObj(v) || !isId(v.run) || !isTime(v.at) || !(HOWS as readonly unknown[]).includes(v.how)) return null
  const prov: Record<ID, OrderProv> = {}
  if (isObj(v.prov))
    for (const [id, p] of Object.entries(v.prov).slice(0, MAX_PROV)) {
      if (!isId(id) || !isObj(p) || typeof p.contentRev !== 'number' || !Number.isInteger(p.contentRev) || p.contentRev < 0) continue
      prov[id] = { createdBy: by(p.createdBy), updatedBy: by(p.updatedBy), contentOrigin: by(p.contentOrigin), contentRev: p.contentRev }
    }
  const pins: Record<ID, number> = {}
  if (isObj(v.pins))
    for (const [id, rev] of Object.entries(v.pins).slice(0, MAX_PROV)) if (isId(id) && typeof rev === 'number' && Number.isInteger(rev) && rev >= 0) pins[id] = rev
  const fps: Record<ID, string> = {}
  if (isObj(v.fps)) for (const [id, fp] of Object.entries(v.fps).slice(0, MAX_PROV)) if (isId(id) && typeof fp === 'string' && /^[0-9a-f]{64}$/.test(fp)) fps[id] = fp
  return { run: v.run, at: v.at, how: v.how as OrderPressHow, prov, pins, ...(Object.keys(fps).length ? { fps } : {}) }
}

/** A record that holds nothing any more (only planned, no draft, chain, kept press or request mark): none. */
export const bareRecord = (rec: OrderRecord): boolean => rec.state === 'draft' && !rec.draft && !rec.chain && !rec.want && !rec.asked && rec.pressed === undefined

/** A record as this build keeps it (null: none, or not one this build can read). */
export function readOrderRecord(v: unknown): OrderRecord | null {
  if (!isObj(v) || v.v !== 1 || !(STATES as readonly unknown[]).includes(v.state)) return null
  const state = v.state as OrderState
  const out: OrderRecord = { v: 1, state }
  if (isObj(v.want) && isTime(v.want.at) && v.want.mode === 'trigger') {
    const press = readPress(v.want.press)
    out.want = { at: v.want.at, mode: 'trigger', ...(press ? { press } : {}) }
  }
  // Orders B12: a Planen that arrived from another device · this device's own last press
  if (isObj(v.asked) && isTime(v.asked.at)) out.asked = { at: v.asked.at }
  if (isTime(v.pressed)) out.pressed = v.pressed
  const d = v.draft
  if (isObj(d) && isObj(d.plan) && typeof d.hash === 'string' && d.hash.length <= 128 && isId(d.run) && isTime(d.at)) out.draft = d as unknown as OrderDraft
  if (v.chain !== undefined) {
    const chain = readOrderChain(v.chain)
    // a running, halted or creating request whose chain cannot be read: not this build's to act on
    if (!chain && (state === 'running' || state === 'halted' || state === 'creating' || state === 'interrupted')) return null
    if (chain) out.chain = chain
  } else if (state === 'running' || state === 'halted') return null
  return out
}
