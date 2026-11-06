import {sha256Hex} from './sha256.ts'
import {mockSourceState} from '../ai/designMock.ts'
import {atlasData} from './facts.ts'
/** Reuse needs a service-owned version AND unchanged lifecycle/scope metadata. */
export function sourceRecord(raw:string):Record<string,any>|null {
 try{const env=JSON.parse(raw);if(env.isError===true)return null;const data=atlasData(raw);if(!data||data.ok===false||data.error||data.truncated)return null;const r=data.item??data.record??data;return r&&Number.isSafeInteger(r.ref)&&r.ref>0&&!r.truncated?r:null}catch{return null}
}
export function sourceRevision(record:Record<string,any>):string|null {
 const fields=['updatedAt','updated_at','revision','version'].filter(k=>typeof record[k]==='string'&&record[k].length>0||typeof record[k]==='number'&&Number.isFinite(record[k]))
 return fields.length?JSON.stringify(fields.map(k=>[k,record[k]])):null
}
export interface SourceSnapshot {raw:string;hash:string;at:number}
export function revalidatedSource(snapshot:SourceSnapshot,metadata:string):string|null {
 if(!snapshot||typeof snapshot.raw!=='string'||typeof snapshot.hash!=='string'||!Number.isFinite(snapshot.at)||snapshot.at<0)return null
 if(sha256Hex(snapshot.raw)!==snapshot.hash)return null
 const old=sourceRecord(snapshot.raw),current=sourceRecord(metadata)
 if(!old||!current||typeof old.body!=='string'||old.ref!==current.ref)return null
 const version=sourceRevision(old)
 if(!version||version!==sourceRevision(current)||mockSourceState(old)!==mockSourceState(current))return null
 return JSON.stringify({item:{...current,body:old.body}})
}
