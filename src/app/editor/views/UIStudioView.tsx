import {lazy,Suspense} from 'react'
import {NodeViewWrapper,NodeViewContent,type ReactNodeViewProps} from '@tiptap/react'
import {flushEditor} from '../lib/editAs'
import {useWorkspace} from '../../store/store'
import {useCloud} from '../../cloud'
const Studio=lazy(()=>import('../../features').then(m=>({default:m.UIStudio})))
export function UIStudioView({node,editor,getPos}:ReactNodeViewProps){
 const pageId=editor.view.dom.getAttribute('data-page-id')??'',epoch=useWorkspace(s=>s.epoch),page=useWorkspace(s=>s.pages[pageId]),readOnly=useCloud(s=>s.readOnly)
 const editable=editor.isEditable&&!!page&&!page.trashedAt&&!page.settings.locked&&!readOnly
 const current=()=>{if(editor.isDestroyed||!editor.isEditable||useCloud.getState().readOnly||epoch!==useWorkspace.getState().epoch)return null;const p=useWorkspace.getState().pages[pageId];if(!p||p.trashedAt||p.settings.locked)return null;const pos=getPos();if(typeof pos!=='number')return null;const live=editor.state.doc.nodeAt(pos);return live?.type.name==='codeBlock'&&live.attrs.language==='ui-instructions'&&live.textContent===node.textContent?{pos,live}:null}
 const save=(raw:string)=>{const hit=current();if(!hit)return false;const next=editor.schema.nodes.codeBlock.create({...hit.live.attrs,language:'ui-instructions'},editor.schema.text(raw));editor.view.dispatch(editor.state.tr.replaceWith(hit.pos,hit.pos+hit.live.nodeSize,next));flushEditor(editor);return true}
 const source=(src:string,file:File)=>{const hit=current();if(!hit)return false;const image=/\.(png|jpe?g|webp)$/i.test(file.name);const type=editor.schema.nodes[image?'image':'fileBlock'];if(!type)return false;const next=type.create(image?{src,alt:file.name}:{src,name:file.name,size:file.size,mime:file.type});editor.view.dispatch(editor.state.tr.insert(hit.pos+hit.live.nodeSize,next));flushEditor(editor);return true}
 return <NodeViewWrapper className="ui-studio-block"><div contentEditable={false}><Suspense fallback={<span>UI Studio …</span>}><Studio raw={node.textContent} editable={editable} pageId={pageId} onSave={save} onSource={source}/></Suspense></div><div hidden><NodeViewContent/></div></NodeViewWrapper>
}
