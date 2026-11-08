import type {Trace} from './inventory'
/** Exact recorded sources only; matching words or titles never create a relationship. */
export function sourceConnections(traces:Trace[]){
 const groups=new Map<string,{title:string;owners:Array<{trace:Trace;version?:string;changed?:boolean}>}>()
 for(const trace of traces){
  const sources=[...(trace.sources??[]),...trace.references.map(r=>({key:JSON.stringify(['code',r.server,r.atlasUrl?new URL(r.atlasUrl).origin:'',r.citation.repo,r.citation.path,r.citation.snapshot,r.citation.commit]),title:[r.repoName,r.citation.path].filter(Boolean).join(' · '),version:r.citation.commit.slice(0,12),changed:false}))]
  for(const s of sources){const g=groups.get(s.key)??{title:s.title,owners:[]};if(!g.owners.some(o=>o.trace.id===trace.id))g.owners.push({trace,version:s.version,changed:s.changed});groups.set(s.key,g)}
 }
 return [...groups.entries()].filter(([,g])=>g.owners.length>1).map(([key,g])=>({key,...g}))
}
export function SourceConnections({traces,de,go,pages}:{traces:Trace[];pages:Record<string,{title:string}>;de:boolean;go:(page:string,block?:string)=>void}){
 const groups=sourceConnections(traces)
 return <section className="source-connections"><h3>{de?'Gemeinsam verwendete Quellen':'Shared source connections'}</h3><p>{de?'Diese Verbindungen stammen aus gespeicherten Quellenverweisen. Ein geänderter Atlas-Abgleich zeigt mögliche Auswirkungen; die Inhalte müssen einzeln geprüft werden.':'These connections come from saved source references. A changed Atlas comparison indicates possible impact; each result still needs review.'}</p>{!groups.length&&<p>{de?'Noch keine gemeinsam referenzierten Quellen gefunden.':'No shared source references found yet.'}</p>}{groups.slice(0,40).map(g=><details key={g.key}><summary>{g.title} · {g.owners.length} {de?'Verknüpfungen':'connections'}</summary>{g.owners.some(o=>o.changed)&&<p className="workflow-gap">{de?'Gespeicherter Atlas-Abgleich meldet eine Änderung. Prüfe die verknüpften Ergebnisse.':'A saved Atlas comparison reports a change. Recheck the linked results.'}</p>}{g.owners.map(o=><div key={o.trace.id}><strong>{pages[o.trace.page]?.title} · {o.trace.title}</strong>{o.version&&<small> · {de?'Gespeicherter Stand: ':'Saved version: '}{o.version}</small>}<button type="button" className="btn btn--sm" onClick={()=>go(o.trace.page,o.trace.block)}>{de?'Verknüpfte Stelle öffnen':'Open linked location'}</button></div>)}</details>)}{groups.length>40&&<p>{de?'Weitere Verbindungen stehen an den Originalstellen.':'More connections are available at their original locations.'}</p>}</section>
}
