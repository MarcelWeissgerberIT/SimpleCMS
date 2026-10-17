/**
 * Work orders — "Ohne Bestätigung starten" / "Start without confirming" (Orders B11, spec §3.5), the pure core: which
 * finished plan may be created at once, and why not (Node specs read it; no store, no i18n).
 *
 * A plan is started without the person's ↵ only when NONE of these holds — each one leaves it at "Kette bereit" and is
 * named on the plate ("Nicht automatisch gestartet: 2 offene Punkte · Repo fehlt bei 02"):
 *  - open: the planner asked something (open points / questions);
 *  - repo: a step without a repo whose pipeline needs one (a Coding step always; a BA / QA step only when its pipeline
 *    runs more than document stages — §3.2);
 *  - otherRepo: a repo other than the request's Repo field — without one: other than the ONLY repo the worker announces
 *    (several announced and none named on the request: every step with a repo falls back, A15);
 *  - branch: a named branch, or one the planner asked for and the reader dropped (its note) — auto mode only ever lets
 *    the worker make a new branch;
 *  - kind: a step of a kind the consent does not cover (the request's own Pipelines field asked for another one);
 *  - outside: the request, a page the planner read or a page a step takes along is of an outside class (mail) or was
 *    last written by someone other than the person (an agent, the bridge, the sync / a file, an import, a share,
 *    Claude …) per the provenance captured at the press (§2.3; once the person edits the text himself, it is his);
 *  - moved: the request or a linked page differs between the press and the planner's read (fingerprints — never the
 *    tab-local contentRev, which an editor filling block ids moves);
 *  - keys: a key-shaped string was scrubbed from the plan;
 *  - budget: the chain would have no "Budget je Kette".
 * The lapse (the consent's sig against the settings now), the Patchbay's fuse and startChain's own refusals are checked by
 * the app part (autoStart.ts) — they need the store, the model and the lock.
 */
import type { ID, OrderKind } from '../../../store/types'
import type { OrderAutoWhy, OrderPlanV1, OrderProv, PlanNote } from './types'

/** Content origins of the person's own writing (an editor's `editor:<key>`, the answers to the planner, the summary key W). */
const PERSON_ORIGINS = new Set(['answers', 'summary'])
const byPerson = (origin: string | null | undefined): boolean => !origin || origin.startsWith('editor:') || PERSON_ORIGINS.has(origin)
/** A writer stamp that is not the person: an agent (`agent:<id>`), the public API / a webhook (`api:` / `hook:`). */
const outsideStamp = (by: string | null | undefined): boolean => typeof by === 'string' && /^(agent|api|hook|mcp):/.test(by)

/** Was this page last written by someone other than the person (the provenance captured at the press)? */
export const provOutside = (p: Pick<OrderProv, 'updatedBy' | 'contentOrigin'> | null | undefined): boolean => !!p && (outsideStamp(p.updatedBy) || !byPerson(p.contentOrigin))

/** What auto mode reads about one page that goes into the plan (the request, a page read, a step's ref). */
export interface AutoInput {
  id: ID
  /** of the data class `mail` (core/sources.ts classOfPage) */
  mail: boolean
  /** written last by someone other than the person (provOutside over the press's provenance, else now) */
  outside: boolean
}

export interface AutoFacts {
  plan: OrderPlanV1
  notes: readonly PlanNote[]
  /** the kinds the consent covers (the work orders' settings) */
  kinds: readonly OrderKind[]
  /** the request's Repo field (its option's name), null: none */
  rowRepo: string | null
  /** the repos the connected worker announces (names) */
  repos: readonly string[]
  /** per step (0-based): does its pipeline need a repo? */
  needsRepo: readonly boolean[]
  /** the request first, then every page read or taken along (each once) */
  inputs: readonly AutoInput[]
  /** fingerprints at the press (null: the plan came from no press — the answers to its questions) */
  pressFps: Readonly<Record<ID, string>> | null
  /** fingerprints of the planner's read */
  readFps: Readonly<Record<ID, string>>
  /** the chain's budget in $ (the plate's for this chain, else the settings'), null: none */
  budget: number | null
}

/** Why auto mode leaves this plan at "Kette bereit" (empty: it may be created at once). In the plate's order. */
export function autoFallbacks(f: AutoFacts): OrderAutoWhy[] {
  const out: OrderAutoWhy[] = []
  const steps = f.plan.steps
  if (f.plan.questions.length || f.plan.refused) out.push({ why: 'open', n: Math.max(1, f.plan.questions.length) })
  steps.forEach((st, i) => {
    if (!st.repo && (st.kind === 'coding' || f.needsRepo[i])) out.push({ why: 'repo', step: i + 1 })
  })
  const only = f.repos.length === 1 ? f.repos[0]! : null
  steps.forEach((st, i) => {
    if (!st.repo) return
    const want = f.rowRepo ?? only
    if (!want || st.repo !== want) out.push({ why: 'otherRepo', step: i + 1 })
  })
  const dropped = new Set(f.notes.flatMap((n) => (n.kind === 'branch' ? [n.step] : [])))
  steps.forEach((st, i) => {
    if (st.branch !== null || dropped.has(i + 1)) out.push({ why: 'branch', step: i + 1 })
  })
  steps.forEach((st, i) => {
    if (!f.kinds.includes(st.kind)) out.push({ why: 'kind', step: i + 1 })
  })
  const seen = new Set<ID>()
  for (const p of f.inputs) {
    if (seen.has(p.id)) continue
    seen.add(p.id)
    if (p.mail) out.push({ why: 'outside', page: p.id, cls: 'mail' })
    else if (p.outside) out.push({ why: 'outside', page: p.id, cls: 'foreign' })
  }
  if (f.pressFps)
    for (const [id, fp] of Object.entries(f.pressFps)) {
      const read = f.readFps[id]
      if (read !== undefined && read !== fp) out.push({ why: 'moved', page: id })
    }
  const keys = f.notes.reduce((n, x) => n + (x.kind === 'keys' ? x.count : 0), 0)
  if (keys) out.push({ why: 'keys', n: keys })
  if (f.budget === null) out.push({ why: 'budget' })
  return out
}

/**
 * The parts the consent's sig covers (§3.5): the database, its kinds, the pinned projects, the checkpoint, the budget,
 * the picked server (name, address, tested tools, the integration profiles matching it), and per kind the project it
 * resolves to with its pipeline's stages — plus this device's Approvals. Canonical JSON of this is hashed (autoSig.ts).
 */
export interface AutoSigParts {
  v: 1
  db: ID
  kinds: OrderKind[]
  pinned: Partial<Record<OrderKind, ID>>
  checkpoint: boolean
  budget: number | null
  server: { name: string; url: string | null; tools: string[] | null; profiles: string[] } | null
  projects: Array<{ kind: OrderKind; project: ID | null; stages: unknown[] }>
  approvals: 'all' | 'review' | 'none'
}

/** The pipeline's part of the sig: what each stage sends to the worker or decides next (names and colours aside). */
export function stagesPart(pipeline: ReadonlyArray<{ id: string; kind: string; auto?: boolean; permissionMode?: string; maxTurns?: number; gitAction?: string; next?: string | null; instructions?: string; output?: string; model?: string | null; hold?: boolean }>): unknown[] {
  return pipeline.map((s) => [s.id, s.kind, !!s.auto, s.permissionMode ?? null, s.maxTurns ?? null, s.gitAction ?? null, s.next ?? null, s.instructions ?? '', s.output ?? null, s.model ?? null, !!s.hold])
}

/* ------------------------------------------------------------------ the draft's reasons, read back */

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const count = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 10_000 ? v : null)
const stepNo = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 999 ? v : null)

/** A stored fallback reason as this build keeps it (null: not one it can read — records.ts readDraft drops it). */
export function readAutoWhy(v: unknown): OrderAutoWhy | null {
  if (!isObj(v)) return null
  switch (v.why) {
    case 'open':
    case 'keys':
      return count(v.n) ? { why: v.why, n: count(v.n)! } : null
    case 'repo':
    case 'otherRepo':
    case 'branch':
    case 'kind':
      return stepNo(v.step) ? { why: v.why, step: stepNo(v.step)! } : null
    case 'outside':
      return ID_RE.test(String(v.page)) && (v.cls === 'mail' || v.cls === 'foreign') ? { why: 'outside', page: String(v.page), cls: v.cls } : null
    case 'moved':
      return ID_RE.test(String(v.page)) ? { why: 'moved', page: String(v.page) } : null
    case 'budget':
    case 'lapsed':
      return { why: v.why }
    case 'fuse':
      return typeof v.label === 'string' && typeof v.path === 'string' ? { why: 'fuse', label: v.label.slice(0, 16), path: v.path.slice(0, 600) } : null
    case 'start':
      return typeof v.text === 'string' && v.text.trim() ? { why: 'start', text: v.text.slice(0, 300) } : null
    default:
      return null
  }
}
