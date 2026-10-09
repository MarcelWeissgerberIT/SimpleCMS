/**
 * Custom agents — the pages a saved agent works with that are in the trash or gone for good: its scope (pages and
 * databases), the database its row trigger watches, its report page. Pure (the pages map is passed in):
 *  - lostPages(): each such page with where it is — in the trash itself, below a page in the trash (`root` names that
 *    page: restoring it brings the page back), or deleted for good (no title any more).
 *  - runBlock(): why a browser run would not start — nothing in its scope can be used (every page and database it names
 *    is in the trash or gone), or its report page is in the trash or gone. exec.ts ends such a run as an error with
 *    this reason; the agent page names every lost page with a Restore key (AgentsView.tsx).
 *  - trashedRoot(): the page in the trash that takes `id` along (itself, else the nearest page above it in the trash).
 */
import type { Translate } from '@/shared/i18n'
import type { CustomAgent, ID, Page } from '../../store/types'

/** The page in the trash that holds `id` (itself or the nearest one above it) — null: `id` is not in the trash. */
export function trashedRoot(pages: Record<ID, Page>, id: ID): Page | null {
  const seen = new Set<ID>()
  for (let p: Page | undefined = pages[id]; p && !seen.has(p.id); p = p.parentId ? pages[p.parentId] : undefined) {
    if (p.trashed) return p
    seen.add(p.id)
  }
  return null
}

/** What a saved agent uses a page for. */
export type LostRole = 'scope' | 'trigger' | 'report'

export interface LostPage {
  id: ID
  role: LostRole
  /** 'trashed': in the trash itself · 'below': below `root`, which is in the trash · 'gone': deleted for good */
  state: 'trashed' | 'below' | 'gone'
  /** '' when gone (nothing is known about it any more) */
  title: string
  /** a database (scope.databases, the trigger's database) or a page */
  database: boolean
  /** the page in the trash that takes it along (restoring it brings the page back) */
  root?: { id: ID; title: string }
}

const titleOf = (p: Page | undefined, untitled: string) => p?.title.trim() || untitled

/** One page the agent names: null while it is live (or missing here while `gone` is false). */
function lostOne(pages: Record<ID, Page>, id: ID, role: LostRole, database: boolean, untitled: string, gone: boolean): LostPage | null {
  const p = pages[id]
  if (!p) return gone ? { id, role, state: 'gone', title: '', database } : null
  const root = trashedRoot(pages, id)
  if (!root) return null
  if (root.id === id) return { id, role, state: 'trashed', title: titleOf(p, untitled), database }
  return { id, role, state: 'below', title: titleOf(p, untitled), database, root: { id: root.id, title: titleOf(root, untitled) } }
}

/**
 * The pages `agent` names that are in the trash (or below a page there) or deleted for good — in the order of its form.
 * `gone`: a page missing from `pages` counts as deleted for good — false where this device may simply not see it (a
 * team workspace, another member's agent: their private pages are not here).
 */
export function lostPages(agent: Pick<CustomAgent, 'scope' | 'trigger' | 'output'>, pages: Record<ID, Page>, untitled = '', gone = true): LostPage[] {
  const out: LostPage[] = []
  const add = (x: LostPage | null) => {
    if (x && !out.some((o) => o.id === x.id && o.role === x.role)) out.push(x)
  }
  if (!agent.scope.everything) {
    for (const id of agent.scope.pages) add(lostOne(pages, id, 'scope', false, untitled, gone))
    for (const id of agent.scope.databases) add(lostOne(pages, id, 'scope', true, untitled, gone))
  }
  const tr = agent.trigger
  if ((tr.type === 'row_created' || tr.type === 'row_changed') && tr.databaseId) add(lostOne(pages, tr.databaseId, 'trigger', true, untitled, gone))
  if (agent.output?.pageId) add(lostOne(pages, agent.output.pageId, 'report', false, untitled, gone))
  return out
}

/**
 * Is this device's pages map the whole truth for `agent`'s pages (a page missing here is deleted for good)? Locally
 * always; in a team only for the member's own agents (a teammate's private pages are not on this device).
 */
export const seesAllPagesOf = (agent: Pick<CustomAgent, 'createdBy'>, team: boolean, me: string | null): boolean => !team || !agent.createdBy || agent.createdBy === me

/** A lost page in words: "“A” is in the trash." · "“A” is in “P”, and “P” is in the trash." · "A database that was deleted for good." */
export function lostText(t: Translate, l: LostPage): string {
  if (l.state === 'gone') return t(l.database ? 'features.agents.lost.gone.database' : 'features.agents.lost.gone.page')
  if (l.state === 'below' && l.root) return t('features.agents.lost.below', { title: l.title, parent: l.root.title })
  return t('features.agents.lost.trashed', { title: l.title })
}

/** The page a Restore key brings back for a lost page (itself, or the page in the trash above it) — null: gone for good. */
export const restoreTarget = (l: LostPage): ID | null => (l.state === 'trashed' ? l.id : l.state === 'below' ? (l.root?.id ?? null) : null)

/** Why a run of `agent` would not start (null: it can start): nothing in its scope is usable, or its report page is lost. */
export function runBlock(agent: Pick<CustomAgent, 'scope' | 'trigger' | 'output'>, pages: Record<ID, Page>, untitled = ''): { why: 'scope' | 'report'; lost: LostPage[] } | null {
  const lost = lostPages(agent, pages, untitled)
  const named = agent.scope.everything ? 0 : agent.scope.pages.length + agent.scope.databases.length
  const scopeLost = lost.filter((l) => l.role === 'scope')
  if (named > 0 && scopeLost.length >= named) return { why: 'scope', lost: scopeLost }
  const report = lost.filter((l) => l.role === 'report')
  if (report.length) return { why: 'report', lost: report }
  return null
}

/** A blocked run's reason in words: why it did not start, then each page concerned. */
export function blockText(t: Translate, block: NonNullable<ReturnType<typeof runBlock>>): string {
  return [t(`features.agents.blocked.${block.why}`), ...block.lost.map((l) => lostText(t, l))].join(' ')
}
