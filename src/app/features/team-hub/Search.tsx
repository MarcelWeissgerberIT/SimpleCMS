import {inTemplate} from '../../store/selectors'
import {searchHits} from '@/shared/mcp/searchHits'
import {useEffect,useRef,useState} from 'react'
import {useWorkspace} from '../../store/store'
import {useCloud} from '../../cloud'
import {navigate} from '../../lib/router'
import {useT} from '../../i18n'
import {readServers,searchConnected,type SearchSource} from '../ai/mcp-servers'
export default function Search({close}:{close:()=>void}){
 const t=useT(),cloud=useCloud(),[q,setQ]=useState(''),[used,setUsed]=useState(''),[selected,setSelected]=useState<string[]>([]),[results,setResults]=useState<SearchSource[]>([]),[busy,setBusy]=useState(false),abort=useRef<AbortController|null>(null)
 const pages=useWorkspace(s=>s.pages),servers=readServers().filter(s=>s.enabled)
 useEffect(()=>()=>{abort.current?.abort()},[cloud.active.id,cloud.user?.id])
 async function search(){abort.current?.abort();const c=new AbortController();abort.current=c;setResults([]);setUsed(q);setBusy(true);try{await searchConnected(q,selected,c.signal,r=>setResults(v=>[...v,r]))}catch(e){if(!c.signal.aborted)setResults([{source:'MCP',text:String(e),error:true}])}finally{if(abort.current===c)setBusy(false)}}
 const hits=used?Object.values(pages).filter(p=>!p.trashed&&!inTemplate(pages,p.id)&&(p.title+' '+p.plain).toLocaleLowerCase().includes(used.toLocaleLowerCase())).slice(0,30):[]
 return <section><p>{t('team.searchHint')}</p><form onSubmit={e=>{e.preventDefault();void search()}}><input className="input" aria-label={t('team.query')} value={q} maxLength={300} onChange={e=>setQ(e.target.value)}/><button className="btn btn--primary" disabled={busy||!q.trim()}>{t('team.search')}</button>{busy&&<button type="button" className="btn" onClick={()=>{abort.current?.abort();setBusy(false)}}>{t('team.stop')}</button>}</form><div className="team-hub__actions">{servers.map(s=><label key={s.id}><input type="checkbox" checked={selected.includes(s.name)} onChange={e=>setSelected(v=>e.target.checked?[...v,s.name]:v.filter(n=>n!==s.name))}/>{s.name}</label>)}</div>{used&&<h3>One · {hits.length}</h3>}{hits.map(p=><button className="btn" key={p.id} onClick={()=>{close();navigate({name:'page',id:p.id})}}>{p.title}</button>)}{results.map((r,i)=><article key={i}><details open><summary>{r.source}{r.tool?' · '+r.tool:''}</summary>{searchHits(r.text).map((hit,n)=><article key={n}>{hit.url?<a href={hit.url} target="_blank" rel="noreferrer">{hit.title}</a>:<strong>{hit.title}</strong>}<p>{hit.snippet}</p></article>)}<details><summary>{t('team.sourceResponse')}</summary><pre role={r.error?'alert':undefined}>{r.text}</pre></details>{r.error&&<p role="alert">{r.text}</p>}</details></article>)}</section>
}
