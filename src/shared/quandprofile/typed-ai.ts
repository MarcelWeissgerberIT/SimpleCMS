/** Typed task selection. Tags and shadows are bounded data, never executable policy or permission grants. */
import {sha256Hex} from '../mcp/sha256.ts'
export const TAG_KINDS=['domain','operation','rule','input','output'] as const
export type TagKind=typeof TAG_KINDS[number]
export type TypedTag={kind:TagKind;value:string;version?:string}
export type TypedShadow={protocol:'one.typed-shadow.v1';id:string;version:number;match:TypedTag[];input:string;output:string;readOnly:boolean;requiresSources:boolean;format:'inherit'|'json';requiredTerms:string[];requiredKeys:string[];guidance:string}
export type TypedSource={kind:'shadow'|'rule';server:string;origin:string;tenant:string;project:string;ref:number;hash:string;stateHash:string;quote:string;binding:string}
export type TypedAI={protocol:'one.typed-ai.v1';tags:TypedTag[];shadows:TypedShadow[];sources:TypedSource[]}
export type TypedIssue={code:'missing'|'ambiguous'|'input'|'output'|'rule'|'shadow';detail:string}
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v)
function keys(v:unknown,allowed:string[]){if(!object(v)||Object.keys(v).some(k=>!allowed.includes(k)))throw Error('Typed AI: unknown or invalid field')}
const text=(v:unknown,max=120)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw Error('Typed AI: invalid text');return v.trim()}
const slug=(v:unknown)=>{const s=text(v).toLowerCase();if(!/^[a-z0-9][a-z0-9._+/-]{0,119}$/.test(s))throw Error('Typed AI: use stable tag IDs (letters, numbers, . _ + / -)');return s}
const list=(v:unknown,max:number)=>{if(!Array.isArray(v)||v.length>max)throw Error('Typed AI: list limit');return v}
export function typedTag(v:unknown):TypedTag{
 keys(v,['kind','value','version']);const p=v as TypedTag
 if(!TAG_KINDS.includes(p.kind))throw Error('Typed AI: unknown tag type')
 const version=p.version===undefined?undefined:text(p.version,40)
 if(version&&!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(version)||p.kind==='rule'&&!version)throw Error('Typed AI: rule tags need an exact version')
 return {kind:p.kind,value:slug(p.value),...(version?{version}:{})}
}
export const tagKey=(t:TypedTag)=>t.kind+':'+t.value+(t.version?'@'+t.version:'')
function tags(v:unknown){const a=list(v,16).map(typedTag);if(new Set(a.map(tagKey)).size!==a.length)throw Error('Typed AI: duplicate tag');for(const k of TAG_KINDS.filter(k=>k!=='rule'))if(a.filter(t=>t.kind===k).length>1)throw Error('Typed AI: only one '+k+' tag');return a}
const strings=(v:unknown)=>{const a=list(v,16).map(x=>text(x,160));if(new Set(a).size!==a.length)throw Error('Typed AI: duplicate criterion');return a}
export function typedShadow(v:unknown):TypedShadow{
 keys(v,['protocol','id','version','match','input','output','readOnly','requiresSources','format','requiredTerms','requiredKeys','guidance']);const p=v as TypedShadow
 if(p.protocol!=='one.typed-shadow.v1'||!Number.isSafeInteger(p.version)||p.version<1||p.version>10000||typeof p.readOnly!=='boolean'||typeof p.requiresSources!=='boolean'||!['inherit','json'].includes(p.format))throw Error('Typed AI: invalid shadow version or checks')
 const match=tags(p.match);if(!match.some(t=>t.kind==='operation'))throw Error('Typed AI: a shadow must name its operation')
 const requiredKeys=strings(p.requiredKeys);if(requiredKeys.some(k=>!/^[$a-zA-Z_][a-zA-Z0-9_]{0,79}$/.test(k)||['__proto__','prototype','constructor'].includes(k))||requiredKeys.length&&p.format!=='json')throw Error('Typed AI: JSON keys require JSON output')
 return {protocol:p.protocol,id:slug(p.id),version:p.version,match,input:slug(p.input),output:slug(p.output),readOnly:p.readOnly,requiresSources:p.requiresSources,format:p.format,requiredTerms:strings(p.requiredTerms),requiredKeys,guidance:text(p.guidance,2400)}
}
export function typedSource(v:unknown):TypedSource{
 keys(v,['kind','server','origin','tenant','project','ref','hash','stateHash','quote','binding']);const p=v as TypedSource
 if(!['shadow','rule'].includes(p.kind)||!Number.isSafeInteger(p.ref)||p.ref<1||typeof p.hash!=='string'||!/^[a-f0-9]{64}$/.test(p.hash)||typeof p.stateHash!=='string'||!/^[a-f0-9]{64}$/.test(p.stateHash))throw Error('Typed AI: source needs a global Atlas ref and exact body SHA-256')
 const origin=new URL(text(p.origin,200));if(origin.protocol!=='https:'||origin.origin!==p.origin)throw Error('Typed AI: use an exact HTTPS Atlas origin')
 const quote=text(p.quote,1200);if(quote.length<12)throw Error('Typed AI: source needs an exact version/applicability quote')
 return {kind:p.kind,server:text(p.server),origin:origin.origin,tenant:text(p.tenant),project:text(p.project),ref:p.ref,hash:p.hash,stateHash:p.stateHash,quote,binding:text(p.binding,180)}
}
export function typedAI(v:unknown):TypedAI{
 keys(v,['protocol','tags','shadows','sources']);const p=v as TypedAI
 if(p.protocol!=='one.typed-ai.v1')throw Error('Typed AI: unknown protocol')
 const selection=tags(p.tags),shadows=list(p.shadows,12).map(typedShadow),sources=list(p.sources,12).map(typedSource)
 if(new Set(shadows.map(s=>s.id+'@'+s.version)).size!==shadows.length||new Set(sources.map(sourceKey)).size!==sources.length)throw Error('Typed AI: duplicate shadow or source')
 return {protocol:p.protocol,tags:selection,shadows,sources}
}
function canonical(v:unknown):string{return JSON.stringify(v&&typeof v==='object'?Array.isArray(v)?v.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,JSON.parse(canonical(x))])):v)}
export const typedHash=(v:unknown)=>sha256Hex(canonical(v))
export const typedSourceState=(record:Record<string,unknown>)=>typedHash(Object.fromEntries(['ref','title','project','tenant','tenantSlug','kind','status','fields','archived','confirmed'].filter(k=>Object.hasOwn(record,k)).map(k=>[k,record[k]])))
export const sourceKey=(s:TypedSource)=>typedHash([s.kind,s.server,s.origin,s.tenant,s.project,s.ref,s.hash,s.stateHash,s.binding,s.quote])
export function resolveTypedAI(raw:unknown){
 const spec=typedAI(raw),issues:TypedIssue[]=[],selected=new Set(spec.tags.map(tagKey))
 for(const kind of ['domain','operation','input','output']as const)if(!spec.tags.some(t=>t.kind===kind))issues.push({code:'missing',detail:kind})
 const candidates=spec.shadows.filter(s=>s.match.every(t=>selected.has(tagKey(t))))
 if(!candidates.length)issues.push({code:'missing',detail:'shadow'})
 if(candidates.length>1)issues.push({code:'ambiguous',detail:candidates.map(s=>s.id+'@'+s.version).join(', ')})
 const shadow=candidates.length===1?candidates[0]:null
 if(shadow){for(const k of ['input','output']as const)if(spec.tags.find(t=>t.kind===k)?.value!==shadow[k])issues.push({code:k,detail:shadow[k]})}
 for(const tag of spec.tags.filter(t=>t.kind==='rule'))if(spec.sources.filter(s=>s.kind==='rule'&&s.binding===tagKey(tag)).length!==1)issues.push({code:'rule',detail:tagKey(tag)})
 for(const source of spec.sources){if(source.kind==='rule'&&!selected.has(source.binding)||source.kind==='shadow'&&!spec.shadows.some(s=>s.id+'@'+s.version===source.binding))issues.push({code:'shadow',detail:source.binding})}
 return {spec,shadow,issues,hash:typedHash(spec),status:issues.length?'open' as const:'ready' as const}
}
export const parseTagChain=(value:string)=>value.split(/[\n,]+/u).map(s=>s.trim()).filter(Boolean).map(s=>{const m=/^(domain|operation|rule|input|output):([^@\s]+)(?:@([^\s]+))?$/.exec(s);if(!m)throw Error('Typed AI: expected type:value@version');return typedTag({kind:m[1],value:m[2],...(m[3]?{version:m[3]}:{})})})
/** A shadow imported from Atlas uses this exact JSON object, optionally in one fenced JSON block. */
export function shadowFromBody(body:string):TypedShadow{
 const fenced=[...body.matchAll(/```json\s*\n([\s\S]*?)\n```/g)]
 if(fenced.length>1)throw Error('Typed AI: ambiguous shadow JSON blocks')
 return typedShadow(JSON.parse(fenced.length?fenced[0]![1]!:body))
}
/** Called only with a successfully read full Atlas record, never with model prose or search excerpts. */
export function verifyTypedSource(source:TypedSource,server:string,origin:string,args:Record<string,unknown>,record:Record<string,any>,spec:TypedAI):string{
 const body=record.body,project=typeof record.project==='string'?record.project:record.project?.slug,tenant=record.tenantSlug??(typeof record.tenant==='string'?record.tenant:record.tenant?.slug)
 if(source.server!==server||source.origin!==origin||source.ref!==record.ref||source.ref!==args.ref||source.tenant!==args.tenant||source.project!==project||tenant!==undefined&&tenant!==source.tenant||record.archived===true||record.truncated===true||typeof body!=='string'||sha256Hex(body)!==source.hash||typedSourceState(record)!==source.stateHash||!body.includes(source.quote))throw Error('Typed AI: Atlas source changed, is incomplete, archived or outside its pinned scope (Ref '+source.ref+'). Re-read the source and review a new profile version.')
 if(source.kind==='shadow'){const actual=shadowFromBody(body),expected=spec.shadows.find(s=>s.id+'@'+s.version===source.binding);if(!expected||typedHash(expected)!==typedHash(actual))throw Error('Typed AI: Atlas shadow definition does not match the selected version')}
 return sourceKey(source)
}
export const BUILTIN_TYPED_SHADOWS:TypedShadow[]=[
 ['ba','source-text','requirements',true,'Distinguish evidenced requirements, contradictions and open questions. Human domain acceptance remains open.'],
 ['po','requirements','acceptance-criteria',true,'Prepare source-bound acceptance criteria. Never invent priorities, product decisions or approval.'],
 ['pm','project-evidence','briefing',true,'Distinguish observations, risks, dependencies and proposed next steps. Never invent ownership or commitments.'],
 ['research','sources','comparison',true,'Compare actually read sources and their dates. Separate evidence from inference and unresolved claims.'],
 ['test','requirements','test-matrix',true,'Separate test proposals, linked tests and executed test evidence. A proposal is not passing coverage.'],
 ['mock','requirements','html+png',true,'Use the applicable actually read design system, components and tokens. Preserve stable instance IDs and unchanged layout when revising. Report concrete before/after changes for each note; distinguish unresolved notes and source-only updates. One independently compares the result and avoids duplicate unchanged versions. Save in the One block after acceptance; Atlas synchronization is separate and explicit.'],
 ['coding','specification','patch',false,'Use the current specification and repository conventions. Require meaningful verification; a generated patch is not an executed test.'],
].map(([operation,input,output,readOnly,guidance])=>({protocol:'one.typed-shadow.v1',id:'one.'+operation,version:1,match:[{kind:'operation',value:String(operation)}],input:String(input),output:String(output),readOnly:Boolean(readOnly),requiresSources:true,format:'inherit',requiredTerms:[],requiredKeys:[],guidance:String(guidance)}))
export function typedTemplate(operation:string):TypedAI{
 const shadow=BUILTIN_TYPED_SHADOWS.find(s=>s.match[0]!.value===operation);if(!shadow)throw Error('Unknown Typed AI template')
 return {protocol:'one.typed-ai.v1',tags:[{kind:'domain',value:operation==='mock'?'ui':operation==='coding'?'development':'product'},{kind:'operation',value:operation},{kind:'input',value:shadow.input},{kind:'output',value:shadow.output}],shadows:[structuredClone(shadow)],sources:[]}
}
