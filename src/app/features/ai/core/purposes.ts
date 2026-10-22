/**
 * Every AI request names its purpose: what kind of work it is (the feature class a rule routes), which data classes it
 * NEEDS (refused on a route that may not receive one: "Make tasks" needs people's names, the meeting summary the
 * transcript …) and which it MAY carry (conditional: page text only when it goes along, the One memory only when its
 * block does, MCP only when a server joins — people's names and transcripts are redacted instead), what the model must
 * be able to do, and whether it may go without a page (`pageless`: public text, names of databases and fields, an
 * uploaded file — nothing page-derived). Call sites pass `carries` = the `may` classes they actually built (D-S2-27);
 * the gate checks needs ∪ carries ∪ the classes of the sources. An unknown purpose at runtime counts as 'ask' needing
 * every data class (fail closed).
 */
import type { DataClass, FeatureClass } from '@/shared/ai/types'
import { DATA_CLASSES } from '@/shared/ai/policy'

export type Need = 'structured' | 'tools' | 'vision' | 'pdf' | 'mcp' | 'listing' | 'decisions'

export interface PurposeDecl {
  cls: FeatureClass
  /** data classes the request always carries — refused on a route that may not receive one */
  needs: readonly DataClass[]
  /** data classes it may carry (a call site names them in `carries` when it does) */
  may: readonly DataClass[]
  /** what the model must be able to do (a call adds its own: a PDF, an addressed MCP server …) */
  caps: readonly Need[]
  /** `sources: []` is legal: nothing page-derived in the declaration — or a call that may carry no page (⌘K "?" on a
   *  route without a page, a list filled without one) */
  pageless: boolean
}

/** Classes that come from pages: a purpose declaring one must name its sources; a request carrying one on a route that
 *  does not see everything must say what redaction / filter its text went through (the gate's backstop, D-S2-5). */
export const PAGE_DERIVED: readonly DataClass[] = ['selection', 'page', 'rows', 'workspace', 'people', 'transcript', 'private', 'mail', 'memory']

const p = (cls: FeatureClass, needs: DataClass[], may: DataClass[], caps: Need[] = [], o: { mayBeEmpty?: true } = {}): PurposeDecl => ({
  cls,
  needs,
  may,
  caps,
  pageless: !!o.mayBeEmpty || ![...needs, ...may].some((c) => PAGE_DERIVED.includes(c)),
})

export const PURPOSES = {
  'menu.action': p('write', ['selection'], ['page', 'mcp']),
  'menu.ask': p('ask', ['selection'], ['page', 'memory', 'mcp']),
  'menu.tasks': p('write', ['selection', 'people'], ['page', 'mcp']),
  'palette.ask': p('ask', [], ['page', 'memory', 'mcp'], [], { mayBeEmpty: true }),
  'workspace.ask': p('workspace', ['workspace'], ['mcp']),
  'structure.todb': p('structure', ['selection'], [], ['structured']),
  // the Tasks form sends people's names (<people>): it carries `people`, refused where names may not go
  'structure.transform': p('structure', ['selection'], ['people', 'mcp'], ['structured']),
  'structure.freeboard': p('structure', ['selection', 'structure'], ['mcp'], ['structured']),
  'structure.redo': p('structure', ['selection'], ['page'], ['structured']),
  'drawing.diagram': p('structure', ['selection'], ['page'], ['structured']),
  'memory.propose': p('memory', ['memory'], ['selection', 'page'], ['structured']),
  'memory.example': p('memory', ['memory'], ['page'], ['structured']),
  'vision.image': p('vision', ['files'], ['page'], ['vision']),
  'vision.design': p('vision', ['files'], [], ['vision']),
  // a PDF needs a model that reads PDFs (the call says so); a text file goes to any
  'documents.file': p('documents', ['files'], ['page']),
  'generate.media': p('generate', ['mcp'], ['page', 'files'], ['mcp']),
  'mcp-setup.inspect': p('mcp-setup', ['mcp'], [], ['mcp', 'listing']),
  'terminal.task': p('terminal', ['workspace'], ['memory', 'files', 'selection', 'mcp'], ['tools']),
  'agents.run': p('agents', [], ['workspace', 'rows', 'page', 'structure', 'memory', 'mcp'], ['tools']),
  'write.instructions': p('write', ['public'], []),
  'bulk.autofill': p('bulk', ['rows'], ['page', 'mcp'], ['structured']),
  'meeting.summary': p('meeting', ['transcript'], ['mcp'], ['structured']),
  'bulk.mail': p('bulk', ['mail'], [], ['structured']),
  'outbox.draft': p('outbox', ['rows'], ['page', 'memory'], ['structured']),
  'bulk.kit': p('bulk', ['structure'], ['page', 'mcp'], ['structured'], { mayBeEmpty: true }),
  'scripts.draft': p('scripts', ['structure'], []),
  'scripts.effect': p('scripts', ['workspace'], []),
  'help.ask': p('help', ['public'], []),
  // a fixed sentence, not workspace data: works before any data class is granted (D-S2-6)
  'setup.test': p('help', [], []),
  // Jev as Vorprüfer (slice SJ, class 'gate', a decision model only): the agent's instructions are always there; the change,
  // its row and the trigger only as far as they go along (classes of the target, its parent, the run's touched pages)
  'gate.precheck': p('gate', ['public'], ['structure', 'page', 'rows', 'people', 'workspace', 'private', 'mail', 'memory', 'mcp'], ['decisions']),
  // "Belegt?": a help answer (public only) or an Ask-the-workspace answer with the excerpts it was built from
  'gate.verify': p('gate', ['public'], ['structure', 'page', 'rows', 'people', 'workspace', 'private', 'mail', 'memory'], ['decisions'], { mayBeEmpty: true }),
  // the work-order planner (features/coding/orders): the request row and the catalogue of pipelines / repos always; the
  // linked pages, private ones and the picked server only as far as they go along. Class 'terminal' — it already makes
  // pipeline tasks, so the data-rule matrix gains no column. One structured answer, no tool loop of One's
  'coding.plan': p('terminal', ['rows', 'structure'], ['page', 'private', 'mcp'], ['structured']),
} as const satisfies Record<string, PurposeDecl>

export type PurposeId = keyof typeof PURPOSES

/** An unknown purpose (a call site the table does not know): class 'ask', needing every data class — fail closed. */
export const UNKNOWN_PURPOSE: PurposeDecl = { cls: 'ask', needs: DATA_CLASSES, may: [], caps: [], pageless: false }

export const isPurposeId = (v: unknown): v is PurposeId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(PURPOSES, v)

export const purposeOf = (id: string): PurposeDecl => (isPurposeId(id) ? PURPOSES[id] : UNKNOWN_PURPOSE)
