/**
 * PageEditor — the TipTap block editor bound to one page in the workspace store.
 *  - initial content from page.content; debounced writes via setContent(…, instanceId)
 *  - applies external updates (history restore, AI, other panes) without echo
 *  - overlays: drag handle + block menu, slash menu, bubble toolbar, mention/emoji, AI …
 *  - team cloud: bound to the page's Y document instead (collab.ts) — no initial content, no
 *    setContent for its own edits (the cloud area keeps page.content fresh), Y undo, carets
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor, JSONContent } from '@tiptap/core'
import { Mark, type Node as PMNode } from '@tiptap/pm/model'
import { Selection, TextSelection, type Transaction } from '@tiptap/pm/state'
import { ySyncPluginKey } from '@tiptap/y-tiptap'
import type { ID } from '../store/types'
import { useWorkspace } from '../store/store'
import { inPersonEvent, reportFallback, withWriter, type Writer } from '../store/writer'
import { navigate, pageHref, useRoute } from '../lib/router'
import { newId } from '../lib/ids'
import { createBridge, type Bridge } from './lib/bridge'
import { editorExtensions } from './extensions/kit'
import { findBlockById, flashBlock } from './extensions/behaviors'
import { sanitize, withBlockIds } from './convert'
import { liftMisplacedItems } from './workitem/place'
import { EditorOverlays } from './menus/EditorOverlays'
import { Comments } from './comments/CommentsRail'
import { ContextPicker } from './context/ContextPicker'
import { registerBridge } from './context/redo'
import { acquireContentDoc, flushPageContent, releaseContentDoc, useCloud, type ContentDocHandle } from '../cloud'
import { inEditAs, NORMALISE_META, PERSON_META, registerEditorFlush } from './lib/editAs'
import { useT } from '../i18n'
import { ReadOnlyDoc } from './ReadOnlyDoc'
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
/* The writer net (DEV / ?e2e, flight recorder): a transaction that    */
/* changed the document outside a user event, outside editAs, not from */
/* Y sync and not marked as a normalisation reaches the store with the */
/* editor's flush as "typed" — that flush is reported (store/writer).  */
/* ------------------------------------------------------------------ */

const NET = (() => {
  try {
    return import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e')
  } catch {
    return false
  }
})()
/** Events of the person on an editor (capture): a change read from the DOM shortly after one of them is theirs. */
const INPUT_EVENTS = ['keydown', 'keypress', 'beforeinput', 'input', 'compositionstart', 'compositionend', 'paste', 'cut', 'drop', 'dragend', 'pointerdown', 'mousedown', 'mouseup', 'click', 'touchend'] as const
/** ProseMirror reads some DOM changes a little later (flushSoon, compositions). */
const INPUT_WINDOW_MS = 150
/** The e2e driver's own frames (page.evaluate): a transaction dispatched straight from a spec. */
const TEST_DRIVER = /\bUtilityScript\.evaluate\b/

/** Two documents that differ at most in block ids (UniqueID filling them in is a normalisation). */
function sameButIds(a: PMNode, b: PMNode): boolean {
  if (a === b) return true
  if (a.type !== b.type || a.childCount !== b.childCount || a.text !== b.text || !Mark.sameSet(a.marks, b.marks)) return false
  for (const k of new Set([...Object.keys(a.attrs), ...Object.keys(b.attrs)])) {
    const x = a.attrs[k]
    const y = b.attrs[k]
    if (k !== 'id' && x !== y && JSON.stringify(x) !== JSON.stringify(y)) return false
  }
  for (let i = 0; i < a.childCount; i++) if (!sameButIds(a.child(i), b.child(i))) return false
  return true
}

/** Did this transaction come from somewhere the flush cannot name (no user event, no editAs, no Y sync, no normalisation)? */
function untrackedChange(tr: Transaction, lastInput: number): boolean {
  if (!tr.docChanged || inEditAs()) return false
  if (tr.getMeta(NORMALISE_META) || tr.getMeta(PERSON_META) || tr.getMeta(ySyncPluginKey) || tr.getMeta('uiEvent')) return false
  const ev = (window as unknown as { event?: Event }).event
  if (ev?.isTrusted || inPersonEvent() || performance.now() - lastInput <= INPUT_WINDOW_MS) return false
  return !sameButIds(tr.before, tr.doc)
}

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

/**
 * Every mounted page editor's pending typing into the store now — each flush its own write, under its editor's frame
 * (the flight recorder's eject runs it before it plans and again right before it writes: unsaved typing must reach
 * the store first, never be overwritten by an external apply). Nothing pending: nothing.
 */
export function flushOpenEditors(): void {
  flushAllEditors()
}

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
  // (A tab shows one workspace for its whole life: switching workspaces reloads the app.)
  if (useCloud.getState().active.kind === 'cloud') return <CloudEditor key={props.pageId} {...props} />
  return <EditorInstance key={props.pageId} {...props} />
}

/** How long a page document may take before the page shows its last known text (read-only) meanwhile. */
const WAIT_SHOW_MS = 500

/**
 * Team cloud: hold the page's content document while mounted; render once its local copy is loaded. A
 * document that waits for the server (first open after an update, offline) shows the page's last known
 * text, read-only, with a line saying why.
 */
function CloudEditor(props: PageEditorProps) {
  const [handle, setHandle] = useState<ContentDocHandle | null>(null)
  const [unbound, setUnbound] = useState(false)
  const [slow, setSlow] = useState(false)
  const { pageId } = props
  useEffect(() => {
    const h = acquireContentDoc(pageId)
    if (!h) {
      setUnbound(true)
      return
    }
    let alive = true
    const show = () => alive && setHandle(h)
    h.ready.then(show, show)
    const timer = window.setTimeout(() => alive && setSlow(true), WAIT_SHOW_MS)
    return () => {
      alive = false
      window.clearTimeout(timer)
      setHandle(null)
      setSlow(false)
      releaseContentDoc(pageId)
    }
  }, [pageId])
  if (unbound) return <EditorInstance {...props} />
  if (!handle) return slow ? <WaitingDoc pageId={pageId} className={props.className} /> : <div className={['one-editor', 'is-loading', props.className ?? ''].filter(Boolean).join(' ')} aria-busy="true" />
  return <EditorInstance {...props} collab={handle} />
}

/** Plain text as paragraphs (one per line) — what is known of a page whose content this device never had. */
function textDoc(plain: string): JSONContent | null {
  const lines = plain.split('\n').filter((l) => l.trim())
  return lines.length ? { type: 'doc', content: lines.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) } : null
}

/** The page's last known text while its document waits for the server (its content, else its search text). */
function WaitingDoc({ pageId, className }: { pageId: ID; className?: string }) {
  const t = useT()
  const stored = useWorkspace((s) => s.pages[pageId]?.content ?? null)
  const plain = useWorkspace((s) => s.pages[pageId]?.plain ?? '')
  const content = useMemo(() => stored ?? textDoc(plain), [stored, plain])
  const offline = useCloud((s) => s.status === 'offline')
  // a viewer (or an outdated tab) reads only: the line never promises editing
  const ro = useCloud((s) => s.readOnly)
  const line = offline ? (ro ? 'editor.wait.offline.ro' : 'editor.wait.offline') : ro ? 'editor.wait.loading.ro' : 'editor.wait.loading'
  return (
    <div className={['one-editor', 'is-waiting', className ?? ''].filter(Boolean).join(' ')} aria-busy="true" data-testid="waiting-doc">
      <p className="one-editor__wait" role="status">
        <span className="label">{t(offline ? 'editor.wait.offline.label' : 'editor.wait.loading.label')}</span>
        <span>{t(line)}</span>
      </p>
      {content && <ReadOnlyDoc content={content} headingOffset={1} />}
    </div>
  )
}

/** Sanitised content with block ids filled in (ids missing, or a misplaced task moved out → persist once after mount). */
function prepareContent(c: JSONContent | null | undefined): { doc: JSONContent | undefined; idsAdded: boolean } {
  if (!c) return { doc: undefined, idsAdded: false }
  const lifted = liftMisplacedItems(c)
  const { doc, changed } = withBlockIds(sanitize(lifted))
  return { doc, idsAdded: changed || lifted !== c }
}

function EditorInstance({ pageId, readOnly, autoFocus, onReady, className, collab }: PageEditorProps & { collab?: ContentDocHandle }) {
  /** The editor's writer id (store/writer.ts); `editor:<id>` = its content origin. */
  const editorKey = useMemo(() => newId(), [])
  const instanceId = `editor:${editorKey}`
  const bridge = useMemo(() => createBridge(), [])
  const locked = useWorkspace((s) => !!s.pages[pageId]?.settings.locked)
  const font = useWorkspace((s) => s.pages[pageId]?.settings.font ?? 'sans')
  const small = useWorkspace((s) => !!s.pages[pageId]?.settings.smallText)
  const spellcheck = useWorkspace((s) => s.settings.spellcheck)
  // viewers (and a revoked membership) read only
  const cloudReadOnly = useCloud((s) => !!collab && s.readOnly)
  const editable = !readOnly && !locked && !cloudReadOnly

  const lastRev = useRef(useWorkspace.getState().pages[pageId]?.contentRev ?? 0)
  const dirty = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  /** The mounted editor. Never assigned from onCreate: under StrictMode a discarded twin also emits 'create'. */
  const editorRef = useRef<Editor | null>(null)
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  /** The net (DEV / ?e2e): when the person last used this editor, and a change nobody named since the last flush. */
  const lastInput = useRef(0)
  const untracked = useRef<string | null>(null)

  /** Hand the editor's document to the store: as `writer`'s write (editAs), else as this editor's (the person typing). */
  const flush = useCallback(
    (writer?: Writer) => {
      window.clearTimeout(timer.current)
      const ed = editorRef.current
      if (!dirty.current || !ed) return
      dirty.current = false
      const stray = untracked.current
      untracked.current = null
      let json: JSONContent
      try {
        json = ed.getJSON()
      } catch {
        return
      }
      const ws = useWorkspace.getState()
      if (!ws.pages[pageId]) return
      if (!writer && stray !== null) reportFallback('editor', [`p:${pageId}`], stray)
      withWriter(writer ?? { kind: 'editor', id: editorKey }, () => ws.setContent(pageId, json, instanceId))
      lastRev.current = useWorkspace.getState().pages[pageId]?.contentRev ?? lastRev.current
    },
    [pageId, instanceId, editorKey],
  )

  // the page title is the one <h1>: heading blocks render as <h2>–<h4> beneath it
  const extensions = useMemo(() => editorExtensions({ bridge, headingOffset: 1, collab }), [bridge])
  // collaboration: the content comes from the Y document, not the store
  const initial = useMemo(() => (collab ? { doc: undefined, idsAdded: false } : prepareContent(useWorkspace.getState().pages[pageId]?.content)), [pageId])

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
          timer.current = window.setTimeout(() => flush(), 1500)
        }
      },
      onUpdate: ({ editor: ed, transaction }) => {
        // collaboration: the Y document is the copy; the cloud area refreshes page.content
        if (collab || !ed.isEditable || ed.isDestroyed) return
        editorRef.current = ed
        dirty.current = true
        if (NET && untracked.current === null && untrackedChange(transaction, lastInput.current)) {
          const limit = Error.stackTraceLimit
          Error.stackTraceLimit = 40
          const stack = new Error().stack ?? ''
          Error.stackTraceLimit = limit
          // a spec driving the editor itself (Playwright's evaluate) stands in for the person, like the test hook's store
          if (!TEST_DRIVER.test(stack)) untracked.current = stack
        }
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => flush(), SAVE_DELAY)
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

  // writes applied through this editor under their writer (editAs): its flush, or the content document's refresh
  useEffect(() => (editor ? registerEditorFlush(editor, collab ? (w) => flushPageContent(pageId, w) : flush) : undefined), [editor, collab, pageId, flush])

  // the net (DEV / ?e2e): the person's own input on this editor
  useEffect(() => {
    if (!NET || !editor || editor.isDestroyed) return
    const dom = editor.view.dom
    // (synthetic ones too: in DEV / e2e the test driver's events stand in for the person's, store/writer.ts inPersonEvent)
    const note = () => {
      lastInput.current = performance.now()
    }
    INPUT_EVENTS.forEach((t) => dom.addEventListener(t, note, true))
    return () => INPUT_EVENTS.forEach((t) => dom.removeEventListener(t, note, true))
  }, [editor])

  // "Redo with instructions" from outside the page (block menu, AI terminal) opens this editor's AI panel
  useEffect(() => (editor ? registerBridge(editor, bridge) : undefined), [editor, bridge])

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
  // collaboration: they reach the Y document (cloud bridge) and arrive like anyone's edits
  useEffect(() => {
    if (!editor || collab) return
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
        timer.current = window.setTimeout(() => flush(), SAVE_DELAY)
        return
      }
      window.clearTimeout(timer.current)
      dirty.current = false
      applyExternalContent(editor, theirs)
    })
  }, [editor, pageId, instanceId, flush, collab])

  // flush on unload (module-level listener, see flushAllEditors) / tab hide / unmount
  useEffect(() => {
    const own = () => flush()
    const onHide = () => document.visibilityState === 'hidden' && flush()
    unloadFlushers.add(own)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      unloadFlushers.delete(own)
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
      {/* what Claude may read: the picker (also on read-only pages — the AI terminal reads them too) */}
      {editor && <ContextPicker editor={editor} pageId={pageId} />}
    </div>
  )
}
