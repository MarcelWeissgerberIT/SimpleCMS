const objectRow=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v)
/** Evidence from actual Atlas responses only; scoped to one run and selected server origins. */
export class McpEvidence {
 private empty:{server:string;tool:string;filter:string;query?:string;project?:string;parent?:string}|null=null
 private latest:{server:string;tool:string;count:number;recordsAreExcerpts:true;arguments:Record<string,unknown>;records:Array<Record<string,unknown>>}|null=null
 private positive:typeof this.latest=null
 searchResult(){return this.latest}
 contradictsSearch(text:string){if(!this.positive||/(?:keine (?:weiteren|zusätzlichen)|no (?:additional|further|more))/i.test(text)||this.positive.records.some(r=>typeof r.ref==='number'&&text.includes('/r/'+r.ref)))return null;return this.positive&&/(?:keine?.{0,100}(?:Dokument|Treffer|Eintr[aä]g|Ergebnis|Quelle|Record).{0,100}(?:gefunden|vorhanden|vorliegen|vor)|(?:no|zero).{0,60}(?:documents?|records?|results?|matches|sources?))/i.test(text)?this.positive:null}
 private parents=new Map<string,string>()
 directory(server:string,projects:Array<{slug:string;parentSlug:string|null}>){for(const p of projects)if(typeof p.slug==='string'&&typeof p.parentSlug==='string')this.parents.set(JSON.stringify([server,p.slug]),p.parentSlug)}
 emptySearch(){return this.empty}
 private sources=new Map<string,{refs:Set<number>;urls:Set<string>}>()
 observe(raw:string,origin:string,call?:{server:string;name:string;arguments:Record<string,unknown>}){
  const response=JSON.parse(raw)
  if(call&&['atlas_search','atlas_query'].includes(call.name)){
   let data=response
   if(Array.isArray(response?.content)&&response.content.length===1&&response.content[0]?.type==='text'){try{data=JSON.parse(response.content[0].text)}catch{/* No count evidence. */}}
   const rows=data?.items??data?.rows
   if(Array.isArray(rows)){
    this.latest={server:call.server,tool:call.name,count:rows.length,recordsAreExcerpts:true,arguments:{...call.arguments},records:rows.slice(0,3).filter(objectRow).map(row=>Object.fromEntries(['ref','title','project','kind','summary'].filter(k=>Object.hasOwn(row,k)).map(k=>[k,typeof row[k]==='string'?row[k].slice(0,k==='summary'?700:240):row[k]])))}
    if(this.latest.records.some(r=>Number.isSafeInteger(r.ref)&&Number(r.ref)>0))this.positive=this.latest
    const kind=typeof call.arguments.kind==='string'?call.arguments.kind:typeof call.arguments.aql==='string'&&/\bkind\s*=/i.test(call.arguments.aql)?'AQL kind filter':''
    const query=call.name==='atlas_search'&&typeof call.arguments.q==='string'?call.arguments.q.trim():''
    const project=typeof call.arguments.project==='string'?call.arguments.project:'',parent=project?this.parents.get(JSON.stringify([call.server,project])):undefined
    const phrase=query.split(/\s+/).filter(Boolean).length>1
    this.empty=rows.length===0?(kind?{server:call.server,tool:call.name,filter:kind.slice(0,100)}:phrase?{server:call.server,tool:call.name,filter:'topic phrase',query:query.slice(0,200)}:parent?{server:call.server,tool:call.name,filter:'project with verified parent',project,parent}:null):null
   }
  }
  let source=this.sources.get(origin)
  if(!source){source={refs:new Set(),urls:new Set()};this.sources.set(origin,source)}
  const walk=(value:unknown,depth=0)=>{
   if(depth>20)return
   if(typeof value==='string'){
    for(const url of value.match(/https?:\/\/[^\s<>"\])]+/g)??[]){if(source.urls.size<1000)source.urls.add(url.replace(/[.,;:!?]+$/,''))}
    if(value.startsWith('{')||value.startsWith('[')){try{walk(JSON.parse(value),depth+1)}catch{/* Prose stays data. */}}
   }else if(Array.isArray(value))for(const v of value)walk(v,depth+1)
   else if(value&&typeof value==='object'){
    const data=value as Record<string,unknown>
    if(Number.isSafeInteger(data.ref)&&Number(data.ref)>0&&source.refs.size<2000)source.refs.add(Number(data.ref))
    for(const v of Object.values(data))walk(v,depth+1)
   }
  }
  walk(response)
 }
 check(text:string){
  const invalid:string[]=[]
  for(const raw of text.match(/https?:\/\/[^\s<>"\])]+/g)??[]){
   let url:URL;try{url=new URL(raw.replace(/[.,;:!?]+$/,''))}catch{continue}
   const source=this.sources.get(url.origin);if(!source?.refs.size||!/^\/(?:docs|r)(?:\/|$)/.test(url.pathname))continue
   const ref=/^\/r\/(\d+)$/.exec(url.pathname)
   if(!source.urls.has(url.href)&&!(ref&&source.refs.has(Number(ref[1]))))invalid.push(raw.slice(0,250))
  }
  return [...new Set(invalid)].slice(0,8)
 }
 hint(){return [...this.sources].map(([origin])=>`Atlas record URLs: ${origin}/r/<actual numeric ref from the tool result>. Never derive /docs/ URLs from titles.`).join('\n')}
}
