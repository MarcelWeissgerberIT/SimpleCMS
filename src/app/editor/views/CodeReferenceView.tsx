import {lazy,Suspense} from 'react'
import {NodeViewWrapper,NodeViewContent,type ReactNodeViewProps} from '@tiptap/react'
import {flushEditor} from '../lib/editAs'
import {useWorkspace} from '../../store/store'
import {useCloud} from '../../cloud'
const Evidence=lazy(()=>import('../../features').then(m=>({default:m.CodeEvidence})))
/** The existing fenced-code format survives Markdown, sync, exports and older clients unchanged. */
export function CodeReferenceView({node,editor,getPos}:ReactNodeViewProps){
 const pageId=editor.view.dom.getAttribute('data-page-id'),epoch=useWorkspace(s=>s.epoch)
 const page=useWorkspace(s=>pageId?s.pages[pageId]:undefined),readOnly=useCloud(s=>s.readOnly)
 const editable=editor.isEditable&&!page?.settings.locked&&!readOnly
 const save=(raw:string)=>{
  if(editor.isDestroyed||!editor.isEditable||readOnly||epoch!==useWorkspace.getState().epoch||!!pageId&&useWorkspace.getState().pages[pageId]?.settings.locked)return
  const pos=getPos();if(typeof pos!=='number')return
  const current=editor.state.doc.nodeAt(pos);if(current?.type.name!=='codeBlock'||current.textContent!==node.textContent)return
  const next=editor.schema.nodes.codeBlock.create({...current.attrs,language:'atlas-code'},editor.schema.text(raw))
  editor.view.dispatch(editor.state.tr.replaceWith(pos,pos+current.nodeSize,next));flushEditor(editor)
 }
 return <NodeViewWrapper className="code-reference-block">
  <div contentEditable={false}><Suspense fallback={<span>Atlas …</span>}><Evidence raw={node.textContent} editable={editable} canRead={!!page&&!page.trashedAt} onSave={save}/></Suspense></div>
  <div hidden><NodeViewContent as="code"/></div>
 </NodeViewWrapper>
}
