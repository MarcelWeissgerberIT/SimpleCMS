import {useEffect,useRef,useState} from 'react'
import type {MockBlockData} from '@/shared/ai/mockBlock'
import type {MockFeedback} from '@/shared/ai/mockReview'
import {applyMockMarkdown} from './mockSourceChecks'
import {persistMockMarkdown} from './MockRevisionActions'
export function MockMarkdownPanel({data,note,de,editable}:{data:MockBlockData;note:MockFeedback;de:boolean;editable:boolean}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),ctrl=useRef<AbortController|null>(null)
 useEffect(()=>()=>ctrl.current?.abort(),[])
 const c=note.markdown,originalSources=data.preview?.provenance?.sources
 const sources=c?.source&&originalSources?.some(s=>s.server===c.source!.server&&new URL(s.url).origin===new URL(c.source!.url).origin)?[c.source]:originalSources
 if(!c)return null
 const apply=async()=>{if(!sources||!data.journal||ctrl.current)return;const controller=new AbortController();ctrl.current=controller;setBusy(true);setError('');try{await applyMockMarkdown(sources,c,controller.signal,next=>persistMockMarkdown(data.journal!.id,note.id,next))}catch(e){setError(String(e instanceof Error?e.message:e))}finally{ctrl.current=null;setBusy(false)}}
 return <section className="mock-markdown"><h4>{de?'MD-Änderungsvorschlag':'Markdown proposal'} · <a href={c.url} target="_blank" rel="noreferrer">#{c.ref}</a></h4><details><summary>{de?'Vorher / Nachher prüfen':'Review before / after'}</summary><div className="mock-comparison__columns"><div><strong>{de?'Vorher':'Before'}</strong><pre>{c.before}</pre></div><div><strong>{de?'Nachher':'After'}</strong><pre>{c.after}</pre></div></div></details>
 <p>{c.state==='verified'?(de?'In Atlas zurückgelesen und bestätigt: ':'Read back and verified in Atlas: ')+(c.verifiedAt??''):c.state==='uncertain'?(de?'Übertragung unklar. Erneutes Prüfen liest nur; es schreibt nicht nochmals.':'Delivery uncertain. Rechecking only reads; it does not repeat the write.'):(de?'Ersetzt ausschließlich den gezeigten MD-Inhalt. Der Ausgangsstand wird vor dem Schreiben erneut geprüft.':'Replaces only the displayed Markdown. The base is checked again before writing.')}</p>
 <button type="button" className="btn btn--sm" disabled={!editable||busy||!sources||c.state==='verified'||c.before===c.after} onClick={()=>void apply()}>{busy?(de?'Atlas wird geprüft …':'Checking Atlas …'):c.state==='uncertain'?(de?'Speicherung erneut prüfen':'Recheck saved content'):(de?'MD-Änderung freigeben und speichern':'Approve and save Markdown change')}</button>{c.before===c.after&&<p>{de?'Keine MD-Änderung erforderlich.':'No Markdown change needed.'}</p>}{error&&<p role="alert">{error}</p>}</section>
}
