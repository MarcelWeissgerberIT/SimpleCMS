/** Historical host checks for a private program receipt. Never consumed as execution authority. */
import {programDigest} from './program.ts'
import type {TaskReport,TaskFinding} from './task.ts'
import type {EvidenceQuantum} from './runtime.ts'
export type ProgramInspection={protocol:'one.program-inspection.v1';taskId:string;at:number;phase:TaskReport['phase'];contractHash:string;requestHash:string;dimensions:string[];findings:TaskFinding[];quanta:EvidenceQuantum[];observations:TaskReport['observations'];sources:{one:string[];atlas:string[];other:string[]};packetHash:string;packet?:Record<string,unknown>;packetOmitted:boolean}
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length<=max
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const strings=(v:unknown,max:number,length:number):v is string[]=>Array.isArray(v)&&v.length<=max&&v.every(x=>text(x,length))
const status=(v:unknown)=>['open','violated','verified'].includes(String(v))
const only=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).every(k=>keys.includes(k))
export function readProgramInspection(raw:unknown):ProgramInspection{
 const fail=():never=>{throw Error('Invalid program inspection receipt')}
 if(!object(raw)||!only(raw,['protocol','taskId','at','phase','contractHash','requestHash','dimensions','findings','quanta','observations','sources','packetHash','packet','packetOmitted']))fail()
 const v=raw as ProgramInspection
 if(v.protocol!=='one.program-inspection.v1'||!text(v.taskId,100)||!Number.isSafeInteger(v.at)||!['working','decision','ready','blocked','accepted'].includes(v.phase)||!hash(v.contractHash)||!hash(v.requestHash)||!strings(v.dimensions,32,80)||!hash(v.packetHash)||typeof v.packetOmitted!=='boolean')fail()
 if(!Array.isArray(v.findings)||v.findings.length>80||v.findings.some(f=>!object(f)||!only(f,['id','dimensions','status','hard','detail'])||!text(f.id,120)||!strings(f.dimensions,32,80)||!status(f.status)||typeof f.hard!=='boolean'||!text(f.detail,4000)))fail()
 if(new Set(v.findings.map(f=>f.id)).size!==v.findings.length||v.findings.some(f=>f.dimensions.some(d=>!v.dimensions.includes(d))))fail()
 if(!Array.isArray(v.quanta)||v.quanta.length>160||v.quanta.some(q=>!object(q)||!only(q,['id','obligation_id','dimensions','profile_hash','verifier','verifier_version','quantum_binding','dependencies','result','detail'])||!hash(q.id)||!hash(q.profile_hash)||!text(q.obligation_id,120)||!text(q.verifier,120)||!text(q.verifier_version,80)||!strings(q.dimensions,32,80)||!status(q.result)||!text(q.detail,4000)||!object(q.dependencies)||Object.keys(q.dependencies).length>40||Object.entries(q.dependencies).some(([k,val])=>!text(k,120)||!text(val,2000))||q.quantum_binding!==null&&(!object(q.quantum_binding)||!only(q.quantum_binding,['definition_id','definition_version','definition_hash'])||!text(q.quantum_binding.definition_id,120)||!text(q.quantum_binding.definition_version,80)||!hash(q.quantum_binding.definition_hash))))fail()
 if(new Set(v.quanta.map(q=>q.id)).size!==v.quanta.length||v.quanta.some(q=>!v.findings.some(f=>f.id===q.obligation_id&&f.status===q.result)||q.dimensions.some(d=>!v.dimensions.includes(d))))fail()
 if(!Array.isArray(v.observations)||v.observations.length>512||v.observations.some(o=>!object(o)||!only(o,['area','tool','success','at'])||!text(o.area,40)||!text(o.tool,160)||typeof o.success!=='boolean'||!Number.isSafeInteger(o.at)))fail()
 if(!object(v.sources)||!only(v.sources,['one','atlas','other'])||!['one','atlas','other'].every(key=>strings(v.sources[key as keyof typeof v.sources],100,2000)))fail()
 if(v.packet!==undefined&&(!object(v.packet)||v.packetOmitted||JSON.stringify(v.packet).length>120000||programDigest(v.packet)!==v.packetHash)||v.packet===undefined&&!v.packetOmitted)fail()
 if(JSON.stringify(v).length>240000)fail()
 // Reject prototype keys, excessive nesting and non-JSON values in all branches.
 programDigest(v)
 return structuredClone(v)
}
export function captureProgramInspection(report:TaskReport):ProgramInspection{
 const c=report.compiled,packet=c.model_context,include=JSON.stringify(packet).length<=120000
 const inspection:ProgramInspection={protocol:'one.program-inspection.v1',taskId:report.id,at:report.at,phase:report.phase,contractHash:c.contract_hash,requestHash:c.request_hash,dimensions:c.dimension_definitions.map(d=>d.id),findings:c.findings,quanta:c.quanta,observations:report.observations,sources:{one:report.evidence.one_pages??[],atlas:report.evidence.atlas_records??[],other:report.evidence.other_sources??[]},packetHash:programDigest(packet),...(include?{packet}:{}),packetOmitted:!include}
 return readProgramInspection(inspection)
}
