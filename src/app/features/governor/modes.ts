/**
 * How every AI purpose runs, for the brake (Regler design § 5.3, G-D15): its default run mode, the kind of answer it
 * waits for (text may be capped at the line, structured JSON never — a cut JSON is worth nothing; a loop is braked per
 * round) and the series its ledger sources belong to (`<series>:<request id>` when the call site names none — never the
 * bare purpose: an allowance or a band keyed by the purpose would cover every later request of it).
 *
 * Six purposes run both ways and must say how (`caller`): a custom agent's run (manual · scheduled · trigger), autofill
 * (a person's job · the watch), mail organise (during a sync · "Organise now"), a script's `claude()` effect (the person's
 * run · an automation's), Jev's pre-checks of an agent run (that run's mode), the work-order planner ('manual': pressed
 * here with the worker online · 'trigger': the press kept until the worker came back). DEV / `?e2e`: such a request without `run.mode` throws in prepare(); elsewhere an unknown mode
 * reads as 'trigger' — it never asks. Pure (a Node spec reads it).
 */
import type { PurposeId } from '../ai/core/purposes'
import type { RunMode } from './brake'

export type AnswerKind = 'text' | 'structured' | 'loop'

export interface ModeRow {
  /** the default mode — 'caller': the call site passes run.mode */
  mode: RunMode | 'caller'
  answer: AnswerKind
  /** the ledger series ('palette', 'help', 'autofill' …): a request's source is `<series>:<id>` unless it names one */
  series: string
}

const row = (mode: ModeRow['mode'], answer: AnswerKind, series: string): ModeRow => ({ mode, answer, series })

export const RUN_MODES: Readonly<Record<PurposeId, ModeRow>> = {
  'menu.action': row('interactive', 'text', 'ai'),
  'menu.ask': row('interactive', 'text', 'ai'),
  'menu.tasks': row('interactive', 'text', 'ai'),
  'palette.ask': row('interactive', 'text', 'palette'),
  'workspace.ask': row('interactive', 'text', 'workspace'),
  'help.ask': row('interactive', 'text', 'help'),
  'structure.todb': row('interactive', 'structured', 'ai'),
  'structure.transform': row('interactive', 'structured', 'ai'),
  'structure.freeboard': row('interactive', 'structured', 'ai'),
  'structure.redo': row('interactive', 'structured', 'ai'),
  'workspace.translate': row('interactive', 'structured', 'translation'),
  'drawing.diagram': row('interactive', 'structured', 'ai'),
  'memory.propose': row('follow-up', 'structured', 'memory'),
  'memory.example': row('follow-up', 'structured', 'memory'),
  'vision.image': row('interactive', 'text', 'ai'),
  'vision.design': row('interactive', 'text', 'design'),
  'documents.file': row('interactive', 'text', 'ai'),
  'generate.media': row('interactive', 'text', 'ai'),
  'mcp-setup.inspect': row('interactive', 'text', 'mcp-setup'),
  'setup.test': row('interactive', 'text', 'setup'),
  'terminal.task': row('interactive', 'loop', 'terminal'),
  'agents.run': row('caller', 'loop', 'agent'),
  'write.instructions': row('interactive', 'text', 'instructions'),
  'scripts.draft': row('interactive', 'text', 'script-draft'),
  'scripts.effect': row('caller', 'text', 'script'),
  'bulk.autofill': row('caller', 'structured', 'autofill'),
  'bulk.mail': row('caller', 'structured', 'mail'),
  'bulk.kit': row('interactive', 'structured', 'kit'),
  'meeting.summary': row('interactive', 'structured', 'meeting'),
  'outbox.draft': row('interactive', 'structured', 'outbox'),
  // decisions (slice SJ, class 'gate'): typed answers, never capped (the decide wire sets no answer budget). A run's
  // pre-checks take the run's mode and source (checkRun.ts) and its decide reservation (§ 5.6); "Belegt?" is a person's
  // answer check (verify.ts)
  'gate.precheck': row('caller', 'structured', 'gate'),
  'gate.verify': row('interactive', 'structured', 'gate'),
  // the work-order planner: a typed plan (never capped); its source `order:<row>:<run>`
  'coding.plan': row('caller', 'structured', 'order'),
}

/** The purposes whose call site must pass run.mode. */
export const CALLER_MODE: readonly PurposeId[] = (Object.keys(RUN_MODES) as PurposeId[]).filter((p) => RUN_MODES[p].mode === 'caller')

const MODES: readonly RunMode[] = ['interactive', 'manual', 'scheduled', 'trigger', 'bulk', 'follow-up']
export const isRunMode = (v: unknown): v is RunMode => typeof v === 'string' && (MODES as readonly string[]).includes(v)

/** A purpose's row (an unknown purpose: a trigger-mode text request of its own series — it never asks). */
export const modeRow = (purpose: string): ModeRow => (RUN_MODES as Record<string, ModeRow>)[purpose] ?? row('trigger', 'text', 'ai')

/** The run mode of a request: the call site's, else the purpose's default; a caller-mode purpose without one: 'trigger'. */
export function modeOf(purpose: string, given?: unknown): RunMode {
  if (isRunMode(given)) return given
  const m = modeRow(purpose).mode
  return m === 'caller' ? 'trigger' : m
}

/** Does this request miss the run mode its call site must pass? (the DEV / ?e2e contract check) */
export const missesMode = (purpose: string, given?: unknown): boolean => modeRow(purpose).mode === 'caller' && !isRunMode(given)

/**
 * The visible answer a capped text request still needs (the brake caps no lower): 1 024 tokens, 2 048 on a model whose
 * thinking sits inside max_tokens. null: not a text purpose (structured answers and loops are never capped).
 */
export function minOut(purpose: string, thinks: boolean): number | null {
  return modeRow(purpose).answer === 'text' ? (thinks ? 2048 : 1024) : null
}

/** A ledger source's grammar (ids only). */
export const SOURCE_RE = /^[a-z-]+:[A-Za-z0-9:_-]{1,160}$/

/** A request's own source when the call site names none: `<series>:<id>`. */
export const sourceFor = (purpose: string, id: string): string => `${modeRow(purpose).series}:${id}`
