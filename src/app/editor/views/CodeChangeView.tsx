import { lazy, Suspense, useRef } from 'react'
import { NodeViewWrapper, NodeViewContent, type ReactNodeViewProps } from '@tiptap/react'
import { dispatchAs } from '../lib/editAs'
import type { Writer } from '../../store/writer'
import { useWorkspace } from '../../store/store'
import { useCloud } from '../../cloud'
const Analysis = lazy(() => import('../../features').then((m) => ({ default: m.CodeChange })))
export function CodeChangeView({ node, editor, getPos }: ReactNodeViewProps) {
  const pageId = editor.view.dom.getAttribute('data-page-id') ?? '',
    epoch = useWorkspace((s) => s.epoch),
    page = useWorkspace((s) => s.pages[pageId]),
    readOnly = useCloud((s) => s.readOnly)
  const editable = editor.isEditable && !!page && !page.trashedAt && !page.settings.locked && !readOnly
  const baseline = useRef('')
  const current = () => {
    if (
      editor.isDestroyed ||
      !editor.isEditable ||
      useCloud.getState().readOnly ||
      epoch !== useWorkspace.getState().epoch
    )
      return null
    const p = useWorkspace.getState().pages[pageId]
    if (!p || p.trashedAt || p.settings.locked) return null
    const pos = getPos()
    if (typeof pos !== 'number') return null
    const live = editor.state.doc.nodeAt(pos)
    return live?.type.name === 'codeBlock' && live.attrs.language === 'code-change' ? { pos, live } : null
  }
  const surrounding = () => {
    const hit = current()
    if (!hit) return ''
    const placeholder = editor.schema.nodes.codeBlock.create(hit.live.attrs)
    const json = editor.state.tr.replaceWith(hit.pos, hit.pos + hit.live.nodeSize, placeholder).doc.toJSON()
    const clean = (n: any): any => ({
      ...n,
      attrs: n.attrs ? Object.fromEntries(Object.entries(n.attrs).filter(([k]) => k !== 'id')) : undefined,
      content: n.content?.map(clean),
    })
    return JSON.stringify([useWorkspace.getState().pages[pageId]?.title, clean(json)])
  }
  const save = (raw: string, expected: string, writer: Writer) => {
    const hit = current()
    if (!hit || hit.live.textContent !== expected) return false
    const next = editor.schema.nodes.codeBlock.create(hit.live.attrs, editor.schema.text(raw))
    dispatchAs(editor, writer, editor.state.tr.replaceWith(hit.pos, hit.pos + hit.live.nodeSize, next))
    baseline.current = surrounding()
    return true
  }
  const read = () => {
    const hit = current()
    if (!hit) return null
    const signature = surrounding()
    if (!baseline.current) baseline.current = signature
    else if (signature !== baseline.current) return null
    return hit.live.textContent
  }
  return (
    <NodeViewWrapper>
      <div contentEditable={false}>
        <Suspense fallback={<span>…</span>}>
          <Analysis
            raw={node.textContent}
            editable={editable}
            canRead={!!page && !page.trashedAt}
            pageId={pageId}
            onSave={save}
            onCurrent={read}
          />
        </Suspense>
      </div>
      <div hidden>
        <NodeViewContent />
      </div>
    </NodeViewWrapper>
  )
}
