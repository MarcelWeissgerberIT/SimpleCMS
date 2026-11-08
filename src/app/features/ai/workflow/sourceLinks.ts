import type {Trace} from './inventory'
/** Exact recorded sources only; matching words or titles never create a relationship. */
export function sourceConnections(traces:Trace[]){
 const groups=new Map<string,{title:string;owners:Array<{trace:Trace;version?:string;changed?:boolean}>}>()
 for(const trace of traces){
  const sources=[...(trace.sources??[]),...trace.references.map(r=>({key:JSON.stringify(['code',r.server,r.atlasUrl?new URL(r.atlasUrl).origin:'',r.citation.repo,r.citation.path,r.citation.snapshot,r.citation.commit]),title:[r.repoName,r.citation.path].filter(Boolean).join(' · '),version:r.citation.commit.slice(0,12),changed:trace.changedReferences?.some(c=>c.server===r.server&&JSON.stringify(c.citation)===JSON.stringify(r.citation))}))]
  for(const s of sources){const g=groups.get(s.key)??{title:s.title,owners:[]};if(!g.owners.some(o=>o.trace.id===trace.id))g.owners.push({trace,version:s.version,changed:s.changed});groups.set(s.key,g)}
 }
 return [...groups.entries()].filter(([,g])=>g.owners.length>1||g.owners.some(o=>o.changed)).map(([key,g])=>({key,...g}))
}
