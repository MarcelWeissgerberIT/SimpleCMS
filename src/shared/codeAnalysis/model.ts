import {codeReference,type CodeReference} from '../mcp/codeReference.ts'
export const PHASES=['scope','investigate','challenge','synthesize'] as const
export type Phase=typeof PHASES[number]
export type Evidence={id:string;reference:CodeReference;checkedAt:number}
export type Finding={id:string;title:string;claim:string;impact:string;severity:'low'|'medium'|'high';verdict:'supported'|'partial'|'contradicted'|'unresolved';support:string[];against:string[];countercheck:string;status:'open'|'reviewed'|'resolved'}
export type Report={summary:string;scope:string[];gaps:string[];questions:string[];evidence:Evidence[];findings:Finding[];flows:{id:string;title:string;steps:{label:string;evidence:string[];uncertainty:string}[]}[];requirements:{id:string;text:string;verdict:Finding['verdict'];implementation:string[];tests:string[];gap:string}[]}
export type Observation={tool:string;detail:string;state:'ok'|'err';at:number}
export type FindingReview={finding:string;requirements:string[];mock?:{page:string;block:string;journal:string;note:string};note:string}
export type SourceCheck={evidence:string;snapshot:string;commit:string;state:'current'|'different'|'unknown';at:number}
export type Revision={id:string;createdAt:number;target:string;question:string;repository:string;extent:Analysis['extent'];completed:Phase[];report:Report;reviews?:FindingReview[];sourceChecks?:SourceCheck[];observed:Observation[];cost:number;state:'draft'|'running'|'paused'|'failed'|'ready'|'accepted';error:string}
export type Analysis={label?:string;format:'one-code-analysis';version:1;id:string;question:string;repository:string;target:string;extent:'question'|'flow'|'module';budget:number;maxRounds:number;active:string|null;revisions:Revision[]}
export const emptyReport=():Report=>({summary:'',scope:[],gaps:[],questions:[],evidence:[],findings:[],flows:[],requirements:[]})
const object=(v:any)=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('format');return v}
const str=(v:any,max=4000):string=>{if(typeof v!=='string'||v.length>max)throw Error('format');return v}
const list=<T>(v:any,fn:(v:any)=>T,max=80):T[]=>{if(!Array.isArray(v)||v.length>max)throw Error('format');return v.map(fn)}
const enumOf=<T extends string>(v:any,items:readonly T[]):T=>{if(!items.includes(v))throw Error('format');return v}
const num=(v:any,max=1e15)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>max)throw Error('format');return v}
const strings=(v:any)=>list(v,x=>str(x))
const unique=<T extends {id:string}>(v:T[]):T[]=>{if(v.some(x=>!x.id)||new Set(v.map(x=>x.id)).size!==v.length)throw Error('duplicate');return v}
export function readReport(input:unknown):Report{
 const v=object(input)
 const evidence=unique(list(v.evidence,(e:any)=>{const reference=codeReference(JSON.stringify(e.reference));if(!reference)throw Error('citation');return {id:str(e.id,100),reference,checkedAt:num(e.checkedAt??0)}},24))
 const links=(x:any)=>{const ids=strings(x);if(ids.some(id=>!evidence.some(e=>e.id===id)))throw Error('reference');return ids}
 const verdict=(x:any)=>enumOf(x,['supported','partial','contradicted','unresolved'] as const)
 const findings=unique(list(v.findings,(f:any)=>({id:str(f.id,100),title:str(f.title,300),claim:str(f.claim),impact:str(f.impact),severity:enumOf(f.severity,['low','medium','high'] as const),verdict:verdict(f.verdict),support:links(f.support),against:links(f.against),countercheck:str(f.countercheck),status:enumOf(f.status??'open',['open','reviewed','resolved'] as const)})))
 for(const f of findings)if(f.verdict==='supported'&&!f.support.length||f.verdict==='contradicted'&&!f.against.length)throw Error('unsupported')
 const requirements=unique(list(v.requirements,(r:any)=>({id:str(r.id,100),text:str(r.text),verdict:verdict(r.verdict),implementation:links(r.implementation),tests:links(r.tests),gap:str(r.gap)})))
 for(const r of requirements)if(['supported','contradicted'].includes(r.verdict)&&!r.implementation.length)throw Error('unsupported')
 return {summary:str(v.summary,12000),scope:strings(v.scope),gaps:strings(v.gaps),questions:strings(v.questions),evidence,findings,
  flows:unique(list(v.flows,(f:any)=>({id:str(f.id,100),title:str(f.title,300),steps:list(f.steps,(s:any)=>({label:str(s.label),evidence:links(s.evidence),uncertainty:str(s.uncertainty)}),40)}))),
  requirements}
}
export function readAnalysis(raw:string):Analysis{
 if(raw.length>500000)throw Error('size')
 const v=object(JSON.parse(raw));if(v.format!=='one-code-analysis'||v.version!==1)throw Error('format')
 const revisions=unique(list(v.revisions,(r:any):Revision=>({id:str(r.id,100),createdAt:num(r.createdAt),target:str(r.target,300),question:str(r.question,8000),repository:str(r.repository,300),extent:enumOf(r.extent,['question','flow','module'] as const),completed:list(r.completed,p=>enumOf(p,PHASES),4),report:readReport(r.report),...(r.reviews?{reviews:unique(list(r.reviews,(x:any)=>({id:str(x.finding,100),finding:str(x.finding,100),requirements:list(x.requirements,q=>str(q,100),80),note:str(x.note,2000),...(x.mock?{mock:{page:str(x.mock.page,100),block:str(x.mock.block,100),journal:str(x.mock.journal,100),note:str(x.mock.note,100)}}:{})}))).map(({id,...x})=>x)}:{}),...(r.sourceChecks?{sourceChecks:unique(list(r.sourceChecks,(x:any)=>({id:str(x.evidence,100),evidence:str(x.evidence,100),snapshot:str(x.snapshot,200),commit:str(x.commit,200),state:enumOf(x.state,['current','different','unknown'] as const),at:num(x.at)}),24)).map(({id,...x})=>x)}:{}),observed:list(r.observed,o=>({tool:str(o.tool,100),detail:str(o.detail,1000),state:enumOf(o.state,['ok','err'] as const),at:num(o.at)}),200),cost:num(r.cost,100000),state:enumOf(r.state,['draft','running','paused','failed','ready','accepted'] as const),error:str(r.error,2000)}),20))
 for(const r of revisions){if(r.reviews?.some(x=>!r.report.findings.some(f=>f.id===x.finding)||x.requirements.some(id=>!r.report.requirements.some(q=>q.id===id)))||r.sourceChecks?.some(x=>!r.report.evidence.some(e=>e.id===x.evidence)))throw Error('reference')}
 for(const r of revisions)if(r.completed.some((p,i)=>p!==PHASES[i])||['ready','accepted'].includes(r.state)&&r.completed.length!==4)throw Error('phase')
 if(v.active!==null&&!revisions.some(r=>r.id===v.active&&r.state==='accepted'))throw Error('active')
 const result:Analysis={...(v.label?{label:str(v.label,300)}:{}),format:v.format,version:1,id:str(v.id,100),question:str(v.question,8000),repository:str(v.repository,300),target:str(v.target,300),extent:enumOf(v.extent,['question','flow','module'] as const),budget:num(v.budget,100),maxRounds:num(v.maxRounds,60),active:v.active,revisions}
 if(result.budget<0.1||result.maxRounds<2||!Number.isInteger(result.maxRounds))throw Error('budget')
 return result
}
export function newAnalysis(id:string):Analysis{return {format:'one-code-analysis',version:1,id,question:'',repository:'',target:'',extent:'question',budget:3,maxRounds:16,active:null,revisions:[]}}
export function newRevision(a:Analysis,id:string):Revision{return {id,createdAt:Date.now(),target:a.target,question:a.question,repository:a.repository,extent:a.extent,completed:[],report:emptyReport(),observed:[],cost:0,state:'draft',error:''}}
export function changes(before:Report,after:Report){
 const signature=(f:Finding,r:Report)=>JSON.stringify({...f,status:undefined,support:f.support.map(id=>r.evidence.find(e=>e.id===id)?.reference.citation).map(c=>c&&({repo:c.repo,path:c.path,lines:c.lines,digest:c.digest})),against:f.against.map(id=>r.evidence.find(e=>e.id===id)?.reference.citation).map(c=>c&&({repo:c.repo,path:c.path,lines:c.lines,digest:c.digest}))})
 return [...new Set([...before.findings,...after.findings].map(f=>f.id))].map(id=>{const a=before.findings.find(f=>f.id===id),b=after.findings.find(f=>f.id===id);return {id,title:b?.title??a!.title,kind:!a?'added':!b?'removed':signature(a,before)!==signature(b,after)?'changed':'unchanged'}})
}
export const REPORT_CONTRACT=`Return ONLY JSON with these exact fields (no Markdown fences):
{"summary":"","scope":["searched paths, symbols and limits"],"gaps":["unread or unavailable areas"],"questions":["remaining investigation"],"evidence":[{"id":"e1","reference":{"server":"actual connection","repoName":"observed name","citation":{"repo":"","snapshot":"","commit":"","path":"","lines":[1,2],"digest":""},"finding":"","highlight":[1,2]},"checkedAt":0}],"findings":[{"id":"f1","title":"","claim":"","impact":"","severity":"low|medium|high","verdict":"supported|partial|contradicted|unresolved","support":["e1"],"against":[],"countercheck":"where counterexamples were searched; limitations","status":"open"}],"flows":[{"id":"flow1","title":"","steps":[{"label":"","evidence":["e1"],"uncertainty":""}]}],"requirements":[{"id":"r1","text":"","verdict":"supported|partial|contradicted|unresolved","implementation":["e1"],"tests":[],"gap":""}]}
All arrays may be empty. Maximum 24 evidence entries, 80 findings, 40 steps per flow. Preserve finding IDs across versions. References must be exact returned citations; host verifies them. Test evidence means test source exists, NEVER that tests ran. No raw code, credentials or copied tool bodies in output. Supported findings need support; contradicted findings need against evidence. Supported or contradicted requirements need implementation evidence. No source is evidence of absence.`
