/** Host-produced page-window metadata. Text inside a document never controls pagination. */
export type PageReadWindow={pageId:string;offset:number;nextOffset:number|null;totalCharacters:number;bodyStart:number;characters:number;partial:boolean;version?:string}
export class PageReadBuffer {
 private parts=new Map<number,string>();private total:number|null=null
 private identity:string|null=null;private received=0
 reset(){this.parts.clear();this.total=null;this.identity=null;this.received=0}
 add(window:PageReadWindow,content:string){
  const {offset,nextOffset,totalCharacters,bodyStart,characters}=window
  if(![offset,totalCharacters,bodyStart,characters].every(n=>Number.isSafeInteger(n)&&n>=0)||bodyStart+characters>content.length||offset+characters>totalCharacters||nextOffset!==null&&nextOffset!==offset+characters||nextOffset===null&&offset+characters!==totalCharacters||this.total!==null&&this.total!==totalCharacters)throw Error('Invalid host source window')
  const identity=JSON.stringify([window.pageId,window.version??null,window.partial])
  if(this.identity!==null&&this.identity!==identity)throw Error('Source version or permitted scope changed; start a fresh source read.')
  const part=content.slice(bodyStart,bodyStart+characters)
  for(const [start,text] of this.parts){
   const from=Math.max(start,offset),to=Math.min(start+text.length,offset+part.length)
   if(from<to&&text.slice(from-start,to-start)!==part.slice(from-offset,to-offset))throw Error('Overlapping source windows disagree; read the current version again.')
  }
  this.identity=identity;this.total=totalCharacters;this.received+=characters
  // Merge equal overlapping/adjacent intervals. Out-of-order reads cannot hide a gap.
  const sorted=[...this.parts,[offset,part] as [number,string]].sort(([a],[b])=>a-b)
  this.parts.clear()
  for(const [start,text] of sorted){
   const last=[...this.parts].at(-1)
   if(last&&start<=last[0]+last[1].length){const extra=start+text.length-(last[0]+last[1].length);if(extra>0)this.parts.set(last[0],last[1]+text.slice(-extra))}
   else this.parts.set(start,text)
  }
 }
 nextOffset(){const first=this.parts.entries().next().value;return first?.[0]===0?first[1].length:0}
 complete(){return this.total!==null&&this.nextOffset()===this.total}
 text(){return this.parts.get(0)??''}
 coverage(){const unique=[...this.parts.values()].reduce((n,text)=>n+text.length,0);return {uniqueCharacters:unique,duplicateCharacters:this.received-unique,totalCharacters:this.total??0,complete:this.complete(),nextOffset:this.nextOffset()}}
}
/** Exact line/paragraph excerpts. Long lines are split, never silently dropped. Ref IDs stay stable before focus selection. */
export function sourcePassages(text:string,prefix:string,maxLength=1000){
 const quotes:string[]=[]
 for(const raw of text.split(/\n+/u)){
  let rest=raw.replace(/⟦b\d+⟧\s*/g,'').trim()
  while(rest){
   if(rest.length<=maxLength){quotes.push(rest);break}
   const boundary=rest.lastIndexOf(' ',maxLength)
   let end=boundary>maxLength*.6?boundary:maxLength
   if(end>0&&/[\uD800-\uDBFF]/u.test(rest[end-1]!))end--
   const quote=rest.slice(0,end).trim();if(quote)quotes.push(quote);rest=rest.slice(end).trim()
  }
 }
 return quotes.map((quote,i)=>({ref:prefix+String(i+1).padStart(2,'0'),quote}))
}
