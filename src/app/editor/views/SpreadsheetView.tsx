/**
 * Spreadsheet block — the frame. The grid (engine, formula bar, sheets, datasets) is a lazy chunk
 * of features/sheets; a failing grid shows a plate instead of taking the page down. Read-only
 * renders don't use this view: they show the schema's static tables (schema/spreadsheet.ts).
 */
import { Component, lazy, Suspense, useCallback, useEffect, useReducer, type ReactNode } from 'react'
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import type { JSONContent } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { loadSheetBlock } from '../../features'
import { useWorkspace } from '../../store/store'
import { useCloud } from '../../cloud'
import { useT } from '../../i18n'
import './spreadsheet.css'

const LazySheet = lazy(() => loadSheetBlock().then((m) => ({ default: m.SheetBlock })))

class SheetGuard extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(err: unknown) {
    console.warn('[editor] spreadsheet failed', err)
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export function SpreadsheetView({ node, editor, getPos, selected }: ReactNodeViewProps) {
  const t = useT()
  // locking the page (or a viewer role) flips the editor's editable flag without a transaction
  const pageId = editor.view.dom.getAttribute('data-page-id')
  const locked = useWorkspace((s) => !!pageId && !!s.pages[pageId]?.settings.locked)
  const viewer = useCloud((s) => s.readOnly)
  const [, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    const id = window.setTimeout(bump, 0)
    return () => window.clearTimeout(id)
  }, [locked, viewer])
  const editable = !editor.isDestroyed && editor.isEditable && !locked

  // every edit of the grid is its own undo step (no merging of quick successive edits)
  const update = useCallback(
    (patch: Record<string, unknown>) => {
      const pos = getPos()
      if (typeof pos !== 'number' || editor.isDestroyed) return
      const current = editor.state.doc.nodeAt(pos)
      if (!current || current.type.name !== 'spreadsheet') return
      const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...patch })
      closeHistory(tr)
      editor.view.dispatch(tr)
    },
    [editor, getPos],
  )
  const insertAfter = useCallback(
    (json: JSONContent) => {
      const pos = getPos()
      if (typeof pos !== 'number') return
      const at = pos + editor.state.doc.nodeAt(pos)!.nodeSize
      editor.chain().insertContentAt(at, json).run()
    },
    [editor, getPos],
  )

  return (
    <NodeViewWrapper className={`sheet-block${selected ? ' is-selected' : ''}`} data-type="spreadsheet" contentEditable={false}>
      <SheetGuard fallback={<div className="sheet-block__plate label">{t('editor.spreadsheet.failed')}</div>}>
        <Suspense fallback={<div className="sheet-block__plate label">{t('editor.spreadsheet.loading')}</div>}>
          <LazySheet attrs={node.attrs} update={update} editable={editable} editor={editor} pageId={pageId} insertAfter={insertAfter} />
        </Suspense>
      </SheetGuard>
    </NodeViewWrapper>
  )
}

/** Everything inside the block belongs to React (keys, pointer, clipboard). */
export const spreadsheetViewOptions = { stopEvent: () => true, ignoreMutation: () => true }
