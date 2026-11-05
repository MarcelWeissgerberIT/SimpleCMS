/** Run-local provenance for static design proposals. Discovery and search excerpts cannot mint sources. */
import {MCP_SOURCE_BYTES,MCP_CACHE_BYTES,sourceBytes} from '../mcp/sourceLimits.ts'
import {mockEpic,isEpicMember,type MockEpic} from './mockEpic.ts'
import {sha256Hex} from '../mcp/sha256.ts'
export interface MockSource {id:string;server:string;ref:number;url:string;title:string;body:string;hash:string;stateHash:string;readAt:string}
export interface MockCitation {source:string;quote:string}
export interface MockToken extends MockCitation {name:string;value:string}
export interface MockComponent extends MockCitation {name:string}
export interface MockDraft {title:string;width:number;height:number;html:string;css:string;design:MockCitation;authority:MockCitation|null;target:string|null;requirements:MockCitation[];tokens:MockToken[];components:MockComponent[];notes:string[]}
export interface DesignMock {id:string;title:string;width:number;height:number;document:string;htmlHash:string;createdAt:string;sources:Array<Omit<MockSource,'body'>>;draft:Omit<MockDraft,'html'|'css'>;review:'open';colorAdjustments?:Record<string,string>;request?:string;atlasSaved?:{ref:number;url:string};atlasDestination?:{ref:number;url:string};atlasContext?:Omit<MockEpic,'members'>;target:Omit<MockSource,'body'>|null;route?:{p:import('./types').ProviderId;m:string}}
const obj=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v)
/** Stable source lifecycle fields, not comments/attachments changed by our own upload. */
export function mockSourceState(record:Record<string,unknown>):string{return sha256Hex(JSON.stringify(Object.fromEntries(['ref','title','project','tenant','tenantSlug','kind','status','fields','archived','confirmed','parent','tags'].filter(k=>Object.hasOwn(record,k)).map(k=>[k,record[k]]))))}
export class MockSources {
 selectedDesign:string|null=null
 selectedTarget:string|null=null
 epic:MockEpic|null=null
 private records=new Map<string,Record<string,any>>()
 private designMembers=new Set<string>()
 selectDesign(id:string){this.selectedDesign=id;const source=this.get(id);this.epic=source?mockEpic(this.records.get(id)??{},source.url):null}
 acceptEpicMember(id:string){const source=this.get(id),root=this.get(this.selectedDesign??'');if(!this.epic||!source||source.server!==root?.server||new URL(source.url).origin!==new URL(root.url).origin||!isEpicMember(this.epic,this.records.get(id)??{}))throw Error('Atlas-Teil gehört nicht nachweislich zum ausgewählten Design-Epic.');this.designMembers.add(id)}
 designSource(id:string){return id===this.selectedDesign||this.designMembers.has(id)}
 created=0
 repaired=false
 repairAttempted=false
 private sources=new Map<string,MockSource>()
 private prefix=crypto.randomUUID().slice(0,8)
 observe(server:string,origin:string,name:string,args:Record<string,unknown>,raw:string){
  if(name!=='atlas_get')return null
  let data:any;try{data=JSON.parse(raw);if(data.isError)return null;if(Array.isArray(data.content)&&data.content.length===1&&data.content[0]?.type==='text')data=JSON.parse(data.content[0].text)}catch{return null}
  if(!obj(data)||data.error||data.ok===false)return null
  const record=data.item??data.record??data
  if(!obj(record)||!Number.isSafeInteger(record.ref)||record.ref<1||typeof record.title!=='string')return null
  if(args.ref!==undefined?record.ref!==args.ref:typeof args.project!=='string'||typeof args.slug!=='string'||record.project!==args.project||record.slug!==args.slug)return null
  const body=record.body??record.markdown??record.bodyMd
  if(typeof body!=='string'||body.trim().length<30||sourceBytes(body)>MCP_SOURCE_BYTES||record.truncated===true||data.truncated===true)return null
  const key=JSON.stringify([server,origin,args.tenant??null,record.ref]),old=this.sources.get(key)
  const source:MockSource={id:old?.id??'design-source-'+this.prefix+'-'+(this.sources.size+1),server,ref:Number(record.ref),url:new URL('/r/'+record.ref,origin).href,title:record.title,body,hash:sha256Hex(body),stateHash:mockSourceState(record),readAt:new Date().toISOString()}
  if(!old&&this.sources.size>=24||[...this.sources.values()].reduce((n,s)=>n+(s.id===old?.id?0:sourceBytes(s.body)),sourceBytes(body))>MCP_CACHE_BYTES)return null
  this.sources.set(key,source)
  this.records.set(source.id,{ref:record.ref,title:record.title,body,project:record.project,kind:record.kind,tags:record.tags,parent:record.parent,archived:record.archived})
  return {id:source.id,ref:source.ref,title:source.title,hash:source.hash,readAt:source.readAt,note:'Actually read Atlas body; use this source id and verbatim body quotes in create_design_mock. Still resolve the applicable current design rule; title alone is not evidence.'}
 }
 snapshot(){return [...this.sources.values()].map(s=>({...s}))}
 /** Exact bounded windows, not a model summary. Full bodies remain available to the run-local reader. */
 context(target?:number,request=''){let remaining=this.epic?36000:17000;const weight=(s:Pick<MockSource,'id'|'title'>)=>s.id===this.selectedDesign?0.4:/color|colour|typography/i.test(s.title)?1.8:/spacing|radius/i.test(s.title)?1.3:1;const totalWeight=this.snapshot().reduce((n,s)=>n+weight(s),0);return this.snapshot().sort((a,b)=>Number(b.id===this.selectedDesign)-Number(a.id===this.selectedDesign)).map(({body,...source})=>{
  const headings=[...body.matchAll(/^#{1,6}\s+(.+)$/gm)]
  const foundation=/^(?:colou?r|farben|typography|schrift|spacing|abstände|radius|eckenradien|schatten|css-variablen|tier 2|button)/iu
  const catalogue=headings.some(h=>foundation.test(h[1]!)),limit=Math.min(remaining,this.epic?Math.floor(36000*weight(source)/totalWeight):source.ref===target?2200:catalogue||source.id===this.selectedDesign?12500:2800)
  const candidates:Array<[number,number]>=this.epic?[[0,Math.min(body.length,limit)]]:[[0,Math.min(body.length,catalogue?700:1000)],[Math.max(0,body.length-(catalogue?700:1800)),body.length]]
  const sections=new Set<string>()
  for(let i=0;i<headings.length;i++){const h=headings[i]!,key=h[1]!.toLowerCase();if(!foundation.test(key)||sections.has(key))continue;sections.add(key)
   const from=h.index!,size=/typography/i.test(key)?2000:/css-variablen/iu.test(key)?1700:800
   candidates.push([from,Math.min(headings[i+1]?.index??body.length,from+size)])
   if(sections.size>=12)break
  }
  // Match request terms to actual component instances, then include their exact MD definitions.
  const stop=new Set(['mock','atlas','design','source','record','requirement','create','build','baue','einen','eine','einem','diesem','based','from','with','this','that','the','and','und','mit','für','dialog','list','liste','request'])
  const terms=[...new Set((request.split('\n')[0]?.toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu)??[]).filter(w=>!stop.has(w)))].slice(0,20)
  const componentLines=[...body.matchAll(/^.*\b([A-Za-z][A-Za-z0-9_]*_C\d+)\b.*$/gm)]
  const ranked=componentLines.map(m=>({m,score:terms.reduce((n,t)=>n+(m[0].toLowerCase().includes(t)?1:0),0)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score)
  const chosen=new Set<string>()
  for(const {m} of ranked){const name=m[1]!;if(chosen.has(name))continue;chosen.add(name)
   candidates.push([m.index!,Math.min(body.length,m.index!+Math.min(m[0].length,600))])
   const h=headings.find(h=>h[1]===name);if(h)candidates.push([h.index!,Math.min(body.length,h.index!+1400)])
   if(chosen.size===3)break
  }
  for(const query of ['Komponentenarchitektur','ConfirmationModal','brand-primary','user confirmation','Benutzerbestätigung',...terms.slice(0,4)]){const at=body.toLowerCase().indexOf(query.toLowerCase());if(at>=0)candidates.push([Math.max(0,at-100),Math.min(body.length,at+900)])}
  let left=limit;const accepted:Array<[number,number]>=[]
  for(const [from,to] of candidates){let segments:Array<[number,number]>=[[from,to]];for(const [a,b] of accepted)segments=segments.flatMap(([s,e])=>e<=a||s>=b?[[s,e]]:s<a&&e>b?[[s,a],[b,e]]:s<a?[[s,a]]:e>b?[[b,e]]:[]);for(const [s,e] of segments){const end=Math.min(e,s+left);if(end>s){accepted.push([s,end]);left-=end-s}}}
  remaining-=limit-left;accepted.sort((a,b)=>a[0]-b[0]);const merged:Array<[number,number]>=[];for(const span of accepted){const last=merged.at(-1);if(last&&span[0]<=last[1])last[1]=Math.max(last[1],span[1]);else merged.push([...span])}
  const excerpts=merged.map(([from,to])=>({offset:from,text:body.slice(from,to)}))
  return {...source,characters:body.length,partial:excerpts.reduce((n,e)=>n+e.text.length,0)<body.length,excerpts}
 })}
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
export const MOCK_SCHEMA={type:'object' as const,properties:{title:{type:'string',minLength:3,maxLength:160},width:{type:'integer',minimum:320,maximum:1600},height:{type:'integer',minimum:320,maximum:1400},html:{type:'string',minLength:30,maxLength:24000},css:{type:'string',maxLength:16000},design:citation,authority:{anyOf:[citation,{type:'null'}]},target:{type:['string','null'],description:'Optional source id of a supplied requirement record; must occur in requirements. Use null for a free request. The user may choose an attachment destination later.'},requirements:{type:'array',minItems:0,maxItems:6,items:citation},tokens:{type:'array',minItems:1,maxItems:40,items:{...citation,properties:{...citation.properties,name:{type:'string',pattern:'^--[a-z][a-z0-9-]{1,60}$'},value:{type:'string',minLength:1,maxLength:160}},required:['source','quote','name','value']}},components:{type:'array',minItems:1,maxItems:20,items:{...citation,properties:{...citation.properties,name:{type:'string',pattern:'^[A-Za-z][A-Za-z0-9_-]{0,60}$'}},required:['source','quote','name']}},notes:{type:'array',maxItems:12,items:{type:'string',maxLength:600}}},required:['title','width','height','html','css','design','authority','target','requirements','tokens','components','notes'],additionalProperties:false}
export const MOCK_TAGS=['main','section','article','header','footer','nav','aside','div','span','h1','h2','h3','h4','p','strong','em','small','label','button','input','textarea','select','option','table','caption','thead','tbody','tfoot','tr','th','td','ul','ol','li','dl','dt','dd','hr','br','fieldset','legend','progress','meter','h5','h6','figure','figcaption','blockquote','pre','code','kbd','samp','b','i','u','s','sub','sup','abbr','time','mark','output','details','summary','colgroup','col']
export const MOCK_ATTRS=['class','id','role','aria-label','aria-labelledby','aria-describedby','aria-selected','aria-checked','aria-disabled','aria-current','data-ds-component','data-requirement','type','name','value','placeholder','disabled','checked','selected','for','rows','cols','colspan','rowspan','scope','min','max','step','title','lang','dir','aria-hidden','aria-expanded','aria-controls','aria-modal','aria-valuemin','aria-valuemax','aria-valuenow','aria-valuetext','readonly','required','multiple','minlength','maxlength','datetime','open']
// Generic browser fallbacks are rendering syntax, not a substitute for a cited design font.
const genericFont=/(?:serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|emoji|math|fangsong)/.source
const genericFontTail=new RegExp('^(?:\\s*,\\s*'+genericFont+')*\\s*$','i')
const tokenFontStack=new RegExp('^var\\(\\s*--[a-z0-9-]+\\s*\\)(?:\\s*,\\s*(?:var\\(\\s*--[a-z0-9-]+\\s*\\)|'+genericFont+'))*\\s*$','i')
/** Substitute only exact existing token values; the unchanged citations are still validated before rendering. */
export function normalizeMockFonts(draft:MockDraft):MockDraft{
 const tokens=[...draft.tokens].sort((a,b)=>b.value.length-a.value.length)
 const css=draft.css.replace(/(\bfont-family\s*:\s*)([^;{}]+)/gi,(declaration,prefix:string,value:string)=>{
  const trimmed=value.trim(),token=tokens.find(t=>trimmed.startsWith(t.value)&&genericFontTail.test(trimmed.slice(t.value.length)))
  return token?prefix+'var('+token.name+')'+trimmed.slice(token.value.length):declaration
 })
 return css===draft.css?draft:{...draft,css}
}
export function mockIssues(d:MockDraft,sources:MockSources):string[]{
 const issues:string[]=[]
 for(const c of [d.design,...(d.authority?[d.authority]:[]),...d.requirements,...d.tokens,...d.components])if(!sources.check(c))issues.push('Every citation needs an exact quote from a full Atlas body read in THIS run within 15 minutes. Search/discovery, old runs and titles are insufficient.')
 if(d.target!==null&&!d.requirements.some(c=>c.source===d.target))issues.push('The attachment target must be one of the actually read requirement records, never an inferred/new record.')
 if(!d.authority&&sources.selectedDesign!==d.design.source)issues.push('Without an applicability quote, use only the design source explicitly selected by the person.')
 if(sources.selectedDesign&&d.design.source!==sources.selectedDesign)issues.push('Use the explicitly selected design source, not a substitute.')
 if(sources.selectedDesign&&d.target!==sources.selectedTarget)issues.push('Use only the optional requirement record selected by the person, or null.')
 const design=sources.get(d.design.source)
 if(design&&d.authority&&!(d.authority.quote.includes('/r/'+design.ref)||d.authority.quote.includes('#'+design.ref)||d.authority.quote.includes(design.title)))issues.push('The applicability/current-version quote must name this exact design catalogue (record link, ref or full title). Resolve superseding notes before generating.')
 if(d.authority&&!/(?:current|only valid|leading|must|version|catalog|aktuell|gültig|verbindlich|Katalog)/iu.test(d.authority.quote))issues.push('Read the applicable design rule/current-version statement, not just a catalogue description.')
 for(const t of d.tokens)if((t.source!==d.design.source&&!sources.designSource(t.source))||!t.quote.includes(t.value)||/[{};<>\\]|url\s*\(|@import|expression\s*\(/i.test(t.value))issues.push('Each CSS token value must occur verbatim in its cited design catalogue passage and contain no executable/resource syntax.')
 for(const c of d.components)if((c.source!==d.design.source&&!sources.designSource(c.source))||!c.quote.includes(c.name))issues.push('Each component must be named verbatim in its cited design catalogue passage; missing components need specification, not an inline substitute.')
 if(new Set(d.tokens.map(t=>t.name)).size!==d.tokens.length)issues.push('Token names must be unique.')
 if(new Set(d.components.map(t=>t.name)).size!==d.components.length)issues.push('Component names must be unique.')
 // Static mocks deliberately support no external assets, URLs, scripts or CSS escape obfuscation.
 if(/url\s*\(|@|\\|<|\/\*|expression\s*\(|behavior\s*:|-moz-binding/i.test(d.css))issues.push('Use static inline CSS without imports, URLs, escapes, comments, at-rules or active content.')
 // Inspect complete declarations, not selectors (e.g. #face is an ID, not a colour).
 const declarations=[...d.css.matchAll(/(?:^|[;{])\s*([a-z-][a-z0-9-]*)\s*:\s*([^;{}]+)(?=[;}])/gi)]
 for(const m of declarations){
  const property=m[1]!.toLowerCase(),value=m[2]!
  if(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|lab|lch|color)\s*\(/i.test(value))issues.push('Use the cited CSS token variables for colours; no hard-coded colour values in layout CSS.')
  if(property.startsWith('--'))issues.push('Define tokens only in tokens, not again in CSS.')
  if(!/^(?:color|background(?:-color)?|font(?:-size|-family|-weight)?|line-height|padding(?:-.+)?|margin(?:-.+)?|gap|row-gap|column-gap|border(?:-radius|-color|-width)?|box-shadow)$/.test(property))continue
  if(property==='font-family'&&tokenFontStack.test(value.trim()))continue
  let rest=value.replace(/var\(\s*--[a-z0-9-]+\s*\)/gi,'').replace(/\b(?:transparent|currentColor|inherit|unset|none|normal|auto|solid|dashed)\b/gi,'')
  if(property==='box-shadow')rest=rest.replace(/\binset\b/gi,'').replace(/,/g,' ')
  if(property==='font'||property==='border-radius')rest=rest.replace(/\//g,' ')
  rest=rest.trim()
  if(rest&&!/^(?:[+-]?(?:0(?:\.0+)?|\.0+)(?:px|rem|em|%|vh|vw|vmin|vmax|ch|ex)?\s*)+$/i.test(rest))issues.push('Use cited token variables for visual property '+property+', including spacing/typography; no ad-hoc visual literals.')
 }
 for(const match of d.css.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/gi))if(!d.tokens.some(t=>t.name===match[1]))issues.push('CSS refers to an uncited token: '+match[1])
 if(!d.css.includes('var('))issues.push('The mock must actually use its cited design tokens.')
 return [...new Set(issues)]
}
export const mockIntent=(text:string)=>/^\/mock(?:\s|$)/i.test(text.trim())
export const MOCK_GUIDE=`Design mocks (BA and PO)
- For an HTML/PNG mock use create_design_mock. It creates a STATIC preview artifact, never production code or an approved decision. Requirements and an attachment target are OPTIONAL. A free-form user request with an explicitly selected design source is sufficient: authority:null, target:null, requirements:[]. Human selection does not imply approval or that this is the latest binding version. If a requirement was explicitly supplied, read and cite it; otherwise never ask for or invent one. ONE is only a transient preview/controller; saving attaches HTML, PNG and a source receipt to that record in Atlas, not to ONE. ONE renders PNG from that exact HTML; never claim image generation or tests happened before their receipt.
- First download the explicitly selected design source with atlas_get. If no source was selected, resolve the applicable Atlas design constraint/current catalogue. Read a requirement record only when supplied. Successful full body reads return oneMockSource with run-local source ids. Use read_design_source with that id and a component/token/version keyword to read bounded exact windows from a large catalogue. Search and discovery alone do not suffice. Respect tenant/project and access rules; do not change them. Follow explicit superseding notes: old attached exports and old rules can be obsolete. For FluX FeliX/CNSX resolve the shared FluX catalogue and its latest binding notes, not the E+H workshop system. Load the actual current screen foundation where required; if unavailable, state that gap.
- An explicitly selected package Epic is the design root. Its verified child records collectively form the catalogue. Cite the root in design; tokens and components cite their own actually read child source ids. The Epic index is navigation only; never cite an index row as component or token evidence. Load only relevant components plus shared foundations. Requirements remain optional.
- Cite the design catalogue and any supplied requirements with exact body quotes. An applicability/current-version quote is required only for a design source the model selected; for an explicitly human-selected design source use authority:null without inventing binding status. Unknown version, missing component, conflicting rule or missing required screen: inspect ONE/Atlas first, then ask a focused one_task_question if needed. Never invent a design system or component.
- Allowed HTML elements: ${MOCK_TAGS.join(', ')}. Tables may use caption for their visible accessible title and tfoot for totals.
- Allowed HTML attributes: ${MOCK_ATTRS.join(', ')}. No other attributes, inline styles, URLs or handlers.
- Zero lengths (including 0px), child selectors, comma-separated token-based shadows and slash-separated token-based font/radius values are allowed.
- For font-family use a cited variable such as var(--font); generic browser fallbacks after it (for example var(--font), sans-serif) are allowed. Named fonts must be inside cited tokens. Form controls may use font-family:inherit.
- html is body markup only, using data-ds-component="ExactCatalogueName" on each control or its enclosing component block and data-requirement="R1" etc on requirement areas. Every requirement must map to a visible area. Use CSS variables for design colours, fonts, spacing and radius; tokens carry exact catalogue values and quote. No JS, imports, external images/fonts/links, network, forms submission or inline style attributes. Put styling in css. Use semantic HTML labels and static states; describe interactions and unresolved states in notes. Include font/asset limitations and design approximations honestly. No invented data/approval: mark illustrative examples.
- ONE verifies citation origin, static markup and some token mechanics, NOT semantic completeness or pixel-perfect design compliance. Deliver as a proposal with open BA/PO decisions. Do not call create_page as a substitute for an actual mock artifact. On /mock create at most one focused screen unless the person explicitly asks for more. If sources cannot support it, report the missing source and make no mock.`
