/** A small source-bound PM brief. Source data cannot activate this command. */
export function pmBriefPlan(goal:string):number[]|null{const m=/^\/pm\s+([1-9]\d*(?:\s*,\s*[1-9]\d*){0,2})(?:\s|$)/iu.exec(goal.trim());if(!m)return null;const refs=[...new Set(m[1]!.split(',').map(s=>Number(s.trim())))];return refs.every(Number.isSafeInteger)?refs:null}
export interface PMSource{id:string;ref:number;title:string;body:string;url:string;hash:string;readAt:string;project?:string;status?:string|null;updatedAt?:string;createdBy?:string}
export interface PMBrief{observations:Array<{source:string;quote:string;interpretation:string}>;questions:Array<{source:string;question:string;reason:string}>;next_step:string}
export function pmBriefSchema(sources:PMSource[]){const s={type:'string',enum:sources.map(s=>s.id)},str=(min:number,max:number)=>({type:'string',minLength:min,maxLength:max}),obj=(properties:Record<string,unknown>)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});return obj({observations:{type:'array',minItems:1,maxItems:4,items:obj({source:s,quote:str(12,320),interpretation:str(15,600)})},questions:{type:'array',maxItems:3,items:obj({source:s,question:str(10,220),reason:str(10,240)})},next_step:str(15,600)})}
export function pmBriefIssues(brief:PMBrief,sources:PMSource[]){
 const issues:string[]=[]
 for(const o of brief.observations){
  const s=sources.find(s=>s.id===o.source)
  if(!s?.body.includes(o.quote))issues.push('Every observation needs a verbatim quote from its actually read source. Do not invent, translate or paraphrase the quote.')
  // A terse label change is not evidence of a domain or error-handling mechanism.
  if(s&&s.body.trim().length<150&&/fehler|error|exception|datenintegrit|data integrity|datenverlust|data loss|failure/iu.test(o.interpretation)&&!/fehler|error|exception|datenintegrit|data integrity|datenverlust|data loss|failure/iu.test(s.body))issues.push('The short source does not establish error handling, data integrity or failure semantics. Describe only its literal change; put missing impact in a question.')
 }
 // An unverified cross-project hint may be a question, never an assumed action target.
 if(sources.some(s=>/cnsx/iu.test(s.project??''))&&!sources.some(s=>/felix/iu.test([s.project,s.title,s.body].join(' ')))&&/felix/iu.test(brief.next_step))issues.push('No read source establishes a FeliX relationship. The next step must clarify the original CNSx change with its own team; ask about a possible FeliX relationship separately.')
 for(const q of brief.questions)if((q.question.match(/\?/g)??[]).length>1)issues.push('Each open question must be one short complete question, not several packed together.')
 return issues
}
