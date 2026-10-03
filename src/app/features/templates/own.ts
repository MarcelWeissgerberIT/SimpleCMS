/**
 * Own templates — a template is a real page subtree in the hidden Templates area: its root page
 * carries `template` (Page.template: name, description, category, icon, from) and `hidden: true`,
 * and lives at the top level (in team workspaces: the workspace's pages, or my Private section).
 * Editing a template = editing those pages (the banner in TemplateBanner.tsx says where you are).
 *
 *  - applyTemplate(): "Use" — a deep copy (copy.ts) under a parent, variables filled (vars.ts)
 *  - saveAsTemplate(): "Save as template…" — a deep copy of a page into the Templates area
 *  - createBlankTemplate(), duplicateTemplate(), removeTemplate() (trash + Undo)
 *  - customiseBuiltin(): runs a catalogue builder into the Templates area once (`from: <id>`);
 *    from then on the gallery uses that copy until "Reset to original" (= removeTemplate)
 *  - editTemplate() / leaveTemplate(): open a template for editing and go back where you came from
 */
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { flushSave } from '../../store/persistence'
import { navigate, openPage } from '../../lib/router'
import { t } from '../../i18n'
import type { ID, Page, PageTemplate, TemplateCategory } from '../../store/types'
import { templateRootOf } from '../../store/selectors'
import { pauseAutomations } from '../automations/engine'
import type { TemplateDef, Tr } from './catalog'
import { copyTree } from './copy'
import { templateFiller } from './vars'

export const TEMPLATE_CATEGORIES: TemplateCategory[] = ['work', 'product', 'personal', 'knowledge']

const ws = () => useWorkspace.getState()

/** Template roots that are not in the trash, oldest first (the gallery's order). */
export function templateRoots(pages: Record<ID, Page>): Page[] {
  const out: Page[] = []
  for (const id of Object.keys(pages)) {
    const p = pages[id]
    if (p.template && !p.trashed) out.push(p)
  }
  return out.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
}

/** Customised built-ins: catalogue id → its edited copy (the most recently changed one). */
export function customisedBuiltins(roots: Page[]): Map<string, Page> {
  const out = new Map<string, Page>()
  for (const p of roots) {
    const from = p.template?.from
    if (!from) continue
    const had = out.get(from)
    if (!had || p.updatedAt > had.updatedAt) out.set(from, p)
  }
  return out
}

/** The display name of a template. */
export const templateName = (p: Page | undefined) => p?.template?.name.trim() || p?.title.trim() || t('features.tpl.untitled')

/** Open editors put their pending text into the store first: a copy must see the latest keystrokes. */
function flushEditors() {
  try {
    ;(window as Window & { __oneEditorUnload?: () => void }).__oneEditorUnload?.()
  } catch {
    /* a failing editor must not stop the copy */
  }
}

/** The page of a `#/p/<id>` route, else null. */
const routePage = (hash: string | null | undefined) => hash?.match(/^#\/p\/([\w-]+)/)?.[1] ?? null

/** Is `id` the page `rootId` or below it? */
function isWithin(id: ID | null, rootId: ID): boolean {
  const pages = ws().pages
  const seen = new Set<ID>()
  let cur = id ? pages[id] : undefined
  while (cur && !seen.has(cur.id)) {
    if (cur.id === rootId) return true
    seen.add(cur.id)
    cur = cur.parentId ? pages[cur.parentId] : undefined
  }
  return false
}

/** Undo a fresh copy: to the trash; if it is on screen, back to where the user was before. */
function undoCopy(id: ID, from: string) {
  if (!ws().pages[id]) return
  const onCopy = isWithin(routePage(window.location.hash), id)
  ws().trashPage(id)
  if (onCopy) navigate(from && !isWithin(routePage(from), id) ? from : '#/')
  void flushSave()
}

/** Toast for a fresh copy (built-in or own template): "“X” added · Undo". */
export function announceCopy(id: ID, name: string, from: string) {
  useUI.getState().toast({ message: t('features.tpl.created', { name }), kind: 'success', action: { label: t('common.undo'), run: () => undoCopy(id, from) } })
}

/**
 * "Use": a fresh copy of the template under `parentId` (null = top level), variables filled.
 * The copy's root is called like the template's root page (or the template, when that is untitled).
 */
export function applyTemplate(rootId: ID, parentId: ID | null): ID | null {
  flushEditors()
  const root = ws().pages[rootId]
  if (!root?.template) return null
  const name = templateName(root)
  const fill = templateFiller(name)
  const resume = pauseAutomations()
  try {
    const title = root.title.trim() ? fill(root.title) : name
    const res = copyTree(rootId, { parentId, root: { title, hidden: false, template: null }, fill })
    void flushSave()
    return res?.rootId ?? null
  } finally {
    resume()
  }
}

/** "Save as template…": a copy of the page (and everything below it) in the Templates area. */
export function saveAsTemplate(pageId: ID, meta: PageTemplate, opts: { private?: boolean } = {}): ID | null {
  flushEditors()
  const resume = pauseAutomations()
  try {
    const res = copyTree(pageId, { parentId: null, root: { hidden: true, template: meta }, private: opts.private })
    void flushSave()
    return res?.rootId ?? null
  } finally {
    resume()
  }
}

/** "New template": an empty page in the Templates area. */
export function createBlankTemplate(): ID {
  const name = t('features.tpl.untitled')
  const id = ws().createPage({ parentId: null, hidden: true, title: '' })
  ws().updatePage(id, { template: { name } })
  void flushSave()
  return id
}

/** "Customise" a built-in: its builder runs once into the Templates area, marked `from: <id>`. */
export function customiseBuiltin(def: TemplateDef, L: Tr): ID {
  const resume = pauseAutomations()
  try {
    const id = def.build(null, L)
    ws().updatePage(id, {
      hidden: true,
      template: { name: def.title(L), description: def.description(L), category: def.category, icon: { type: 'asset', value: def.icon }, from: def.id },
    })
    void flushSave()
    return id
  } finally {
    resume()
  }
}

/** "Duplicate": another template with the same pages ("<name> (copy)"; never a customised built-in). */
export function duplicateTemplate(rootId: ID): ID | null {
  flushEditors()
  const root = ws().pages[rootId]
  if (!root?.template) return null
  const { from: _from, ...meta } = root.template
  const resume = pauseAutomations()
  try {
    const res = copyTree(rootId, {
      parentId: null,
      root: { hidden: true, template: { ...meta, name: t('features.tpl.copyName', { name: templateName(root) }) } },
      private: !!root.private,
    })
    void flushSave()
    return res?.rootId ?? null
  } finally {
    resume()
  }
}

/** Delete a template / reset a customised built-in: to the trash, with Undo. */
export function removeTemplate(rootId: ID, kind: 'delete' | 'reset') {
  const root = ws().pages[rootId]
  if (!root?.template) return
  const name = templateName(root)
  ws().trashPage(rootId)
  void flushSave()
  useUI.getState().toast({
    message: t(kind === 'reset' ? 'features.tpl.resetDone' : 'features.tpl.deleted', { name }),
    action: { label: t('common.undo'), run: () => ws().pages[rootId] && ws().restorePage(rootId) },
  })
}

/** Change the gallery metadata of a template. */
export function updateTemplateMeta(rootId: ID, patch: Partial<PageTemplate>) {
  const root = ws().pages[rootId]
  if (!root?.template) return
  ws().updatePage(rootId, { template: { ...root.template, ...patch } })
}

/* ------------------------------------------------------------------ */
/* Editing: open a template, "Done" goes back                          */
/* ------------------------------------------------------------------ */

let returnTo: string | null = null
const detailsFor = new Set<ID>()

/** Open a template's root page for editing; "Done" in the banner comes back to where this was called. */
export function editTemplate(rootId: ID, opts: { details?: boolean } = {}) {
  const here = window.location.hash
  const cur = routePage(here)
  if (!cur || templateRootOf(ws().pages, cur) !== rootId) returnTo = here || '#/'
  if (opts.details) detailsFor.add(rootId)
  openPage(rootId)
}

/** The banner opens its details once for a template that was just made. */
export function consumeDetailsRequest(rootId: ID): boolean {
  return detailsFor.delete(rootId)
}

/** "Done": back to where editing started (home when that is unknown or gone). */
export function leaveTemplate() {
  const to = returnTo
  returnTo = null
  const page = routePage(to)
  const gone = !!page && (!ws().pages[page] || ws().pages[page].trashed)
  navigate(to && !gone ? to : '#/')
}
