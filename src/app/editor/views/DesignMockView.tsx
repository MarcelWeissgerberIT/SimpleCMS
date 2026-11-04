import DOMPurify from 'dompurify'
import { lazy, Suspense, useEffect, useMemo, useReducer, useState } from 'react'
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { mockBlockData, mockBlockFrame, mockBlocksAllowed, type MockBlockData } from '@/shared/ai/mockBlock'
import { useWorkspace } from '../../store/store'
import { useCloud } from '../../cloud'
import { useT } from '../../i18n'
import { Modal } from '../../ui/Modal'
import './designMock.css'
const Composer=lazy(()=>import('../../features').then(m=>({default:m.MockBlockComposer})))
export function DesignMockView({node,editor,getPos}:ReactNodeViewProps) {
 const t=useT(),spec=useMemo(()=>mockBlockData(node.attrs.spec),[node.attrs.spec]),[large,setLarge]=useState(false)
 const pageId=editor.view.dom.getAttribute('data-page-id'),epoch=useWorkspace(s=>s.epoch)
 const locked=useWorkspace(s=>!!pageId&&!!s.pages[pageId]?.settings.locked),viewer=useCloud(s=>s.readOnly)
 const [,bump]=useReducer(n=>n+1,0)
 useEffect(()=>{const id=setTimeout(bump,0);return()=>clearTimeout(id)},[locked,viewer])
 const supported=useCloud(mockBlocksAllowed)
 const editable=!editor.isDestroyed&&editor.isEditable&&!locked&&!viewer&&supported
 const change=(next:MockBlockData)=>{
  if(editor.isDestroyed||!editor.isEditable||!mockBlocksAllowed(useCloud.getState())||epoch!==useWorkspace.getState().epoch||!!pageId&&useWorkspace.getState().pages[pageId]?.settings.locked)return
  const pos=getPos();if(typeof pos!=='number'||editor.state.doc.nodeAt(pos)?.type.name!=='designMock')return
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos,undefined,{...editor.state.doc.nodeAt(pos)!.attrs,spec:next}))
 }
 const preview=spec.preview
 const safeDocument=useMemo(()=>preview?mockBlockFrame(DOMPurify.sanitize(preview.document,{WHOLE_DOCUMENT:true,ADD_TAGS:['style'],FORBID_TAGS:['meta','base','script','link','iframe','object','embed','form'],FORBID_ATTR:['src','srcset','action','formaction','href','poster','background']})):'',[preview])
 const frame=()=><iframe title={preview?.title||t('editor.block.designMock')} sandbox="allow-same-origin" referrerPolicy="no-referrer" tabIndex={-1} srcDoc={safeDocument} style={{width:preview!.width,height:preview!.height,minHeight:320}}/>
 return <NodeViewWrapper className="mock-block" data-type="design-mock">
  <header contentEditable={false}><strong>{t('editor.block.designMock')}</strong><span className="label">{t('editor.mock.static')}</span></header>
  <NodeViewContent className="mock-block__title"/>
  <details contentEditable={false} open={!preview}><summary>{t('editor.mock.configure')}</summary>{editable?<Suspense fallback={null}><Composer value={spec} onChange={change}/></Suspense>:<div><p>{spec.request}</p><p>{spec.source}</p><p>{spec.requirement}</p></div>}</details>
  {preview&&<section className="mock-block__preview" contentEditable={false}><div className="mock-block__actions"><strong>{preview.title}</strong><button type="button" className="btn btn--sm" onClick={()=>setLarge(true)}>{t('editor.mock.fullscreen')}</button>{editable&&<button type="button" className="btn btn--sm" onClick={()=>change({...spec,preview:null})}>{t('editor.mock.remove')}</button>}</div><div className="mock-block__viewport">{frame()}</div><p className="faint">{t('editor.mock.snapshot')} · {preview.createdAt}</p>{preview.targetUrl&&<a href={preview.targetUrl} target="_blank" rel="noreferrer">{t('editor.mock.target')}</a>}</section>}
  {large&&preview&&<Modal open title={preview.title} width="calc(100vw - 24px)" className="mock-block-modal" onClose={()=>setLarge(false)}><div className="mock-block__viewport">{frame()}</div></Modal>}
 </NodeViewWrapper>
}
export const designMockViewOptions={stopEvent:({event}:{event:Event})=>!event.type.startsWith('drag')&&event.type!=='drop'&&!!(event.target as Element|null)?.closest?.('.mock-block__composer,.mock-block__preview,.mock-block summary,.mock-block header')}
