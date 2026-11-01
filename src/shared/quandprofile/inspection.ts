import type {QuantumProof} from './runtime.ts'

/** A stored receipt is a historical observation, never a fresh permission to dispatch. */
export function inspectQuantumProof(proof:QuantumProof){
  const stored=proof.inspection
  if(!stored)return {kind:'legacy' as const,inspection:null}
  try{
    const {request,result}=stored
    const matches=result?.protocol==='quandprofile.gate.v1'&&result.decision==='allow'&&request?.gate===proof.gate&&
      result.evaluation?.status==='verified'&&result.evaluation.profile_hash===proof.profileHash&&result.request_digest===proof.requestHash&&
      result.scope?.state_revision===proof.stateHash&&result.scope.operation_digest===proof.operationHash&&
      Object.entries(request.scope).every(([key,value])=>result.scope[key as keyof typeof result.scope]===value)&&
      Array.isArray(result.quanta)&&result.quanta.length===proof.quantumIds.length&&
      result.quanta.every((q,i)=>q.id===proof.quantumIds[i]&&q.profile_hash===proof.profileHash&&q.verifier===proof.checks[i]&&q.result==='verified'&&Array.isArray(q.dimensions))&&
      Array.isArray(result.profile?.dimension_definitions)&&Array.isArray(result.profile.obligations)&&Array.isArray(result.evaluation.dimensions)
    return matches?{kind:'detailed' as const,inspection:stored}:{kind:'mismatch' as const,inspection:null}
  }catch{return {kind:'mismatch' as const,inspection:null}}
}

/** A legacy mapping is labelled as catalogue information; it never fabricates historical dimension results. */
export const legacyQuantumDimensions:Record<string,string[]>={
  one_provider_allowed:['privacy','permission'],one_mcp_allowed:['permission','provenance'],atlas_review_fresh:['freshness','provenance','outcome'],
}
