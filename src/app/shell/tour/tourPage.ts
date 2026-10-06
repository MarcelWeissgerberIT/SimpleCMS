/**
 * The tour's practice page ("Tour — try things here"): created on the first start (or reused while it lives),
 * offered for deletion at the end. The slash-menu and AI steps — and the matching "Try it" keys of
 * "What can One do?" — write in it, never in the person's own pages. Team workspaces: a private page.
 */
import type { Editor, JSONContent } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { useWorkspace } from '../../store/store'
import { isEffectivelyTrashed } from '../../store/selectors'
import type { ID } from '../../store/types'
import { useUI } from '../../store/ui'
import { createPrivatePage, useCloud } from '../../cloud'
import { liveEditorOf } from '../../editor'
import { t } from '../../i18n'
import { navigate } from '../../lib/router'
import { rememberTour, useTour } from './state'

const txt = (text: string): JSONContent => ({ type: 'text', text })
const para = (text = ''): JSONContent => (text ? { type: 'paragraph', content: [txt(text)] } : { type: 'paragraph' })

/** The page's starting content (the steps look for the empty line and the list). */
function tourDoc(): JSONContent {
  const item = (s: string): JSONContent => ({ type: 'listItem', content: [para(s)] })
  return {
    type: 'doc',
    content: [
      para(t('shell.tour.page.intro')),
      para(),
      { type: 'heading', attrs: { level: 3 }, content: [txt(t('shell.tour.page.heading'))] },
      { type: 'bulletList', content: [item(t('shell.tour.page.item1')), item(t('shell.tour.page.item2')), item(t('shell.tour.page.item3')), item(t('shell.tour.page.item4'))] },
      para(t('shell.tour.page.tip')),
    ],
  }
}

/** The Tour page if it still lives (not trashed). */
export function liveTourPage(): ID | null {
  const id = useTour.getState().memory.page
  const { pages } = useWorkspace.getState()
  return id && pages[id] && !isEffectivelyTrashed(pages, id) ? id : null
}

/** The Tour page — created when there is none. Null for viewers (they cannot write). */
export function ensureTourPage(): ID | null {
  const have = liveTourPage()
  if (have) return have
  const cloud = useCloud.getState()
  if (cloud.readOnly) return null
  const input = { title: t('shell.tour.page.title'), icon: { type: 'asset' as const, value: 'compass' }, content: tourDoc() }
  let id: ID
  try {
    // a team workspace: in my Private section (nobody else needs the practice page)
    id = cloud.active.kind === 'cloud' ? createPrivatePage(input) : useWorkspace.getState().createPage(input)
  } catch {
    id = useWorkspace.getState().createPage(input)
  }
  rememberTour({ page: id })
  return id
}

/** "Delete the Tour page" at the end: to the trash, with Undo. */
export function trashTourPage(): void {
  const id = liveTourPage()
  if (!id) return
  const ws = useWorkspace.getState()
  const title = ws.pages[id]?.title ?? ''
  ws.trashPage(id)
  rememberTour({ page: null })
  if (window.location.hash.startsWith(`#/p/${id}`)) navigate({ name: 'home' })
  useUI.getState().toast({
    message: t('shell.tour.finish.deleted', { title }),
    kind: 'success',
    action: {
      label: t('common.undo'),
      run: () => {
        useWorkspace.getState().restorePage(id)
        rememberTour({ page: id })
      },
    },
  })
}

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms))

/** The page's mounted, editable editor — waited for while the page opens (null after ~3 s). */
export async function editorOf(pageId: ID): Promise<Editor | null> {
  for (let i = 0; i < 60; i++) {
    const ed = liveEditorOf(pageId)
    if (ed && !ed.isDestroyed && ed.isEditable) return ed
    await sleep(50)
  }
  return null
}

/** Open the Tour page (created when needed); resolves with its editor. */
export async function openTourPage(): Promise<{ id: ID; editor: Editor | null } | null> {
  const id = ensureTourPage()
  if (!id) return null
  if (!window.location.hash.startsWith(`#/p/${id}`)) navigate({ name: 'page', id })
  return { id, editor: await editorOf(id) }
}

/** The first empty line of the page (one is added after the intro when there is none). */
export function emptyLine(editor: Editor): number {
  let at = -1
  editor.state.doc.forEach((node, pos) => {
    if (at < 0 && node.type.name === 'paragraph' && node.content.size === 0) at = pos + 1
  })
  if (at >= 0) return at
  const first = editor.state.doc.firstChild
  const after = first ? first.nodeSize : 0
  editor.chain().insertContentAt(after, { type: 'paragraph' }).run()
  return after + 1
}

/** The heading and the list below it (the last list of the page) — the blocks the AI step selects. */
export function listRange(editor: Editor): { from: number; to: number } | null {
  let list: { from: number; to: number } | null = null
  let heading = -1
  editor.state.doc.forEach((node, pos) => {
    if (node.type.name === 'heading') heading = pos
    if (node.type.name === 'bulletList' || node.type.name === 'orderedList' || node.type.name === 'taskList') list = { from: heading >= 0 && heading < pos ? heading : pos, to: pos + node.nodeSize }
  })
  return list
}

/** Select the heading and its list (the bubble toolbar shows; the AI panel acts on it). */
export function selectList(editor: Editor): boolean {
  const r = listRange(editor)
  if (!r) return false
  const { state } = editor
  const sel = TextSelection.between(state.doc.resolve(r.from + 1), state.doc.resolve(Math.max(r.from + 1, r.to - 1)))
  editor.view.dispatch(state.tr.setSelection(sel).scrollIntoView())
  editor.view.focus()
  return true
}
