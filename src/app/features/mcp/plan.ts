/**
 * One MCP — what every writing tool shares: the plan a call becomes (validated, nothing written; a
 * localized summary for the approval card; apply() + undo), and the small argument checks.
 * write.ts (pages, rows, new properties and databases), tidy.ts (trash, restore, moves) and
 * structure.ts (database, property and view changes) build plans with these.
 */
import { t } from '../../i18n'
import { newId } from '../../lib/ids'
import { inTemplate } from '../../store/selectors'
import type { ColorName, ID, Page, PageIcon, PropertyType, SelectOption, StatusGroup } from '../../store/types'
import { COLOR_NAMES } from '../../store/types'
import type { McpToolName } from './contract'
import { live, McpToolError, q, ws } from './values'

/** One line of the approval card. */
export type PlanLine =
  /** a property value: before → after (before absent for new rows) */
  | { k: 'prop'; name: string; before?: string; after: string; fresh?: string[] }
  /** a labelled fact: "In · Team wiki", "Type · number" */
  | { k: 'fact'; label: string; value: string }
  /** Markdown that gets written (first lines shown) */
  | { k: 'md'; label: string; value: string }
  | { k: 'note'; value: string }

export interface Applied {
  result: unknown
  /** revert (false = left alone because it was changed since) */
  undo?: () => boolean
}

export interface WritePlan {
  tool: McpToolName
  /** what the card calls the action: "New row", "Update" … */
  verb: string
  /** one sentence: Create row “Q4 launch” in Projects */
  summary: string
  /** page / database the change is about (activity log) */
  target: string
  lines: PlanLine[]
  /** nothing would change: answered without asking */
  noop?: unknown
  apply(): Promise<Applied>
}

export const str = (v: unknown, key: string, opts: { required?: boolean; max?: number } = {}): string => {
  if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) {
    if (opts.required) throw new McpToolError(`Missing required parameter "${key}".`)
    return ''
  }
  if (typeof v !== 'string') throw new McpToolError(`"${key}" must be a string.`)
  if (opts.max && v.length > opts.max) throw new McpToolError(`"${key}" is too long (${v.length} characters, at most ${opts.max}).`)
  return v
}

export const pageOrThrow = (id: unknown, key = 'id'): Page => {
  const raw = str(id, key, { required: true, max: 80 }).trim()
  const p = live(raw)
  if (!p) throw new McpToolError(`No page with id ${q(raw)}. Use one_search to find page ids.`)
  return p
}

/** A page the tidy-up tools may touch: live and not part of a template (templates are not found). */
export const tidyPageOrThrow = (id: unknown, key = 'id'): Page => {
  const raw = str(id, key, { required: true, max: 80 }).trim()
  const p = live(raw)
  if (!p || inTemplate(ws().pages, p.id)) throw new McpToolError(`No page with id ${q(raw)}. Use one_search to find page ids.`)
  return p
}

/** A name with its spaces collapsed and trimmed ('' when absent). */
export const cleanName = (v: unknown, key: string, max = 300) => str(v, key, { max }).replace(/\s+/g, ' ').trim()

/** An emoji, "asset:<name>" or "lucide:<Name>" → icon; '' / null → remove; undefined → leave as is. */
export function parseIcon(raw: unknown): PageIcon | null | undefined {
  if (raw === undefined) return undefined
  if (raw === null || raw === '') return null
  const hint = 'an emoji (e.g. "🚀"), "asset:<name>" or "lucide:<IconName>" ("" removes the icon)'
  if (typeof raw !== 'string') throw new McpToolError(`"icon" must be ${hint}.`)
  const s = raw.trim()
  if (!s) return null
  const named = /^(asset|lucide):([A-Za-z0-9_-]{1,64})$/.exec(s)
  if (named) return named[1] === 'asset' ? { type: 'asset', value: named[2] } : { type: 'lucide', value: named[2] }
  const emoji = s.length <= 16 && !/[A-Za-z\s<>]/.test(s) && /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u{20E3}/u.test(s)
  if (!emoji) throw new McpToolError(`"icon" must be ${hint} — got ${q(s.slice(0, 40))}.`)
  return { type: 'emoji', value: s }
}

/** The first lines of Markdown for the card. */
export function preview(md: string): string {
  const lines = md.trim().split('\n')
  const head = lines.slice(0, 6).join('\n')
  return head.length > 420 ? `${head.slice(0, 420)}…` : lines.length > 6 ? `${head}\n…` : head
}

/** A number the way the workspace language writes it. */
export const chars = (n: number) => n.toLocaleString(ws().settings.language === 'de' ? 'de-DE' : 'en-US')

/** `id` or `ids` (at most `max`, deduplicated, in order) — exactly one of the two. */
export function idList(args: Record<string, unknown>, max: number): ID[] {
  const one = args.id
  const many = args.ids
  if (one !== undefined && one !== null && many !== undefined && many !== null) throw new McpToolError('Pass "id" or "ids", not both.')
  if (many !== undefined && many !== null) {
    if (!Array.isArray(many) || !many.length || many.some((x) => typeof x !== 'string' || !x.trim())) throw new McpToolError('"ids" must be a list of page ids.')
    if (many.length > max) throw new McpToolError(`At most ${max} ids in one call (got ${many.length}).`)
    return [...new Set((many as string[]).map((x) => x.trim().slice(0, 80)))]
  }
  return [str(one, 'id', { required: true, max: 80 }).trim()]
}

/** Lines of the card listing several items (the first ones, then "+ n more"). */
export function itemLines(items: Array<{ label: string; value: string }>, max = 8): PlanLine[] {
  const lines: PlanLine[] = items.slice(0, max).map((x) => ({ k: 'fact', label: x.label, value: x.value }))
  if (items.length > max) lines.push({ k: 'note', value: t('features.mcp.plan.more', { n: chars(items.length - max) }) })
  return lines
}

/** Deep copy of plain JSON (store data is frozen). */
export const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T))
export const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** Option colours (no "default"), in the order new options take them. */
export const palette = COLOR_NAMES.filter((c) => c !== 'default')

/** A colour name an agent passed ("Blue" → 'blue'); undefined when it is none of the palette. */
export const colorOf = (raw: unknown): ColorName | undefined => (typeof raw === 'string' && (palette as string[]).includes(raw.trim().toLowerCase()) ? (raw.trim().toLowerCase() as ColorName) : undefined)

/** Options for select / multi_select / status from names or {name, color, group}. */
export function optionsOf(type: PropertyType, raw: unknown, key: string, start = 0): SelectOption[] | undefined {
  if (raw === undefined || raw === null) return undefined
  if (type !== 'select' && type !== 'multi_select' && type !== 'status') throw new McpToolError(`${key}: options only apply to select, multi_select and status.`)
  if (!Array.isArray(raw)) throw new McpToolError(`${key}: "options" must be a list of option names (or {name, color, group}).`)
  const opts: Array<{ name: string; color?: ColorName; group?: StatusGroup }> = []
  for (const item of raw as unknown[]) {
    const o = typeof item === 'string' ? { name: item } : item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : null
    if (!o || typeof o.name !== 'string') throw new McpToolError(`${key}: every option is a name or {name, color, group}.`)
    const name = o.name.replace(/\s+/g, ' ').trim().slice(0, 60)
    if (!name || opts.some((x) => x.name.toLowerCase() === name.toLowerCase())) continue
    const color = colorOf(o.color)
    const group = o.group === 'todo' || o.group === 'in_progress' || o.group === 'done' ? o.group : undefined
    opts.push({ name, ...(color ? { color } : {}), ...(group ? { group } : {}) })
  }
  if (opts.length > 100) throw new McpToolError(`${key}: at most 100 options.`)
  if (type === 'status' && !opts.length) return undefined
  // status without groups: first = to do, last = done, the rest in progress
  const groupAt = (i: number): StatusGroup => (opts.length === 1 || i === 0 ? 'todo' : i === opts.length - 1 ? 'done' : 'in_progress')
  return opts.map((o, i) => ({ id: newId(), name: o.name, color: o.color ?? palette[(start + i) % palette.length], ...(type === 'status' ? { group: o.group ?? groupAt(i) } : {}) }))
}
