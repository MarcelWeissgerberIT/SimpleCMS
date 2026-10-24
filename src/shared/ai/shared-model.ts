type ShareCryptoKey = Awaited<ReturnType<typeof globalThis.crypto.subtle.importKey>>
export interface SharedPublicKey {kty?:string;n?:string;e?:string;alg?:string;ext?:boolean;key_ops?:string[]}
/** Workspace-scoped text inference. The relay queues ciphertext, never worker credentials or tools. */
export const SHARED_PREFIX = 'one-shared/'
export const SHARED_INPUT_MAX = 22000
export const SHARED_QUEUE_MAX = 12
export interface SharedModel {
  id: string; workspace: string; model: string; label: string; owner: string; mine: boolean;
  /** Host checks local model metadata before sending context to inference. */
  dataFlow?: boolean;
  enabled: boolean; online: boolean; queued: number; running: boolean; publicKey: SharedPublicKey | null
}
export interface SharedText {
  model: string; messages: {role: 'system'|'user'|'assistant';content:string}[]; maxTokens:number
}
export interface SharedBox {v:1;iv:string;data:string;key?:string}
const bytes = (s:string) => Uint8Array.from(atob(s),c=>c.charCodeAt(0))
const b64 = (b:ArrayBuffer|Uint8Array) => {let s='';for(const c of new Uint8Array(b as ArrayBuffer))s+=String.fromCharCode(c);return btoa(s)}
const context = (share:string,id:string) => new TextEncoder().encode(`one-model-share:v1:${share}:${id}`)
export async function modelShareKey() {
  return globalThis.crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['wrapKey','unwrapKey'])
}
export async function sealShared(value:unknown,key:ShareCryptoKey,share:string,id:string):Promise<SharedBox> {
  const iv=globalThis.crypto.getRandomValues(new Uint8Array(12))
  const data=await globalThis.crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:context(share,id)},key,new TextEncoder().encode(JSON.stringify(value)))
  return {v:1,iv:b64(iv),data:b64(data)}
}
export async function openShared<T>(box:SharedBox,key:ShareCryptoKey,share:string,id:string):Promise<T> {
  const data=await globalThis.crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(box.iv),additionalData:context(share,id)},key,bytes(box.data))
  return JSON.parse(new TextDecoder().decode(data)) as T
}
export async function sharedRequestBox(value:SharedText,publicKey:SharedPublicKey,share:string,id:string) {
  const rsa=await globalThis.crypto.subtle.importKey('jwk',publicKey,{name:'RSA-OAEP',hash:'SHA-256'},false,['wrapKey'])
  const key=await globalThis.crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt'])
  const wrapped=await globalThis.crypto.subtle.wrapKey('raw',key,rsa,{name:'RSA-OAEP'})
  return {key,box:{...await sealShared(value,key,share,id),key:b64(wrapped)}}
}
export async function sharedWorkerKey(box:SharedBox,key:ShareCryptoKey) {
  if(!box.key)throw new Error('Missing request key')
  return globalThis.crypto.subtle.unwrapKey('raw',bytes(box.key),key,{name:'RSA-OAEP'},{name:'AES-GCM',length:256},false,['encrypt','decrypt'])
}
