import {fitLocalToolContext} from './local-context.ts'
/** Reuse bounded result excerpts on Anthropic too. Keep human input, tool arguments,
 * signed thinking and non-text blocks verbatim; never summarize source facts. */
export function fitNativeToolContext<T extends {role:string;content:unknown}>(messages:T[],byteBudget:number):T[]{
 const bytes=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v)).length
 if(bytes(messages)<=byteBudget)return messages
 const encoded=messages.map(m=>({role:(Array.isArray(m.content)&&m.content.some((b:any)=>b?.type==='tool_use'||b?.type==='tool_result')?m.role:'system') as 'user'|'assistant'|'system',content:JSON.stringify(m.content)}))
 const decode=(rows:typeof encoded)=>rows.map((m,i)=>({...messages[i]!,content:JSON.parse(m.content)}))
 const fitted=fitLocalToolContext(encoded,rows=>bytes(decode(rows))<=byteBudget)
 return decode(fitted)
}
