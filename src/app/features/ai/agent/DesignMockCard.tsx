import {useRef,useState} from 'react'
import type {DesignMock} from '@/shared/ai/designMock'
import {sha256Hex} from '@/shared/mcp/sha256'
import {useWorkspace} from '../../../store/store'
import {attachMockToAtlas,type MockAttachment} from './mockAtlas'
import './design-mock.css'
const download=(blob:Blob,name:string)=>{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
export function DesignMockCard({artifact:a}:{artifact:DesignMock}){
 const de=useWorkspace(s=>s.settings.language==='de'),frame=useRef<HTMLIFrameElement>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),[uploads,setUploads]=useState<MockAttachment[]>([]),[pngReceipt,setPngReceipt]=useState<{sha256:string;bytes:number;renderedAt:string}|null>(null)
 const epoch=useRef(useWorkspace.getState().epoch),check=()=>{if(epoch.current!==useWorkspace.getState().epoch)throw Error(de?'Workspace gewechselt. Mock dort erneut erstellen.':'Workspace changed. Create the mock there again.')}
 const [destination,setDestination]=useState(a.target?String(a.target.ref):'')
 const destinationRef=Number(destination.replace(/^#/,'')),validDestination=/^#?[1-9][0-9]*$/.test(destination)&&Number.isSafeInteger(destinationRef)
 const name=a.title.replace(/[^\p{L}\p{N}_-]+/gu,'-').slice(0,65)+'-'+a.htmlHash.slice(0,8)+'-'+a.id.slice(0,8)
 const manifest=(png:typeof pngReceipt)=>JSON.stringify({...a,document:undefined,attachments:uploads,attachmentTarget:validDestination?destinationRef:null,png:png??{status:'not rendered'},checks:{sourceOrigin:'checked',htmlStatic:'checked',semanticSupport:'human review open',visualDesignCompliance:'human review open'}},null,2)
 const png=async()=>{
  check();const doc=frame.current?.contentDocument;if(!doc?.body||!doc.body.childElementCount)throw Error(de?'Die Vorschau lädt noch.':'Preview is still loading.')
  const {default:html2canvas}=await import('html2canvas-pro');check()
  const canvas=await html2canvas(doc.body,{width:a.width,height:a.height,windowWidth:a.width,windowHeight:a.height,scale:1,backgroundColor:null,logging:false,imageTimeout:2000,onclone:cloned=>{cloned.querySelectorAll('input,textarea,select').forEach(el=>(el as HTMLElement).blur())}})
  check();const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(v=>v?resolve(v):reject(Error('PNG encoding failed.')),'image/png'))
  const receipt={sha256:sha256Hex(new Uint8Array(await blob.arrayBuffer())),bytes:blob.size,renderedAt:new Date().toISOString()};setPngReceipt(receipt);return {blob,receipt}
 }
 const act=async(which:'png'|'save')=>{setBusy(true);setError('');try{
  const {blob,receipt}=await png();check()
  if(which==='png'){download(blob,name+'.png');return}
  const encoder=new TextEncoder(),files=[{bytes:encoder.encode(a.document),filename:name+'.html',mime:'text/html' as const},{bytes:new Uint8Array(await blob.arrayBuffer()),filename:name+'.png',mime:'image/png' as const},{bytes:encoder.encode(manifest(receipt)),filename:name+'-sources.json',mime:'application/json' as const}]
  check();await attachMockToAtlas(a,files,new AbortController().signal,setUploads,destinationRef);check();setSaved(true)
 }catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
 return <section className="design-mock" aria-label={de?'Design-Mock':'Design mock'}>
  <header><div><span className="label">BA / PO · {de?'Entwurf · Abnahme offen':'Proposal · review open'}</span><h3>{a.title}</h3></div><span>{a.width} × {a.height}</span></header>
  <div className="design-mock__viewport"><iframe ref={frame} title={a.title} sandbox="allow-same-origin" srcDoc={a.document} width={a.width} height={a.height} tabIndex={-1}/></div>
  <div className="design-mock__actions"><button className="btn btn--sm" disabled={busy} onClick={()=>{check();download(new Blob([a.document],{type:'text/html'}),name+'.html')}}>HTML {de?'herunterladen':'download'}</button><button className="btn btn--sm" disabled={busy} onClick={()=>void act('png')}>PNG {de?'erstellen':'render'}</button><button className="btn btn--primary btn--sm" disabled={busy||saved||!validDestination} onClick={()=>void act('save')}>{busy?(de?'Wird gerendert …':'Rendering …'):saved?(de?'In Atlas gespeichert':'Saved in Atlas'):(de?'Am Atlas-Record ablegen':'Attach to Atlas record')}</button></div>
  <label>{de?'Atlas-Ziel zum Speichern (optional, #Record): ':'Atlas destination for saving (optional, #record): '}<input value={destination} onChange={e=>setDestination(e.target.value)} disabled={busy||saved} inputMode="numeric" placeholder="#12345"/></label>
  {a.target&&<p><a href={a.target.url} target="_blank" rel="noreferrer">{a.target.title} · #{a.target.ref}</a></p>}
  <p>{de?'Statischer Mock. PNG aus dieser HTML-Vorschau. Zitate wurden gegen gelesene Atlas-Inhalte geprüft; fachliche Vollständigkeit und Design-Treue bleiben zu prüfen.':'Static mock. PNG rendered from this HTML preview. Quotes checked against read Atlas content; semantic completeness and visual compliance still need review.'}</p>
  <details><summary>{de?'Designstand, Anforderungen und offene Punkte':'Design source, requirements and open points'}</summary>{a.sources.map(s=><p key={s.id}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> · {s.readAt}<br/><code>{s.hash}</code></p>)}{[...(a.draft.authority?[a.draft.authority]:[]),a.draft.design,...a.draft.requirements].map((c,i)=><blockquote key={i}>{c.quote}</blockquote>)}<ul>{a.draft.notes.map((n,i)=><li key={i}>{n}</li>)}</ul><p>HTML SHA-256: {a.htmlHash}</p>{pngReceipt&&<p>PNG SHA-256: {pngReceipt.sha256} · {pngReceipt.bytes} bytes · {pngReceipt.renderedAt}</p>}<button className="btn btn--sm" onClick={()=>download(new Blob([manifest(pngReceipt)],{type:'application/json'}),name+'-sources.json')}>{de?'Quellennachweis herunterladen':'Download source receipt'}</button></details>
  {uploads.length>0&&<ul>{uploads.map(f=><li key={f.filename}><a href={f.url} target="_blank" rel="noreferrer">{f.filename}</a> · SHA-256 {f.sha256.slice(0,12)} · {f.bytes} bytes</li>)}</ul>}
  {error&&<p role="alert">{error}</p>}
 </section>
}
