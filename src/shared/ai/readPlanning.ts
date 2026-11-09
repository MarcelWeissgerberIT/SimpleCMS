/** Planning heuristic, not provider billing or an exact tokenizer. */
export const estimatedReadTokens = (text: string) => Math.ceil(new TextEncoder().encode(text).length / 3)
export interface ReadBudget { maxCharacters:number; estimatedTokens:number }
export const STANDARD_READ:ReadBudget={maxCharacters:36_000,estimatedTokens:12_000}
export const SMALL_READ:ReadBudget={maxCharacters:5_000,estimatedTokens:1_700}

/** Keep headings and fenced code together when possible, with a hard bound even for huge blocks. */
export function sourceWindowEnd(text:string,offset:number,budget:ReadBudget):number {
 let end=Math.min(text.length,offset+budget.maxCharacters)
 if(estimatedReadTokens(text.slice(offset,end))>budget.estimatedTokens){
  let low=offset,high=end
  while(low<high){const mid=Math.ceil((low+high)/2);if(estimatedReadTokens(text.slice(offset,mid))<=budget.estimatedTokens)low=mid;else high=mid-1}
  end=low
 }
 if(end<text.length){
  let fence:string|null=null,last=offset
  const prefix=text.slice(0,end)
  const lines=prefix.matchAll(/^.*(?:\n|$)/gm)
  for(const line of lines){const start=line.index!,value=line[0],mark=value.match(/^\s{0,3}(`{3,}|~{3,})/)
   if(mark){if(!fence)fence=mark[1];else if(mark[1][0]===fence[0]&&mark[1].length>=fence.length)fence=null}
   if(!fence&&start>offset&&(/^[ \t]*\n$/.test(value)||/^#{1,6}\s/.test(value)))last=start
  }
  if(last>offset+(end-offset)*.6)end=last
 }
 if(end>offset&&/[\uD800-\uDBFF]/u.test(text[end-1]!))end--
 return end
}

/** Bounded concurrent reads; queued work observes cancellation before starting. */
export class ReadPool {
 private active=0;private queue:Array<()=>void>=[]
 private limit:number
 constructor(limit=3){this.limit=limit;if(!Number.isInteger(limit)||limit<1)throw Error('Invalid read concurrency')}
 async run<T>(read:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
  signal?.throwIfAborted()
  if(this.active>=this.limit)await new Promise<void>(resolve=>this.queue.push(resolve));else this.active++
  try{signal?.throwIfAborted();return await read()}
  finally{const next=this.queue.shift();if(next)next();else this.active--}
 }
}
