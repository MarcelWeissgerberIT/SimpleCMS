/** Explicit AND-gate / prerequisite relationships, not claims that checks contradict one another. */
export type CubeRelation={from:string;to:string;kind:'prerequisite'|'crosscheck';label:string}
const definitions:CubeRelation[]=[
 {from:'task_provider_checked',to:'task_action_allowed',kind:'crosscheck',label:'providerPermission'},
 {from:'task_search_before_question',to:'task_decisions_resolved',kind:'prerequisite',label:'sourcesDecision'},
 {from:'task_sources_observed',to:'task_observed_claims',kind:'crosscheck',label:'sourceClaims'},
 {from:'task_observed_claims',to:'task_result_shape',kind:'crosscheck',label:'claimsFormat'},
 {from:'task_result_shape',to:'task_human_acceptance',kind:'crosscheck',label:'formatAcceptance'},
 {from:'profile_one_sources',to:'profile_write_target',kind:'crosscheck',label:'sourceTarget'},
 {from:'profile_atlas_sources',to:'profile_write_target',kind:'crosscheck',label:'sourceTarget'},
 {from:'profile_read_only',to:'task_action_allowed',kind:'crosscheck',label:'restriction'},
 {from:'typed_selection',to:'typed_output',kind:'prerequisite',label:'typedContract'},
 {from:'typed_sources',to:'typed_output',kind:'crosscheck',label:'sourceClaims'},
 {from:'typed_effects',to:'task_action_allowed',kind:'crosscheck',label:'restriction'},
 {from:'typed_output',to:'task_human_acceptance',kind:'crosscheck',label:'formatAcceptance'},
]
export function cubeRelations(keys:readonly string[]):CubeRelation[]{const available=new Set(keys);return definitions.filter(r=>available.has(r.from)&&available.has(r.to))}
