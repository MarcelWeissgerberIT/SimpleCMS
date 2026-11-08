import {lazy,Suspense} from 'react'
import {useEditorState,NodeViewWrapper,NodeViewContent,type ReactNodeViewProps} from '@tiptap/react'
import {replaceStructuredCode} from '../lib/structuredCode'
import {useWorkspace} from '../../store/store'
import {useCloud} from '../../cloud'
const Evidence=lazy(()=>import('../../features').then(m=>({default:m.CodeEvidence})))
/** The existing fenced-code format survives Markdown, sync, exports and older clients unchanged. */
export function CodeReferenceView({node,editor,getPos}:ReactNodeViewProps){
 const pageId=editor.view.dom.getAttribute('data-page-id'),epoch=useWorkspace(s=>s.epoch)
 const page=useWorkspace(s=>pageId?s.pages[pageId]:undefined),readOnly=useCloud(s=>s.readOnly)
 const editorEditable=useEditorState({editor,selector:({editor:e})=>!e.isDestroyed&&e.isEditable})
 const editable=editorEditable&&!page?.settings.locked&&!readOnly
 const save=(raw:string)=>{
  if(editor.isDestroyed||!editor.isEditable||readOnly||epoch!==useWorkspace.getState().epoch||!!pageId&&useWorkspace.getState().pages[pageId]?.settings.locked)return false
  const pos=getPos();if(typeof pos!=='number')return false
  const current=editor.state.doc.nodeAt(pos);if(current?.type.name!=='codeBlock'||current.textContent!==node.textContent)return false
  return replaceStructuredCode(editor,pos,node.textContent,raw,{kind:'you',via:'form'})
 }
 return <NodeViewWrapper className="code-reference-block">
  <div contentEditable={false}><Suspense fallback={<span>Atlas …</span>}><Evidence raw={node.textContent} editable={editable} canRead={!!page&&!page.trashedAt} onSave={save}/></Suspense></div>
  <div hidden><NodeViewContent/></div>
 </NodeViewWrapper>
}
