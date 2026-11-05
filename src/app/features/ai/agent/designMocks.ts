import DOMPurify from 'dompurify'
import {MockSources,MOCK_SCHEMA,mockIssues,type MockDraft,type DesignMock} from '@/shared/ai/designMock'
import {sha256Hex} from '@/shared/mcp/sha256'
import {validateValue} from '@/shared/quandprofile/program'
import {ToolInputError,type AgentTool} from './tools'
const tags=['main','section','article','header','footer','nav','aside','div','span','h1','h2','h3','h4','p','strong','em','small','label','button','input','textarea','select','option','table','thead','tbody','tr','th','td','ul','ol','li','dl','dt','dd','hr','br','fieldset','legend','progress']
const attrs=['class','id','role','aria-label','aria-labelledby','aria-describedby','aria-selected','aria-checked','aria-disabled','aria-current','data-ds-component','data-requirement','type','name','value','placeholder','disabled','checked','selected','for','rows','cols','colspan','rowspan','scope','min','max','step']
const escape=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
export function compileMock(draft:MockDraft,sources:MockSources):DesignMock{
 try{validateValue(draft,MOCK_SCHEMA,'design mock')}catch(e){throw new ToolInputError(String(e))}
 const issues=mockIssues(draft,sources)
 const parsed=new DOMParser().parseFromString(draft.html,'text/html')
 if(parsed.head.children.length||/<\s*\/?(?:html|head|body|!doctype)\b/i.test(draft.html))issues.push('Supply body markup only, not a document/head/style/script wrapper.')
 for(const el of parsed.body.querySelectorAll('*')){
  if(!tags.includes(el.tagName.toLowerCase()))issues.push('Unsupported static mock element: '+el.tagName)
  for(const attr of el.attributes)if(!attrs.includes(attr.name))issues.push('Unsupported attribute: '+attr.name+'; no URLs, inline CSS or handlers.')
  if(el instanceof HTMLInputElement&&!['text','number','checkbox','radio','search','date','time','email'].includes(el.type))issues.push('Unsupported input type.')
  const name=el.getAttribute('data-ds-component')
  if(name&&!draft.components.some(c=>c.name===name))issues.push('Uncited component: '+name)
  if(['BUTTON','INPUT','SELECT','TEXTAREA','PROGRESS','TABLE'].includes(el.tagName)&&!el.closest('[data-ds-component]'))issues.push('Every control/table needs a data-ds-component catalogue mapping on itself or its enclosing component.')
  for(const ref of (el.getAttribute('data-requirement')??'').split(/\s+/).filter(Boolean))if(!/^R[1-6]$/.test(ref)||Number(ref.slice(1))>draft.requirements.length)issues.push('Unknown requirement mapping: '+ref)
 }
 for(let n=1;n<=draft.requirements.length;n++)if(!parsed.body.querySelector(`[data-requirement~="R${n}"]`))issues.push('Map requirement R'+n+' to its visible mock area with data-requirement.')
 for(const component of draft.components)if(![...parsed.body.querySelectorAll('[data-ds-component]')].some(el=>el.getAttribute('data-ds-component')===component.name))issues.push('Cited component is not used: '+component.name)
 if(issues.length)throw new ToolInputError('Mock held: '+[...new Set(issues)].join(' ').slice(0,8000))
 const clean=DOMPurify.sanitize(draft.html,{ALLOWED_TAGS:tags,ALLOWED_ATTR:attrs,ALLOW_DATA_ATTR:false,ALLOW_ARIA_ATTR:false})
 const tokens=draft.tokens.map(t=>t.name+':'+t.value).join(';')
 const used=[...new Set([draft.design,...(draft.authority?[draft.authority]:[]),...draft.requirements,...draft.tokens,...draft.components].map(c=>c.source))].map(id=>{const {body,...meta}=sources.get(id)!;return meta})
 const createdAt=new Date().toISOString()
 const doc='<!doctype html><html lang="'+(/\b(?:der|die|das|und|mit)\b/i.test(draft.html)?'de':'en')+'"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; base-uri &#39;self&#39;; form-action &#39;none&#39;"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="one-mock-status" content="proposal; human review open"><meta name="one-mock-sources" content="'+escape(JSON.stringify(used))+'"><title>'+escape(draft.title)+'</title><style>:root{'+tokens+'}*{box-sizing:border-box}body{margin:0}'+draft.css+'</style></head><body inert>'+clean+'</body></html>'
 const htmlHash=sha256Hex(doc),{html,css,...provenance}=draft
 return {id:crypto.randomUUID(),title:draft.title,width:draft.width,height:draft.height,document:doc,htmlHash,createdAt,sources:used,draft:provenance,review:'open',...(sources.epic?{atlasContext:(( {members,...context})=>context)(sources.epic)}:{}),target:used.find(s=>s.id===draft.target)??null}
}
export function mockTool(sources:MockSources,emit:(artifact:DesignMock)=>void,recover?:((input:unknown,error:unknown)=>Promise<MockDraft>)):AgentTool{
 let made=0,repaired=false
 return {name:'create_design_mock',description:'Create a static HTML design mock artifact with a PNG export card. Requires a freshly read Atlas design catalogue with cited tokens and components; actual reads return oneMockSource ids. Requirements and attachment target are optional. An applicability quote is needed only when the model selected the catalogue. Nothing is written to ONE or Atlas. Missing/obsolete design sources must be resolved first.',input_schema:MOCK_SCHEMA,write:false,async run(input){
  if(made>=3)throw new ToolInputError('At most three mock variants per task; narrow the screen before continuing.')
  let artifact:DesignMock
  try{artifact=compileMock(input as unknown as MockDraft,sources)}catch(error){if(!recover||repaired||!sources.snapshot().length)throw error;repaired=true;sources.repairAttempted=true;const draft=await recover(input,error);artifact=compileMock(draft,sources);sources.repaired=true}
  made++;sources.created++;emit(artifact)
  return {state:'ok',summary:artifact.title+' · HTML · PNG export ready · review open',content:JSON.stringify({artifact_id:artifact.id,title:artifact.title,html_sha256:artifact.htmlHash,sources:artifact.sources,review:'open',html:'available in mock card',png:'render on explicit PNG export or Attach to Atlas; not rendered yet',checks:'quote origin, component references, some CSS token mechanics, static sandbox; NOT semantic completeness or pixel-perfect compliance',notes:artifact.draft.notes})}
 }}
}

export function mockReadTool(sources:MockSources):AgentTool{return {name:'read_design_source',write:false,description:'Read exact excerpts from an already retrieved full Atlas mock source by oneMockSource id and component/token/version keyword. Bounded source windows, no new access or network; use next_offset for more matches.',input_schema:{type:'object',properties:{source:{type:'string'},query:{type:'string',minLength:1,maxLength:120},offset:{type:'integer',minimum:0}},required:['source','query'],additionalProperties:false},run(input){try{return {state:'ok',summary:String(input.query)+' · actual Atlas source excerpts',content:JSON.stringify(sources.excerpt(String(input.source),String(input.query),Number(input.offset??0)))}}catch(e){throw new ToolInputError(String(e))}}}}
