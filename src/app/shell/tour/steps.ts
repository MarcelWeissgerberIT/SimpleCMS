/**
 * The tour's steps: where each one happens (`enter`), the real element it frames (`target`, looked up again
 * every frame — the first visible match), what "Do it for me" does (`act`, real and small: the Tour page, a view
 * switch, a dialog, a dry run) and what it closes again when the tour moves on (`leave`).
 */
import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { inTemplate, isEffectivelyTrashed } from '../../store/selectors'
import type { Database, ID, Page, PropertyDef } from '../../store/types'
import { navigate, parseHash } from '../../lib/router'
import { openAIPanel } from '../../editor'
import { closeAgent, openAgent, runScript, silentScriptUI } from '../../features'
import { closeHelp, openHelp } from '../../help'
import { t } from '../../i18n'
import { emptyLine, openTourPage, selectList } from './tourPage'
import { TOUR_STEP_COUNT } from './state'

export type StepId = 'slash' | 'ai' | 'palette' | 'database' | 'terminal' | 'history' | 'scripts' | 'help'

/** What "Do it for me" reports back to the placard (a line under the text). */
export interface ActResult {
  note?: string
}

export interface TourStep {
  id: StepId
  /** needs a Claude key to do its thing for real (without one: the key line, and only what works without) */
  needsKey?: boolean
  /** the shortcut in the title ({key}) */
  key?: string
  enter?: () => void | Promise<void>
  /** what to frame: an element, or several (framed together) — null: the placard alone */
  target: () => HTMLElement | HTMLElement[] | null
  act?: (ctx: { hasKey: boolean }) => Promise<ActResult | void> | ActResult | void
  leave?: () => void
}

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms))

/** The element is on screen (laid out, not hidden). */
export function isShown(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement) || !el.isConnected) return false
  const r = el.getBoundingClientRect()
  if (r.width < 2 || r.height < 2) return false
  if (r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth) return false
  return getComputedStyle(el).visibility !== 'hidden'
}

/** The first shown element of a list of selectors. */
const first = (...selectors: string[]): HTMLElement | null => {
  for (const s of selectors) {
    for (const el of document.querySelectorAll(s)) if (isShown(el)) return el as HTMLElement
  }
  return null
}

const mainPageId = (): ID | null => {
  const r = parseHash(window.location.hash)
  return r.name === 'page' ? r.id : null
}

/** The page the history step shows: the start page (it has a version history from the start), else the open page. */
function historyPage(): ID | null {
  const { settings, pages } = useWorkspace.getState()
  const ok = (id: ID | null | undefined): id is ID => !!id && !!pages[id] && !isEffectivelyTrashed(pages, id) && pages[id].kind === 'page'
  if (ok(settings.startPageId)) return settings.startPageId
  const open = mainPageId()
  return ok(open) ? open : null
}

/** The database the tour shows: the one with the most views (the demo's Projects), never a system one. */
export function showcaseDatabase(): { page: Page; db: Database } | null {
  const { pages, databases } = useWorkspace.getState()
  const list = Object.values(databases)
    .map((db) => ({ db, page: pages[db.id] }))
    .filter((x): x is { db: Database; page: Page } => !!x.page && !x.db.system && !isEffectivelyTrashed(pages, x.page.id) && !inTemplate(pages, x.page.id))
    .sort((a, b) => b.db.views.length - a.db.views.length || a.page.createdAt - b.page.createdAt)
  return list[0] ?? null
}

/** Type like a person would (the slash menu filters as it goes). */
async function typeInto(editor: Editor, text: string, gap = 80) {
  for (const ch of text) {
    if (editor.isDestroyed) return
    editor.commands.insertContent(ch)
    await sleep(gap)
  }
}

/** A key press for the editor's own handlers (the slash menu's Enter). */
function press(editor: Editor, key: string) {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  editor.view.someProp('handleKeyDown', (f) => f(editor.view, ev))
}

const bq = (name: string) => `\`${name.replace(/`/g, '')}\``

/** The dry run's script: every open entry of the showcase database gets the first option of another select. */
function dryRunCode(): string | null {
  const pick = showcaseDatabase()
  if (!pick) return null
  const props = pick.db.properties
  const status: PropertyDef | undefined = props.find((p) => p.type === 'status') ?? props.find((p) => p.type === 'select')
  const other = props.find((p) => p.type === 'select' && p.id !== status?.id)
  if (!status || !other?.options?.length) return null
  const opts = status.options ?? []
  const done = (opts.find((o) => o.group === 'done') ?? opts[opts.length - 1])?.name ?? 'Done'
  const ref = `@[${(pick.page.title.trim() || 'Untitled').replace(/[\]\\]/g, (c) => `\\${c}`)}](p:${pick.page.id})`
  return `let open = db(${ref}).where(${bq(status.name)} != ${JSON.stringify(done)})\nfor e in open {\n  e.set(${bq(other.name)}: ${JSON.stringify(other.options[0].name)})\n}\n`
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'slash',
    enter: async () => {
      // the caret waits on the empty line — without taking the keyboard from the placard (← → keep stepping)
      const at = await openTourPage()
      if (!at?.editor) return
      at.editor.commands.setTextSelection(emptyLine(at.editor))
    },
    target: () => first('.slash') ?? emptyLineEl() ?? first('#main .pv-content .ProseMirror [data-type="taskList"]', '#main .pv-content .ProseMirror'),
    act: async () => {
      const at = await openTourPage()
      const ed = at?.editor
      if (!ed) return
      ed.chain().focus().setTextSelection(emptyLine(ed)).run()
      await typeInto(ed, '/todo', 110)
      await sleep(650)
      if (ed.isDestroyed) return
      press(ed, 'Enter')
      await sleep(120)
      if (!ed.isDestroyed) await typeInto(ed, t('shell.tour.page.todo'), 25)
    },
  },
  {
    id: 'ai',
    needsKey: true,
    enter: async () => {
      await openTourPage()
    },
    target: () => {
      const panel = first('.ai-panel')
      if (panel) return panel
      const list = listEls()
      const bubble = first(`[aria-label="${t('editor.bubble.label')}"]`)
      return bubble ? [bubble, ...list] : list.length ? list : first('#main .pv-content .ProseMirror')
    },
    act: async ({ hasKey }) => {
      const at = await openTourPage()
      const ed = at?.editor
      if (!ed || !selectList(ed)) return
      await sleep(250)
      // with a key: Transform into → Diagram runs for real (a preview first; nothing changes before "Transform")
      if (hasKey) openAIPanel(ed, { mode: 'selection', transform: 'diagram' })
    },
    leave: () => {
      const ed = editorInMain()
      if (ed && !ed.isDestroyed && !ed.state.selection.empty) ed.view.dispatch(ed.state.tr.setSelection(TextSelection.near(ed.state.selection.$to)))
    },
  },
  {
    id: 'palette',
    key: 'Mod+K',
    target: () => first('.pal', '.sb-nav .sb-navrow'),
    act: () => useUI.getState().openPalette('>'),
    leave: () => {
      if (useUI.getState().paletteOpen) useUI.getState().closePalette()
    },
  },
  {
    id: 'database',
    enter: () => {
      const pick = showcaseDatabase()
      if (pick && mainPageId() !== pick.page.id) navigate({ name: 'page', id: pick.page.id })
    },
    target: () => first('#main .db-tabs', '#main .pv-content'),
    act: async () => {
      const pick = showcaseDatabase()
      if (!pick) return
      if (mainPageId() !== pick.page.id) {
        navigate({ name: 'page', id: pick.page.id })
        await sleep(400)
      }
      // the next board / timeline / calendar view after the one that shows
      const tabs = [...document.querySelectorAll<HTMLElement>('#main .db-tabs .db-tab')]
      const active = tabs.findIndex((el) => el.dataset.active === 'true')
      const views = pick.db.views
      const wanted = ['board', 'timeline', 'calendar', 'gallery']
      const order = views.map((v, i) => ({ v, i })).filter(({ v, i }) => i !== active && wanted.includes(v.type))
      const next = order.find(({ i }) => i > active) ?? order[0]
      tabs[next?.i ?? -1]?.querySelector<HTMLElement>('.db-tab__btn')?.click()
    },
  },
  {
    id: 'terminal',
    key: 'Mod+J',
    needsKey: true,
    target: () => first('section.term', '.status .term-cell'),
    act: () => openAgent(),
    leave: () => closeAgent(),
  },
  {
    id: 'history',
    enter: () => {
      const id = historyPage()
      if (id && mainPageId() !== id) navigate({ name: 'page', id })
    },
    target: () => first('.hist', `.tb-right button[aria-label="${t('shell.topbar.history')}"]`),
    act: () => {
      const id = historyPage()
      if (id) useUI.getState().openModal({ type: 'history', pageId: id })
    },
    leave: () => {
      if (useUI.getState().modal?.type === 'history') useUI.getState().closeModal()
    },
  },
  {
    id: 'scripts',
    enter: () => {
      if (parseHash(window.location.hash).name !== 'scripts') navigate({ name: 'scripts' })
    },
    target: () => first('#main .sc-gallery', '#main .sc-examples', '#main .sc-list', '#main .sc-head', '#main'),
    act: async () => {
      const code = dryRunCode()
      if (!code) return { note: t('shell.tour.scripts.none') }
      const res = await runScript({ code, mode: 'dry', name: t('shell.tour.scripts.name'), ui: silentScriptUI, record: false })
      if (res.status !== 'ok') return { note: t('shell.tour.scripts.none') }
      const n = res.changes.length
      return { note: t(n === 1 ? 'shell.tour.scripts.resultOne' : 'shell.tour.scripts.result', { n }) }
    },
  },
  {
    id: 'help',
    key: '?',
    target: () => first('.help', '.status .status__btn[aria-expanded]:last-of-type'),
    act: () => openHelp(),
    leave: () => closeHelp(),
  },
]

if (TOUR_STEPS.length !== TOUR_STEP_COUNT) console.warn('[one] tour: TOUR_STEP_COUNT is out of date')

/** The practice page's empty line (the slash step's place). */
function emptyLineEl(): HTMLElement | null {
  const root = document.querySelector('#main .pv-content .ProseMirror')
  if (!root) return null
  for (const p of root.querySelectorAll(':scope > p')) if (!p.textContent?.trim() && isShown(p)) return p as HTMLElement
  return null
}

/** The heading and the bullet list of the practice page (the AI step's blocks). */
function listEls(): HTMLElement[] {
  const root = document.querySelector('#main .pv-content .ProseMirror')
  if (!root) return []
  const lists = [...root.querySelectorAll<HTMLElement>(':scope > ul:not([data-type="taskList"]), :scope > ol')]
  const list = lists[lists.length - 1]
  if (!list) return []
  const prev = list.previousElementSibling
  return prev instanceof HTMLElement && /^H[1-3]$/.test(prev.tagName) ? [prev, list] : [list]
}

/** The main column's editor (the Tour page while its steps run). */
function editorInMain(): Editor | null {
  const dom = document.querySelector('#main .pv-content .ProseMirror') as (HTMLElement & { editor?: Editor }) | null
  return dom?.editor ?? null
}
