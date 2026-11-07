import type {ProgramSpec} from '@/shared/quandprofile/program'
/** Reusable read-only analysis recipe. Source inputs stay editable; no results or old approvals are replayed. */
export function analysisRecipe(goal:string,pages:string[],schema:Record<string,unknown>):ProgramSpec{
 const ids=[...new Set(pages)].slice(0,20)
 if(!ids.length)throw Error('Choose a source page first.')
 return {protocol:'one.program.v1',goal:goal.slice(0,8000),parameters:Object.fromEntries(ids.map((id,i)=>['source_'+(i+1),{schema:{type:'string',minLength:1},default:id}])),steps:[
  ...ids.map((_,i)=>({id:'read_'+(i+1),kind:'tool' as const,tool:'read_page',schema,effect:'read' as const,args:{object:{id:{input:'source_'+(i+1)}}}})),
  {id:'review',kind:'decision',question:'Quellen und Analyseauftrag für diesen Lauf bestätigen / Confirm sources and scope for this run',neededFor:'Fresh scope confirmation before generating a new report; no automatic publication or external writes.'},
  {id:'analysis',kind:'generate',instruction:'Analyse the fresh source documents for this question: '+goal.slice(0,8000)+'\nSeparate observed evidence, counterevidence, requirements, assumptions and open questions. Cite source pages and exact code references if present. Do not claim a fresh repository read or test execution: these are carried-forward document sources. Return a reviewable Markdown report. Never execute code or write externally.',context:{array:ids.map((_,i)=>({result:'read_'+(i+1),path:[]}))}}
 ],output:{result:'analysis',path:[]}}
}
