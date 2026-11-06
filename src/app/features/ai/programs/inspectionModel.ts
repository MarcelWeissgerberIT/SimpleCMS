import type {ProgramSpec,Expr} from '@/shared/quandprofile/program'
import type {CubeReference} from '../mcp-servers/QuantumCube'
export function expressionBindings(expr:Expr):{inputs:string[];results:string[]}{
 if('input'in expr)return{inputs:[expr.input],results:[]}
 if('result'in expr)return{inputs:[],results:[expr.result]}
 const children='object'in expr?Object.values(expr.object):'array'in expr?expr.array:[]
 const all=children.map(expressionBindings)
 return{inputs:[...new Set(all.flatMap(b=>b.inputs))],results:[...new Set(all.flatMap(b=>b.results))]}
}
/** Intended check catalogue only: no current host observation or compiler evidence is fabricated. */
export function programCheckCatalogue(spec:ProgramSpec,label:(key:string)=>string):CubeReference[]{
 const entries:Array<[string,string[]]>=[['task_scope_current',['freshness']],['task_provider_checked',['privacy']],['task_action_allowed',['permission']],['task_sources_observed',['provenance']],['task_observed_claims',['data']],['task_result_shape',['outcome']],['task_human_acceptance',['outcome','interpretation']]]
 if(spec.steps.some(s=>s.kind==='decision'))entries.push(['task_search_before_question',['provenance','interpretation']],['task_decisions_resolved',['interpretation']])
 const profile=spec.profile?.spec
 if(profile?.requireOne||profile?.onePages.length)entries.push(['profile_one_sources',['provenance']])
 if(profile?.requireAtlas||profile?.atlasRefs.length)entries.push(['profile_atlas_sources',['provenance']])
 if(profile?.atlasWriteRefs.length)entries.push(['profile_write_target',['permission']])
 if(profile?.readOnly)entries.push(['profile_read_only',['permission']])
 if(profile?.typedAI)entries.push(['typed_selection',['interpretation','data']],['typed_sources',['freshness','provenance']],['typed_effects',['permission']],['typed_output',['outcome']])
 return entries.map(([key,dimensions])=>({key,label:label(key),dimensions,status:'open'}))
}
