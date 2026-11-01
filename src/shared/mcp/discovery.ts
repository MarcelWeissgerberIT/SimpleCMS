/** Rank the already authorised catalogue. This discovers tools, never record content. */
export function discoverMcpTools<T extends {name:string;description?:string;server?:string}>(tools:T[],query:string):T[] {
 const norm=(s:string)=>s.toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim()
 const q=norm(query),direct=tools.filter(t=>norm(t.name)===q)
 if(direct.length)return direct.slice(0,6)
 if(/^atlas_[a-z0-9_]+$/i.test(query.trim()))return []
 const exact=tools.filter(t=>query.toLowerCase().split(/[^a-z0-9_]+/).includes(t.name.toLowerCase()))
 if(exact.length)return exact.slice(0,6)
 const terms=q.split(' ').filter(t=>t.length>1&&!['atlas','mcp','tool','tools','server','the','in','nach','zum','von','aus'].includes(t))
 const atlas=/\batlas\b/.test(q)||tools.length>0&&tools.every(t=>t.name.startsWith('atlas_'))
 const reads=/work|week|woche|updated|recent|arbeit|task|aufgab|priorit/.test(q)
 const hasRef=/\/r\/\d+|\b(?:ref|record|dokument|testdokument|datensatz)\s*#?\s*\d+\b/i.test(query)
 const defaults=hasRef?['atlas_get','atlas_search','atlas_query','atlas_project_list']:reads?['atlas_query','atlas_search','atlas_project_list','atlas_get']:['atlas_search','atlas_query','atlas_project_list','atlas_get']
 return tools.map((t,i)=>{
  const name=norm(t.name),desc=norm(t.description??'')
  let score=(atlas&&t.name.startsWith('atlas_')?1:0)+terms.reduce((s,w)=>s+(name.split(' ').includes(w)?48:desc.includes(w)?1:0),0)
  // Topic words such as "Laborbuch" are arguments of search/query, not names of dedicated tools.
  const fallback=atlas&&t.name.startsWith('atlas_')?defaults.indexOf(t.name):-1
  if(fallback>=0)score+=40-fallback*4
  return {t,i,score}
 }).filter(v=>v.score>0).sort((a,b)=>b.score-a.score||a.i-b.i).slice(0,6).map(v=>v.t)
}

/** An exact user-supplied record target resolves a bare Atlas catalogue request, not permissions or content. */
export function taskMcpDiscoveryQuery(goal:string,query:string):string {
 const text=goal.replace(/["“„`][^"“”„`]*["”`]/g,'')
 const known=/\batlas\b/iu.test(text)&&/\b(?:ref|record|datensatz)\s*[:#]?\s*\d+\b|\/r\/\d+\b/iu.test(text)
 return known&&/^(?:aj[- ]?)?atlas$/iu.test(query.trim())?'atlas_get':query
}
export const MCP_DISCOVERY_NOTE='Tool discovery only, not a content read. Use the returned exact function for the requested operation. For a known numeric Atlas Ref, call atlas_get(ref); do not full-text search its digits. Request parts [body] for a bounded body analysis. Only topic searches use atlas_search q; date/status searches may use atlas_query. Empty discovery is not evidence of missing records. ONE coding tasks/pipelines are not Atlas records. Discover exact tool names for specialised operations.'
