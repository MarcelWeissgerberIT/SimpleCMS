/**
 * Breadcrumb block (schema/breadcrumb.ts): the path of a page — workspace › ancestors › page.
 * Live in the editor (BreadcrumbView); frozen into plain titles when a doc leaves the workspace
 * (share links, exports, Markdown), because the receiving side has no workspace to look the path up in.
 */
import type { JSONContent } from '@tiptap/core'
import { useWorkspace } from '../../store/store'
import { selectBreadcrumbs } from '../../store/selectors'
import type { ID, Page } from '../../store/types'
import { useCloud } from '../../cloud'
import { t } from '../../i18n'

/** The open workspace's name (team workspace: the server's name; local: this browser's). */
export function workspaceTitle(): string {
  const c = useCloud.getState()
  const active = c.active
  const team = active.kind === 'cloud' ? c.workspaces.find((w) => w.id === active.id)?.name : null
  return team || useWorkspace.getState().settings.workspaceName.trim() || 'One'
}

export interface Trail {
  /** Root → page (inclusive). */
  pages: Page[]
  /** The topmost page has a parent this member can't see (team workspaces: no access) — shown as a gap. */
  gap: boolean
}

/** The path of a page in a page map (empty when the page is not there). */
export function trailOf(pages: Record<ID, Page>, id: ID | null | undefined): Trail {
  if (!id || !pages[id]) return { pages: [], gap: false }
  const chain = selectBreadcrumbs(pages, id)
  const top = chain[0]
  return { pages: chain, gap: !!top?.parentId && !pages[top.parentId] }
}

/** The path as plain titles: [workspace, (…), …ancestors, page] — null when the page is unknown. */
export function pathTitles(id: ID | null | undefined): string[] | null {
  const trail = trailOf(useWorkspace.getState().pages, id)
  if (!trail.pages.length) return null
  const untitled = t('common.untitled')
  // team workspaces: a private page (and its subpages) sits under "Private", not in the shared tree
  const priv = trail.pages[0].private ? [t('editor.breadcrumb.private')] : []
  return [workspaceTitle(), ...priv, ...(trail.gap ? ['…'] : []), ...trail.pages.map((p) => p.title.trim() || untitled)]
}

/** A frozen path attribute as stored (defensive: anything else is "live"). */
export function frozenPathOf(v: unknown): string[] | null {
  return Array.isArray(v) && v.length > 0 && v.length <= 64 ? v.map((s) => (typeof s === 'string' ? s.slice(0, 300) : '')) : null
}

/* ------------------------------------------------------------------ */
/* Freezing (docs leaving the workspace)                               */
/* ------------------------------------------------------------------ */

type Json = JSONContent

function hasLiveBreadcrumb(n: Json): boolean {
  if (n.type === 'breadcrumb') return !frozenPathOf(n.attrs?.path)
  return !!n.content?.some(hasLiveBreadcrumb)
}

/** Block ids of the breadcrumbs in a doc. */
function breadcrumbIds(n: Json, out: string[] = []): string[] {
  if (n.type === 'breadcrumb' && typeof n.attrs?.id === 'string') out.push(n.attrs.id)
  for (const c of n.content ?? []) breadcrumbIds(c, out)
  return out
}

/** Per (immutable) page content: the breadcrumb block ids it holds. */
const idsCache = new WeakMap<object, string[]>()

/**
 * The page a doc belongs to: the page holding exactly this content object (what the exports and share
 * links pass), else the page holding one of its breadcrumbs (a copy that went through another transform).
 */
export function pageOfDoc(doc: Json): ID | null {
  const pages = useWorkspace.getState().pages
  const all = Object.values(pages)
  for (const p of all) if (p.content === doc) return p.id
  const wanted = new Set(breadcrumbIds(doc))
  if (!wanted.size) return null
  for (const p of all) {
    if (!p.content || p.trashed) continue
    let ids = idsCache.get(p.content)
    if (!ids) {
      ids = breadcrumbIds(p.content)
      idsCache.set(p.content, ids)
    }
    if (ids.some((id) => wanted.has(id))) return p.id
  }
  return null
}

/**
 * The doc with every live breadcrumb frozen into the path of its page (`near`, else looked up). The same
 * object comes back when there is nothing to freeze; a breadcrumb whose page is unknown stays live.
 */
export function freezeBreadcrumbs(doc: Json, near?: ID | null): Json {
  if (!doc || !hasLiveBreadcrumb(doc)) return doc
  const path = pathTitles(near ?? pageOfDoc(doc))
  if (!path) return doc
  const walk = (n: Json): Json => {
    if (n.type === 'breadcrumb') return frozenPathOf(n.attrs?.path) ? n : { ...n, attrs: { ...n.attrs, path } }
    if (!n.content) return n
    const kids = n.content.map(walk)
    return kids.some((k, i) => k !== n.content![i]) ? { ...n, content: kids } : n
  }
  return walk(doc)
}
