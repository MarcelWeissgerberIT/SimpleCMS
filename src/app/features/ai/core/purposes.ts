/**
 * Every AI request names its purpose: what kind of work it is (the feature class a rule routes), which data classes it
 * may carry at most (the declaration — the gate adds the classes of the request's sources), what the model must be
 * able to do, and whether it may go without a page (`pageless`: public text, names of databases and fields, an
 * uploaded file — nothing page-derived). An unknown purpose at runtime counts as 'ask' with every data class.
 */
import type { DataClass, FeatureClass } from '@/shared/ai/types'
import { DATA_CLASSES } from '@/shared/ai/policy'

export type Need = 'structured' | 'tools' | 'vision' | 'pdf' | 'mcp' | 'listing'

export interface PurposeDecl {
  cls: FeatureClass
  decl: readonly DataClass[]
  needs: readonly Need[]
  /** `sources: []` is legal: nothing page-derived in the declaration — or a call that may carry no page (⌘K "?" on a
   *  route without a page, a list filled without one) */
  pageless: boolean
}

/** Classes that come from pages: a purpose declaring one must name its sources. */
const PAGE_DERIVED: readonly DataClass[] = ['selection', 'page', 'rows', 'workspace', 'people', 'transcript', 'private', 'mail', 'memory']

const p = (cls: FeatureClass, decl: DataClass[], needs: Need[] = [], o: { mayBeEmpty?: true } = {}): PurposeDecl => ({ cls, decl, needs, pageless: !!o.mayBeEmpty || !decl.some((c) => PAGE_DERIVED.includes(c)) })

export const PURPOSES = {
  'menu.action': p('write', ['selection', 'page', 'mcp']),
  'menu.ask': p('ask', ['selection', 'page', 'memory', 'mcp']),
  'menu.tasks': p('write', ['selection', 'page', 'people', 'mcp']),
  'palette.ask': p('ask', ['page', 'memory', 'mcp'], [], { mayBeEmpty: true }),
  'workspace.ask': p('workspace', ['workspace', 'mcp']),
  'structure.todb': p('structure', ['selection'], ['structured']),
  'structure.transform': p('structure', ['selection', 'people', 'mcp'], ['structured']),
  'structure.freeboard': p('structure', ['selection', 'structure', 'mcp'], ['structured']),
  'structure.redo': p('structure', ['selection', 'page'], ['structured']),
  'memory.propose': p('memory', ['memory', 'selection', 'page'], ['structured']),
  'memory.example': p('memory', ['memory', 'page'], ['structured']),
  'vision.image': p('vision', ['files', 'page'], ['vision']),
  'vision.design': p('vision', ['files'], ['vision']),
  'documents.file': p('documents', ['files', 'page'], ['pdf']),
  'generate.media': p('generate', ['mcp', 'page'], ['mcp']),
  'mcp-setup.inspect': p('mcp-setup', ['mcp'], ['mcp', 'listing']),
  'terminal.task': p('terminal', ['workspace', 'memory', 'files', 'selection', 'mcp'], ['tools']),
  'agents.run': p('agents', ['workspace', 'rows', 'page', 'structure', 'memory', 'mcp'], ['tools']),
  'write.instructions': p('write', ['public']),
  'bulk.autofill': p('bulk', ['rows', 'page', 'mcp'], ['structured']),
  'meeting.summary': p('meeting', ['transcript', 'mcp'], ['structured']),
  'bulk.mail': p('bulk', ['mail'], ['structured']),
  'outbox.draft': p('outbox', ['rows', 'page', 'memory'], ['structured']),
  'bulk.kit': p('bulk', ['structure', 'page', 'mcp'], ['structured'], { mayBeEmpty: true }),
  'scripts.draft': p('scripts', ['structure']),
  'scripts.effect': p('scripts', ['workspace']),
  'help.ask': p('help', ['public']),
  'setup.test': p('help', ['public']),
} as const satisfies Record<string, PurposeDecl>

export type PurposeId = keyof typeof PURPOSES

/** An unknown purpose (a call site the table does not know): class 'ask', every data class — fail closed. */
export const UNKNOWN_PURPOSE: PurposeDecl = { cls: 'ask', decl: DATA_CLASSES, needs: [], pageless: false }

export const isPurposeId = (v: unknown): v is PurposeId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(PURPOSES, v)

export const purposeOf = (id: string): PurposeDecl => (isPurposeId(id) ? PURPOSES[id] : UNKNOWN_PURPOSE)
