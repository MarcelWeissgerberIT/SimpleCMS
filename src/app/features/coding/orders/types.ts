/**
 * Work orders (Prüfaufträge, features/coding/orders) — the contract every later part builds on. Pure types and limits
 * (a Node spec reads them).
 *
 *  - OrderPlanV1: the planner's one structured answer (purpose `coding.plan`), read strictly by plan.ts readPlan — every
 *    field bounded by PLAN_LIMITS; anything else is 'malformed' (one repair round).
 *  - OrderConfig (store/types.ts, `Database.orders`): read with readOrderConfig (config.ts).
 *  - OrderRecord: this device's record of a request — IndexedDB `one-coding`, key `<scope>|order|<rowId>`, announced on
 *    BroadcastChannel `one-coding-orders`; never synced, exported or backed up; wiped with the device copy and the local
 *    reset; drafts and finished chains dropped after 30 days. `chain.steps` is the authoritative chain on this device —
 *    the Prüfauftrag relation and the Schritt number on the task rows are for display only.
 *  - The writer of everything a chain writes: store/writer.ts `{ kind: 'order', row, run, change? }` — key
 *    `order:<row>:<run>[#c<n> | #a<n> | #s]` (c = created step n, a = advanced step n, s = the request's Status).
 */
import type { ID, OrderConfig, OrderKind, OrderStatusKey } from '../../../store/types'
import type { Writer } from '../../../store/writer'
import type { Receipt } from '../../ai/core/meter'

export type { OrderConfig, OrderKind, OrderStatusKey }

/* ------------------------------------------------------------------ the plan */

/** The planner's answer: what it understood, the server's context (when one took part), the steps, open points. */
export interface OrderPlanV1 {
  v: 1
  /** ≤ 600 — "Verstanden: …" */
  summary: string
  /** what the picked server returned that the planner used (null: no server took part); note ≤ 2000, absolute links only */
  context: { server: string; note: string; links: string[] } | null
  /** ≤ 6 steps, ≤ 3 of them coding — BA first when the requirement is unclear, QA last for the coded change */
  steps: OrderStepPlan[]
  /**
   * ≤ 5 × 300 — each gets its own answer field ("Antworten"). With no steps (only questions or a refusal) the Status
   * stays "Planen" (chip "Rückfrage"); beside steps they are the plan's open points (auto mode falls back on them)
   */
  questions: string[]
  /** ≤ 300 — why the planner made no plan (an unclear or empty request) */
  refused: string | null
}

/** One step of a plan — becomes one pipeline task in its kind's project. */
export interface OrderStepPlan {
  kind: OrderKind
  /** ≤ 200 */
  title: string
  /** Markdown ≤ 2000 → claudeBlocks (web images become links; a page link outside `refs` becomes its label) */
  goal: string
  /** ≤ 10 × 300, each checkable */
  criteria: string[]
  /** one of the worker's announced repos (else null + an open point) */
  repo: string | null
  /** null = a new branch the worker names; else BRANCH_NAME, announced or new — never the base branch */
  branch: string | null
  priority: 'high' | 'medium' | 'low'
  /** ⊆ the request's linked page ids (≤ 8) — the only pages that go along to Claude Code */
  refs: ID[]
  /** ≤ 300 — shown on the station */
  why: string
}

/** Every bound of a plan (plan.ts readPlan refuses anything beyond them — §2.7 / §2.11). */
export const PLAN_LIMITS = {
  summary: 600,
  contextNote: 2000,
  contextLinks: 20,
  steps: 6,
  codingSteps: 3,
  title: 200,
  goal: 2000,
  criteria: 10,
  criterion: 300,
  why: 300,
  refs: 8,
  questions: 5,
  question: 300,
  refused: 300,
} as const

/** Request limits (§2.11): the row's text, the linked pages, the server's calls, what a step page takes along. */
export const ORDER_LIMITS = {
  /** the request's readable text (a cut is noted) */
  requestChars: 40_000,
  /** linked pages that go to the planner, and the characters of each */
  linkedPages: 8,
  linkedChars: 20_000,
  /** server calls the planner is asked to make at most */
  serverCalls: 6,
  /** the request quoted verbatim into every step page ("Auftrag") */
  quoteChars: 4_000,
  /** the previous step's result copied in ("Grundlage") */
  basisChars: 20_000,
  /** planner runs at once: per row, per tab; rows per "Plan" command */
  runsPerRow: 1,
  runsPerTab: 3,
  rowsPerCommand: 5,
  /** a press kept while the worker is away (ms) */
  wantMs: 24 * 3600_000,
  /** step 01 starts this long after ↵ (the Undo window, ms) */
  startDelayMs: 10_000,
  /** records kept (ms) */
  keepMs: 30 * 24 * 3600_000,
  /** fewer characters of words than this: the request is empty, nothing is sent */
  minWords: 40,
} as const

/* ------------------------------------------------------------------ this device's record */

/** Where a request stands on this device (the chain engine ignores 'creating' / 'interrupted' rows). */
export type OrderState = 'draft' | 'creating' | 'interrupted' | 'running' | 'halted' | 'done' | 'discarded'

/** Who last wrote a page the planner read, captured at the press (from the write before the attribution keeper ran). */
export interface OrderProv {
  createdBy: string | null
  updatedBy: string | null
  contentOrigin: string | null
  contentRev: number
}

/** One call the planner made on the picked server, as the plate lists it ("<Server> · <tool>(<args>) → 3,2 kB"). */
export interface OrderCall {
  tool: string
  /** the arguments One's request sent, cut for display */
  args: string
  /** the size of what came back (bytes of text) */
  bytes: number
  /** false: the call failed or returned an error */
  ok: boolean
}

/** Why a tool of the picked server is not offered to the planner. */
export type OrderToolLeft = 'notRead' | 'out' | 'untested'

/** Why the picked server did not take part in a plan (orders/tools.ts serverSkip; 'token': no access in this browser). */
export type OrderServerSkip = 'missing' | 'off' | 'untested' | 'noReads' | 'refused' | 'rule' | 'route' | 'token'

/**
 * What reading the planner's answer changed (plan.ts readPlan) — the plate names each. `step`: the step's number
 * (1 = "01"); null: the plan's own text (summary, questions, refusal, the server's note).
 */
export type PlanNote =
  | { kind: 'repo'; step: number; repo: string }
  | { kind: 'branch'; step: number; branch: string; why: 'name' | 'base' | 'unknown' | 'kind' }
  | { kind: 'refs'; step: number; count: number }
  | { kind: 'links'; step: number | null; count: number }
  | { kind: 'keys'; step: number | null; count: number }
  | { kind: 'context'; why: 'noServer' | 'links' }

/** A plan shown on this device and not yet started (Status "Kette bereit"). */
export interface OrderDraft {
  plan: OrderPlanV1
  /** the hash ↵ confirms: the steps as edited, the resolved projects, each step's pipeline line, the Approvals */
  hash: string
  at: number
  /** the planner run (ledger source `order:<row>:<run>`) */
  run: string
  receipt: Receipt | null
  /** the person changed the plan on the plate (R asks before planning again) */
  edited: boolean
  source: {
    /** the request row's contentRev at the press */
    rev: number
    /** the row and each linked page: who wrote them, at the press */
    prov: Record<ID, OrderProv>
    /** contentRev of every page the planner read, at the press */
    pins: Record<ID, number>
    /**
     * fingerprints of what the planner read (orders/fingerprint.ts): the row → its request text as the step quote holds
     * it (requestFp), each linked page → title + text (pageFp). ↵ refuses when any moved since (contentRev is per tab —
     * never compared across tabs); the chain pins the pages at these.
     */
    fps?: Record<ID, string>
    /** the server that took part (its name here), null: none */
    server: string | null
    /** its tools the planner could call (read tools only) */
    tools: string[]
    /** its tools left out, with the reason */
    left: Array<{ tool: string; why: OrderToolLeft }>
    /** every call made */
    calls: OrderCall[]
    /** the picked server did not take part, and why (absent: none was picked, or it took part) */
    skip?: { server: string; why: OrderServerSkip }
  }
  /** answers to the planner's questions, written into the row as "Antworten" */
  answers?: Array<{ q: string; a: string }>
  /** what reading the answer changed (repos, branches, refs, links, keys) */
  notes?: PlanNote[]
  /**
   * "Ab hier neu planen" (replanFrom): planned again after step `n` of the running chain `run` was done — its steps
   * replace that chain's parked ones on ↵ (startChain), and the first of them takes step `n`'s result as its Grundlage
   */
  from?: { n: number; run: string }
  /**
   * a follow-up plan made while the request's chain stood halted or done: the record's state before the draft — D on it
   * brings that chain back as it was (halted: ↵ Fortsetzen / S again; its parked steps stay held)
   */
  over?: 'halted' | 'done'
  /**
   * "Budget je Kette" set on the plate for this chain (the field above ↵ Kette starten): an amount in $ (within the
   * config's BUDGET_RANGE), null = none for this chain; absent = the work orders' settings decide (Database.orders.budgetUsd)
   */
  budget?: number | null
  /**
   * Orders B11 — "Ohne Bestätigung starten" on this device did NOT start this plan: why (spec §3.5 fallbacks — open
   * points, repo / branch doubts, outside content, a moved pin, a scrubbed key, a lapsed consent, a fuse, a refusal of
   * the start itself). The plate says it above the plan ("Nicht automatisch gestartet: …"); ↵ Kette starten as always.
   */
  auto?: { at: number; reasons: OrderAutoWhy[] }
  /**
   * Orders B11 — fingerprints of the request and its linked pages taken AT THE PRESS (press.ts; orders/fingerprint.ts,
   * the same forms as `source.fps`): auto mode falls back when one differs from what the planner read ("moved since the
   * press" — never the tab-local contentRev, which an editor filling block ids moves)
   */
  pressFps?: Record<ID, string>
}

/**
 * Orders B11 — why auto mode left a finished plan at "Kette bereit" (spec §3.5; each named on the plate):
 *  - open: open points or questions (plan.ts planOpenPoints) · repo: a step without a repo whose pipeline needs one ·
 *    otherRepo: a repo other than the request's Repo field (or, without one, the only announced repo) · branch: a named
 *    branch (or one the planner asked for and the reader dropped) · kind: a step of a kind the consent does not cover
 *  - outside: the request or a page that goes along is of an outside class (mail) or was written by someone other than
 *    the person (an agent, the bridge, the sync / a file, an import, a share, Claude — the captured provenance)
 *  - moved: the request or a linked page changed between the press and the planner's read
 *  - keys: a key-shaped string was scrubbed from the plan · budget: no "Budget je Kette" for the chain
 *  - lapsed: the settings changed since the consent was given (dropped — switch it on again)
 *  - fuse: the Patchbay says the planner's path would trip a fuse (its sentence, as shown when it was checked)
 *  - start: startChain itself refused (its refusal in words, as said when it was refused)
 */
export type OrderAutoWhy =
  | { why: 'open'; n: number }
  | { why: 'repo'; step: number }
  | { why: 'otherRepo'; step: number }
  | { why: 'branch'; step: number }
  | { why: 'kind'; step: number }
  | { why: 'outside'; page: ID; cls: 'mail' | 'foreign' }
  | { why: 'moved'; page: ID }
  | { why: 'keys'; n: number }
  | { why: 'budget' }
  | { why: 'lapsed' }
  | { why: 'fuse'; label: string; path: string }
  | { why: 'start'; text: string }

/** One step of a confirmed chain. */
export interface OrderChainStep {
  /** the step number (a follow-up chain goes on counting: 4, 5, 6 …) */
  n: number
  /** the task row */
  id: ID
  kind: OrderKind
  /** the project (pipeline database) it was created in */
  project: ID
  /** its pipeline line at confirm (start: true) — a different one at advance asks first */
  line: string
  /** this device's Approvals for it at confirm */
  approvals: 'all' | 'review' | 'none'
  /**
   * each page it takes along → its fingerprint as confirmed (the planner's read, checked at ↵; a ref card's ↵ pins what
   * it rendered) — compared at advance; '' = unknown (asks)
   */
  refs: Record<ID, string>
  /** the slot block the Grundlage replaces (null: step 1, which has none) */
  basisBlock: string | null
  /**
   * the blocks the chain wrote into the step page at creation (the slot, the "Auftrag" quote, the "Kontext" callout) —
   * never copied on into the next step's Grundlage (orders/basis.ts)
   */
  own?: string[]
  /** its title and contentRev right after it was created (undoChain / finishCreates: "untouched" means still these) */
  title?: string
  rev?: number
  /**
   * SHA-256 of what was confirmed for its page (title, project, fields, text — orders/confirm.ts stepSig): a step still
   * to be made after an interruption is made without asking only while it is still exactly this
   */
  sig?: string
}

/** Evidence of who moved step n to done (written at the move; only `coding` / `you` / `terminal` let it go on). */
export interface OrderDoneBy {
  /** the writer kind (store/writer.ts) */
  kind: Writer['kind']
  /** you: how ('ui' · 'preflight' …) */
  via?: string
  at: number
  /** the surface that approved it showed step n+1 in full */
  sawNext?: boolean
}

/**
 * Why a chain halted (each a plate line and the Preflight card "Kette angehalten"). 'ejected': the flight recorder's eject
 * took a step's creation back (its `step`); 'ejectedStatus': an eject took back the Status the chain wrote while it ran
 * (Orders B13).
 */
export type OrderHaltWhy = 'status' | 'trashed' | 'budget' | 'member' | 'outOfOrder' | 'startsAtOnce' | 'noStart' | 'statusOption' | 'stopped' | 'ejected' | 'ejectedStatus' | 'finished' | 'putBack'

/** Every halt reason (the record reader keeps only these). */
export const ORDER_HALT_WHYS: readonly OrderHaltWhy[] = ['status', 'trashed', 'budget', 'member', 'outOfOrder', 'startsAtOnce', 'noStart', 'statusOption', 'stopped', 'ejected', 'ejectedStatus', 'finished', 'putBack']

/** A confirmed chain on this device. */
export interface OrderChain {
  run: string
  confirmedAt: number
  /** step 1 starts at this time (↵ + 10 s; ↵ again: now) */
  startAt: number
  steps: OrderChainStep[]
  doneBy: Record<number, OrderDoneBy>
  /** sticky: only resumeChain (VON HAND, on the worker device) leaves it — `step`: the step it is about, if any */
  halted: { at: number; why: OrderHaltWhy; by: string; step?: number } | null
  resumedAt?: number
  /** "Stop after the analysis" as confirmed */
  checkpoint: boolean
  budgetUsd?: number
  /** while creating: step n → the task made so far (a throw trashes them; finishCreates completes them) */
  made?: Record<number, ID>
  /** steps skipped (S) — the next one gets no Grundlage from them */
  skipped?: number[]
  /**
   * steps whose last gate the person approved on a surface that showed the next step in full (the gate card's fold):
   * the analysis checkpoint after such a step needs no second press, also when its done move comes later (a stage
   * after the gate runs first)
   */
  seenNext?: number[]
  /**
   * the reasons a VON HAND key on a card already passed for step n (no evidence of the done move · the analysis
   * checkpoint): a reason that appears after them (the Confirm wait) never brings them back — the person saw them
   */
  passed?: Record<number, Array<'evidence' | 'checkpoint'>>
  /**
   * the steps the engine started (step n → when): written BEFORE the move (write-ahead), so a step out of its park
   * stage without one ran out of order, and a step with one still parked is moved again (the move is idempotent)
   */
  advanced?: Record<number, number>
  /**
   * the steps whose move landed in the store (step n → when; written right after it under the chain's lock): only a step
   * started (`advanced`) WITHOUT this mark is ever moved again — never one a lagging store shows parked
   */
  moved?: Record<number, number>
  /** moved steps someone other than the chain put back into their park stage (step n → when; the tab where it happened) */
  back?: Record<number, number>
  /**
   * pages the chain copies from or takes along (its steps once started, its refs, a replan's basis step) → when someone
   * other than the chain, the person or this device's worker last wrote them (an agent, the bridge, the sync, an
   * automation, another device …) — the Grundlage / ref card shows them before they go on
   */
  foreign?: Record<ID, number>
  /** step n → the fingerprint of the Grundlage a card showed and the person passed (its ↵) */
  basisSeen?: Record<number, string>
  /**
   * Orders B13 — steps whose creation the flight recorder's eject took back (step n → the eject's id; its unit
   * `order:<row>:<run>#c<n>`): an ejected step halts the chain ('ejected', S decides); the eject's Undo drops its own
   * marks again (the halt stays — an eject and its Undo never advance a chain)
   */
  ejected?: Record<number, string>
  /** this device asks "end the chain?" since (the request was set to Fertig while it ran) */
  finishing?: number
  /**
   * this device took the chain over (Preflight's "Kette bestätigen" — the worker moved here, a restored backup): its steps
   * were made elsewhere, so Z (undoChain) never takes them back
   */
  adopted?: number
  /**
   * the request's older chain this one replaced when it started (a follow-up chain): its steps still parked then went to
   * the trash (`trashed`, said on the plate before ↵) — undoChain brings them and that chain back
   */
  replaced?: { chain: OrderChain; trashed: ID[] }
  /**
   * a chain planned again from a done step of the chain it replaced ("Ab hier neu planen"): that step — its task, kind,
   * title as confirmed and its own chain blocks — whose result the first step of this chain takes as its Grundlage
   */
  basis?: { n: number; id: ID; kind: OrderKind; title: string; drop: string[] }
}

/**
 * How a request was pressed (spec §0 — the fixed allow-list, in this tab only): its Status set to Planen by the person
 * (via none / 'ui': a board drag, a cell pick) · the database command Planen · ↵ Planen on the plate · Prüfen lassen ·
 * 'card': ↵ Hier planen on Preflight's card for a request asked for on another device (a team, §3.10 — VON HAND).
 */
export type OrderPressHow = 'status' | 'command' | 'plate' | 'send' | 'card'

/**
 * A press, as the planner gets it (orders/planner.ts planOrder): its run (the planner run's id — ledger source
 * `order:<row>:<run>`), when, how, and the provenance captured synchronously at the press (press.ts pressProv — the row
 * and each linked page, from the write before the attribution keeper could clear an agent's stamp; `pins` = their
 * contentRev then).
 */
export interface OrderPress {
  run: string
  at: number
  how: OrderPressHow
  prov: Record<ID, OrderProv>
  pins: Record<ID, number>
  /** Orders B11: fingerprints of the request and its linked pages at the press (auto mode's "moved since the press") */
  fps?: Record<ID, string>
}

/** This device's record of one request. */
export interface OrderRecord {
  v: 1
  state: OrderState
  /**
   * a press made on this device while the worker was away or Coding was off: plans when an 'ok' worker is back (5 s
   * after; ≤ 24 h, then it expires — "abgelaufen — ↵ erneut"); `press` = the press it keeps (its provenance and pins)
   */
  want?: { at: number; mode: 'trigger'; press?: OrderPress }
  draft?: OrderDraft
  chain?: OrderChain
  /**
   * Orders B12 (a team): the request's Status reached Planen from ANOTHER device — this device saw the change arrive
   * from the server (the member's own write: the work orders are private) — the worker device's VON HAND card "Auf
   * anderem Gerät angefordert · ↵ Hier planen" (never a trigger). ≤ 24 h; dropped when the request leaves Planen or is
   * pressed here.
   */
  asked?: { at: number }
  /** Orders B12: when this device last pressed the request (any outcome) — a request card never names its own press. ≤ 24 h. */
  pressed?: number
}
