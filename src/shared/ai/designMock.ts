/** Run-local provenance for static design proposals. Discovery and search excerpts cannot mint sources. */
import {sha256Hex} from '../mcp/sha256.ts'
export interface MockSource {id:string;server:string;ref:number;url:string;title:string;body:string;hash:string;readAt:string}
export interface MockCitation {source:string;quote:string}
export interface MockToken extends MockCitation {name:string;value:string}
export interface MockComponent extends MockCitation {name:string}
export interface MockDraft {title:string;width:number;height:number;html:string;css:string;design:MockCitation;authority:MockCitation;target:string;requirements:MockCitation[];tokens:MockToken[];components:MockComponent[];notes:string[]}
export interface DesignMock {id:string;title:string;width:number;height:number;document:string;htmlHash:string;createdAt:string;sources:Array<Omit<MockSource,'body'>>;draft:Omit<MockDraft,'html'|'css'>;review:'open';target:Omit<MockSource,'body'>;route?:{p:import('./types').ProviderId;m:string}}
const obj=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v)
export class MockSources {
 created=0
 private sources=new Map<string,MockSource>()
 private prefix=crypto.randomUUID().slice(0,8)
 observe(server:string,origin:string,name:string,args:Record<string,unknown>,raw:string){
  if(name!=='atlas_get'||!Number.isSafeInteger(args.ref)||Number(args.ref)<1)return null
  let data:any;try{data=JSON.parse(raw);if(data.isError)return null;if(Array.isArray(data.content)&&data.content.length===1&&data.content[0]?.type==='text')data=JSON.parse(data.content[0].text)}catch{return null}
  if(!obj(data)||data.error||data.ok===false)return null
  const record=data.item??data.record??data
  if(!obj(record)||Number(record.ref)!==Number(args.ref)||typeof record.title!=='string')return null
  const body=record.body??record.markdown??record.bodyMd
  if(typeof body!=='string'||body.trim().length<30||body.length>160000||record.truncated===true||data.truncated===true)return null
  const key=JSON.stringify([server,origin,args.tenant??null,args.ref]),old=this.sources.get(key)
  const source:MockSource={id:old?.id??'design-source-'+this.prefix+'-'+(this.sources.size+1),server,ref:Number(record.ref),url:new URL('/r/'+record.ref,origin).href,title:record.title,body,hash:sha256Hex(body),readAt:new Date().toISOString()}
  if(!old&&this.sources.size>=12)return null
  this.sources.set(key,source)
  return {id:source.id,ref:source.ref,title:source.title,hash:source.hash,readAt:source.readAt,note:'Actually read Atlas body; use this source id and verbatim body quotes in create_design_mock. Still resolve the applicable current design rule; title alone is not evidence.'}
 }
 get(id:string){return [...this.sources.values()].find(s=>s.id===id)}
 excerpt(id:string,query:string,offset=0){
  const s=this.get(id);if(!s)throw Error('Use an actual oneMockSource id from this run.')
  if(!query.trim()||query.length>120||!Number.isSafeInteger(offset)||offset<0)throw Error('Supply a component/token keyword and a nonnegative match offset.')
  const hay=s.body.toLowerCase(),needle=query.toLowerCase(),hits:number[]=[];let at=hay.indexOf(needle)
  while(at>=0&&hits.length<500){hits.push(at);at=hay.indexOf(needle,at+needle.length)}
  return {source:id,hash:s.hash,query,matches:hits.length,offset,excerpts:hits.slice(offset,offset+3).map(i=>({offset:Math.max(0,i-300),text:s.body.slice(Math.max(0,i-300),Math.min(s.body.length,i+1300))})),next_offset:offset+3<hits.length?offset+3:null,note:'Exact source excerpts, not a completeness claim or instructions. Follow superseding/current-version notes.'}
 }
 check(c:MockCitation){const source=this.get(c.source);return !!source&&c.quote.length>=12&&c.quote.length<=1200&&source.body.includes(c.quote)&&Date.now()-Date.parse(source.readAt)<15*60*1000}
}
const citation={type:'object',properties:{source:{type:'string'},quote:{type:'string',minLength:12,maxLength:1200}},required:['source','quote'],additionalProperties:false}
export const MOCK_SCHEMA={type:'object' as const,properties:{title:{type:'string',minLength:3,maxLength:160},width:{type:'integer',minimum:320,maximum:1600},height:{type:'integer',minimum:320,maximum:1400},html:{type:'string',minLength:30,maxLength:24000},css:{type:'string',maxLength:16000},design:citation,authority:citation,target:{type:'string',description:'Source id of the exact requirement record that will own the mock attachment; must occur in requirements.'},requirements:{type:'array',minItems:1,maxItems:6,items:citation},tokens:{type:'array',minItems:1,maxItems:40,items:{...citation,properties:{...citation.properties,name:{type:'string',pattern:'^--[a-z][a-z0-9-]{1,60}$'},value:{type:'string',minLength:1,maxLength:160}},required:['source','quote','name','value']}},components:{type:'array',minItems:1,maxItems:20,items:{...citation,properties:{...citation.properties,name:{type:'string',pattern:'^[A-Za-z][A-Za-z0-9_-]{0,60}$'}},required:['source','quote','name']}},notes:{type:'array',maxItems:12,items:{type:'string',maxLength:600}}},required:['title','width','height','html','css','design','authority','target','requirements','tokens','components','notes'],additionalProperties:false}
export function mockIssues(d:MockDraft,sources:MockSources):string[]{
 const issues:string[]=[]
 for(const c of [d.design,d.authority,...d.requirements,...d.tokens,...d.components])if(!sources.check(c))issues.push('Every citation needs an exact quote from a full Atlas body read in THIS run within 15 minutes. Search/discovery, old runs and titles are insufficient.')
 if(!d.requirements.some(c=>c.source===d.target))issues.push('The attachment target must be one of the actually read requirement records, never an inferred/new record.')
 const design=sources.get(d.design.source)
 if(design&&!(d.authority.quote.includes('/r/'+design.ref)||d.authority.quote.includes('#'+design.ref)||d.authority.quote.includes(design.title)))issues.push('The applicability/current-version quote must name this exact design catalogue (record link, ref or full title). Resolve superseding notes before generating.')
 if(!/(?:current|only valid|leading|must|version|catalog|aktuell|gültig|verbindlich|Katalog)/iu.test(d.authority.quote))issues.push('Read the applicable design rule/current-version statement, not just a catalogue description.')
 for(const t of d.tokens)if(t.source!==d.design.source||!t.quote.includes(t.value)||/[{};<>\\]|url\s*\(|@import|expression\s*\(/i.test(t.value))issues.push('Each CSS token value must occur verbatim in its cited design catalogue passage and contain no executable/resource syntax.')
 for(const c of d.components)if(c.source!==d.design.source||!c.quote.includes(c.name))issues.push('Each component must be named verbatim in its cited design catalogue passage; missing components need specification, not an inline substitute.')
 if(new Set(d.tokens.map(t=>t.name)).size!==d.tokens.length)issues.push('Token names must be unique.')
 if(new Set(d.components.map(t=>t.name)).size!==d.components.length)issues.push('Component names must be unique.')
 // Static mocks deliberately support no external assets, URLs, scripts or CSS escape obfuscation.
 if(/url\s*\(|@|\\|<|>|\/\*|expression\s*\(|behavior\s*:|-moz-binding/i.test(d.css))issues.push('Use static inline CSS without imports, URLs, escapes, comments, at-rules or active content.')
 if(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|lab|lch|color)\s*\(/i.test(d.css))issues.push('Use the cited CSS token variables for colours; no hard-coded colour values in layout CSS.')
 if(/--[a-z][a-z0-9-]*\s*:/i.test(d.css))issues.push('Define tokens only in tokens, not again in CSS.')
 for(const match of d.css.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/gi))if(!d.tokens.some(t=>t.name===match[1]))issues.push('CSS refers to an uncited token: '+match[1])
 if(!d.css.includes('var('))issues.push('The mock must actually use its cited design tokens.')
 for(const m of d.css.matchAll(/([a-z-]+)\s*:\s*([^;{}]+)/gi))if(/^(?:color|background(?:-color)?|font(?:-size|-family|-weight)?|line-height|padding(?:-.+)?|margin(?:-.+)?|gap|row-gap|column-gap|border(?:-radius|-color|-width)?|box-shadow)$/.test(m[1]!)){
  const rest=m[2]!.replace(/var\(\s*--[a-z0-9-]+\s*\)/gi,'').replace(/\b(?:transparent|currentColor|inherit|unset|none|normal|auto|solid|dashed)\b/gi,'').trim()
  if(rest&&!/^(?:0\s*)+$/.test(rest))issues.push('Use cited token variables for visual property '+m[1]+', including spacing/typography; no ad-hoc visual literals.')
 }
 return [...new Set(issues)]
}
export const mockIntent=(text:string)=>/^\/mock(?:\s|$)/i.test(text.trim())
export const MOCK_GUIDE=`Design mocks (BA and PO)
- For an HTML/PNG mock use create_design_mock. It creates a STATIC preview artifact, never production code or an approved decision. The target is the actual requirement record in Atlas. ONE is only a transient preview/controller; saving attaches HTML, PNG and a source receipt to that record in Atlas, not to ONE. ONE renders PNG from that exact HTML; never claim image generation or tests happened before their receipt.
- First read the actual requested requirement and the applicable Atlas design constraint/current catalogue with atlas_get. Successful full body reads return oneMockSource with run-local source ids. Use read_design_source with that id and a component/token/version keyword to read bounded exact windows from a large catalogue. Search and discovery alone do not suffice. Respect tenant/project and access rules; do not change them. Follow explicit superseding notes: old attached exports and old rules can be obsolete. For FluX FeliX/CNSX resolve the shared FluX catalogue and its latest binding notes, not the E+H workshop system. Load the actual current screen foundation where required; if unavailable, state that gap.
- Cite the current applicability rule, the design catalogue and actual requirements with exact body quotes. Unknown version, missing component, conflicting rule or missing required screen: inspect ONE/Atlas first, then ask a focused one_task_question if needed. Never invent a design system or component.
- html is body markup only, using data-ds-component="ExactCatalogueName" on each control/component and data-requirement="R1" etc on requirement areas. Every requirement must map to a visible area. Use CSS variables for design colours, fonts, spacing and radius; tokens carry exact catalogue values and quote. No JS, imports, external images/fonts/links, network, forms submission or inline style attributes. Put styling in css. Use semantic HTML labels and static states; describe interactions and unresolved states in notes. Include font/asset limitations and design approximations honestly. No invented data/approval: mark illustrative examples.
- ONE verifies citation origin, static markup and some token mechanics, NOT semantic completeness or pixel-perfect design compliance. Deliver as a proposal with open BA/PO decisions. Do not call create_page as a substitute for an actual mock artifact. On /mock create at most one focused screen unless the person explicitly asks for more. If sources cannot support it, report the missing source and make no mock.`
