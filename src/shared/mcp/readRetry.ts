/** Retry only reads explicitly refused by rate limiting, never ambiguous writes. */
export function mcpRateDelay(value:unknown,thrown=false):number|null {
 let v:any=value
 if(v instanceof Error)v={...v,message:v.message}
 if(typeof v?.result==='string'){try{v=JSON.parse(v.result)}catch{return null}}
 let failed=thrown||v?.isError===true||v?.ok===false||v?.status===429||v?.statusCode===429
 if(Array.isArray(v?.content)&&v.content.length===1&&v.content[0]?.type==='text'){
  const text=v.content[0].text;try{v=JSON.parse(text);failed ||= v?.ok===false||!!v?.error}catch{v={message:text}}
 }
 if(!failed)return null
 const text=typeof v?.error==='string'?v.error:typeof v?.error?.message==='string'?v.error.message:String(v?.message??'')
 if(v?.status!==429&&v?.statusCode!==429&&!/rate.?limit|too many (?:requests|aql queries)|\b429\b/i.test(text))return null
 const seconds=/retry (?:in|after)\s+(\d+(?:\.\d+)?)\s*s/i.exec(text)
 const ms=typeof v?.retryAfterMs==='number'?v.retryAfterMs:typeof v?.retryAfter==='number'?v.retryAfter*1000:seconds?Number(seconds[1])*1000:5000
 return Number.isFinite(ms)&&ms>=0&&ms<=90000?Math.max(250,ms):null
}
export function waitForMcp(ms:number,signal?:AbortSignal):Promise<void>{return new Promise((resolve,reject)=>{
 signal?.throwIfAborted()
 const stop=()=>{clearTimeout(timer);reject(signal?.reason??new Error('Stopped'))}
 const timer=setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve()},ms)
 signal?.addEventListener('abort',stop,{once:true})
})}
export async function retryMcpRead<T>(run:()=>Promise<T>,options:{read:boolean;signal?:AbortSignal;waiting?:(ms:number,attempt:number)=>void;wait?:(ms:number,signal?:AbortSignal)=>Promise<void>}):Promise<T>{
 let waited=0
 for(let attempt=0;;attempt++){
  options.signal?.throwIfAborted()
  let result:T|undefined,error:unknown,thrown=false
  try{result=await run()}catch(e){error=e;thrown=true}
  const delay=options.read?mcpRateDelay(thrown?error:result,thrown):null
  if(delay===null||attempt>=3||waited+delay>180000){if(thrown)throw error;return result!}
  waited+=delay;options.waiting?.(delay,attempt+1);await (options.wait??waitForMcp)(delay,options.signal)
 }
}
