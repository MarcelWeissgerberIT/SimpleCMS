/** Display-only metadata from observed tool responses. Never changes calls or model context. */
export type McpDisplay={repo?:string;version?:string;path?:string;query?:string;lines?:string;title?:string;ref?:number;technical?:string;cached?:boolean}
const obj=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const clean=(v:unknown,n=240)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,n):''
const guid=/^[\da-f]{8}-[\da-f-]{27}$/i
const name=(v:unknown)=>{const s=clean(v);return guid.test(s)?'':s}
const commit=(v:unknown)=>typeof v==='string'&&/^[a-f\d]{7,64}$/i.test(v)?v.slice(0,8):''
const data=(v:unknown):Record<string,any>|null=>{try{const x=typeof v==='string'?JSON.parse(v):v;if(!obj(x)||x.isError)return null;if(obj(x.structuredContent))return x.structuredContent;if(Array.isArray(x.content)){if(x.content.length!==1||x.content[0]?.type!=='text')return null;return data(JSON.parse(x.content[0].text))}return x}catch{return null}}
const key=(...v:unknown[])=>JSON.stringify(v)
export class McpActivityNames{
 private repos=new Map<string,string>()
 private versions=new Map<string,string>()
 private records=new Map<string,string>()
 private sources=new Map<string,McpDisplay>()
 private put<T>(map:Map<string,T>,key:string,value:T){if(!value)return;if(map.size>=500&&!map.has(key))map.delete(map.keys().next().value!);map.set(key,value)}
 observe(server:string,tool:string,args:Record<string,unknown>,raw:unknown){
  const d=data(raw);if(!d||d.error)return
  if(tool==='atlas_code_repos')for(const r of Array.isArray(d.items)?d.items:[]){if(!obj(r)||typeof r.id!=='string')continue;this.put(this.repos,key(server,r.id),name(r.name));if(obj(r.newest))this.snapshot(server,r.id,r.newest)}
  if(tool==='atlas_code_versions')for(const s of Array.isArray(d.items)?d.items:[])this.snapshot(server,args.repo,s)
  if(tool.startsWith('atlas_code_')&&typeof d.snapshot==='string'&&commit(d.commit)){const k=key(server,d.repo??args.repo,d.snapshot),known=this.versions.get(k);if(!known?.endsWith(commit(d.commit)))this.put(this.versions,k,commit(d.commit))}
  if(['atlas_get','atlas_search','atlas_query'].includes(tool))for(const item of [d.item,...(Array.isArray(d.items)?d.items:[])])if(obj(item)&&Number.isSafeInteger(item.ref))this.put(this.records,key(server,args.tenant??null,item.ref),name(item.title))
 }
 private snapshot(server:string,repo:unknown,s:unknown){if(!obj(s)||typeof s.id!=='string')return;const label=[name(s.branch),commit(s.commit)].filter(Boolean).join(' · ');this.put(this.versions,key(server,repo,s.id),label)}
 retain(packed:string,display:McpDisplay){try{const d=JSON.parse(packed);if(typeof d.result_id==='string')this.put(this.sources,d.result_id,{...display,technical:undefined})}catch{/* no retained source */}}
 describe(server:string,tool:string,args:Record<string,unknown>):McpDisplay{
  const citation=obj(args.citation)?args.citation:{},repo=args.repo??citation.repo,snapshot=args.snapshot??citation.snapshot
  const inherited=typeof args.result_id==='string'?this.sources.get(args.result_id):undefined
  const start=args.startLine??(Array.isArray(citation.lines)?citation.lines[0]:undefined),end=args.endLine??(Array.isArray(citation.lines)?citation.lines[1]:undefined)
  const technical=Object.fromEntries(['repo','snapshot','path','startLine','endLine','query','q','prefix','ref','tenant','offset','result_id','citation','from','to'].filter(k=>Object.hasOwn(args,k)).map(k=>[k,args[k]]))
  return {...inherited,...(repo?{repo:this.repos.get(key(server,repo))||undefined,version:this.versions.get(key(server,repo,snapshot))||commit(citation.commit)||undefined}:{}),
   path:inherited?.path||clean(args.path??citation.path??args.prefix)||undefined,query:clean(args.query??args.q,200)||undefined,
   lines:Number.isSafeInteger(start)&&Number(start)>0?String(start)+(Number.isSafeInteger(end)&&Number(end)>=Number(start)?'–'+end:''):inherited?.lines,
   title:typeof args.ref==='number'?this.records.get(key(server,args.tenant??null,args.ref)):inherited?.title,
   ref:typeof args.ref==='number'?args.ref:inherited?.ref,technical:JSON.stringify(technical,null,2).slice(0,4000),cached:tool.startsWith('one_mcp_')&&tool.endsWith('_result')||undefined}
 }
}
const actions:Record<string,[string,string]>={
 atlas_code_repos:['Repositories anzeigen','List repositories'],atlas_code_versions:['Code-Stände anzeigen','List code versions'],atlas_code_files:['Dateien auflisten','List files'],atlas_code_search:['Code durchsuchen','Search code'],atlas_code_read:['Code lesen','Read code'],atlas_code_compare:['Code-Stände vergleichen','Compare code versions'],atlas_code_verify:['Quellbeleg prüfen','Verify source citation'],atlas_code_drafts:['Anforderungsentwürfe lesen','Read requirement drafts'],atlas_code_propose:['Anforderungsentwurf anlegen','Create requirement draft'],
 atlas_get:['Atlas-Eintrag lesen','Read Atlas record'],atlas_search:['Atlas durchsuchen','Search Atlas'],atlas_query:['Atlas-Abfrage ausführen','Query Atlas'],atlas_whoami:['Atlas-Zugang prüfen','Check Atlas identity'],atlas_create:['Atlas-Eintrag anlegen','Create Atlas record'],atlas_update:['Atlas-Eintrag aktualisieren','Update Atlas record'],atlas_comment:['Atlas-Kommentar speichern','Save Atlas comment'],
 one_mcp_search:['Werkzeuge suchen','Find tools'],one_mcp_read_result:['Gesicherte Quelle weiterlesen','Continue reading retained source'],one_mcp_find_result:['In gesicherter Quelle suchen','Search retained source'],one_mcp_list_results:['Gesicherte Quellen anzeigen','List retained sources']
}
export function mcpActivityText(tool:string,d:McpDisplay|undefined,arg:string|undefined,lang:string){
 const de=lang==='de',action=actions[tool]?.[de?0:1]??tool
 if(!d)return {action,detail:tool.startsWith('atlas_code_')?(de?'Details aufklappen':'Expand details'):arg??''}
 const parts=[d.repo,...(tool.startsWith('atlas_code_')&&!d.repo&&!['atlas_code_repos'].includes(tool)?[de?'Repository':'Repository']:[]),d.version?`${de?'Stand':'Version'} ${d.version}`:'',d.title??(d.ref?`#${d.ref}`:''),d.path,d.lines?`${de?'Zeilen':'Lines'} ${d.lines}`:'',d.query?`„${d.query}“`:''].filter(Boolean)
 return {action,detail:parts.join(' · ')||(!actions[tool]?arg??'':'')}
}
