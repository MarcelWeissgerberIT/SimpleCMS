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
import type { Writer } from '../../store/writer'
import { privateRefsFor, privateScopeRefusal } from '../ai/claudeFiles'
import { batchRefusal, codeOf, mcpError } from '../../../shared/mcp/errors'

/** One line of the approval card. */
export type PlanLine =
  /** a property value: before → after (before absent for new rows) */
  | { k: 'prop'; name: string; before?: string; after: string; fresh?: string[] }
  /**
   * a labelled fact: "In · Team wiki", "Type · number". `entry`: one of the things the person approves (a batch's row,
   * page …) — counted by the card's scroll hint; a numbered label ("01") is one by itself.
   */
  | { k: 'fact'; label: string; value: string; entry?: true }
  /** Markdown that gets written (first lines shown) */
  | { k: 'md'; label: string; value: string }
  | { k: 'note'; value: string }
  /** a task block the change makes, keeps, changes or removes: the title and its fields (UI language) */
  | { k: 'item'; tag: 'new' | 'kept' | 'changed' | 'removed'; title: string; facts: string; warn?: string }

export interface Applied {
  result: unknown
  /** revert (false = parts left alone because they were changed since); a script run's Undo resolves later */
  undo?: () => boolean | Promise<boolean>
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
  /** asked even when changes are applied directly (one_run_script: a script may send mail, call Claude …) */
  alwaysAsk?: boolean
  /** write it as `writer`'s (store/writer.ts: the MCP call) — every synchronous burst inside its frame */
  apply(writer: Writer): Promise<Applied>
}

export const str = (v: unknown, key: string, opts: { required?: boolean; max?: number } = {}): string => {
  if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) {
    if (opts.required) throw new McpToolError(mcpError('bad_argument', key, 'missing — it is required'))
    return ''
  }
  if (typeof v !== 'string') throw new McpToolError(mcpError('bad_argument', key, 'a string is expected'))
  if (opts.max && v.length > opts.max) throw new McpToolError(mcpError('bad_argument', key, `too long (${v.length} characters, at most ${opts.max})`))
  return v
}

export const pageOrThrow = (id: unknown, key = 'id'): Page => {
  const raw = str(id, key, { required: true, max: 80 }).trim()
  const p = live(raw)
  if (!p) throw new McpToolError(`not_found: No page with id ${q(raw)}. Use one_search to find page ids.`)
  return p
}

/** A page the tidy-up tools may touch: live and not part of a template (templates are not found). */
export const tidyPageOrThrow = (id: unknown, key = 'id'): Page => {
  const raw = str(id, key, { required: true, max: 80 }).trim()
  const p = live(raw)
  if (!p || inTemplate(ws().pages, p.id)) throw new McpToolError(`not_found: No page with id ${q(raw)}. Use one_search to find page ids.`)
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
  if (type !== 'select' && type !== 'multi_select' && type !== 'status') throw new McpToolError(mcpError('bad_argument', key, 'options only apply to select, multi_select and status'))
  if (!Array.isArray(raw)) throw new McpToolError(mcpError('bad_argument', key, 'a list of option names (or {name, color, group}) is expected'))
  const opts: Array<{ name: string; color?: ColorName; group?: StatusGroup }> = []
  for (const item of raw as unknown[]) {
    const o = typeof item === 'string' ? { name: item } : item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : null
    if (!o || typeof o.name !== 'string') throw new McpToolError(mcpError('bad_argument', key, 'every option is a name or {name, color, group}'))
    const name = o.name.replace(/\s+/g, ' ').trim().slice(0, 60)
    if (!name || opts.some((x) => x.name.toLowerCase() === name.toLowerCase())) continue
    const color = colorOf(o.color)
    const group = o.group === 'todo' || o.group === 'in_progress' || o.group === 'done' ? o.group : undefined
    opts.push({ name, ...(color ? { color } : {}), ...(group ? { group } : {}) })
  }
  if (opts.length > 100) throw new McpToolError(mcpError('bad_argument', key, `${opts.length} options (at most 100)`))
  if (type === 'status' && !opts.length) return undefined
  // status without groups: first = to do, last = done, the rest in progress
  const groupAt = (i: number): StatusGroup => (opts.length === 1 || i === 0 ? 'todo' : i === opts.length - 1 ? 'done' : 'in_progress')
  return opts.map((o, i) => ({ id: newId(), name: o.name, color: o.color ?? palette[(start + i) % palette.length], ...(type === 'status' ? { group: o.group ?? groupAt(i) } : {}) }))
}

/* ------------------------------------------------------------------ */
/* Shared by the planners                                               */
/* ------------------------------------------------------------------ */

/** The new tasks of a write, for its result (Claude uses these ids in later calls). */
export const tasksOf = (created: Array<{ id: string; title: string; handle?: string }>) => (created.length ? { tasks: created } : {})

/**
 * Private files may not go into a shared page (spec § 3.3): a shared write would publish them for the whole workspace.
 * `targetPrivate`: the target's privacy (team; locally nothing is private).
 */
export function checkFileScope(markdown: string, targetPrivate: boolean, target: string): void {
  checkLinkScope(markdown, targetPrivate, target)
  if (!markdown.includes('onefile:')) return
  const refs = privateRefsFor(markdown, targetPrivate)
  if (refs.length) throw new McpToolError(privateScopeRefusal(refs, target))
}

/** Page ids a Markdown text links: `#/p/<id>` — a Markdown link, a full One address, a bare one. */
const PAGE_LINKS = /#\/p\/([\w-]+)/g

/**
 * Nothing points shared → private (spec § 3.3): a link to the member's private page written into a shared page becomes a
 * page mention or a page link block there (agent/links.ts withPageNodes) — or stays a link to it — and every member gets
 * it. Refused with private_scope (team; locally nothing is private). `target`: the shared page's name for the message.
 */
export function checkLinkScope(markdown: string, targetPrivate: boolean, target: string): void {
  if (targetPrivate || !markdown.includes('#/p/')) return
  const { pages } = ws()
  const ids = [...new Set([...markdown.matchAll(PAGE_LINKS)].map((m) => m[1]!))].filter((id) => !!pages[id]?.private)
  if (!ids.length) return
  throw new McpToolError(
    `private_scope: markdown: ${target} is seen by the whole workspace and the text links ${ids.length === 1 ? 'a private page' : `${ids.length} private pages`} (${ids.slice(0, 5).join(', ')}${ids.length > 5 ? ` +${ids.length - 5}` : ''}). Nothing was changed. Leave the link out — private pages are never linked or mentioned from shared ones; ask the person.`,
  )
}

/**
 * A planner's refusal for one entry of a batch: the entry's path after the code (`bad_argument: rows[3]: …`), the
 * code kept when the message has one (not_found, system_database …), else bad_argument. Anything but an McpToolError
 * passes as it is.
 */
export function atPath(e: unknown, path: string): never {
  if (!(e instanceof McpToolError) || !path) throw e
  const code = codeOf(e.message)
  const body = code ? e.message.slice(code.length + 1).trim() : e.message
  throw new McpToolError(`${code ?? 'bad_argument'}: ${path}: ${body}`)
}

/**
 * A batch planned entry by entry — all or nothing, and every entry that does not fit is named in ONE refusal (`rows[i]
 * ("title"): …` per line, ≤ 20 lines and "and n more"), so a model fixes them in one round. One bad entry keeps its
 * own refusal as it is. `plan` runs for every entry (a later one is checked although an earlier one failed); `label`
 * names an entry (its title) in the list. The words are shared with the team server (shared/mcp/errors.ts batchRefusal).
 */
export function eachEntry<T>(items: readonly T[], path: (i: number) => string, label: (item: T, i: number) => string | null, plan: (item: T, i: number) => void): void {
  const failed: Array<{ i: number; error: McpToolError }> = []
  items.forEach((item, i) => {
    try {
      plan(item, i)
    } catch (e) {
      if (!(e instanceof McpToolError)) throw e
      failed.push({ i, error: e })
    }
  })
  if (!failed.length) return
  if (failed.length === 1) throw failed[0]!.error
  const root = path(0).replace(/\[\d+\]$/, '')
  throw new McpToolError(batchRefusal(failed.map((f) => ({ path: path(f.i), name: label(items[f.i]!, f.i), message: f.error.message })), items.length, root))
}
