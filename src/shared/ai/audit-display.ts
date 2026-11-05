import {atlasReceipt} from '../mcp/facts.ts'
const object=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null
/** Inspect transport envelopes only; errors mentioned inside document bodies are source text. */
export function auditResultFailed(value:unknown,depth=0):boolean{
 if(depth>8)return false
 if(typeof value==='string'){try{return auditResultFailed(JSON.parse(value),depth+1)}catch{return false}}
 const v=object(value);if(!v)return false
 if(v.isError===true||v.oneNotExecuted===true||atlasReceipt('',v).outcome==='error')return true
 return v.result!==undefined&&auditResultFailed(v.result,depth+1)
}
export const AUDIT_PREVIEW_CHARS=16000
export function auditPreview(value:unknown){
 const text=typeof value==='string'?value:JSON.stringify(value,null,2)??''
 return {text:text.slice(0,AUDIT_PREVIEW_CHARS),truncated:text.length>AUDIT_PREVIEW_CHARS}
}
