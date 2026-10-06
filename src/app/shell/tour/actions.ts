/**
 * The "Try it" keys the shell provides (help/changelog/try.ts runs them; register.ts hands them over at boot):
 * the tour, the slash menu / the AI menu / Transform into on the tour's practice page, a database, its
 * commands, a spreadsheet, a database's automations. Real places — nothing runs on its own.
 */
import type { JSONContent } from '@tiptap/core'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { inTemplate, isEffectivelyTrashed } from '../../store/selectors'
import type { ID } from '../../store/types'
import { navigate, parseHash } from '../../lib/router'
import { openAIPanel } from '../../editor'
import { emptyLine, openTourPage, selectList } from './tourPage'
import { showcaseDatabase } from './steps'

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms))

/** Wait for an element (null after `ms`). */
async function waitFor<T extends Element>(selector: string, ms = 2000): Promise<T | null> {
  for (let i = 0; i < ms / 50; i++) {
    const el = document.querySelector<T>(selector)
    if (el) return el
    await sleep(50)
  }
  return null
}

/** The slash menu on the practice page's empty line. */
export async function trySlash(query = ''): Promise<void> {
  const at = await openTourPage()
  const ed = at?.editor
  if (!ed) return
  ed.chain().focus().setTextSelection(emptyLine(ed)).run()
  ed.commands.insertContent(`/${query}`)
}

/** The AI menu on the practice page's first paragraph (without a key it asks for one — the real first step). */
export async function tryAIMenu(): Promise<void> {
  const at = await openTourPage()
  const ed = at?.editor
  if (!ed) return
  const first = ed.state.doc.firstChild
  if (!first?.textContent) return
  ed.chain().focus().setTextSelection({ from: 1, to: 1 + first.content.size }).run()
  await sleep(120)
  openAIPanel(ed, { mode: 'selection' })
}

/** The practice page's list selected, the AI menu open on "Transform into …" (the forms; nothing runs yet). */
export async function tryTransform(): Promise<void> {
  const at = await openTourPage()
  const ed = at?.editor
  if (!ed || !selectList(ed)) return
  await sleep(120)
  openAIPanel(ed, { mode: 'selection', open: 'transform' })
}

async function openDatabase(): Promise<ID | null> {
  const pick = showcaseDatabase()
  if (!pick) return null
  const r = parseHash(window.location.hash)
  if (!(r.name === 'page' && r.id === pick.page.id)) navigate({ name: 'page', id: pick.page.id })
  return pick.page.id
}

export async function tryDatabase(): Promise<void> {
  await openDatabase()
}

/** The database's command menu (its toolbar key). */
export async function tryCommands(): Promise<void> {
  if (!(await openDatabase())) return
  const key = await waitFor<HTMLElement>('#main [data-testid="db-commands"]')
  key?.click()
}

export function tryAutomations(): void {
  const pick = showcaseDatabase()
  if (pick) useUI.getState().openModal({ type: 'automations', databaseId: pick.page.id })
}

const hasSheet = (doc: JSONContent | null | undefined): boolean => {
  if (!doc) return false
  if (doc.type === 'spreadsheet') return true
  return !!doc.content?.some(hasSheet)
}

/** The first page with a spreadsheet (the demo's budget), else the slash menu on "sheet". */
export async function trySheet(): Promise<void> {
  const { pages } = useWorkspace.getState()
  const page = Object.values(pages)
    .filter((p) => p.kind === 'page' && !p.databaseId && !isEffectivelyTrashed(pages, p.id) && !inTemplate(pages, p.id))
    .sort((a, b) => a.createdAt - b.createdAt)
    .find((p) => hasSheet(p.content))
  if (page) return navigate({ name: 'page', id: page.id })
  await trySlash('sheet')
}
