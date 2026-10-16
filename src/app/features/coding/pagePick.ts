/**
 * Pages for a coding text field (coding/RefField.tsx): the "@" / "one:" search — the editor's own (editor
 * lib/pageSearch.ts: live pages, no template pages, the same ranking) — and "Give the page" suggestions: names Claude's
 * question puts in quotes that are the exact title of a page here. Private pages (team) only where their title may
 * travel: a task that is private itself (the reference lands in its page as a note).
 */
import { useWorkspace } from '../../store/store'
import { inTemplate, selectBreadcrumbs } from '../../store/selectors'
import type { ID, Page } from '../../store/types'
import { liveIds, mentionPages, refPages, type RefSection } from '../../editor'
import { useCloud } from '../../cloud'
import { t } from '../../i18n'
import type { Trigger } from './refDraft'

/** Team workspaces: a reference to a private page only from a private task (local workspaces have none). */
export function privateAllowed(taskId: ID | null): boolean {
  if (useCloud.getState().active.kind !== 'cloud') return true
  return !!taskId && !!useWorkspace.getState().pages[taskId]?.private
}

/** "Projects / Launch" — where a page lives (its ancestors), '' at the top. */
export function pathOf(pages: Record<ID, Page>, id: ID): string {
  return selectBreadcrumbs(pages, id)
    .slice(0, -1)
    .map((p) => p.title.trim() || t('common.untitled'))
    .join(' / ')
}

export interface PickRow {
  page: Page
  /** where it lives (or the "one:" section's word) */
  hint: string
  /** "one:" only: same level · inside · search */
  section?: RefSection
}

/**
 * The rows of the menu for "@que" / "one:que" — the editor's search, ranking and length (@: 6 matches, or the 4 opened
 * last without a query; one: 6 per section). `live`: liveIds when the menu opened.
 */
export function pickRows(trigger: Trigger, near: ID | null, allowPrivate: boolean, live: ReadonlySet<ID>): PickRow[] {
  const s = useWorkspace.getState()
  const skip = allowPrivate ? undefined : (p: Page) => !!p.private
  if (trigger.kind === '@') {
    const typed = !!trigger.query.trim()
    return mentionPages(s.pages, typed ? [] : s.recent, { query: trigger.query, near, live, skip })
      .slice(0, typed ? 6 : 4)
      .map((page) => ({ page, hint: pathOf(s.pages, page.id) }))
  }
  return refPages(s.pages, { query: trigger.query, near, live, skip }, 6).map(({ section, page }) => ({ page, section, hint: section === 'search' ? pathOf(s.pages, page.id) : '' }))
}

/**
 * Names in quotes — „…“ “…” "…" «…» »…« ‚…‘ ‘…’ '…' (an apostrophe inside a word is no quote) — in order, each once.
 */
const QUOTED = /„([^“”"\n]{1,120})[“”"]|“([^”\n]{1,120})”|"([^"\n]{1,120})"|«([^»\n]{1,120})»|»([^«\n]{1,120})«|‚([^‘’'\n]{1,120})[‘’']|‘([^’\n]{1,120})’|(?<![\p{L}\p{N}])'([^'\n]{1,120})'(?![\p{L}\p{N}])/gu

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

export function quotedNames(text: string): string[] {
  const out = new Map<string, string>()
  for (const m of text.matchAll(QUOTED)) {
    const name = (m.slice(1).find((g) => g !== undefined) ?? '').trim()
    if (name && !out.has(norm(name))) out.set(norm(name), name)
  }
  return [...out.values()]
}

export interface PageSuggestion {
  /** the name as the question writes it */
  name: string
  /** the live pages titled exactly so (case and spaces aside): one, or several — then each with its path */
  pages: Array<{ id: ID; title: string; path: string }>
}

/**
 * "Give the page": for every name the question quotes that is the exact title (trimmed, any case) of a live page here —
 * not in a template, not the task itself, private only where allowed — that page; an ambiguous name lists every
 * candidate with its path. Nothing is added by itself.
 */
export function suggestPages(question: string, near: ID | null, allowPrivate: boolean): PageSuggestion[] {
  const names = quotedNames(question)
  if (!names.length) return []
  const { pages } = useWorkspace.getState()
  const want = new Map(names.map((n) => [norm(n), n]))
  const hits = new Map<string, Page[]>()
  let live: Set<ID> | null = null
  for (const p of Object.values(pages)) {
    const key = norm(p.title)
    if (!key || !want.has(key) || p.id === near || (!allowPrivate && p.private)) continue
    if (!(live ??= liveIds(pages)).has(p.id) || inTemplate(pages, p.id)) continue
    hits.set(key, [...(hits.get(key) ?? []), p])
  }
  return [...want].flatMap(([key, name]) => {
    const list = hits.get(key)
    return list?.length ? [{ name, pages: list.sort((a, b) => b.updatedAt - a.updatedAt).map((p) => ({ id: p.id, title: p.title.trim(), path: pathOf(pages, p.id) })) }] : []
  })
}
