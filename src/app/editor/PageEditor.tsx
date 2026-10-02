/**
 * PageEditor — the TipTap block editor bound to one page in the workspace store.
 *  - initial content from page.content; debounced writes via setContent(…, instanceId)
 *  - applies external updates (history restore, AI, other panes) without echo
 *  - overlays: drag handle + block menu, slash menu, bubble toolbar, mention/emoji, AI …
 */
import { useCallback, useEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor, JSONContent } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import type { ID } from '../store/types'
import { useWorkspace } from '../store/store'
import { useRoute } from '../lib/router'
import { newId } from '../lib/ids'
import { createBridge } from './lib/bridge'
import { editorExtensions } from './extensions/kit'
import { sanitize } from './convert'
import { EditorOverlays } from './menus/EditorOverlays'
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

export function PageEditor(props: PageEditorProps) {
  // A fresh editor per page keeps undo history and plugins page-scoped.
  return <EditorInstance key={props.pageId} {...props} />
}

function initialContent(pageId: ID): JSONContent | undefined {
  const c = useWorkspace.getState().pages[pageId]?.content
  return c ? sanitize(c) : undefined
}

function EditorInstance({ pageId, readOnly, autoFocus, onReady, className }: PageEditorProps) {
  const instanceId = useMemo(() => `editor:${newId()}`, [])
  const bridge = useMemo(() => createBridge(pageId), [pageId])
  const locked = useWorkspace((s) => !!s.pages[pageId]?.settings.locked)
  const font = useWorkspace((s) => s.pages[pageId]?.settings.font ?? 'sans')
  const small = useWorkspace((s) => !!s.pages[pageId]?.settings.smallText)
  const spellcheck = useWorkspace((s) => s.settings.spellcheck)
  const editable = !readOnly && !locked

  const lastRev = useRef(useWorkspace.getState().pages[pageId]?.contentRev ?? 0)
  const dirty = useRef(false)
  const timer = useRef<number | undefined>(undefined)
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

  const extensions = useMemo(() => editorExtensions({ bridge }), [bridge])

  const editor = useEditor(
    {
      extensions,
      content: initialContent(pageId),
      editable,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      autofocus: autoFocus ? 'start' : false,
      editorProps: {
        attributes: { class: 'doc-content', spellcheck: String(spellcheck), 'data-page-id': pageId },
      },
      onCreate: ({ editor: ed }) => {
        editorRef.current = ed
        onReadyRef.current?.(ed)
      },
      onUpdate: ({ editor: ed }) => {
        if (!ed.isEditable) return
        dirty.current = true
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(flush, SAVE_DELAY)
      },
      onBlur: () => flush(),
    },
    [],
  )
  editorRef.current = editor

  // editable / spellcheck follow page + settings
  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable, false)
  }, [editor, editable])
  useEffect(() => {
    editor?.view.dom.setAttribute('spellcheck', String(spellcheck))
  }, [editor, spellcheck])

  // external content updates (history restore, AI, other editor instances …)
  useEffect(() => {
    if (!editor) return
    return useWorkspace.subscribe((s, prev) => {
      const p = s.pages[pageId]
      if (!p || p === prev.pages[pageId]) return
      if (p.contentRev === lastRev.current) return
      lastRev.current = p.contentRev
      if (p.contentOrigin === instanceId || editor.isDestroyed) return
      window.clearTimeout(timer.current)
      dirty.current = false
      const { from, to } = editor.state.selection
      editor.commands.setContent(p.content ? sanitize(p.content) : { type: 'doc', content: [{ type: 'paragraph' }] }, { emitUpdate: false })
      const size = editor.state.doc.content.size
      try {
        const sel = TextSelection.create(editor.state.doc, Math.min(from, size), Math.min(to, size))
        editor.view.dispatch(editor.state.tr.setSelection(sel).setMeta('addToHistory', false))
      } catch {
        /* selection not restorable — keep default */
      }
    })
  }, [editor, pageId, instanceId])

  // flush on unload / tab hide / unmount
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && flush()
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('beforeunload', flush)
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
      const el = editor.view.dom.querySelector<HTMLElement>(`[data-id="${CSS.escape(targetBlock)}"]`)
      if (!el) return
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el.classList.remove('block-flash')
      void el.offsetWidth
      el.classList.add('block-flash')
      window.setTimeout(() => el.classList.remove('block-flash'), 2000)
    }, 160)
    return () => window.clearTimeout(t)
  }, [editor, targetBlock])

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
      <EditorContent editor={editor} className="one-editor__content" />
      {editable && <div className="one-editor__tail" onMouseDown={onTailDown} aria-hidden />}
      {editor && editable && <EditorOverlays editor={editor} bridge={bridge} pageId={pageId} />}
    </div>
  )
}
