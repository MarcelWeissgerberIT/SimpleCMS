/** A narrow check for an observed Atlas type error, not a replacement AQL parser.
 * Quoted values are skipped so a literal containing "tags =" is never reinterpreted. */
export function atlasQueryProblem(tool:string,args:Record<string,unknown>):string|null{
 if(!['atlas_search','atlas_query'].includes(tool)||typeof args.aql!=='string')return null
 if(args.aql.trim()&&typeof args.q==='string'&&args.q.trim())return 'Atlas query is ambiguous: aql overrides q, so the supplied topic would not be searched. Use q without aql for the topic search, or express the complete intended query in aql without q. Preserve tenant/project scope; do not silently discard or rewrite either query. No server call was sent.'
 const text=args.aql
 for(let i=0;i<text.length;){
  const ch=text[i]!
  if(ch==='"'||ch==="'"){const quote=ch;i++;while(i<text.length){if(text[i]==='\\'){i+=2;continue}if(text[i++]===quote)break}continue}
  if(/[a-z_]/i.test(ch)){const start=i++;while(i<text.length&&/[a-z0-9_.-]/i.test(text[i]!))i++;if(text.slice(start,i).toLowerCase()==='tags'){let next=i;while(/\s/.test(text[next]??'')&&next<text.length)next++;if(text[next]==='=')return 'Atlas AQL: tags is an array; scalar equality (=) is invalid. Use the array membership operator documented by the current Atlas query contract, or inspect a bounded result and filter its actual tags explicitly. Preserve tenant/project scope and report incomplete pagination. No server call was sent.'}continue}
  i++
 }
 return null
}
