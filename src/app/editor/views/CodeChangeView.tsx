import { lazy, Suspense, useRef } from 'react'
import { useEditorState, NodeViewWrapper, NodeViewContent, type ReactNodeViewProps } from '@tiptap/react'
import { replaceStructuredCode } from '../lib/structuredCode'
import type { Writer } from '../../store/writer'
import { useWorkspace } from '../../store/store'
import { useCloud } from '../../cloud'
const Analysis = lazy(() => import('../../features').then((m) => ({ default: m.CodeChange })))
export function CodeChangeView({ node, editor, getPos }: ReactNodeViewProps) {
  const pageId = editor.view.dom.getAttribute('data-page-id') ?? '',
    epoch = useWorkspace((s) => s.epoch),
    page = useWorkspace((s) => s.pages[pageId]),
    readOnly = useCloud((s) => s.readOnly)
  const editorEditable=useEditorState({editor,selector:({editor:e})=>!e.isDestroyed&&e.isEditable})
  const editable = editorEditable && !!page && !page.trashedAt && !page.settings.locked && !readOnly
  const peers=useEditorState({editor,selector:({editor:e})=>{
    const out:string[]=[]
    let id:string;try{id=JSON.parse(node.textContent).id}catch{return out}
    e.state.doc.descendants((n,pos)=>{if(n.type.name!=='codeBlock'||n.attrs.language!=='code-change'||pos===getPos())return
      try{if(JSON.parse(n.textContent).id===id&&n.attrs.id)out.push(n.attrs.id)}catch{/* invalid blocks have their own error */}
    })
    return out
  }})
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
    if(!replaceStructuredCode(editor,hit.pos,expected,raw,writer))return false
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
            blockId={node.attrs.id}
            parallelBlocks={peers}
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
