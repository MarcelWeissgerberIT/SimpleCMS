import {useEffect,useRef,useState} from 'react'
import {useWorkspace} from '../../store/store'
import {useLang} from '../../i18n'
import {holdOverviewPages} from '../../shell/page/overview/sources'
import {overviewSources,overviewSignature} from '../../shell/page/overview/model'
import {codeReference} from '@/shared/mcp/codeReference'
import {codeConnections} from '../code-evidence/load'
import {addCard,addOverviewCard,readAttachment,sourcePage} from './actions'
import {pageFiles} from '../ai/agent/documentTools'
export function SourcePicker({deskId,onAdded}:{deskId:string;onAdded:(id:string)=>void}){
 const de=useLang()==='de',pages=useWorkspace(s=>s.pages),desk=pages[deskId]
 const [query,setQuery]=useState(''),[pageId,setPageId]=useState(''),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const [file,setFile]=useState<{id:string;text:string;hash:string;name:string}|null>(null),[quote,setQuote]=useState(''),[note,setNote]=useState(''),[server,setServer]=useState('')
 const controller=useRef<AbortController|null>(null)
 useEffect(()=>{const c=new AbortController();let release:()=>void=()=>{};setReady(false);setBusy(false);setFile(null);setQuote('');setError('')
 if(pageId)void holdOverviewPages([pageId],c.signal).then(r=>{release=r;if(c.signal.aborted)r();else setReady(true)}).catch(e=>{if(!c.signal.aborted)setError(String(e.message??e))})
 return()=>{c.abort();release();controller.current?.abort()}
 },[pageId,deskId])
 const run=async(fn:(signal:AbortSignal)=>Promise<void>|void)=>{controller.current?.abort();const c=new AbortController();controller.current=c;setBusy(true);setError('');try{await fn(c.signal)}catch(e){if(!c.signal.aborted)setError(e instanceof Error?e.message:String(e))}finally{if(!c.signal.aborted)setBusy(false)}}
 const p=pages[pageId],eligible=Object.values(pages).filter(p=>p.id!==deskId&&!p.workbench&&!p.hidden&&!p.trashed&&!!p.private===!!desk.private&&p.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
 const add=(title:string,detail:string,blockId:string,kind:'page'|'code'='page',code?:ReturnType<typeof codeReference>)=>run(()=>{const source=sourcePage(deskId,pageId);onAdded(addCard(deskId,{title:title.slice(0,300),detail,source:{kind,pageId,blockId,quote:detail,signature:overviewSignature(source),label:source.title.slice(0,300),...(code?{code:{...code,server:code.server||server}}:{})}}))})
 return <div className="wb-source-picker">
  <label>{de?'Seite suchen':'Find a page'}<input value={query} onChange={e=>setQuery(e.target.value)} placeholder={de?'Titel …':'Title …'}/></label>
  <label>{de?'Quelle auswählen':'Select source'}<select aria-label={de?'Quelle auswählen':'Select source'} value={pageId} onChange={e=>setPageId(e.target.value)}><option value="">—</option>{eligible.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
  {pageId&&!ready&&!error&&<p role="status">{de?'Quelle wird geladen …':'Loading source …'}</p>}
  {error&&<p role="alert">{error}</p>}
  {ready&&p&&<>
   {p.overview&&<details><summary>{de?'Karten aus dem Überblick':'Cards from overview'}</summary>{p.overview.items.map(item=><button className="wb-source-choice" key={item.id} disabled={busy} onClick={()=>void run(async signal=>onAdded(await addOverviewCard(deskId,pageId,item,signal)))}>{item.title} <span>＋</span></button>)}</details>}
   <details open><summary>{de?'Absätze und Code-Belege':'Passages and code references'}</summary>
    {overviewSources(p).map(source=>{const ref=codeReference(source.text)
     return <div key={source.id} className="wb-source-excerpt"><p>{ref?(ref.finding||ref.citation.path):source.text.slice(0,350)+(source.text.length>350?' …':'')}</p>
      {ref&&!ref.server&&<select aria-label={de?'Atlas-Verbindung':'Atlas connection'} value={server} onChange={e=>setServer(e.target.value)}><option value="">Atlas …</option>{codeConnections().map(c=><option key={c.name}>{c.name}</option>)}</select>}
      <button className="btn btn--sm" disabled={busy||source.text.length>12000||!!ref&&!ref.server&&!server} onClick={()=>void add(ref?.finding||source.text.slice(0,100),ref?(ref.finding||ref.citation.path):source.text,source.id,ref?'code':'page',ref)}>{de?'Auf den Schreibtisch':'Add to desk'}</button>
      {source.text.length>12000&&<small>{de?'Absatz zu lang; teile ihn in kleinere Abschnitte.':'Passage too long; split it into smaller sections.'}</small>}
     </div>
    })}
   </details>
   {!!pageFiles(p.content).length&&<details><summary>{de?'Anhänge auswerten':'Read attachments'}</summary>{pageFiles(p.content).map(f=><button className="wb-source-choice" disabled={busy} key={f.file_id} onClick={()=>void run(async signal=>{const epoch=useWorkspace.getState().epoch;sourcePage(deskId,pageId);const result=await readAttachment(pageId,f.file_id,signal);signal.throwIfAborted();if(epoch!==useWorkspace.getState().epoch)throw Error(de?'Arbeitsbereich gewechselt.':'Workspace changed.');sourcePage(deskId,pageId);setFile({id:f.file_id,...result});setQuote('')})}>{f.name} · {de?'Text laden':'Load text'}</button>)}</details>}
   {file&&<div><label>{file.name}<textarea aria-label={file.name} readOnly rows={8} value={file.text}/></label><label>{de?'Gewünschten Originalauszug hier einfügen (max. 12.000 Zeichen)':'Paste the original excerpt here (up to 12,000 characters)'}<textarea value={quote} maxLength={12000} onChange={e=>setQuote(e.target.value)}/></label><button className="btn" disabled={busy||!quote.trim()||!file.text.includes(quote)} onClick={()=>void run(()=>onAdded(addCard(deskId,{title:file.name.slice(0,300),detail:quote,source:{kind:'file',pageId,blockId:file.id,quote,signature:overviewSignature(sourcePage(deskId,pageId)),label:file.name.slice(0,300),fileId:file.id,fileHash:file.hash}})))}>{de?'Dateiauszug hinzufügen':'Add file excerpt'}</button></div>}
  </>}
  <details><summary>{de?'Eigene Annahme':'Your own assumption'}</summary><label>{de?'Notiz':'Note'}<textarea maxLength={12000} value={note} onChange={e=>setNote(e.target.value)}/></label><button className="btn" disabled={busy||!note.trim()} onClick={()=>void run(()=>{onAdded(addCard(deskId,{title:note.slice(0,100),detail:note,source:{kind:'note',pageId:deskId,blockId:'',quote:note,signature:'',label:de?'Eigene Annahme':'Own assumption'}}));setNote('')})}>{de?'Als Annahme hinzufügen':'Add as assumption'}</button></details>
  {busy&&<p role="status">{de?'Quelle wird verarbeitet …':'Processing source …'} <button className="btn btn--sm" onClick={()=>{controller.current?.abort();setBusy(false)}}>{de?'Abbrechen':'Cancel'}</button></p>}
 </div>
}
