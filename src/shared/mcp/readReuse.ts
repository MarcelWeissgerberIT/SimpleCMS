import {canonicalJson} from './duplicates.ts'
import {sourceBytes} from './sourceLimits.ts'
/** Short-lived, task-local reuse. Never survives a write attempt or catalogue refresh. */
export class McpReadReuse {
 private entries=new Map<string,{value:string;at:number;bytes:number}>()
 private bytes=0
 private now:()=>number
 private maxBytes:number
 private ttl:number
 constructor(now=()=>Date.now(),maxBytes=16*1024*1024,ttl=30_000){this.now=now;this.maxBytes=maxBytes;this.ttl=ttl}
 key(server:string,name:string,args:Record<string,unknown>){return canonicalJson([server,name,args])}
 get(key:string){const entry=this.entries.get(key);if(!entry)return null;if(this.now()-entry.at>=this.ttl){this.entries.delete(key);this.bytes-=entry.bytes;return null}return {value:entry.value,at:entry.at}}
 put(key:string,value:string){const bytes=sourceBytes(value);if(bytes>this.maxBytes)return;const old=this.entries.get(key);if(old){this.bytes-=old.bytes;this.entries.delete(key)}
  while(this.entries.size&&(this.entries.size>=128||this.bytes+bytes>this.maxBytes)){const key=this.entries.keys().next().value!;this.bytes-=this.entries.get(key)!.bytes;this.entries.delete(key)}
  this.entries.set(key,{value,at:this.now(),bytes});this.bytes+=bytes
 }
 clear(){this.entries.clear();this.bytes=0}
}
/** Identity, access checks and mutable job status must always reach the service. */
export const reusableMcpRead=(name:string,effect:string)=>effect==='read'&&!name.startsWith('atlas_code_')&&!/whoami|identity|auth|permission|constraint|status|job|poll|setup|session/i.test(name)
