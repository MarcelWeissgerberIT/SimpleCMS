/**
 * The engines' rules on what a write can start (plan §1.3) — pure, shared by the rack (model.ts draws net flags only
 * where a listener can start) and the chain analysis (chains.ts walks the flow with the very same rules, §2.5):
 *  - automations fire only in the tab where the write happens, never on a remote write, never while paused: a server
 *    agent's write (remote in every tab) starts no automation and no autofill, only a kit value relay (recompute has no
 *    remote check, §6 A12); a team hook's write (on the server) starts no automation and no autofill;
 *  - `set_property` never starts automations (applyingAction); a script inside a `run_script` action runs with
 *    automations paused;
 *  - agents never start agents directly (both runners skip `agent:` writers) — through an automation they do;
 *  - autofill never starts autofill (its own fields are out of `rowHash`), and listens to its row's inputs;
 *  - a field "only by hand" (`agentReadOnly`) is never written by an agent or the MCP bridge (enforced in the agent's
 *    and the bridge's tools, §1.18) — every other writer ignores the flag (autofill, automations, kit, scripts);
 *  - mail "Organise with Claude" sorts only the mails a sync just created (mail/service.ts `organiseRows(res.created)`,
 *    "Organise earlier mails" the synced ones): no write of any module starts it — only the mail sync's row trigger;
 *  - the coding worker writes the task row in its tab (Stage moves, plan and summary, fields — coding/tasks.ts
 *    finishStage under `codingWriter`, automations not paused): a local writer like any other ('pipeline');
 *  - a pipeline's git stage runs with nobody in between unless a gate the task's Approvals stop at stands between where
 *    the task enters and that stage (coding/tasks.ts `skipsGate`: a hold gate always stops; 'all' every gate; 'review'
 *    every gate but one right after a plan stage; 'none' only hold gates). A write that can set the task's Stage (the
 *    Stage property itself, every field, a new row) can drop it into any stage the worker takes on its own (`auto`):
 *    every such stage is an entry then (fix ui-words).
 */
import type { FlowListen, ModuleKey, PipelineInput, Place } from './types'

/** Who writes — the kind of writer decides what its write can start. */
export type WriterKind =
  | 'agent'
  | 'serverAgent'
  | 'automation'
  | 'autoScript'
  | 'script'
  | 'autofill'
  | 'organise'
  | 'kit'
  | 'bridge'
  | 'clock'
  | 'button'
  | 'command'
  | 'incoming'
  | 'sync'
  | 'clippings'
  | 'pipeline'

/** A place's key in the flow: `<db>:<prop | * | +row | -row>` · `page:<id>` · `inbox` · `everything` · `ext:<what>`. */
export function placeKey(p: Place): string {
  if ('db' in p) return `${p.db}:${p.prop ?? '*'}`
  if ('page' in p) return `page:${p.page}`
  if ('inbox' in p) return 'inbox'
  if ('everything' in p) return 'everything'
  return `ext:${p.external}`
}

/** Does this writer honour "only by hand" fields (§1.18)? Agents (browser and server) and the MCP bridge. */
export const honoursHandOnly = (kind: WriterKind): boolean => kind === 'agent' || kind === 'serverAgent' || kind === 'bridge'

/** Can a write by `w` start listener `l`? */
export function startable(w: { kind: WriterKind; key: ModuleKey }, l: FlowListen): boolean {
  if (l.module === w.key) return false
  // mail organise starts only from the mail sync (its row trigger), never from a module's write
  if (l.kind === 'organise') return false
  switch (w.kind) {
    case 'agent':
      return l.kind !== 'agent'
    case 'serverAgent':
      // remote in every tab: no automation, no autofill, no agent (the runners skip agent writers) — kit relays only
      return l.kind === 'kit'
    case 'automation':
    case 'autoScript':
      return l.kind !== 'automation'
    case 'autofill':
      return l.kind !== 'autofill'
    case 'incoming':
      // written on the server: automations and autofill never run after a remote write
      return l.kind !== 'automation' && l.kind !== 'autofill'
    default:
      return true
  }
}

/** Does a write to `wp` reach a listener of `lp` (same database)? `autofillProps`: the database's auto autofill fields. */
export function reaches(wp: string, lp: string, l: FlowListen, autofillProps: ReadonlySet<string>): boolean {
  if (l.kind === 'autofill' && autofillProps.has(wp)) return false // autofill's own fields never start it (rowHash)
  if (wp === '+row') return lp === '+row' || (lp === '*' && (l.kind === 'autofill' || l.kind === 'kit'))
  if (wp === '-row') return lp === '-row'
  if (lp === '+row' || lp === '-row') return false
  if (wp === '*') return true
  return lp === wp || lp === '*'
}

/* ------------------------------------------------------------------ pipelines */

type Stage = PipelineInput['stages'][number]
type Approvals = 'all' | 'review' | 'none'

/** The git actions that send something out of One (`commit` and `update-base` stay local). */
export const GIT_OUT: ReadonlySet<string> = new Set(['push', 'pr', 'comment', 'merge'])

/** Does a task with these Approvals stop at the gate at index `i`? (coding/tasks.ts `skipsGate`, inverted) */
export function gateStops(stages: readonly Stage[], i: number, level: Approvals): boolean {
  const st = stages[i]
  if (st?.kind !== 'gate') return false
  if (st.hold) return true
  if (level === 'none') return false
  return level === 'all' || stages[i - 1]?.kind !== 'plan'
}

/** The stage after index `i` (its `next`, else the following one — coding/schema.ts `nextStage`); -1 at the end. */
function nextIndex(stages: readonly Stage[], i: number): number {
  const next = stages[i]?.next
  if (next) return stages.findIndex((s) => s.id === next)
  return i + 1 < stages.length ? i + 1 : -1
}

/** Stage kinds that run Claude Code (coding/protocol.ts `CLAUDE_KINDS` — patchbay-model-fixes keeps them in step). */
export const CLAUDE_CODE_STAGES: ReadonlySet<string> = new Set(['plan', 'implement', 'doc'])

/**
/** Stage kinds the worker never takes on its own (pickNext: a gate waits, done ends, an import stage needs the panel). */
const NOT_TAKEN: ReadonlySet<string> = new Set(['gate', 'done', 'import'])

/**
 * Where a task enters a pipeline: its first stage (a new row) and every queue stage (the worker takes it on, or a person
 * starts it — a start by hand is never a check). `anyStage` (fix ui-words): the write can set the Stage itself (a
 * set_property on Stage, a write of every field, a new row with its values) — then also every stage the worker takes on
 * its own (`auto`, coding/tasks.ts pickNext), behind any gate.
 */
export function pipelineEntries(stages: readonly Stage[], anyStage = false): number[] {
  return stages.map((s, i) => (i === 0 || s.kind === 'queue' || (anyStage && s.auto && !NOT_TAKEN.has(s.kind)) ? i : -1)).filter((i) => i >= 0)
}

/**
 * Fix (safety-data): does a task reach an outbound git action (push · pr · comment · merge) with nobody in between AFTER
 * a stage that runs Claude Code? Then the worker's AI chose what that step sends — the walk of `unattendedGit`.
 */
export function claudeBeforeGit(stages: readonly Stage[], level: Approvals, anyStage = false): boolean {
  for (const start of pipelineEntries(stages, anyStage)) {
    const seen = new Set<number>()
    let claude = false
    for (let i = start; i >= 0 && !seen.has(i); i = nextIndex(stages, i)) {
      seen.add(i)
      const st = stages[i]
      if (st.kind === 'done') break
      if (st.kind === 'gate' && (i === start || gateStops(stages, i, level))) break
      if (CLAUDE_CODE_STAGES.has(st.kind)) claude = true
      if (claude && st.kind === 'git' && st.gitAction && GIT_OUT.has(st.gitAction)) return true
    }
  }
  return false
}

/**
 * The git actions (push · pr · comment · merge) a task reaches with nobody in between: walked from where a task enters
 * the pipeline (`pipelineEntries` — `anyStage` for a write that can set the Stage) along `next`, stopping at a gate the
 * Approvals stop at (or a done stage). A git stage behind a stopping gate on every walk is "after approval".
 */
export function unattendedGit(stages: readonly Stage[], level: Approvals, anyStage = false): Set<string> {
  const out = new Set<string>()
  for (const start of pipelineEntries(stages, anyStage)) {
    const seen = new Set<number>()
    // a task that starts at a gate waits there for a person
    for (let i = start; i >= 0 && !seen.has(i); i = nextIndex(stages, i)) {
      seen.add(i)
      const st = stages[i]
      if (st.kind === 'done') break
      if (st.kind === 'gate' && (i === start || gateStops(stages, i, level))) break
      if (st.kind === 'git' && st.gitAction && GIT_OUT.has(st.gitAction)) out.add(st.gitAction)
    }
  }
  return out
}
