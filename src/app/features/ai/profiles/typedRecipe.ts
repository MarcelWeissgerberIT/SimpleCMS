import {typedAI,typedTemplate,typedHash,tagKey,type TypedAI} from '../../../../shared/quandprofile/typed-ai.ts'
/** Preserve bindings only where their declared domain and shadow contract still match. No permission is inferred. */
export function changeTypedRecipe(previous:TypedAI|undefined,operation:string){
 const next=typedTemplate(operation)
 if(!previous)return{next,kept:[] as string[],removed:[] as string[]}
 const old=typedAI(previous),oldDomain=old.tags.find(t=>t.kind==='domain'),oldOp=old.tags.find(t=>t.kind==='operation')?.value
 let originalDefault:string|undefined
 try{originalDefault=typedTemplate(oldOp??'').tags.find(t=>t.kind==='domain')?.value}catch{/* custom operation */}
 // Explicit custom domains remain the person's context; a preset domain follows its new recipe.
 if(oldDomain&&oldDomain.value!==originalDefault)next.tags=next.tags.map(t=>t.kind==='domain'?oldDomain:t)
 const sameDomain=oldDomain?.value===next.tags.find(t=>t.kind==='domain')?.value
 const rules=sameDomain?old.tags.filter(t=>t.kind==='rule'):[]
 next.tags.push(...rules)
 const selected=new Set(next.tags.map(tagKey)),contract=next.shadows[0]!
 const compatible=old.shadows.filter(s=>s.match.every(t=>selected.has(tagKey(t)))&&s.input===contract.input&&s.output===contract.output&&s.readOnly===contract.readOnly&&s.requiresSources===contract.requiresSources)
 if(compatible.length===1)next.shadows=compatible
 next.sources=old.sources.filter(source=>source.kind==='rule'?rules.some(t=>tagKey(t)===source.binding):next.shadows.some(s=>s.id+'@'+s.version===source.binding&&old.shadows.some(old=>typedHash(old)===typedHash(s))))
 const kept=next.sources.map(s=>s.binding)
 const removed=[...new Set([...old.sources.filter(s=>!next.sources.includes(s)).map(s=>s.binding),...old.shadows.filter(s=>!next.shadows.some(n=>typedHash(n)===typedHash(s))).map(s=>s.id+'@'+s.version),...old.tags.filter(t=>t.kind==='rule'&&!rules.some(r=>tagKey(r)===tagKey(t))).map(tagKey)])]
 return{next:typedAI(next),kept,removed}
}
