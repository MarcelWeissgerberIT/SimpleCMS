/**
 * Writing into a meeting block. Through its editor when one is mounted (a proper transaction:
 * runtime writes stay out of the undo history, the generated notes are one undo step), else
 * through the store — setContent(…, 'meeting') — when the page is no longer open.
 */
import type { Editor, JSONContent } from '@tiptap/core'
import { Fragment } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import { findMeeting, meetingAttrs, MEETING, type MeetingAttrs } from '../../../editor'
import { useWorkspace } from '../../../store/store'

export interface MeetingTarget {
  blockId: string
  pageId: string | null
  editor: Editor | null
}

export type MeetingPatch = Partial<Omit<MeetingAttrs, 'id'>>
type PatchArg = MeetingPatch | ((a: MeetingAttrs) => MeetingPatch | null)

const alive = (e: Editor | null): e is Editor => !!e && !e.isDestroyed

/** The page id an editor is bound to (PageEditor sets data-page-id). */
export function editorPageId(editor: Editor): string | null {
  try {
    return (editor.view.dom as HTMLElement).getAttribute('data-page-id')
  } catch {
    return null
  }
}

/** Map the meeting node with this id inside a JSON doc (null when it is not there). */
function mapJson(doc: JSONContent, blockId: string, fn: (n: JSONContent) => JSONContent): JSONContent | null {
  let hit = false
  const walk = (n: JSONContent): JSONContent => {
    if (hit) return n
    if (n.type === MEETING && n.attrs?.id === blockId) {
      hit = true
      return fn(n)
    }
    if (!n.content) return n
    const kids = n.content.map(walk)
    return kids.some((k, i) => k !== n.content![i]) ? { ...n, content: kids } : n
  }
  const next = walk(doc)
  return hit ? next : null
}

/** Current attrs + notes of the block (editor first, then the stored page). */
export function readMeeting(target: MeetingTarget): { attrs: MeetingAttrs; notes: JSONContent[] } | null {
  if (alive(target.editor)) {
    const hit = findMeeting(target.editor.state.doc, target.blockId)
    if (hit) return { attrs: meetingAttrs(hit.node), notes: (hit.node.content.toJSON() as JSONContent[] | null) ?? [] }
  }
  const page = target.pageId ? useWorkspace.getState().pages[target.pageId] : null
  let found: { attrs: MeetingAttrs; notes: JSONContent[] } | null = null
  if (page?.content)
    mapJson(page.content, target.blockId, (n) => {
      found = { attrs: meetingAttrs(n), notes: n.content ?? [] }
      return n
    })
  return found
}

/** Change attrs (outside the undo history unless `history`). False when the block is gone. */
export function patchMeeting(target: MeetingTarget, patch: PatchArg, opts: { history?: boolean } = {}): boolean {
  const resolve = (a: MeetingAttrs) => (typeof patch === 'function' ? patch(a) : patch)
  if (alive(target.editor)) {
    const { editor } = target
    const hit = findMeeting(editor.state.doc, target.blockId)
    if (hit) {
      const p = resolve(meetingAttrs(hit.node))
      if (!p) return true
      const tr = editor.state.tr
      for (const [k, v] of Object.entries(p)) tr.setNodeAttribute(hit.pos, k, v)
      if (!opts.history) tr.setMeta('addToHistory', false)
      editor.view.dispatch(tr)
      return true
    }
    if (editorPageId(editor) === target.pageId) return false
  }
  const ws = useWorkspace.getState()
  const page = target.pageId ? ws.pages[target.pageId] : null
  if (!page?.content) return false
  let skip = false
  const next = mapJson(page.content, target.blockId, (n) => {
    const p = resolve(meetingAttrs(n))
    if (!p) {
      skip = true
      return n
    }
    return { ...n, attrs: { ...n.attrs, ...p } }
  })
  if (!next) return false
  if (!skip) ws.setContent(page.id, next, 'meeting')
  return true
}

/**
 * Put generated notes into the block — one undo step with the attrs patch. 'replace' swaps the
 * whole notes area, 'prepend' keeps what the user typed during the meeting below.
 */
export function writeNotes(target: MeetingTarget, blocks: JSONContent[], patch: MeetingPatch, mode: 'replace' | 'prepend'): boolean {
  if (alive(target.editor)) {
    const { editor } = target
    const hit = findMeeting(editor.state.doc, target.blockId)
    if (hit) {
      let frag: Fragment
      try {
        frag = Fragment.fromArray(blocks.map((b) => editor.schema.nodeFromJSON(b)))
      } catch (err) {
        console.warn('[meeting] invalid notes', err)
        return false
      }
      const start = hit.pos + 1
      const tr = editor.state.tr
      if (mode === 'replace') tr.replaceWith(start, hit.pos + hit.node.nodeSize - 1, frag)
      else tr.insert(start, frag)
      for (const [k, v] of Object.entries(patch)) tr.setNodeAttribute(hit.pos, k, v)
      editor.view.dispatch(closeHistory(tr))
      return true
    }
    if (editorPageId(editor) === target.pageId) return false
  }
  const ws = useWorkspace.getState()
  const page = target.pageId ? ws.pages[target.pageId] : null
  if (!page?.content) return false
  const next = mapJson(page.content, target.blockId, (n) => ({
    ...n,
    attrs: { ...n.attrs, ...patch },
    content: mode === 'replace' ? blocks : [...blocks, ...(n.content ?? [])],
  }))
  if (!next) return false
  ws.setContent(page.id, next, 'ai')
  return true
}
