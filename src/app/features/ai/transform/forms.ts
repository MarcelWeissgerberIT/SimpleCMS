/**
 * "Transform into …" — the picks as the menus show them (AI menu submenu, the grip menu of selected blocks):
 * a mono code and an icon per pick, the picks a selection allows, and the run request of a pick.
 */
import type { Node as PMNode } from '@tiptap/pm/model'
import { ChartColumn, ChartGantt, Columns2, LayoutGrid, ListCollapse, Network, PanelsTopLeft, Shapes, SquareKanban, Table2, type LucideIcon } from 'lucide-react'
import { t } from '../../../i18n'
import { fitsAt, fittingTypes, transformRange } from './range'
import type { BlockRange } from '../todb/plan'
import type { TransformRunRequest } from './run'
import type { TransformPick } from './types'

export const TRANSFORM_CODES: Record<TransformPick, string> = {
  auto: 'AUTO',
  board: 'BRD',
  table: 'TBL',
  timeline: 'TML',
  diagram: 'DGM',
  chart: 'CHT',
  columns: 'COL',
  tabs: 'TAB',
  toggles: 'TGL',
  cards: 'CRD',
}

export const TRANSFORM_ICONS: Record<TransformPick, LucideIcon> = {
  auto: Shapes,
  board: SquareKanban,
  table: Table2,
  timeline: ChartGantt,
  diagram: Network,
  chart: ChartColumn,
  columns: Columns2,
  tabs: PanelsTopLeft,
  toggles: ListCollapse,
  cards: LayoutGrid,
}

/** What typing finds a pick by (EN + DE). */
export const TRANSFORM_KEYWORDS: Record<TransformPick, string> = {
  auto: 'transform auto verwandeln automatisch',
  board: 'board kanban status',
  table: 'table database tabelle datenbank',
  timeline: 'timeline dates milestones schedule zeitleiste termine meilensteine zeitplan',
  diagram: 'diagram flowchart mermaid mindmap mind map sequence org chart process schaubild flussdiagramm ablauf organigramm prozess',
  chart: 'chart graph bar line pie donut numbers diagramm grafik säulen linie kuchen ring zahlen',
  columns: 'columns compare comparison pros cons side by side spalten vergleich vorteile nachteile nebeneinander',
  tabs: 'tabs tab panels reiter',
  toggles: 'toggles toggle faq fold collapse aufklappen aufklappliste',
  cards: 'cards callouts karten hinweisbox',
}

/** The form's name in the UI language ("Diagram", "Schaubild" …). */
export const typeLabel = (type: TransformPick): string => t(`features.ai.transform.type.${type}`)

/** The picks for the blocks at `range` (Auto first, then the forms that may go there); [] when nothing can be transformed. */
export function transformChoices(doc: PMNode, range: BlockRange | null | undefined): TransformPick[] {
  const forms = range ? fittingTypes(fitsAt(doc, range)) : []
  return forms.length ? ['auto', ...forms] : []
}

/** The picks for a selection from `from` to `to` (the grip menu of selected blocks). */
export const transformChoicesAt = (doc: PMNode, from: number, to: number): TransformPick[] => transformChoices(doc, transformRange(doc, from, to))

/** The run request of a pick (request options come along only when given — the run keeps the others). */
export function transformRequest(pick: TransformPick, extra: Partial<Pick<TransformRunRequest, 'diagram' | 'columns' | 'instruction' | 'fresh'>> = {}): TransformRunRequest {
  const req: TransformRunRequest = { kind: 'transform', label: t('features.ai.transform.runLabel', { type: typeLabel(pick) }), code: TRANSFORM_CODES[pick], pick }
  for (const k of ['diagram', 'columns', 'instruction', 'fresh'] as const) if (extra[k] !== undefined) Object.assign(req, { [k]: extra[k] })
  return req
}
