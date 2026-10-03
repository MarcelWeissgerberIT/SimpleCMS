/**
 * PageEditor — the TipTap block editor bound to one page in the workspace store.
 *  - initial content from page.content; debounced writes via setContent(…, instanceId)
 *  - applies external updates (history restore, AI, other panes) without echo
 *  - overlays: drag handle + block menu, slash menu, bubble toolbar, mention/emoji, AI …
 */
import { useCallback, useEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor, JSONContent } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Selection, TextSelection } from '@tiptap/pm/state'
import type { ID } from '../store/types'
import { useWorkspace } from '../store/store'
import { navigate, pageHref, useRoute } from '../lib/router'
import { newId } from '../lib/ids'
import { createBridge, type Bridge } from './lib/bridge'
import { editorExtensions } from './extensions/kit'
import { findBlockById, flashBlock } from './extensions/behaviors'
import { sanitize, withBlockIds } from './convert'
import { EditorOverlays } from './menus/EditorOverlays'
import { Comments } from './comments/CommentsRail'
import './editor.css'

export interface PageEditorProps {
  pageId: ID
  readOnly?: boolean
  autoFocus?: boolean
  /** Called with the TipTap editor instance once created. */
  onReady?: (editor: Editor) => void
  className?: string
}

const SAVE_DELAY = 300

/* ------------------------------------------------------------------ */
/* Mod+K with a text selection = link (Notion). The global palette     */
/* listens for ⌘K in the capture phase on window; this listener is     */
/* registered at module load (before the shell mounts), so it runs     */
/* first and only claims the key when an editor has something to link. */
/* ------------------------------------------------------------------ */

const modKHandlers = new WeakMap<Element, () => boolean>()

function onModKCapture(e: KeyboardEvent) {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.code !== 'KeyK' || e.isComposing) return
  const dom = (e.target as HTMLElement | null)?.closest?.('.ProseMirror')
  const handler = dom ? modKHandlers.get(dom) : undefined
  if (handler?.()) {
    e.preventDefault()
    e.stopImmediatePropagation()
  }
}

/* ------------------------------------------------------------------ */
/* Unload: flush every mounted editor BEFORE the persistence layer     */
/* saves. Listeners on window run in registration order, and this      */
/* module is evaluated before boot() starts persistence.               */
/* ------------------------------------------------------------------ */

const unloadFlushers = new Set<() => void>()
const flushAllEditors = () => unloadFlushers.forEach((f) => f())

if (typeof window !== 'undefined') {
  const w = window as Window & { __oneEditorModK?: (e: KeyboardEvent) => void; __oneEditorUnload?: () => void }
  if (w.__oneEditorModK) window.removeEventListener('keydown', w.__oneEditorModK, true)
  w.__oneEditorModK = onModKCapture
  window.addEventListener('keydown', onModKCapture, true)
  if (w.__oneEditorUnload) {
    window.removeEventListener('beforeunload', w.__oneEditorUnload)
    window.removeEventListener('pagehide', w.__oneEditorUnload)
  }
  w.__oneEditorUnload = flushAllEditors
  window.addEventListener('beforeunload', flushAllEditors)
  window.addEventListener('pagehide', flushAllEditors)
}

function linkShortcut(editor: Editor, bridge: Bridge): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false
  const { selection } = editor.state
  if (selection.$from.parent.type.spec.code) return false
  const onLink = editor.isActive('link')
  if (selection.empty && !onLink) return false
  if (selection.empty) editor.commands.extendMarkRange('link')
  bridge.setState({ linkEdit: true })
  return true
}

/* ------------------------------------------------------------------ */
/* External updates: patch only the changed range, so the caret, node  */
/* views and undo history of untouched blocks survive.                 */
/* ------------------------------------------------------------------ */

function blockAnchor(doc: PMNode, pos: number): { id: string; offset: number } | null {
  const $pos = doc.resolve(pos)
  for (let d = $pos.depth; d > 0; d--) {
    const id = $pos.node(d).attrs.id as string | undefined
    if (id) return { id, offset: pos - $pos.before(d) }
  }
  return null
}

function findById(doc: PMNode, id: string): { pos: number; node: PMNode } | null {
  let hit: { pos: number; node: PMNode } | null = null
  doc.descendants((node, pos) => {
    if (hit) return false
    if (node.attrs.id === id) {
      hit = { pos, node }
      return false
    }
    return !node.isTextblock
  })
  return hit
}

export function applyExternalContent(editor: Editor, json: JSONContent): void {
  const { state } = editor
  let next: PMNode
  try {
    next = state.schema.nodeFromJSON(json)
    next.check()
  } catch {
    return
  }
  const start = state.doc.content.findDiffStart(next.content)
  if (start == null) return
  let tr = state.tr
  try {
    let { a: endA, b: endB } = state.doc.content.findDiffEnd(next.content)!
    const overlap = start - Math.min(endA, endB)
    if (overlap > 0) {
      endA += overlap
      endB += overlap
    }
    tr.replace(start, endA, next.slice(start, endB))
    if (!tr.doc.eq(next)) throw new Error('diff patch mismatch')
  } catch {
    // structural fallback: replace everything, restore the caret by block id + offset
    const anchor = blockAnchor(state.doc, state.selection.from)
    tr = state.tr.replaceWith(0, state.doc.content.size, next.content)
    const hit = anchor ? findById(tr.doc, anchor.id) : null
    try {
      if (hit && anchor) {
        const p = Math.min(hit.pos + anchor.offset, hit.pos + hit.node.nodeSize - 1)
        const $p = tr.doc.resolve(p)
        tr.setSelection($p.parent.inlineContent ? TextSelection.create(tr.doc, p) : Selection.near($p))
      } else tr.setSelection(Selection.near(tr.doc.resolve(Math.min(state.selection.from, tr.doc.content.size))))
    } catch {
      /* keep the mapped selection */
    }
  }
  tr.setMeta('addToHistory', false).setMeta('preventUpdate', true)
  editor.view.dispatch(tr)
}

/** The page whose content holds a block id (a block moved with "Move to" keeps its id). */
function pageOwningBlock(blockId: string, except: string): string | null {
  const has = (n: JSONContent): boolean => n.attrs?.id === blockId || !!n.content?.some(has)
  for (const p of Object.values(useWorkspace.getState().pages)) {
    if (p.id !== except && !p.trashed && p.content && has(p.content)) return p.id
  }
  return null
}

/** Changed range between two docs: [start, endA) in `a` became [start, endB) in `b`; null when equal. */
function diffRange(a: PMNode, b: PMNode): { start: number; endA: number; endB: number } | null {
  const start = a.content.findDiffStart(b.content)
  if (start == null) return null
  let { a: endA, b: endB } = a.content.findDiffEnd(b.content)!
  const overlap = start - Math.min(endA, endB)
  if (overlap > 0) {
    endA += overlap
    endB += overlap
  }
  return { start, endA, endB }
}

/**
 * An external write arrived while this editor still had unsaved typing. Three-way merge on the
 * simplest level: when "their" change (base → theirs) and "our" change (base → editor) touch
 * different ranges, apply theirs onto ours. Returns false when they overlap (caller lets theirs win).
 */
function mergeExternal(editor: Editor, baseJson: JSONContent, theirsJson: JSONContent): boolean {
  const { state } = editor
  let base: PMNode
  let theirs: PMNode
  try {
    base = state.schema.nodeFromJSON(baseJson)
    theirs = state.schema.nodeFromJSON(theirsJson)
  } catch {
    return false
  }
  const t = diffRange(base, theirs)
  if (!t) return true
  const o = diffRange(base, state.doc)
  if (!o) return false
  if (!(t.endA <= o.start || t.start >= o.endA)) return false
  const shift = t.start >= o.endA ? o.endB - o.endA : 0
  try {
    const tr = state.tr.replace(t.start + shift, t.endA + shift, theirs.slice(t.start, t.endB))
    editor.view.dispatch(tr.setMeta('addToHistory', false).setMeta('preventUpdate', true))
    return true
  } catch {
    return false
  }
}

export function PageEditor(props: PageEditorProps) {
  // A fresh editor per page keeps undo history and plugins page-scoped.
  return <EditorInstance key={props.pageId} {...props} />
}

/** Sanitised content with block ids filled in (ids missing → persist once after mount). */
function prepareContent(c: JSONContent | null | undefined): { doc: JSONContent | undefined; idsAdded: boolean } {
  if (!c) return { doc: undefined, idsAdded: false }
  const { doc, changed } = withBlockIds(sanitize(c))
  return { doc, idsAdded: changed }
}

function EditorInstance({ pageId, readOnly, autoFocus, onReady, className }: PageEditorProps) {
  const instanceId = useMemo(() => `editor:${newId()}`, [])
  const bridge = useMemo(() => createBridge(), [])
  const locked = useWorkspace((s) => !!s.pages[pageId]?.settings.locked)
  const font = useWorkspace((s) => s.pages[pageId]?.settings.font ?? 'sans')
  const small = useWorkspace((s) => !!s.pages[pageId]?.settings.smallText)
  const spellcheck = useWorkspace((s) => s.settings.spellcheck)
  const editable = !readOnly && !locked

  const lastRev = useRef(useWorkspace.getState().pages[pageId]?.contentRev ?? 0)
  const dirty = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  /** The mounted editor. Never assigned from onCreate: under StrictMode a discarded twin also emits 'create'. */
  const editorRef = useRef<Editor | null>(null)
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  const flush = useCallback(() => {
    window.clearTimeout(timer.current)
    const ed = editorRef.current
    if (!dirty.current || !ed) return
    dirty.current = false
    let json: JSONContent
    try {
      json = ed.getJSON()
    } catch {
      return
    }
    const ws = useWorkspace.getState()
    if (!ws.pages[pageId]) return
    ws.setContent(pageId, json, instanceId)
    lastRev.current = useWorkspace.getState().pages[pageId]?.contentRev ?? lastRev.current
  }, [pageId, instanceId])

  // the page title is the one <h1>: heading blocks render as <h2>–<h4> beneath it
  const extensions = useMemo(() => editorExtensions({ bridge, headingOffset: 1 }), [bridge])
  const initial = useMemo(() => prepareContent(useWorkspace.getState().pages[pageId]?.content), [pageId])

  const editor = useEditor(
    {
      extensions,
      content: initial.doc,
      editable,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      autofocus: autoFocus ? 'start' : false,
      editorProps: {
        attributes: { class: 'doc-content', spellcheck: String(spellcheck), 'data-page-id': pageId },
      },
      onCreate: ({ editor: ed }) => {
        // persist freshly generated block ids once, so block links stay valid
        if (initial.idsAdded && ed === editorRef.current && ed.isEditable) {
          dirty.current = true
          timer.current = window.setTimeout(flush, 1500)
        }
      },
      onUpdate: ({ editor: ed }) => {
        if (!ed.isEditable || ed.isDestroyed) return
        editorRef.current = ed
        dirty.current = true
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(flush, SAVE_DELAY)
      },
      onBlur: ({ editor: ed }) => {
        if (!ed.isDestroyed) editorRef.current = ed
        flush()
      },
    },
    [],
  )
  editorRef.current = editor

  useEffect(() => {
    if (editor && !editor.isDestroyed) onReadyRef.current?.(editor)
  }, [editor])

  // editable / spellcheck follow page + settings
  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable, false)
  }, [editor, editable])
  useEffect(() => {
    editor?.view.dom.setAttribute('spellcheck', String(spellcheck))
  }, [editor, spellcheck])

  // Mod+K → link editor (see onModKCapture)
  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom
    modKHandlers.set(dom, () => linkShortcut(editor, bridge))
    return () => {
      modKHandlers.delete(dom)
    }
  }, [editor, bridge])

  // external content updates (history restore, AI, other editor instances …)
  useEffect(() => {
    if (!editor) return
    return useWorkspace.subscribe((s, prev) => {
      const p = s.pages[pageId]
      if (!p || p === prev.pages[pageId]) return
      if (p.contentRev === lastRev.current) return
      lastRev.current = p.contentRev
      if (p.contentOrigin === instanceId || editor.isDestroyed) return
      const theirs = prepareContent(p.content).doc ?? { type: 'doc', content: [{ type: 'paragraph' }] }
      // unsaved local typing + a write elsewhere in the doc (AI append, another pane …): keep both
      const base = prev.pages[pageId]?.content
      if (dirty.current && base && mergeExternal(editor, prepareContent(base).doc!, theirs)) {
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(flush, SAVE_DELAY)
        return
      }
      window.clearTimeout(timer.current)
      dirty.current = false
      applyExternalContent(editor, theirs)
    })
  }, [editor, pageId, instanceId, flush])

  // flush on unload (module-level listener, see flushAllEditors) / tab hide / unmount
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && flush()
    unloadFlushers.add(flush)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      unloadFlushers.delete(flush)
      document.removeEventListener('visibilitychange', onHide)
      flush()
    }
  }, [flush])

  // ?b=<blockId> → scroll to + flash the block
  const route = useRoute()
  const targetBlock = route.name === 'page' && route.id === pageId ? route.block : undefined
  useEffect(() => {
    if (!editor || !targetBlock) return
    const t = window.setTimeout(() => {
      const pos = findBlockById(editor, targetBlock)
      if (pos !== null) return flashBlock(editor, pos)
      // the block moved to another page since the link was copied: follow it there
      const owner = pageOwningBlock(targetBlock, pageId)
      if (owner) navigate(pageHref(owner, targetBlock), { replace: true })
    }, 160)
    return () => window.clearTimeout(t)
  }, [editor, targetBlock, pageId])

  // clicking the empty area under the last block focuses (or creates) a trailing line
  const onTailDown = (e: ReactMouseEvent) => {
    if (!editor || !editor.isEditable) return
    e.preventDefault()
    const { doc } = editor.state
    const last = doc.lastChild
    if (last && last.type.name === 'paragraph' && last.content.size === 0) {
      editor.chain().focus().setTextSelection(doc.content.size - 1).run()
    } else {
      editor.chain().focus().insertContentAt(doc.content.size, { type: 'paragraph' }).setTextSelection(doc.content.size + 1).run()
    }
  }

  const classes = ['one-editor', `doc--font-${font}`, small ? 'doc--small' : '', editable ? 'is-editable' : 'is-readonly', className ?? '']
  return (
    <div className={classes.filter(Boolean).join(' ')} data-instance={instanceId}>
      {editor && <Comments editor={editor} bridge={bridge} pageId={pageId} />}
      <EditorContent editor={editor} className="one-editor__content" />
      {editable && <div className="one-editor__tail" onMouseDown={onTailDown} aria-hidden />}
      {editor && editable && <EditorOverlays editor={editor} bridge={bridge} pageId={pageId} />}
    </div>
  )
}
