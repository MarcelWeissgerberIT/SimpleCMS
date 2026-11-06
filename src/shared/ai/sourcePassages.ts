/** Host-produced page-window metadata. Text inside a document never controls pagination. */
export type PageReadWindow={pageId:string;offset:number;nextOffset:number|null;totalCharacters:number;bodyStart:number;characters:number;partial:boolean}
export class PageReadBuffer{
 private parts=new Map<number,string>();private total:number|null=null
 reset(){this.parts.clear();this.total=null}
 add(window:PageReadWindow,content:string){
  const {offset,nextOffset,totalCharacters,bodyStart,characters}=window
  if(![offset,totalCharacters,bodyStart,characters].every(n=>Number.isSafeInteger(n)&&n>=0)||bodyStart+characters>content.length||offset+characters>totalCharacters||nextOffset!==null&&nextOffset!==offset+characters||nextOffset===null&&offset+characters!==totalCharacters||this.total!==null&&this.total!==totalCharacters)throw Error('Invalid host source window')
  this.total=totalCharacters;this.parts.set(offset,content.slice(bodyStart,bodyStart+characters))
 }
 nextOffset(){let offset=0;for(const [start,part]of [...this.parts].sort(([a],[b])=>a-b)){if(start!==offset)break;offset+=part.length}return offset}
 complete(){return this.total!==null&&this.nextOffset()===this.total}
 text(){let offset=0,text='';for(const [start,part]of [...this.parts].sort(([a],[b])=>a-b)){if(start!==offset)break;text+=part;offset+=part.length}return text}
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
