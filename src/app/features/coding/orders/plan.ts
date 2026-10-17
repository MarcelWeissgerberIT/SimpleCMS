/**
 * Work orders — reading the planner's answer (spec §2.7), pure (a Node spec fuzzes it). `readPlan` is strict: an answer
 * that is no JSON, has a field of the wrong type, a key nobody asked for, a string over its bound, too many steps / coding
 * steps / criteria / questions, a kind that is not offered, or nothing at all (no step, no question, no refusal) is
 * refused with every problem in English — the planner's one repair round sends them back. What is read is then made
 * safe, each change noted for the plate:
 *  - repo: one the connected worker announced, else null (an open point);
 *  - branch: coding steps only; a branch name (BRANCH_NAME, never option-like, no "..") that is not the repo's base
 *    branch and — when the worker names its branches — one of them; else null (the worker makes its own);
 *  - refs: only the request's linked pages (≤ 8), others dropped;
 *  - links: a page reference outside a step's `refs` — a Markdown link to `#/p/<id>` or a pasted One address — and every
 *    `one:` link becomes plain text (its label, an address "@Title"); the plan-level texts (summary, questions, refusal,
 *    the server's note) keep no One link at all. So only `refs` can reach Claude Code;
 *  - context: only when a server took part (its name the person's own, as picked); its note keeps no relative links, its
 *    links only absolute http(s) ones that are no One address;
 *  - keys: a key-shaped string (the gate's detector) refuses the answer in the first round; in the repair round's answer
 *    (`scrub`) it is replaced by "••••" and named per step.
 * The draft's hash (`orderPlanHash`): the steps as edited, each step's resolved project and pipeline lines, the Approvals.
 * `planOrder` (planner.ts, the app's runner) is reachable from here too (lazy): B4's entry points call it through this seam.
 */
import type { ID } from '../../../store/types'
import { BRANCH_NAME } from '../draft'
import { canonicalJson } from '../protocol'
import { scrubSecrets } from '@/shared/ai/keys'
import { planKeyHits, scrubPlanKeys } from './keys'
import { PLAN_LIMITS, type OrderKind, type OrderPlanV1, type OrderStepPlan, type PlanNote } from './types'

/** What the reader checks an answer against. */
export interface PlanReadCtx {
  /** the kinds the planner was offered (usable ∩ configured ∩ the row's Pipelines) */
  kinds: readonly OrderKind[]
  /** the connected worker's repositories: name, base branch, announced branches ([] = none announced) */
  repos: ReadonlyArray<{ name: string; base: string; branches: readonly string[] }>
  /** the request's linked pages — the only refs a step may name */
  refs: readonly ID[]
  /** a page's title for a reference that becomes text (null / '': unknown — the address is dropped) */
  titleOf: (id: ID) => string | null
  /** the server that took part (the person's name for it); null: none — then there is no context */
  server: string | null
}

export type { PlanNote }

export type PlanRead = { ok: true; plan: OrderPlanV1; notes: PlanNote[] } | { ok: false; problems: string[] }

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const PRIORITIES = ['high', 'medium', 'low'] as const
const KINDS: readonly string[] = ['spec', 'coding', 'qa']
const PLAN_KEYS = ['v', 'summary', 'context', 'steps', 'questions', 'refused']
const STEP_KEYS = ['kind', 'title', 'goal', 'criteria', 'repo', 'branch', 'priority', 'refs', 'why']
const CONTEXT_KEYS = ['server', 'note', 'links']
/** a refs entry as the store mints ids */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
/** a link's href is at most this long (anything longer is no link we keep) */
const MAX_LINK = 2000
const MAX_PROBLEMS = 30

/** a Markdown link `[label](href "title")` — the label may hold escaped brackets */
const MD_LINK = /\[((?:\\.|[^\]\\\n])*)\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"\n]*")?\s*\)/g
/** a One address in a link */
const ADDRESS_ID = /#\/p\/([A-Za-z0-9_-]{4,64})/
/** a One address in text, with the site in front of it when there is one */
const ADDRESS = /(?:https?:\/\/[^\s<>()[\]"']*)?#\/p\/([A-Za-z0-9_-]{4,64})/g
const ABSOLUTE = /^https?:\/\/[^\s]+$/i

/**
 * A text with every page reference outside `keep` made plain: a Markdown link to such a page (or any `one:` link) → its
 * label; a One address in the text → "@Title" (an unknown page: nothing). `relative`: also a Markdown link whose address
 * is not absolute http(s) → its label (the server's note). Returns the text and how many it changed.
 */
export function unlinkText(text: string, keep: ReadonlySet<ID>, titleOf: (id: ID) => string | null, relative = false): { text: string; count: number } {
  let count = 0
  const viaLinks = text.replace(MD_LINK, (all, label: string, href: string) => {
    const h = href.trim()
    if (h.toLowerCase().startsWith('one:')) {
      count++
      return label
    }
    const id = ADDRESS_ID.exec(h)?.[1]
    if (id) {
      if (keep.has(id)) return all
      count++
      return label
    }
    if (relative && !ABSOLUTE.test(h)) {
      count++
      return label
    }
    return all
  })
  const out = viaLinks.replace(ADDRESS, (all, id: string) => {
    // a kept page's address stays (also inside a kept link); any other: text (or a label) naming a page nobody confirmed
    if (keep.has(id)) return all
    count++
    const title = (titleOf(id) ?? '').replace(/\s+/g, ' ').trim()
    return title ? `@${title}` : ''
  })
  return { text: out, count }
}

/** The plan's bounds as a reader sees them (problems in English: the repair round sends them back word for word). */
class Problems {
  list: string[] = []
  add(p: string) {
    if (this.list.length < MAX_PROBLEMS) this.list.push(p)
  }
}

function str(v: unknown, path: string, max: number, p: Problems, o: { required?: boolean; line?: boolean } = {}): string | null {
  if (typeof v !== 'string') {
    p.add(`${path} must be a string.`)
    return null
  }
  let s = v.trim()
  if (o.line) s = s.replace(/\s+/g, ' ')
  if (o.required && !s) {
    p.add(`${path} is empty.`)
    return null
  }
  if (s.length > max) {
    p.add(`${path} has ${s.length} characters — at most ${max}.`)
    return null
  }
  return s
}

function unknownKeys(o: Obj, known: readonly string[], path: string, p: Problems) {
  for (const k of Object.keys(o)) if (!known.includes(k)) p.add(`${path} has a key nobody asked for: ${JSON.stringify(k.slice(0, 40))}.`)
}

function strList(v: unknown, path: string, maxItems: number, maxLen: number, p: Problems, o: { required?: boolean } = {}): string[] | null {
  if (!Array.isArray(v)) {
    p.add(`${path} must be a list of strings.`)
    return null
  }
  if (v.length > maxItems) {
    p.add(`${path} has ${v.length} entries — at most ${maxItems}.`)
    return null
  }
  const out: string[] = []
  v.forEach((x, i) => {
    const s = str(x, `${path}[${i}]`, maxLen, p, { required: o.required, line: true })
    if (s !== null) out.push(s)
  })
  return out.length === v.length ? out : null
}

/** The shape and bounds of one step (null: refused — the problems say why). */
function readStep(v: unknown, i: number, ctx: PlanReadCtx, p: Problems): OrderStepPlan | null {
  const path = `steps[${i}]`
  if (!isObj(v)) {
    p.add(`${path} must be an object.`)
    return null
  }
  const before = p.list.length
  unknownKeys(v, STEP_KEYS, path, p)
  for (const k of STEP_KEYS) if (!(k in v)) p.add(`${path}.${k} is missing.`)
  let kind: OrderKind | null = null
  if (typeof v.kind !== 'string' || !KINDS.includes(v.kind)) p.add(`${path}.kind must be one of ${ctx.kinds.join(', ')}.`)
  else if (!ctx.kinds.includes(v.kind as OrderKind)) p.add(`${path}.kind ${JSON.stringify(v.kind)} is not offered here — offered: ${ctx.kinds.join(', ') || 'none'}.`)
  else kind = v.kind as OrderKind
  const title = str(v.title, `${path}.title`, PLAN_LIMITS.title, p, { required: true, line: true })
  const goal = str(v.goal, `${path}.goal`, PLAN_LIMITS.goal, p, { required: true })
  const criteria = strList(v.criteria, `${path}.criteria`, PLAN_LIMITS.criteria, PLAN_LIMITS.criterion, p, { required: true })
  const why = str(v.why, `${path}.why`, PLAN_LIMITS.why, p, { line: true })
  let repo: string | null = null
  if (v.repo !== null && v.repo !== undefined) {
    if (typeof v.repo !== 'string') p.add(`${path}.repo must be a repository name or null.`)
    else repo = v.repo.trim().slice(0, 200) || null
  }
  let branch: string | null = null
  if (v.branch !== null && v.branch !== undefined) {
    if (typeof v.branch !== 'string') p.add(`${path}.branch must be a branch name or null.`)
    else branch = v.branch.trim().slice(0, 300) || null
  }
  const priority = typeof v.priority === 'string' && (PRIORITIES as readonly string[]).includes(v.priority) ? (v.priority as OrderStepPlan['priority']) : null
  if (!priority) p.add(`${path}.priority must be high, medium or low.`)
  let refs: string[] | null = null
  if (!Array.isArray(v.refs)) p.add(`${path}.refs must be a list of page ids.`)
  else if (v.refs.length > PLAN_LIMITS.refs * 4) p.add(`${path}.refs has ${v.refs.length} entries — at most ${PLAN_LIMITS.refs}.`)
  else refs = v.refs.filter((r): r is string => typeof r === 'string').map((r) => r.trim())
  if (p.list.length > before || !kind || title === null || goal === null || !criteria || why === null || !priority || !refs) return null
  return { kind, title, goal, criteria, repo, branch, priority, refs, why }
}

/** Shape, bounds and kinds — before anything is made safe. */
function readShape(raw: unknown, ctx: PlanReadCtx): { plan: OrderPlanV1 | null; problems: string[] } {
  const p = new Problems()
  let v: unknown = raw
  if (typeof raw === 'string') {
    const text = raw.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/, '$1')
    try {
      v = JSON.parse(text)
    } catch {
      return { plan: null, problems: ['The answer is no JSON object.'] }
    }
  }
  if (!isObj(v)) return { plan: null, problems: ['The answer must be a JSON object.'] }
  unknownKeys(v, PLAN_KEYS, 'The plan', p)
  for (const k of PLAN_KEYS) if (!(k in v)) p.add(`"${k}" is missing.`)
  if (v.v !== 1) p.add('"v" must be 1.')
  const summary = str(v.summary, 'summary', PLAN_LIMITS.summary, p)
  // the server's context
  let context: OrderPlanV1['context'] = null
  if (v.context !== null && v.context !== undefined) {
    if (!isObj(v.context)) p.add('context must be an object or null.')
    else {
      unknownKeys(v.context, CONTEXT_KEYS, 'context', p)
      const server = str(v.context.server, 'context.server', 200, p, { line: true })
      const note = str(v.context.note, 'context.note', PLAN_LIMITS.contextNote, p)
      const links = Array.isArray(v.context.links) ? v.context.links : null
      if (!links) p.add('context.links must be a list of links.')
      else if (links.length > PLAN_LIMITS.contextLinks) p.add(`context.links has ${links.length} entries — at most ${PLAN_LIMITS.contextLinks}.`)
      if (server !== null && note !== null && links && links.length <= PLAN_LIMITS.contextLinks)
        context = { server, note, links: links.filter((l): l is string => typeof l === 'string').map((l) => l.trim()) }
    }
  }
  // the steps
  const steps: OrderStepPlan[] = []
  if (!Array.isArray(v.steps)) p.add('steps must be a list.')
  else if (v.steps.length > PLAN_LIMITS.steps) p.add(`steps has ${v.steps.length} steps — at most ${PLAN_LIMITS.steps}.`)
  else {
    v.steps.forEach((s, i) => {
      const step = readStep(s, i, ctx, p)
      if (step) steps.push(step)
    })
    const coding = steps.filter((s) => s.kind === 'coding').length
    if (coding > PLAN_LIMITS.codingSteps) p.add(`The plan has ${coding} coding steps — at most ${PLAN_LIMITS.codingSteps}.`)
  }
  const questions = strList(v.questions, 'questions', PLAN_LIMITS.questions, PLAN_LIMITS.question, p, { required: true })
  let refused: string | null = null
  if (v.refused !== null && v.refused !== undefined) refused = str(v.refused, 'refused', PLAN_LIMITS.refused, p, { line: true }) || null
  if (p.list.length) return { plan: null, problems: p.list }
  if (!steps.length && !questions!.length && !refused) return { plan: null, problems: ['The plan has no step, no question and no refusal — plan steps, or ask what is unclear.'] }
  return { plan: { v: 1, summary: summary ?? '', context, steps, questions: questions ?? [], refused }, problems: [] }
}

/** Is this a branch name a step may name (the Branch field's rule, never option-like, no "..")? */
const branchOk = (b: string) => BRANCH_NAME.test(b) && !b.startsWith('-') && !b.includes('..') && !b.endsWith('/') && !b.endsWith('.lock')

/** Repos, branches, refs, links and the context made safe (see the head of this file). */
function makeSafe(plan: OrderPlanV1, ctx: PlanReadCtx): { plan: OrderPlanV1; notes: PlanNote[] } {
  const notes: PlanNote[] = []
  const allowed = new Set(ctx.refs)
  const none = new Set<ID>()
  /** a text without One links outside `keep`, still within its bound (a title in place of an address can be longer) */
  const plain = (step: number | null, text: string, keep: ReadonlySet<ID>, max: number, relative = false): string => {
    const r = unlinkText(text, keep, ctx.titleOf, relative)
    if (r.count) {
      const n = notes.find((x): x is Extract<PlanNote, { kind: 'links' }> => x.kind === 'links' && x.step === step)
      if (n) n.count += r.count
      else notes.push({ kind: 'links', step, count: r.count })
    }
    return r.text.length > max ? `${r.text.slice(0, max - 1)}…` : r.text
  }
  const steps = plan.steps.map((s, i): OrderStepPlan => {
    const n = i + 1
    // refs: only the request's pages, once each, at most 8
    const refs = [...new Set(s.refs.filter((r) => ID_RE.test(r) && allowed.has(r)))].slice(0, PLAN_LIMITS.refs)
    const dropped = new Set(s.refs).size - refs.length
    if (dropped > 0) notes.push({ kind: 'refs', step: n, count: dropped })
    const keep = new Set(refs)
    // repo: one the worker announced
    const known = s.repo ? ctx.repos.find((r) => r.name === s.repo) : undefined
    if (s.repo && !known) notes.push({ kind: 'repo', step: n, repo: scrubSecrets(s.repo) })
    const repo = known?.name ?? null
    // branch: coding only, a name, not the base, one of the worker's when it names them
    let branch: string | null = null
    if (s.branch) {
      const why: Extract<PlanNote, { kind: 'branch' }>['why'] | null =
        s.kind !== 'coding' ? 'kind' : !branchOk(s.branch) ? 'name' : known && s.branch === known.base ? 'base' : !known || (known.branches.length && !known.branches.includes(s.branch)) ? 'unknown' : null
      if (why) notes.push({ kind: 'branch', step: n, branch: scrubSecrets(s.branch), why })
      else branch = s.branch
    }
    const goal = plain(n, s.goal, keep, PLAN_LIMITS.goal)
    // a title that was only a link to a page nobody confirmed: the goal's first line names the step instead
    const title = plain(n, s.title, keep, PLAN_LIMITS.title).replace(/\s+/g, ' ').trim() || goal.split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, PLAN_LIMITS.title) || String(n).padStart(2, '0')
    return {
      ...s,
      title,
      goal,
      criteria: s.criteria.map((c) => plain(n, c, keep, PLAN_LIMITS.criterion)),
      why: plain(n, s.why, keep, PLAN_LIMITS.why),
      repo,
      branch,
      refs,
    }
  })
  // the server's context: only when one took part — named as the person named it; absolute links only
  let context: OrderPlanV1['context'] = null
  if (plan.context && !ctx.server) notes.push({ kind: 'context', why: 'noServer' })
  else if (plan.context && ctx.server) {
    const links = plan.context.links.filter((l) => l.length <= MAX_LINK && ABSOLUTE.test(l) && !ADDRESS_ID.test(l)).slice(0, PLAN_LIMITS.contextLinks)
    if (links.length !== plan.context.links.length) notes.push({ kind: 'context', why: 'links' })
    context = { server: ctx.server, note: plain(null, plan.context.note, none, PLAN_LIMITS.contextNote, true), links: [...new Set(links)] }
  }
  return {
    plan: {
      v: 1,
      summary: plain(null, plan.summary, none, PLAN_LIMITS.summary),
      context,
      steps,
      questions: plan.questions.map((q) => plain(null, q, none, PLAN_LIMITS.question)),
      refused: plan.refused === null ? null : plain(null, plan.refused, none, PLAN_LIMITS.refused),
    },
    notes,
  }
}

/**
 * Read the planner's answer (a JSON string, or a parsed value): refused with its problems, or the plan made safe with
 * what changed. `scrub`: the repair round's answer — key-shaped strings are scrubbed (and named) instead of refused.
 */
export function readPlan(raw: unknown, ctx: PlanReadCtx, opts: { scrub?: boolean } = {}): PlanRead {
  let shape: ReturnType<typeof readShape>
  try {
    shape = readShape(raw, ctx)
  } catch {
    return { ok: false, problems: ['The answer could not be read.'] }
  }
  if (!shape.plan) return { ok: false, problems: shape.problems }
  const safe = makeSafe(shape.plan, ctx)
  const hits = planKeyHits(safe.plan)
  if (hits.length && !opts.scrub)
    return {
      ok: false,
      problems: hits.map((h) => `${h.step === null ? h.field : `steps[${h.step - 1}].${h.field}`} holds something that looks like a secret key or token — leave it out.`),
    }
  if (!hits.length) return { ok: true, plan: safe.plan, notes: safe.notes }
  const scrubbed = scrubPlanKeys(safe.plan)
  return { ok: true, plan: scrubbed.plan, notes: [...safe.notes, ...scrubbed.scrubbed.map((s): PlanNote => ({ kind: 'keys', step: s.step, count: s.count }))] }
}

/**
 * A plan as stored with a draft (this device's record), read again without the world it was made in: its shape and
 * bounds only (every kind, no repo / ref checks — those were made when it was read) — null: not this build's plan.
 */
export function readStoredPlan(raw: unknown): OrderPlanV1 | null {
  const ctx: PlanReadCtx = { kinds: ['spec', 'coding', 'qa'], repos: [], refs: [], titleOf: () => null, server: null }
  try {
    const shape = readShape(raw, ctx)
    if (!shape.plan) return null
    // what readPlan kept stays as it is (repos, branches, refs, context): checked only for their bounds here
    const v = raw as OrderPlanV1
    const steps = shape.plan.steps.map((s, i) => {
      const src = v.steps[i]!
      const refs = Array.isArray(src.refs) ? src.refs.filter((r) => typeof r === 'string' && ID_RE.test(r)).slice(0, PLAN_LIMITS.refs) : []
      const branch = typeof src.branch === 'string' && branchOk(src.branch) ? src.branch : null
      return { ...s, repo: typeof src.repo === 'string' ? src.repo.slice(0, 200) : null, branch, refs }
    })
    const context = shape.plan.context && v.context ? { server: String(v.context.server).slice(0, 64), note: shape.plan.context.note, links: shape.plan.context.links.filter((l) => l.length <= MAX_LINK && ABSOLUTE.test(l)).slice(0, PLAN_LIMITS.contextLinks) } : null
    return { ...shape.plan, steps, context }
  } catch {
    return null
  }
}

/** The open points a plan leaves (the plate's "Offen:", auto mode's fallback): its questions, and coding steps without a repo. */
export function planOpenPoints(plan: OrderPlanV1): Array<{ kind: 'question'; text: string } | { kind: 'repo'; step: number }> {
  return [
    ...plan.questions.map((text) => ({ kind: 'question' as const, text })),
    ...plan.steps.flatMap((s, i) => (s.kind === 'coding' && !s.repo ? [{ kind: 'repo' as const, step: i + 1 }] : [])),
  ]
}

/** What one step resolves to on this device: its project (null: made at confirm) and its pipeline lines (stages.ts pipelineLine). */
export interface ResolvedStep {
  project: ID | null
  /** pipelineLine(…, start: false) — where it is parked */
  park: string
  /** pipelineLine(…, start: true) — where the chain starts it */
  start: string
}

/**
 * The draft's hash (what ↵ Kette starten confirms): the steps as they stand (edited or not), each step's resolved
 * project and pipeline lines, this device's Approvals — SHA-256 over their canonical JSON. B6's startChain recomputes it.
 */
export async function orderPlanHash(plan: OrderPlanV1, resolved: readonly ResolvedStep[], approvals: 'all' | 'review' | 'none'): Promise<string> {
  const text = canonicalJson({ v: 1, steps: plan.steps, context: plan.context, resolved, approvals })
  const bytes = new TextEncoder().encode(text)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The planner (B5, planner.ts) through its seam — B4's entry points (Status → Planen, the command, ↵ Planen, "Prüfen
 * lassen") call this; the runner itself loads lazily (it imports the store, the AI facades, the worker's state).
 */
export const planOrder = (rowId: ID, opts: { mode: 'manual' | 'trigger'; prov?: Record<ID, import('./types').OrderProv>; replace?: boolean }): Promise<import('./planner').PlanOutcome> =>
  import('./planner').then((m) => m.planOrder(rowId, opts))
