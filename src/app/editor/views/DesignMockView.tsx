import DOMPurify from 'dompurify'
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useReducer, useState } from 'react'
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { mockBlockData, mockBlockFrame, mockBlocksAllowed, type MockBlockData } from '@/shared/ai/mockBlock'
import {mockColorToken,mockColorStyle,mockProvenance} from '@/shared/ai/mockBlockProvenance'
import {sha256Hex} from '@/shared/mcp/sha256'
import type {DesignMock} from '@/shared/ai/designMock'
import { useWorkspace } from '../../store/store'
import { useCloud } from '../../cloud'
import { useT } from '../../i18n'
import { Modal } from '../../ui/Modal'
import './designMock.css'
const Composer=lazy(()=>import('../../features').then(m=>({default:m.MockBlockComposer})))
const AtlasCard=lazy(()=>import('../../features').then(m=>({default:m.DesignMockCard})))
const pickerHex=(value:string)=>{const ctx=document.createElement('canvas').getContext('2d')!;ctx.fillStyle=value;return /^#[a-f0-9]{6}$/i.test(ctx.fillStyle)?ctx.fillStyle:'#000000'}
export function DesignMockView({node,editor,getPos}:ReactNodeViewProps) {
 const t=useT(),spec=useMemo(()=>mockBlockData(node.attrs.spec),[node.attrs.spec]),[large,setLarge]=useState(false)
 const de=useWorkspace(s=>s.settings.language==='de'),tabId=useId(),[tab,setTab]=useState<'colors'|'atlas'>('colors')
 const pageId=editor.view.dom.getAttribute('data-page-id'),epoch=useWorkspace(s=>s.epoch)
 const locked=useWorkspace(s=>!!pageId&&!!s.pages[pageId]?.settings.locked),viewer=useCloud(s=>s.readOnly)
 const [,bump]=useReducer(n=>n+1,0)
 useEffect(()=>{const id=setTimeout(bump,0);return()=>clearTimeout(id)},[locked,viewer])
 const supported=useCloud(mockBlocksAllowed)
 const editable=!editor.isDestroyed&&editor.isEditable&&!locked&&!viewer&&supported
 const latest=useRef(spec);latest.current=spec
 const change=(next:MockBlockData,expected=spec)=>{
  if(editor.isDestroyed||!editor.isEditable||!mockBlocksAllowed(useCloud.getState())||epoch!==useWorkspace.getState().epoch||!!pageId&&useWorkspace.getState().pages[pageId]?.settings.locked)return
  const pos=getPos();if(typeof pos!=='number'||editor.state.doc.nodeAt(pos)?.type.name!=='designMock')return
  if(JSON.stringify(mockBlockData(editor.state.doc.nodeAt(pos)!.attrs.spec))!==JSON.stringify(expected))return
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos,undefined,{...editor.state.doc.nodeAt(pos)!.attrs,spec:next}))
 }
 const preview=spec.preview
 const safeDocument=useMemo(()=>preview?mockBlockFrame(DOMPurify.sanitize(preview.document,{WHOLE_DOCUMENT:true,ADD_TAGS:['style'],FORBID_TAGS:['meta','base','script','link','iframe','object','embed','form'],FORBID_ATTR:['src','srcset','action','formaction','href','poster','background']})+mockColorStyle(preview.colors??{})):'',[preview])
 const effectiveHash=sha256Hex(safeDocument)
 const receipt=preview?.provenance
 const isSaved=!!receipt?.atlasSaved&&(preview?.savedHtmlHash===effectiveHash||!Object.keys(preview?.colors??{}).length&&preview?.savedHtmlHash===preview?.htmlHash)
 const artifact:DesignMock|null=preview&&receipt?{...receipt,title:preview.title,width:preview.width,height:preview.height,createdAt:preview.createdAt,document:safeDocument,htmlHash:effectiveHash,review:'open',colorAdjustments:preview.colors,atlasSaved:receipt.atlasSaved}:null
 const persist=(a:DesignMock,saved:boolean)=>{const current=latest.current,p=current.preview;if(p&&p.provenance?.id===a.id)change({...current,preview:{...p,provenance:mockProvenance({...a,document:undefined}),targetUrl:a.atlasSaved?.url??a.atlasDestination?.url??p.targetUrl,savedHtmlHash:saved?a.htmlHash:p.savedHtmlHash}},current)}
 const color=(name:string,value?:string)=>{if(!preview)return;const colors={...preview.colors};if(value)colors[name]=value;else delete colors[name];change({...spec,preview:{...preview,colors}})}
 const colorTokens=receipt?.draft.tokens.filter(t=>mockColorToken(t.value))??[]
 const frame=()=><iframe title={preview?.title||t('editor.block.designMock')} sandbox="allow-same-origin" referrerPolicy="no-referrer" tabIndex={-1} srcDoc={safeDocument} style={{width:preview!.width,height:preview!.height,minHeight:320}}/>
 return <NodeViewWrapper className="mock-block" data-type="design-mock">
  <header contentEditable={false}><strong>{t('editor.block.designMock')}</strong><span className="label">{t('editor.mock.static')}</span></header>
  <NodeViewContent className="mock-block__title"/>
  <details contentEditable={false} open={!preview}><summary>{t('editor.mock.configure')}</summary>{editable?<Suspense fallback={null}><Composer value={spec} onChange={change}/></Suspense>:<div><p>{spec.request}</p><p>{spec.source}</p><p>{spec.requirement}</p></div>}</details>
  {preview&&<section className="mock-block__preview" contentEditable={false}><div className="mock-block__actions"><strong>{preview.title}</strong><button type="button" className="btn btn--sm" onClick={()=>setLarge(true)}>{t('editor.mock.fullscreen')}</button>{editable&&<button type="button" className="btn btn--sm" onClick={()=>change({...spec,preview:null})}>{t('editor.mock.remove')}</button>}</div><div className="mock-block__viewport">{frame()}</div><p className="faint">{t('editor.mock.snapshot')} · {preview.createdAt}</p></section>}
  {preview&&<section className="mock-block__settings" contentEditable={false}>
   <div className="mock-block__tabs" role="tablist" aria-label={de?'Mock-Einstellungen':'Mock settings'} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?'colors':e.key==='End'?'atlas':tab==='colors'?'atlas':'colors';setTab(next);document.getElementById(tabId+'-'+next)?.focus()}}}>
    {(['colors','atlas'] as const).map(key=><button key={key} id={tabId+'-'+key} role="tab" aria-selected={tab===key} aria-controls={tabId+'-panel-'+key} tabIndex={tab===key?0:-1} onClick={()=>setTab(key)}>{key==='colors'?(de?'Farben':'Colours'):'Atlas'}</button>)}
   </div>
   <div role="tabpanel" id={tabId+'-panel-'+tab} aria-labelledby={tabId+'-'+tab} className="mock-block__panel">
    {tab==='colors'?<>
     <p className="faint">{de?'Farben für diesen Entwurf anpassen. Änderungen werden auf der One-Seite gespeichert; Atlas wird erst auf deinen Klick aktualisiert.':'Adjust this proposal’s colours. Changes are saved on the One page; Atlas is updated only when you choose to upload.'}</p>
     {colorTokens.length?<div className="mock-block__colors">{colorTokens.map(token=>{const value=preview.colors?.[token.name]??token.value;return <div className="mock-block__color" key={token.name}><label><input type="color" aria-label={token.name+(de?' Farbe':' colour')} value={pickerHex(value)} disabled={!editable} onChange={e=>color(token.name,e.target.value)}/><span><strong>{token.name.replace(/^--/,'').replace(/-/g,' ')}</strong><small>{de?'Original: ':'Original: '}{token.value}</small></span></label><input aria-label={token.name+' Hex'} key={value} defaultValue={value} disabled={!editable} maxLength={9} onBlur={e=>{if(/^#[a-f0-9]{6}$/i.test(e.target.value))color(token.name,e.target.value);else e.target.value=value}}/><button className="btn btn--sm" disabled={!editable||!preview.colors?.[token.name]} onClick={()=>color(token.name)}>{de?'Zurücksetzen':'Reset'}</button></div>})}</div>:<p>{de?'Für diese Vorschau sind keine bearbeitbaren Farbwerte hinterlegt. Ein neu übernommenes KI-Ergebnis bringt seine Designwerte mit.':'This preview has no editable colour values. Newly adopted AI results include their design tokens.'}</p>}
    </>:<>
     <div className="mock-block__atlas-status"><strong>{receipt?.atlasSaved?(isSaved?(de?'In Atlas gespeichert':'Saved in Atlas'):(de?'Änderungen noch nicht in Atlas':'Changes not yet in Atlas')):receipt?.atlasDestination?(de?'Atlas-Übertragung unvollständig':'Atlas upload incomplete'):(de?'Auf dieser One-Seite · noch nicht in Atlas gespeichert':'On this One page · not yet saved in Atlas')}</strong></div>
     {artifact&&editable?<Suspense fallback={<p>{de?'Atlas-Aktionen werden geladen …':'Loading Atlas actions …'}</p>}><AtlasCard key={artifact.id+artifact.htmlHash} artifact={artifact} embedded savedCurrent={isSaved} onPersist={persist}/></Suspense>:<div><p>{de?'Designquelle: ':'Design source: '}<a href={spec.source} target="_blank" rel="noreferrer">{spec.source}</a></p><p>{de?'Requirements: ':'Requirements: '}{spec.requirement||(de?'Keine hinterlegt':'None supplied')}</p>{receipt&&<ul>{receipt.sources.map(source=><li key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title} · #{source.ref}</a></li>)}</ul>}{preview.targetUrl&&<a href={preview.targetUrl} target="_blank" rel="noreferrer">{de?'Atlas-Record öffnen':'Open Atlas record'}</a>}{!receipt&&<p>{de?'Diese ältere Vorschau enthält keinen vollständigen Quellennachweis für die spätere Übertragung. Übernimm das Ergebnis erneut aus dem KI-Terminal.':'This older preview lacks the source receipt needed for a later upload. Adopt the result from the AI terminal again.'}</p>}</div>}
    </>}
   </div>
  </section>}
  {large&&preview&&<Modal open title={preview.title} width="calc(100vw - 24px)" className="mock-block-modal" onClose={()=>setLarge(false)}><div className="mock-block__viewport">{frame()}</div></Modal>}
 </NodeViewWrapper>
}
export const designMockViewOptions={stopEvent:({event}:{event:Event})=>!event.type.startsWith('drag')&&event.type!=='drop'&&!!(event.target as Element|null)?.closest?.('.mock-block__composer,.mock-block__preview,.mock-block summary,.mock-block header,.mock-block__settings')}
