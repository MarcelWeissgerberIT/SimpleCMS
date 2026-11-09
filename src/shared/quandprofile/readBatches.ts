import type {Expr,ProgramStep} from './program.ts'
function dependencies(expr:Expr):string[]{
 if('result' in expr)return [expr.result]
 if('array' in expr)return expr.array.flatMap(dependencies)
 if('object' in expr)return Object.values(expr.object).flatMap(dependencies)
 return []
}
/** Only adjacent, independent, declared reads. Never move a read across an effect or model step. */
export function readBatches(steps:ProgramStep[],limit=3):ProgramStep[][]{
 if(!Number.isInteger(limit)||limit<1)throw Error('Invalid read batch limit')
 const batches:ProgramStep[][]=[]
 for(const step of steps){
  const last=batches.at(-1)
  if(step.kind==='tool'&&step.effect==='read'&&last&&last.length<limit&&last.every(s=>s.kind==='tool'&&s.effect==='read')&&!dependencies(step.args).some(id=>last.some(s=>s.id===id)))last.push(step)
  else batches.push([step])
 }
 return batches
}
/** All started reads settle before releasing scope or starting the next effect. */
export async function settleReadBatch<T>(items:T[],run:(item:T)=>Promise<void>){
 const results=await Promise.allSettled(items.map(run))
 const failure=results.find(r=>r.status==='rejected')
 if(failure?.status==='rejected')throw failure.reason
}
