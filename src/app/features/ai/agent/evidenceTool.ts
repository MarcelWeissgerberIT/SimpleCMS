import {EVIDENCE_KINDS,parseEvidenceGaps,type EvidenceGap} from '@/shared/ai/evidenceGaps'
import type {AgentTool} from './tools'
export function evidenceTool(report:(gaps:EvidenceGap[])=>void):AgentTool{
 return {name:'report_evidence_gaps',write:false,description:'Record remaining evidence gaps for the current analysis (maximum 40). This is a model report, not verification. In a review continuation include every unresolved item of the current batch; report an empty list only when none remain.',input_schema:{type:'object',additionalProperties:false,required:['gaps'],properties:{gaps:{type:'array',maxItems:40,items:{type:'object',additionalProperties:false,required:['kind','target','reason'],properties:{kind:{type:'string',enum:[...EVIDENCE_KINDS]},target:{type:'string',maxLength:300},reason:{type:'string',maxLength:800},repo:{type:'string',maxLength:300},snapshot:{type:'string',maxLength:300}}}}}},run:async input=>{
  const gaps=parseEvidenceGaps(input);report(gaps)
  return {state:'ok',summary:`Evidence report · ${gaps.length} open · not a verification`,content:JSON.stringify({recorded:true,open:gaps.length,verification:'not_performed'})}
 }}
}
