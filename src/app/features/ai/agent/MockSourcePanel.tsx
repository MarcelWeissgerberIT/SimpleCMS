import {useEffect,useRef,useState} from 'react'
import type {MockBlockData} from '@/shared/ai/mockBlock'
import {checkpointMock,mockVersionKey,type MockFeedback} from '@/shared/ai/mockReview'
import {checkMockSources} from './mockSourceChecks'
import {elementPath} from './mockEvolution'
export function MockSourcePanel({value,onChange,editable,de}:{value:MockBlockData;onChange:(v:MockBlockData)=>void;editable:boolean;de:boolean}){
 const [rows,setRows]=useState<Awaited<ReturnType<typeof checkMockSources>>>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),ctrl=useRef<AbortController|null>(null)
 useEffect(()=>()=>ctrl.current?.abort(),[])
 const p=value.preview,receipt=p?.provenance
 if(!p||!receipt)return null
 const check=async()=>{if(ctrl.current)return;const c=new AbortController();ctrl.current=c;setBusy(true);setError('');try{setRows(await checkMockSources(receipt.sources,c.signal))}catch(e){setRows([]);setError(String(e instanceof Error?e.message:e))}finally{ctrl.current=null;setBusy(false)}}
 const queue=(ref:number)=>{try{
  const doc=new DOMParser().parseFromString(p.document,'text/html'),names=receipt.draft.components.filter(c=>receipt.sources.find(s=>s.id===c.source)?.ref===ref).map(c=>c.name),els=[...doc.querySelectorAll('[data-ds-component]')].filter(e=>names.includes(e.getAttribute('data-ds-component')!))
  const next=checkpointMock(value,'Vor Quellenaktualisierung'),existing=next.journal!.notes
  const notes=(els.length?els.slice(0,8):[doc.body]).map(el=>({id:crypto.randomUUID(),at:new Date().toISOString(),version:mockVersionKey(p),element:{path:elementPath(el),tag:el.tagName.toLowerCase(),text:(el.textContent??'').slice(0,500),component:el.getAttribute('data-ds-component')??'',requirement:el.getAttribute('data-requirement')??'',snippet:el.outerHTML.slice(0,2000)},text:'Quelle #'+ref+' wurde geändert. Prüfe die aktuelle Definition und aktualisiere diese Stelle gezielt. Andere Bereiche beibehalten.',intent:'fix' as const,scope:'mock' as const,resolved:false,md:'none' as const})) satisfies MockFeedback[]
  if(existing.length+notes.length>150)throw Error('Notizlimit erreicht.')
  onChange({...next,journal:{...next.journal!,notes:[...existing,...notes]}});setError(de?'Aktualisierung unter Notizen vorgemerkt.':'Update queued under Notes.')
 }catch(e){setError(String(e))}}
 return <section className="mock-source-check"><h4>{de?'Stand der Designquellen':'Design source freshness'}</h4><button type="button" className="btn btn--sm" disabled={busy} onClick={()=>void check()}>{busy?(de?'Quellen werden geprüft …':'Checking sources …'):(de?'Quellen jetzt prüfen':'Check sources now')}</button><p className="faint">{de?'Liest die verwendeten Atlas-Quellen erneut. Änderungen werden erst nach deiner Annahme in den Mock übernommen.':'Re-reads the Atlas sources. Changes reach the mock only after your acceptance.'}</p>
 {rows.length>0&&<ul>{rows.map((r,i)=><li key={r.url+i}><a href={r.url} target="_blank" rel="noreferrer">{r.title}</a> · {r.changed?(de?'Geändert':'Changed'):(de?'Unverändert':'Unchanged')} · {new Date(r.at).toLocaleString()}{r.changed&&editable&&<button type="button" className="btn btn--sm" onClick={()=>queue(r.ref)}>{de?'Aktualisierung vormerken':'Queue update'}</button>}</li>)}</ul>}{error&&<p role="status">{error}</p>}</section>
}
