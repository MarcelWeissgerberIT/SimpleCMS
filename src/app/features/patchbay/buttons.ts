/**
 * The button index (plan §1.17) — pure. Buttons that run something become § 01 modules: `run_script` (→ the script),
 * `webhook` (→ a way out, by hand), `add_page` (→ a new row). Every other action (insert blocks, a message, an
 * address, property edits on the page itself) stays on the page. Buttons are pressed by a person: fuses never need the
 * index, so the LED and Preflight never wait for it.
 *
 * Built the first time #/patchbay opens (inputs.ts drives it in idle slices: one key walk, then pages in chunks of at
 * most SLICE_MS each — B17: by time, not by count, so a slice of long pages never blocks the main thread), then kept up
 * to date per page from `onRowsChanged` (`changed` / `contentOnly`): a page is read again only when its `contentRev`
 * moved. Template pages never count. Team: `page.content` as the store holds it.
 */
import type { ID, Page } from '../../store/types'
import type { ButtonInput } from './types'

type Json = { type?: unknown; attrs?: Record<string, unknown>; content?: unknown }
type Action = ButtonInput['actions'][number]

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** The host of an address (lower case; null when it is none). */
function hostOf(url: unknown): string | null {
  if (typeof url !== 'string') return null
  try {
    const h = new URL(url.trim()).hostname.toLowerCase()
    return h || null
  } catch {
    return null
  }
}

/** The actions of a button that wire something (a stored or pasted list: anything else is left out). */
export function wiringActions(raw: unknown): Action[] {
  if (!Array.isArray(raw)) return []
  const out: Action[] = []
  for (const a of raw) {
    if (!isObj(a)) continue
    if (a.type === 'run_script') out.push({ type: 'run_script', scriptId: typeof a.scriptId === 'string' && a.scriptId ? a.scriptId : null })
    else if (a.type === 'webhook') out.push({ type: 'webhook', host: hostOf(a.url), method: a.method === 'PUT' ? 'PUT' : 'POST' })
    else if (a.type === 'add_page') out.push({ type: 'add_page', target: typeof a.databaseId === 'string' && a.databaseId ? a.databaseId : null })
  }
  return out
}

/** The wiring buttons of one page's document, in document order (block = the node's id, else its position). */
export function buttonsIn(pageId: ID, doc: unknown): ButtonInput[] {
  const out: ButtonInput[] = []
  let n = 0
  const visit = (node: unknown, depth: number) => {
    if (!isObj(node) || depth > 64) return
    const j = node as Json
    if (j.type === 'button') {
      const actions = wiringActions(j.attrs?.actions)
      const id = typeof j.attrs?.id === 'string' && j.attrs.id ? (j.attrs.id as string) : `#${n}`
      n++
      if (actions.length) out.push({ page: pageId, block: id, actions })
      return
    }
    if (Array.isArray(j.content)) for (const c of j.content) visit(c, depth + 1)
  }
  visit(doc, 0)
  return out
}

/** Is the page or a page above it a template (cycle-safe)? */
function underTemplate(pages: Record<ID, Page>, id: ID): boolean {
  const seen = new Set<ID>()
  let cur: Page | undefined = pages[id]
  while (cur && !seen.has(cur.id)) {
    if (cur.template) return true
    seen.add(cur.id)
    cur = cur.parentId ? pages[cur.parentId] : cur.databaseId ? pages[cur.databaseId] : undefined
  }
  return false
}

/** B17: the time one slice of the build may take (ms) — at least one page is read per slice. */
export const SLICE_MS = 8

const clock = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/**
 * The index: page → (its contentRev, its wiring buttons). `ready` turns true once every page was read. `list()` keeps
 * its reference while nothing changed (the model's memo compares it).
 */
export class ButtonIndex {
  private byPage = new Map<ID, { rev: number; buttons: ButtonInput[] }>()
  private queue: ID[] | null = null
  private cached: ButtonInput[] | null = null
  ready = false
  /** B17 (perf seam): the build's slices — how many, the longest (ms), pages read */
  stats = { slices: 0, maxMs: 0, pages: 0 }

  /** Start a build: the page ids to read (one key walk — the caller's, once). */
  begin(ids: readonly ID[]): void {
    this.queue = [...ids]
    this.byPage.clear()
    this.cached = null
    this.ready = false
    this.stats = { slices: 0, maxMs: 0, pages: 0 }
  }

  /** Read pages of the build for up to `budgetMs` (at least one); true when the build is done. */
  step(pages: Record<ID, Page>, budgetMs = SLICE_MS): boolean {
    if (!this.queue) return this.ready
    const t0 = clock()
    let k = 0
    while (this.queue.length && (k === 0 || clock() - t0 < budgetMs)) {
      const id = this.queue.pop()!
      this.read(pages, id)
      k++
    }
    const ms = clock() - t0
    this.stats = { slices: this.stats.slices + 1, maxMs: Math.max(this.stats.maxMs, ms), pages: this.stats.pages + k }
    if (!this.queue.length) {
      this.queue = null
      this.ready = true
      this.cached = null
    }
    return this.ready
  }

  /** One page again (a change the row index reported): read only when its contentRev moved. */
  update(pages: Record<ID, Page>, ids: Iterable<ID>): boolean {
    let moved = false
    for (const id of ids) {
      const had = this.byPage.get(id)
      const p = pages[id]
      if (!p || p.trashed) {
        if (had) {
          this.byPage.delete(id)
          moved = true
        }
        continue
      }
      if (had && had.rev === p.contentRev) continue
      const before = had?.buttons.length ?? 0
      this.read(pages, id)
      if (before || (this.byPage.get(id)?.buttons.length ?? 0)) moved = true
    }
    if (moved) this.cached = null
    return moved
  }

  private read(pages: Record<ID, Page>, id: ID): void {
    const p = pages[id]
    if (!p || p.trashed || !p.content || underTemplate(pages, id)) {
      this.byPage.delete(id)
      return
    }
    const buttons = buttonsIn(id, p.content)
    if (buttons.length) this.byPage.set(id, { rev: p.contentRev, buttons })
    else this.byPage.set(id, { rev: p.contentRev, buttons: [] })
  }

  /** Every wiring button (null while the first build runs). */
  list(): ButtonInput[] | null {
    if (!this.ready) return null
    if (!this.cached) {
      const out: ButtonInput[] = []
      for (const [, v] of [...this.byPage.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) out.push(...v.buttons)
      this.cached = out
    }
    return this.cached
  }
}
