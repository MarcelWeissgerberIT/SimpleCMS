import {sha256Hex} from '../mcp/sha256.ts'
export type QuantumScope={workspace:string;target:string;actor:string;state_revision:string;operation_digest:string}
export type QuantumRequest={gate:'one_provider'|'one_mcp'|'atlas_review';scope:QuantumScope;snapshot:Record<string,unknown>}
export type QuantumProof={gate:QuantumRequest['gate'];profileHash:string;requestHash:string;stateHash:string;operationHash:string;status:'verified';checks:string[];quantumIds:string[]}
type Exports={memory:{buffer:ArrayBufferLike};qp_alloc:(len:number)=>number;qp_free:(ptr:number,len:number)=>void;qp_check:(ptr:number,len:number)=>number;qp_output_len:()=>number}
export const stateHash=(v:unknown):string=>sha256Hex(JSON.stringify(v))
/** The instance has no imported functions, network, filesystem or model-accessible mutation API. */
export class QuandRuntime {
  private abi:Exports
  constructor(instance:{exports:unknown}){this.abi=instance.exports as unknown as Exports;if(!this.abi.memory||typeof this.abi.qp_check!=='function')throw Error('Invalid compiler module')}
  check(request:QuantumRequest):QuantumProof {
    const bytes=new TextEncoder().encode(JSON.stringify(request));if(!bytes.length||bytes.length>262144)throw Error('Compiler input limit')
    const a=this.abi,ptr=a.qp_alloc(bytes.length);if(!ptr)throw Error('Compiler allocation failed')
    let out=0,len=0
    try{
      new Uint8Array(a.memory.buffer,ptr,bytes.length).set(bytes)
      out=a.qp_check(ptr,bytes.length);len=a.qp_output_len()
      if(!out||!len||len>524288)throw Error('Invalid compiler output')
      const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(new Uint8Array(a.memory.buffer,out,len)))
      if(result?.decision!=='allow'||result.protocol!=='quandprofile.gate.v1'||result.evaluation?.status!=='verified'||
        Object.entries(request.scope).some(([k,v])=>result.scope?.[k]!==v)||!result.quanta?.length||
        result.quanta.some((q:any)=>q.result!=='verified'||q.profile_hash!==result.evaluation.profile_hash))throw Error('Compiler gate blocked')
      return {gate:request.gate,profileHash:result.evaluation.profile_hash,requestHash:result.request_digest,stateHash:request.scope.state_revision,
        operationHash:request.scope.operation_digest,status:'verified',checks:result.quanta.map((q:any)=>q.verifier),quantumIds:result.quanta.map((q:any)=>q.id)}
    }finally{a.qp_free(ptr,bytes.length);if(out&&len)a.qp_free(out,len)}
  }
}

export function providerSnapshot(provider:string,classes:readonly string[],workspace:any,device:any,memberOwned=true){
 const rule=workspace?.policy?.providers?.[provider]
 return {provider,classes:[...new Set(classes)].sort(),provider_rule:rule?{allow:rule.allow??[],forbid:rule.forbid??[]}:null,
  device_allow:device?.allow?.[provider]??[],device_narrow:device?.narrow?.[provider]??[],member_classes_owned_by_member:memberOwned,
  allowed_destinations:workspace?.dataFlow?.providers??null}
}

/** Small host-owned policy reminder. Receipts remain outside model-editable memory. */
export const COMPILED_WORK_POLICY='ONE maintains a compiled task contract outside your context. Use only selected sources and tools. Only the host issues evidence. Read exact targets before changing them. Missing or stale evidence leaves work open. An accepted write is not completed work; report verified results and leave product decisions to people.'
