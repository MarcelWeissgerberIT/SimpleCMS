/** Render only source-provided fields; never invent titles or deep links from opaque IDs. */
export interface SearchHit {title:string;url:string|null;snippet:string}
export function searchHits(raw:string):SearchHit[]{
 const hits:SearchHit[]=[],seen=new Set<string>();let visited=0
 const str=(v:unknown)=>typeof v==='string'?v:''
 const visit=(v:unknown,depth:number)=>{if(depth>10||++visited>800||hits.length>=30)return
  if(typeof v==='string'){if(v.length<200000&&/^[\[{]/.test(v.trim()))try{visit(JSON.parse(v),depth+1)}catch{}return}
  if(Array.isArray(v)){v.slice(0,100).forEach(x=>visit(x,depth+1));return}
  if(!v||typeof v!=='object')return
  const r=v as Record<string,unknown>,title=str(r.title)||str(r.name)||str(r.subject),rawUrl=str(r.url)||str(r.webUrl)||str(r.href)||str(r.link),snippet=str(r.snippet)||str(r.excerpt)||str(r.description)
  let url:string|null=null;try{const u=new URL(rawUrl);if(u.protocol==='https:'&&!u.username&&!u.password)url=u.href}catch{}
  if(title&&(url||snippet)){const key=title+'\n'+url;if(!seen.has(key)){seen.add(key);hits.push({title:title.slice(0,300),url,snippet:snippet.slice(0,800)})}}
  for(const [k,value]of Object.entries(r))if(!['inputSchema','schema','properties'].includes(k))visit(value,depth+1)
 }
 visit(raw,0);return hits
}
