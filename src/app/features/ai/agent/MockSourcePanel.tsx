import {useEffect,useRef,useState} from 'react'
import type {MockBlockData} from '@/shared/ai/mockBlock'
import {checkpointMock,mockVersionKey,mockSourcesKey,currentMockSourceCheck,type MockFeedback} from '@/shared/ai/mockReview'
import {checkMockSources} from './mockSourceChecks'
import {sourceScope} from '../../io/import/sourceAtlas'
import {useWorkspace} from '../../../store/store'
import {useCloud} from '../../../cloud'
import {elementPath} from './mockEvolution'
export function MockSourcePanel({value,onChange,editable,de,compact=false,onOpen}:{value:MockBlockData;onChange:(v:MockBlockData,sourceCheck?:boolean)=>void;editable:boolean;de:boolean;compact?:boolean;onOpen?:()=>void}){
 const latest=useRef({value,onChange,editable});latest.current={value,onChange,editable}
 // A changed personal access or workspace must invalidate the visible result too.
 useWorkspace(s=>s.settings);useWorkspace(s=>s.epoch);useWorkspace(s=>s.integrations);useWorkspace(s=>s.ai);useCloud(s=>s.active);useCloud(s=>s.user)
 const scope=sourceScope(),p=value.preview,receipt=p?.provenance,key=p?mockSourcesKey(p):''
 const [rows,setRows]=useState<Awaited<ReturnType<typeof checkMockSources>>>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[checked,setChecked]=useState(false),[notice,setNotice]=useState(''),ctrl=useRef<AbortController|null>(null)
 const check=async()=>{
  ctrl.current?.abort();const c=new AbortController();ctrl.current=c;setBusy(true);setError('');setNotice('');setChecked(false);setRows([])
  try{
   if(!receipt?.sources.length)throw Error(de?'Kein vollständiger Quellenstand hinterlegt.':'No complete source receipt is available.')
   const results=await checkMockSources(receipt.sources,c.signal),current=latest.current
   if(c.signal.aborted||scope!==sourceScope()||!current.value.preview||mockSourcesKey(current.value.preview)!==key)return
   setRows(results);setChecked(true)
   if(current.editable){const journal=current.value.journal??{id:crypto.randomUUID(),notes:[],versions:[]};current.onChange({...current.value,journal:{...journal,sourceCheck:{version:mockVersionKey(current.value.preview),sourceHash:key,rows:results}}},true)}
  }catch(e){if(!c.signal.aborted){setRows([]);setError(String(e instanceof Error?e.message:e))}}
  finally{if(ctrl.current===c){ctrl.current=null;setBusy(false)}}
 }
 useEffect(()=>{if(receipt?.sources.length)void check();return()=>{ctrl.current?.abort();ctrl.current=null}},[key,scope])
 if(!p||!receipt)return null
 const saved=currentMockSourceCheck(value),visibleRows=checked?rows:saved?.rows??[]
 const changed=rows.filter(r=>r.changed),status=busy?'checking':error?'unavailable':checked?(changed.length?'changed':'current'):'unchecked'
 const title=busy?(de?'Atlas-Paket wird geprüft …':'Checking Atlas package …'):error?(de?'Atlas-Stand nicht prüfbar':'Atlas freshness unavailable'):checked?(changed.length?(de?'Atlas-Paket geändert':'Atlas package changed'):(de?'Verwendete Atlas-Quellen aktuell':'Used Atlas sources up to date')):(de?'Atlas-Stand noch nicht geprüft':'Atlas freshness not checked')
 const at=visibleRows.map(r=>r.at).sort()[0]
 const impacted=[...new Set((receipt.draft.components??[]).filter(c=>changed.some(r=>receipt.sources.find(s=>s.id===c.source)?.ref===r.ref)).map(c=>c.name))]
 const queue=(ref:number)=>{try{
  const doc=new DOMParser().parseFromString(p.document,'text/html'),names=receipt.draft.components.filter(c=>receipt.sources.find(s=>s.id===c.source)?.ref===ref).map(c=>c.name),els=[...doc.querySelectorAll('[data-ds-component]')].filter(e=>names.includes(e.getAttribute('data-ds-component')!))
  const next=checkpointMock(value,'Vor Quellenaktualisierung'),existing=next.journal!.notes
  const notes=(els.length?els.slice(0,8):[doc.body]).map(el=>({id:crypto.randomUUID(),at:new Date().toISOString(),version:mockVersionKey(p),element:{path:elementPath(el),tag:el.tagName.toLowerCase(),text:(el.textContent??'').slice(0,500),component:el.getAttribute('data-ds-component')??'',requirement:el.getAttribute('data-requirement')??'',snippet:el.outerHTML.slice(0,2000)},text:'Quelle #'+ref+' wurde geändert. Prüfe die aktuelle Definition und aktualisiere diese Stelle gezielt. Andere Bereiche beibehalten.',intent:'fix' as const,scope:'mock' as const,resolved:false,md:'none' as const})) satisfies MockFeedback[]
  if(existing.length+notes.length>150)throw Error('Notizlimit erreicht.')
  onChange({...next,journal:{...next.journal!,notes:[...existing,...notes]}});setNotice(de?'Aktualisierung unter Notizen vorgemerkt.':'Update queued under Notes.')
 }catch(e){setNotice(String(e))}}
 return <section className="mock-source-check" data-state={status} aria-label={de?'Atlas-Paketstand':'Atlas package freshness'}>
 <div className="mock-source-check__summary"><strong role="status">{title}</strong><button type="button" className="btn btn--sm" disabled={busy} onClick={()=>void check()}>{busy?(de?'Prüft …':'Checking …'):(de?'Quellen jetzt prüfen':'Check sources now')}</button>{compact&&onOpen&&<button type="button" className="btn btn--sm" onClick={onOpen}>{de?'Details in Atlas':'Atlas details'}</button>}</div>
 {checked&&changed.length>0&&<p>{de?'Geänderte Quellen: ':'Changed sources: '}{changed.map(r=>r.title).join(', ')}{impacted.length>0&&<> · {de?'Verwendete Komponenten: ':'Used components: '}{impacted.join(', ')}</>}. {de?'Der Mock verwendet noch den gespeicherten Stand.':'The mock still uses the saved version.'}</p>}
 {at&&<p className="faint">{checked?(de?'Geprüft: ':'Checked: '):(de?'Letzter gespeicherter Abgleich: ':'Last saved comparison: ')}{new Date(at).toLocaleString()}</p>}
 {error&&<p role="alert">{error} {de?'Der letzte gespeicherte Abgleich bestätigt den aktuellen Atlas-Stand nicht.':'The last saved comparison does not confirm the current Atlas version.'}</p>}
 {notice&&<p role="status">{notice}</p>}
 {!compact&&<><p className="faint">{de?'Beim Laden werden Paket und verwendete Quellen in Atlas neu gelesen. Änderungen werden erst nach deiner Annahme in den Mock übernommen. Nicht verwendete Paket-Komponenten werden hier nicht vollständig geprüft.':'Loading re-reads the package and used sources in Atlas. Changes reach the mock only after your acceptance. Unused package components are not fully checked here.'}</p>
 {visibleRows.length>0&&<ul>{visibleRows.map((r,i)=><li key={r.url+i}><a href={r.url} target="_blank" rel="noreferrer">{r.title}</a> · {r.changed?(de?'Geändert':'Changed'):(de?'Unverändert':'Unchanged')} · {new Date(r.at).toLocaleString()}{checked&&r.changed&&editable&&<button type="button" className="btn btn--sm" onClick={()=>queue(r.ref)}>{de?'Aktualisierung vormerken':'Queue update'}</button>}</li>)}</ul>}</>}
 </section>
}
