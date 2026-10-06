/**
 * "Transform into …" — the shared shapes (plain JSON: a run keeps them in the background and across a reload).
 *
 *  - TransformType: the forms a selection can become. Board / Table / Timeline are databases (the "Turn into
 *    database" machinery, features/ai/todb); the others are blocks built by code from a small structured answer.
 *  - TransformState: what a run holds — the form shown, Auto's choice, the finished results per request key (a
 *    switch back to a form asked before needs no new request) and the options.
 */
import type { JSONContent } from '@tiptap/core'
import type { TableAnswer } from '../todb/run'
import type { FreeBoardResult } from '../freeboard/apply'

export const TRANSFORM_TYPES = ['board', 'freeboard', 'table', 'timeline', 'diagram', 'chart', 'columns', 'tabs', 'toggles', 'cards'] as const
export type TransformType = (typeof TRANSFORM_TYPES)[number]
/** what the person picked: a form, or Auto (Claude picks the form and says why) */
export type TransformPick = TransformType | 'auto'

/** The forms that become a database (todb); the rest become blocks. */
export const DB_TYPES: readonly TransformType[] = ['board', 'table', 'timeline']
export const isDbType = (t: TransformType): boolean => DB_TYPES.includes(t)

export const DIAGRAM_KINDS = ['flowchart', 'mindmap', 'sequence', 'timeline', 'gantt', 'org'] as const
export type DiagramKind = (typeof DIAGRAM_KINDS)[number]
export type DiagramPick = DiagramKind | 'auto'
/** flowchart / org chart: top-down or left-to-right */
export type Direction = 'TD' | 'LR'

export const TRANSFORM_CHART_KINDS = ['bar', 'line', 'area', 'donut'] as const
export type TransformChartKind = (typeof TRANSFORM_CHART_KINDS)[number]

export const COLUMN_COUNTS = [2, 3, 4, 5] as const

/** One line of a section: a paragraph, a bullet, a numbered step or a to-do (inline Markdown). */
export interface SectionItem {
  style: 'text' | 'bullet' | 'number' | 'task'
  text: string
  done: boolean
}

/** A column, a tab, a toggle or a card: its title, an icon (cards) and its lines. */
export interface Section {
  title: string
  icon: string | null
  items: SectionItem[]
}

export type SectionsOf = 'columns' | 'tabs' | 'toggles' | 'cards'

/** A chart from the numbers of the text: categories (labels) × series. */
export interface ChartPlan {
  kind: TransformChartKind
  title: string | null
  unit: string | null
  /** the name of the label column ("Month", "Team" …) */
  category: string
  labels: string[]
  series: { name: string; values: (number | null)[] }[]
}

/** What every block result carries: the blocks it was read from and what stays as text. */
export interface ResultSource {
  /** the blocks Claude read, as they were (apply checks they are still the same) */
  blocks: JSONContent[]
  /** first words of each block (the preview's "Stays as text") */
  gists: string[]
  /** 0-based indexes of the blocks that stay on the page as they are */
  keep: number[]
  /** lines of the material the new form does not show — they stay as text under the new block */
  left: string[]
}

export type BlockResult =
  | (ResultSource & { type: 'diagram'; diagram: DiagramKind; code: string; repaired: boolean })
  | (ResultSource & { type: 'chart'; chart: ChartPlan; dropped: string[] })
  | (ResultSource & { type: 'sections'; of: SectionsOf; sections: Section[] })

/** freeboard: record types, lanes and cards (features/ai/freeboard) */
export type TransformResult = { type: 'db'; table: TableAnswer } | BlockResult | FreeBoardResult

export interface TransformOpts {
  /** request options: the diagram kind and the number of columns (null: Claude decides) */
  diagram: DiagramPick
  columns: number | null
  /** local options (no new request): the flowchart direction and the chart kind (null: as Claude drew it) */
  direction: Direction | null
  chart: TransformChartKind | null
  /** "Keep the original below (collapsed)" */
  keepOriginal: boolean
}

export interface TransformState {
  /** the form the preview shows (null: Auto is still choosing) */
  shown: TransformType | null
  /** Auto: Claude's pick and its one line why */
  auto: { type: TransformType; reason: string } | null
  /** finished results by request key (resultKey) */
  results: Record<string, TransformResult>
  opts: TransformOpts
}

/** Why a transform did not happen (an i18n key under features.ai.transform.err). */
export type TransformIssue = 'diagram' | 'nodates' | 'nonumbers' | 'few' | 'fit' | 'bad'

export class TransformError extends Error {
  issue: TransformIssue
  constructor(issue: TransformIssue) {
    super(issue)
    this.issue = issue
  }
}

export const initialOpts = (): TransformOpts => ({ diagram: 'auto', columns: null, direction: null, chart: null, keepOriginal: false })

export const emptyState = (): TransformState => ({ shown: null, auto: null, results: {}, opts: initialOpts() })

/** The key a form's result is cached under: Board and Table share one answer; diagrams per kind, columns per count. */
export function resultKey(type: TransformType, opts: Pick<TransformOpts, 'diagram' | 'columns'>): string {
  if (type === 'board' || type === 'table') return 'db'
  if (type === 'diagram') return `diagram:${opts.diagram}`
  if (type === 'columns') return `columns:${opts.columns ?? 'auto'}`
  return type
}

/** The result the preview shows now (null: none yet). */
export function shownResult(state: TransformState | null | undefined): TransformResult | null {
  if (!state?.shown) return null
  return state.results[resultKey(state.shown, state.opts)] ?? null
}
