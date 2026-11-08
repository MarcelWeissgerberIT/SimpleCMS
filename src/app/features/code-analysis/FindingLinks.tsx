import {useMemo} from 'react'
import {useWorkspace} from '../../store/store'
import {isEffectivelyTrashed,inTemplate} from '../../store/selectors'
import {mockBlockData} from '@/shared/ai/mockBlock'
import {mockVersionKey,currentMockSourceCheck} from '@/shared/ai/mockReview'
import type {Finding,FindingReview,Report} from '@/shared/codeAnalysis/model'
type MockLink={key:string;page:string;block:string;journal:string;note:string;title:string;changed:boolean;versionChanged:boolean}
const mockIndex=new WeakMap<object,MockLink[]>()
/** User-owned associations, kept outside the model-authored report. */
export function FindingLinks({finding,report,value,onChange,disabled,de}:{finding:Finding;report:Report;value?:FindingReview;onChange:(v:FindingReview)=>void;disabled:boolean;de:boolean}){
 const pages=useWorkspace(s=>s.pages)
 const mocks=useMemo(()=>{const cached=mockIndex.get(pages);if(cached)return cached;const out:MockLink[]=[];let seen=0
  const visit=(n:any,page:string,depth=0)=>{if(depth>40||seen++>50000)return
   if(n.type==='designMock'&&n.attrs?.id){const m=mockBlockData(n.attrs.spec);for(const note of m.journal?.notes??[])out.push({key:JSON.stringify([page,n.attrs.id,m.journal!.id,note.id]),page,block:n.attrs.id,journal:m.journal!.id,note:note.id,title:pages[page].title+' · '+note.text.slice(0,180),changed:!!currentMockSourceCheck(m)?.rows.some(r=>r.changed),versionChanged:!!m.preview&&mockVersionKey(m.preview)!==(note.appliedIn??note.version)})}
   for(const c of n.content??[])visit(c,page,depth+1)
  }
  for(const p of Object.values(pages))if(p.content&&!isEffectivelyTrashed(pages,p.id)&&!inTemplate(pages,p.id))visit(p.content,p.id)
  mockIndex.set(pages,out);return out
 },[pages])
 const v=value??{finding:finding.id,requirements:[],note:''},linked=mocks.find(m=>m.page===v.mock?.page&&m.block===v.mock.block&&m.journal===v.mock.journal&&m.note===v.mock.note)
 const shared=report.requirements.filter(r=>[...r.implementation,...r.tests].some(e=>[...finding.support,...finding.against].includes(e)))
 return <section className="finding-links"><h4>{de?'Anforderungen und Mock-Markierung':'Requirements and mock marking'}</h4>
 {shared.length>0&&<p>{de?'Gemeinsame Belege: ':'Shared evidence: '}{shared.map(r=>r.text).join(' · ')}</p>}
 <details><summary>{de?'Anforderungen zuordnen':'Link requirements'} · {v.requirements.length}</summary>{!report.requirements.length&&<p>{de?'In diesem Bericht sind keine Anforderungen erfasst.':'No requirements recorded in this report.'}</p>}{report.requirements.map(r=><label key={r.id}><input type="checkbox" disabled={disabled} checked={v.requirements.includes(r.id)} onChange={e=>onChange({...v,requirements:e.target.checked?[...v.requirements,r.id]:v.requirements.filter(id=>id!==r.id)})}/>{r.text}</label>)}</details>
 <ul>{report.requirements.filter(r=>v.requirements.includes(r.id)).map(r=><li key={r.id}>{r.text}{r.gap?' · '+r.gap:''}</li>)}</ul>
 <label>{de?'Mock-Notiz verknüpfen':'Link mock note'} <select className="input" disabled={disabled} value={linked?.key??(v.mock?'missing':'')} onChange={e=>{const m=mocks.find(m=>m.key===e.target.value);onChange({...v,mock:m?{page:m.page,block:m.block,journal:m.journal,note:m.note}:undefined})}}><option value="">—</option>{v.mock&&!linked&&<option value="missing">{de?'Verknüpfung nicht mehr verfügbar':'Link no longer available'}</option>}{mocks.map(m=><option key={m.key} value={m.key}>{m.title}</option>)}</select></label>
 {linked&&<><button type="button" className="btn btn--sm" onClick={()=>{window.location.hash='/p/'+encodeURIComponent(linked.page)+'?'+new URLSearchParams({b:linked.block,mockJournal:linked.journal,mockNote:linked.note})}}>{de?'Mock-Markierung öffnen':'Open mock marking'}</button>{linked.changed&&<p role="status">{de?'Designquelle geändert – verknüpftes Finding nachprüfen.':'Design source changed — recheck linked finding.'}</p>}{linked.versionChanged&&<p>{de?'Der Mock steht auf einer anderen Version als diese Markierung.':'The mock uses a different version from this marking.'}</p>}</>}
 <label>{de?'Prüfnotiz':'Review note'}<textarea className="input" aria-label={de?'Prüfnotiz':'Review note'} maxLength={2000} disabled={disabled} value={v.note} onChange={e=>onChange({...v,note:e.target.value})}/></label>
 </section>
}
