/**
 * "Transform into …" — the requests of one run (features/ai/runs.ts, kind 'transform').
 *
 * runTransform(doc, range, req, prev): Auto first asks which form fits (a small classification call: the
 * form + one line why — then the payload call for that form, two requests); a form asked before comes from
 * the run's cache (`prev`, carried over from the run this one replaces) without a request. Each form is one
 * structured request (completeStructured; MCP servers: a fixed request — only "All AI calls" servers, client.ts
 * decides; no One memory), validated before any preview:
 *  - Board / Table / Timeline: the "Turn into database" request (todb/run requestTable), Timeline with dates
 *  - Diagram: Mermaid code checked by Mermaid's parser; on failure ONE repair round with the parser error,
 *    then TransformError('diagram')
 *  - Chart: every value checked against the numbers of the text; none left → TransformError('nonumbers')
 *  - Columns / Tabs / Toggles / Cards: titles + lines; too few parts → TransformError('few')
 *  - Tasks (`items`): tasks as JSON (owners from `<people>` — sent only with this form), built into task blocks with
 *    their ids (items.ts); none → TransformError('few'). Auto never picks Tasks: only an explicit pick makes tasks.
 * Throws AIError (client.ts), TodbError ('changed' …) or TransformError.
 */
import type { JSONContent } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { completeStructured } from '../client'
import type { Route, SourceRef } from '@/shared/ai/types'
import { precheck, type Prepared } from '../core/gate'
import { routed, shapeOf, withShape } from '../core/shape'
import { blockGist, readBlocks, type BlockRange, type ResolvedBlocks, type SourceBlock } from '../todb/plan'
import { requestTable, TodbError } from '../todb/run'
import { requestFreeBoard } from '../freeboard/apply'
import { fitsAt, fittingTypes } from './range'
import { mermaidError, kindOfCode } from './mermaid'
import { numbersIn } from './numbers'
import { chartPrompt, chartValues, classifyPrompt, diagramPrompt, parseChart, parseClassification, parseDiagram, parseSections, sectionsPrompt } from './prompt'
import { buildItems, itemsPrompt, parseItems, peopleNamesOf } from './items'
import { settleWorld } from '../../workitems'
import { useWorkspace } from '../../../store/store'
import { emptyState, resultKey, TransformError, type DiagramPick, type ResultSource, type SectionsOf, type TransformPick, type TransformResult, type TransformState, type TransformType } from './types'

/** The request of a transform run (runs.ts RunRequest). */
export interface TransformRunRequest {
  kind: 'transform'
  label: string
  code: string
  pick: TransformPick
  /** request options that change the answer (they become the run's options) */
  diagram?: DiagramPick
  columns?: number | null
  /** a revision typed into the panel ("fewer steps", "German labels") */
  instruction?: string
  /** Try again: ask anew instead of taking the cached result */
  fresh?: boolean
}

export interface TransformRunOptions {
  /** the page the selected blocks are on (the request's sources) */
  sources: readonly SourceRef[]
  /** the route chip (this request only) — else the rules decide */
  route?: Route | null
  pageTitle?: string
  signal?: AbortSignal
  /** the state so far (Auto's choice, the form being asked) — the preview shows it while the request runs */
  onState?: (state: TransformState) => void
}

/** What every request of a transform carries along (prompt options + the gate's purpose inputs). */
type Ask = { pageTitle?: string; instruction?: string; signal?: AbortSignal; sources: readonly SourceRef[]; route?: Route | null; pre?: Prepared }
/** The gate's inputs of a transform request (features/ai/core) — the route its blocks were read for. */
const gate = (ask: Ask) => ({ purpose: 'structure.transform' as const, sources: ask.sources, typed: ask.instruction, ...(ask.pre ? routed(ask.pre) : {}) })

const clone = (s: TransformState): TransformState => ({ ...s, results: { ...s.results }, opts: { ...s.opts } })

export async function runTransform(doc: PMNode, range: BlockRange, req: TransformRunRequest, prev: TransformState | null | undefined, opts: TransformRunOptions): Promise<TransformState> {
  const state = prev ? clone(prev) : emptyState()
  if (req.diagram) state.opts.diagram = req.diagram
  if (req.columns !== undefined) state.opts.columns = req.columns
  // the route first: the selected blocks are read for it (names / pages it may not see left out — core/shape.ts)
  const pre = precheck({ purpose: 'structure.transform', sources: opts.sources, typed: req.instruction, route: opts.route ?? null })
  const source = withShape(shapeOf(pre), () => readBlocks(doc, range))
  if (!source) throw new TodbError('changed')
  const fits = fitsAt(doc, range)
  const ask: Ask = { pageTitle: opts.pageTitle, instruction: req.instruction, signal: opts.signal, sources: opts.sources, route: opts.route ?? null, pre }

  let type: TransformType
  if (req.pick === 'auto') {
    if (!state.auto || req.fresh) {
      state.shown = null
      opts.onState?.(clone(state))
      // Auto never picks Tasks (people's names, owners): only an explicit pick makes tasks
      const allowed = fittingTypes(fits).filter((x) => x !== 'items')
      if (!allowed.length) throw new TransformError('fit')
      const p = classifyPrompt(source.blocks, allowed, ask)
      const raw = await completeStructured({ ...gate(ask), system: p.system, prompt: p.prompt, schema: p.schema, maxTokens: 600, signal: opts.signal })
      const auto = parseClassification(raw, allowed)
      if (!auto) throw new TransformError('bad')
      state.auto = auto
    }
    type = state.auto.type
  } else type = req.pick
  if (!fits[type]) throw new TransformError('fit')
  state.shown = type
  opts.onState?.(clone(state))

  const key = resultKey(type, state.opts)
  if (!state.results[key] || req.fresh || req.instruction) state.results[key] = await requestResult(doc, range, source, type, state, ask)
  // Board and Table share one answer: the view follows the form shown
  const res = state.results[key]
  if (res.type === 'db' && (type === 'board' || type === 'table')) state.results[key] = { ...res, table: { ...res.table, draft: { ...res.table.draft, view: type } } }
  return state
}

async function requestResult(doc: PMNode, range: BlockRange, source: ResolvedBlocks, type: TransformType, state: TransformState, ask: Ask): Promise<TransformResult> {
  if (type === 'board' || type === 'table') return { type: 'db', table: await requestTable(doc, range, { ...ask, purpose: 'structure.transform' }) }
  if (type === 'timeline') {
    const table = await requestTable(doc, range, { ...ask, focus: 'timeline', purpose: 'structure.transform' })
    const date = table.plan.columns.find((c) => c.type === 'date' && table.plan.entries.some((e) => e.values[c.name] !== undefined))
    if (!date) throw new TransformError('nodates')
    return { type: 'db', table: { ...table, draft: { ...table.draft, view: 'timeline', groupBy: null } } }
  }
  if (type === 'freeboard') {
    // record types, lanes and cards (features/ai/freeboard)
    const got = await requestFreeBoard(doc, range, ask)
    if (!got) throw new TransformError('bad')
    return got
  }
  const base = { blocks: source.blocks.map((b) => b.node.toJSON() as JSONContent), gists: source.blocks.map((b) => blockGist(b.node)) }
  if (type === 'diagram') return diagram(source.blocks, state, ask, base)
  if (type === 'items') {
    // the people's names go along with this form only (≤ 200, never an email) — refused where names may not go
    precheck({ ...gate(ask), carries: ['people'] })
    const names = peopleNamesOf(useWorkspace.getState().people)
    const p = itemsPrompt(source.blocks, names, ask)
    const raw = await completeStructured({ ...gate(ask), carries: ['people'], system: p.system, prompt: p.prompt, schema: p.schema, maxTokens: 12000, signal: ask.signal })
    const got = parseItems(raw, source.blocks)
    if (!got) throw new TransformError('bad')
    if (!got.items.length) throw new TransformError('few')
    const built = buildItems(got.items, settleWorld(), { tooMany: got.tooMany })
    return { type: 'items', ...base, items: got.items, ...built, people: names.length, keep: got.keep, left: got.left }
  }
  if (type === 'chart') {
    const p = chartPrompt(source.blocks, ask)
    const raw = await completeStructured({ ...gate(ask), system: p.system, prompt: p.prompt, schema: p.schema, maxTokens: 6000, signal: ask.signal })
    const pool = numbersIn(source.blocks.map((b) => b.markdown).join('\n'))
    const got = parseChart(raw, source.blocks, pool)
    if (!got) throw new TransformError('bad')
    if (!chartValues(got.chart)) throw new TransformError('nonumbers')
    return { type: 'chart', ...base, ...got }
  }
  const of = type as SectionsOf
  const p = sectionsPrompt(source.blocks, of, { ...ask, columns: of === 'columns' ? state.opts.columns : null })
  const raw = await completeStructured({ ...gate(ask), system: p.system, prompt: p.prompt, schema: p.schema, maxTokens: 12000, signal: ask.signal })
  const got = parseSections(raw, of, source.blocks)
  if (!got) throw new TransformError('bad')
  if (!got.sections) throw new TransformError('few')
  return { type: 'sections', of, ...base, sections: got.sections, keep: got.keep, left: got.left }
}

/** The diagram: asked, checked by Mermaid's parser, repaired once with the parser's error. */
async function diagram(blocks: SourceBlock[], state: TransformState, ask: Ask, base: Pick<ResultSource, 'blocks' | 'gists'>): Promise<TransformResult> {
  const want = state.opts.diagram
  let repair: { code: string; error: string } | undefined
  for (let round = 0; round < 2; round++) {
    const p = diagramPrompt(blocks, want, state.opts.direction, { ...ask, repair })
    const raw = await completeStructured({ ...gate(ask), system: p.system, prompt: p.prompt, schema: p.schema, maxTokens: 8000, signal: ask.signal })
    const got = parseDiagram(raw, blocks)
    if (!got) throw new TransformError('bad')
    const error = await mermaidError(got.code)
    if (!error) {
      const drawn = kindOfCode(got.code) ?? got.diagram
      // an org chart is a flowchart that Claude was asked for as such
      const kind = drawn === 'flowchart' && (want === 'org' || got.diagram === 'org') ? 'org' : drawn
      return { type: 'diagram', ...base, diagram: kind, code: got.code, keep: got.keep, left: got.left, repaired: round > 0 }
    }
    repair = { code: got.code, error }
  }
  throw new TransformError('diagram')
}
