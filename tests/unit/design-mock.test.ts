import {test} from 'node:test'
import assert from 'node:assert/strict'
import {MockSources,mockIssues,normalizeMockFonts,type MockDraft} from '../../src/shared/ai/designMock.ts'
const design='Current Example Kit v5. Button uses --primary: #A50034. Card uses --surface: #FFFFFF. The spacing step is 16px.'
const rule='Current design system: /r/12 Example Kit v5 is the only valid version.'
const req='When a record is selected, the screen shall display its original title.'
const observe=(s:MockSources,ref:number,body:string)=>s.observe('atlas','https://atlas.example.org','atlas_get',{ref},JSON.stringify({item:{ref,title:'Record '+ref,body}}))!
function fixture(){const s=new MockSources(),d=observe(s,12,design),a=observe(s,13,rule),r=observe(s,14,req);const draft:MockDraft={title:'Source mock',width:960,height:640,html:'<main data-requirement="R1"><button data-ds-component="Button">Original title</button></main>',css:'button{color:var(--primary)}',design:{source:d.id,quote:design},authority:{source:a.id,quote:rule},target:r.id,requirements:[{source:r.id,quote:req}],tokens:[{source:d.id,name:'--primary',value:'#A50034',quote:'Button uses --primary: #A50034.'}],components:[{source:d.id,name:'Button',quote:'Button uses --primary: #A50034.'}],notes:['Static proposal; visual review remains open.']};return {s,d,a,r,draft}}
test('only full successful exact Atlas record reads mint mock source ids',()=>{const s=new MockSources();for(const name of ['atlas_search','atlas_context','one_mcp_search'])assert.equal(s.observe('atlas','https://atlas.example.org',name,{ref:12},JSON.stringify({item:{ref:12,title:'Found',body:design}})),null);for(const raw of [{isError:true,item:{ref:12,title:'Denied',body:design}},{item:{ref:99,title:'Other',body:design}},{item:{ref:12,title:'Excerpt',body:design,truncated:true}},{item:{ref:12,title:'Metadata'}}])assert.equal(s.observe('atlas','https://atlas.example.org','atlas_get',{ref:12},JSON.stringify(raw)),null)})
test('fresh real requirement, rule and catalogue passages pass origin/token checks',()=>{const {s,draft}=fixture();assert.deepEqual(mockIssues(draft,s),[])})
test('invented ids and quotes are held',()=>{for(const field of ['design','authority'] as const){const {s,draft}=fixture();draft[field]!.quote='A model invented this quotation.';assert(mockIssues(draft,s).length)}const {s,draft}=fixture();draft.requirements[0].source='other-run';assert(mockIssues(draft,s).length)})
test('search title or unrelated current rule is insufficient',()=>{const {s,draft,a}=fixture();observe(s,13,'Current design system: /r/55 Different Kit is the only valid version.');draft.authority={source:a.id,quote:'Current design system: /r/55 Different Kit is the only valid version.'};assert(mockIssues(draft,s).some(i=>i.includes('exact design')))})
test('a changed catalogue invalidates old quote claims, while keeping source identity',()=>{const {s,d,draft}=fixture(),next=observe(s,12,'New current Kit v6. Button uses --primary: #CC0000. New spacing rules.');assert.equal(next.id,d.id);assert.notEqual(next.hash,d.hash);assert(mockIssues(draft,s).length)})
test('tenant and server wall source ids never alias',()=>{const s=new MockSources(),raw=JSON.stringify({item:{ref:12,title:'Kit',body:design}}),a=s.observe('atlas','https://atlas.example.org','atlas_get',{ref:12,tenant:'a'},raw)!,b=s.observe('atlas','https://atlas.example.org','atlas_get',{ref:12,tenant:'b'},raw)!;assert.notEqual(a.id,b.id)})
test('tokens cannot silently replace source values or carry active CSS',()=>{for(const value of ['#ABCDEF','url(https://evil.test/x)','red;}body{color:red']){const {s,draft}=fixture();draft.tokens[0].value=value;assert(mockIssues(draft,s).length)}})
test('non-catalogue components cannot be invented',()=>{const {s,draft}=fixture();draft.components[0].name='MagicDialog';assert(mockIssues(draft,s).length)})
test('spaced catalogue names require exact evidence, never a normalized alias',()=>{
 const {s,draft}=fixture(),quote='Progress Indicator displays completion of a process.'
 observe(s,12,design+' '+quote)
 draft.components.push({source:draft.design.source,name:'Progress Indicator',quote})
 assert.deepEqual(mockIssues(draft,s),[])
 draft.components[1].name='ProgressIndicator'
 assert(mockIssues(draft,s).some(i=>i.includes('"ProgressIndicator" must be named verbatim')))
 draft.components[1].name='Progress Indicator'
 draft.components[1].quote='Progress Indicator is an invented source quotation.'
 assert(mockIssues(draft,s).some(i=>i.includes('not an exact substring')))
})
test('layout colour literals, external assets, CSS escapes and unknown variables are held',()=>{for(const css of ['a{color:#ff0000}','a{background:url(https://evil.test/x)}','@import "https://evil.test/x";','a{color:var(--invented)}','a{color:var(--primary);\\63olor:red}','a{--primary:red;color:var(--primary)}']){const {s,draft}=fixture();draft.css=css;assert(mockIssues(draft,s).length,css)}})
test('MCP text envelopes and canonical source links use actual returned ref',()=>{const s=new MockSources(),source=s.observe('atlas','https://atlas.example.org/path','atlas_get',{ref:12},JSON.stringify({content:[{type:'text',text:JSON.stringify({item:{ref:12,title:'Design',body:design}})}]}))!;assert.equal(s.get(source.id)?.url,'https://atlas.example.org/r/12')})
test('source excerpts are original bounded windows, with version and token keyword matches',()=>{const {s,d}=fixture(),read=s.excerpt(d.id,'Button');assert.equal(read.matches,1);assert(read.excerpts[0].text.includes('Button uses --primary: #A50034'));assert.throws(()=>s.excerpt('other-run','Button'));assert.throws(()=>s.excerpt(d.id,'Button',-1))})
test('mock target must be an actually cited requirement record',()=>{const {s,draft}=fixture();draft.target=draft.design.source;assert(mockIssues(draft,s).some(i=>i.includes('attachment target')))})
test('visual spacing, font and named colours cannot bypass the cited token mechanism',()=>{for(const css of ['p{color:red;padding:var(--primary)}','p{font-size:16px;color:var(--primary)}','p{gap:17px;color:var(--primary)}']){const {s,draft}=fixture();draft.css=css;assert(mockIssues(draft,s).some(i=>i.includes('visual property')))}})
test('unchanged body does not conceal a source lifecycle/version-field change',()=>{const {s,d}=fixture(),old=s.get(d.id)!;s.observe('atlas','https://atlas.example.org','atlas_get',{ref:12},JSON.stringify({item:{ref:12,title:'Record 12',body:design,status:'superseded',fields:{version:6}}}));const next=s.get(d.id)!;assert.equal(next.hash,old.hash);assert.notEqual(next.stateHash,old.stateHash)})

test('bounded mock excerpts retain release tail and actual foundation sections rather than only the table of contents',()=>{
 const sources=new MockSources(),body='Catalogue introduction\n'+('x'.repeat(7000))+'\n### Colour\nPrimary value #A50034.\n'+('x'.repeat(7000))+'\n### Typography\nFamily EuH Sans, Regular 400.\n'+('x'.repeat(7000))+'\n### Tier 2 · Molecules\nConfirmationModal is available.\n'+('x'.repeat(25000))+'\nLatest binding catalogue version 15. This supersedes version 14.'
 sources.observe('atlas','https://aj-atlas.com','atlas_get',{ref:12},JSON.stringify({item:{ref:12,title:'Catalogue',body}}));const context=sources.context()[0],text=context.excerpts.map(x=>x.text).join('\n');for(const expected of ['#A50034','Family EuH Sans','ConfirmationModal','Latest binding catalogue version 15'])assert(text.includes(expected),expected);assert(context.partial);assert(context.excerpts.every(x=>body.slice(x.offset,x.offset+x.text.length)===x.text));assert(context.excerpts.reduce((n,x)=>n+x.text.length,0)<=18000)
})

test('all exact mock source excerpts share one bounded budget',()=>{const sources=new MockSources(),body='# Catalogue\n### Colour\nPrimary #A50034.\n'+('x'.repeat(70000))+'\n### Typography\nEuH Sans.\nLatest version 15.';for(const ref of [14,13,12,15,16,17])sources.observe('atlas','https://aj-atlas.com','atlas_get',{ref},JSON.stringify({item:{ref,title:'Source '+ref,body}}));const ctx=sources.context(14);assert(ctx.reduce((n,s)=>n+s.excerpts.reduce((m,e)=>m+e.text.length,0),0)<=17000);assert(ctx.every(s=>s.partial))})

test('human-selected design needs no requirement, target or fabricated applicability rule',()=>{
 const {s,d,draft}=fixture();s.selectedDesign=d.id;draft.authority=null;draft.target=null;draft.requirements=[]
 assert.deepEqual(mockIssues(draft,s),[]);s.selectedDesign=null;assert(mockIssues(draft,s).some(x=>x.includes('explicitly selected')))
})
test('exact slug resolution verifies both project and slug before accepting the returned global ref',()=>{
 const s=new MockSources(),args={project:'flux-client',slug:'atlas-ui-instructions'},record={ref:123,title:'Design',body:design,...args}
 assert(s.observe('atlas','https://aj-atlas.com','atlas_get',args,JSON.stringify({item:record})))
 for(const patch of [{project:'other'},{slug:'other'},{ref:0}])assert.equal(s.observe('atlas','https://aj-atlas.com','atlas_get',args,JSON.stringify({item:{...record,...patch}})),null)
})

test('inset is shadow syntax while nonzero shadow dimensions still require citations',()=>{
 const {s,draft}=fixture();draft.tokens.push({source:draft.design.source,name:'--space',value:'16px',quote:'The spacing step is 16px.'})
 draft.css='p{box-shadow:inset var(--space) 0 0 var(--primary)}'
 assert.deepEqual(mockIssues(draft,s),[])
 for(const css of ['p{box-shadow:inset 4px 0 0 var(--primary)}','p{padding:inset var(--space)}']){draft.css=css;assert(mockIssues(draft,s).some(i=>i.includes('visual property')))}
})

function fontFixture(){
 const f=fixture(),quote='Body font is "EuH Sans", system-ui, sans-serif.'
 observe(f.s,12,design+' '+quote)
 f.draft.tokens.push({source:f.d.id,name:'--font',value:'"EuH Sans", system-ui, sans-serif',quote})
 return f
}
test('cited font stacks accept generic browser fallbacks and inheritance',()=>{
 for(const value of ['var(--font)','var(--font), sans-serif','var(--font), system-ui, sans-serif','var(--font), var(--font), ui-sans-serif','inherit']){
  const {s,draft}=fontFixture();draft.css='body{color:var(--primary);font-family:'+value+'}'
  assert.deepEqual(mockIssues(draft,s),[],value)
 }
})
test('font fallbacks cannot introduce an uncited named font or bypass other visual checks',()=>{
 for(const css of ['body{font-family:var(--font), Arial}','body{font-family:Arial, var(--font)}','body{font-family:sans-serif}','body{font-family:var(--missing), sans-serif}','body{font-family:var(--font), "sans-serif"}','body{font-family:var(--font), url(https://evil.test)}','body{font-size:var(--font), sans-serif}']){
  const {s,draft}=fontFixture();draft.css=css;assert(mockIssues(normalizeMockFonts(draft),s).length,css)
 }
})
test('literal font values already cited are converted without inventing a token or changing the input',()=>{
 const {s,draft}=fontFixture();draft.css='body{font-family:"EuH Sans", system-ui, sans-serif}button{font-family:inherit}'
 const result=normalizeMockFonts(draft)
 assert.equal(result.css,'body{font-family:var(--font)}button{font-family:inherit}')
 assert(draft.css.includes('"EuH Sans"'));assert.deepEqual(mockIssues(result,s),[])
 draft.css='body{font-family:"EuH Sans", system-ui, sans-serif, monospace}'
 assert.equal(normalizeMockFonts(draft).css,'body{font-family:var(--font), monospace}')
 draft.tokens.at(-1)!.quote='A fabricated font citation for this token.'
 assert(mockIssues(normalizeMockFonts(draft),s).length)
})

test('static selectors, zero lengths and token-based CSS list syntax do not create false rejections',()=>{
 for(const css of [
  '#face > button{color:var(--primary);padding:0px;margin:0rem 0%}',
  'button{box-shadow:0px 0px var(--space) var(--primary), inset 0 0 var(--space) var(--primary)}',
  'button{font:var(--space)/var(--space) var(--font);border-radius:var(--space) / var(--space)}',
  'button{COLOR:var(--primary);PADDING:0.0px .0rem}',
 ]){const {s,draft}=fontFixture();draft.tokens.push({source:draft.design.source,name:'--space',value:'16px',quote:'The spacing step is 16px.'});draft.css=css;assert.deepEqual(mockIssues(draft,s),[],css)}
})
test('CSS syntax support still checks every declaration and disallows resource and literal bypasses',()=>{
 for(const css of [
  '#face > button{color:var(--primary);padding:3px}',
  'button{color:var(--primary);COLOR:red}',
  'button{color:var(--primary);box-shadow:0px 0px 3px var(--primary),none}',
  'button{color:var(--primary);font:16px/20px Arial}',
  'button{color:var(--primary);--primary:red}',
  'button{color:var(--primary);--primary2:red}',
  'button{color:var(--primary);background:#abc}',
  'button{color:var(--primary);background:url(https://evil.test)}',
  'button{color:var(--primary)} </style><script>alert(1)</script>',
 ]){const {s,draft}=fontFixture();draft.css=css;assert(mockIssues(draft,s).length,css)}
})


test('freshly revalidated cache keeps original provenance and accepts exact citations',()=>{
 const {s,d,draft}=fixture(),original=Date.now()-60*60*1000
 s.markReused(d.id,original)
 assert.equal(Date.parse(s.get(d.id)!.readAt),original)
 assert(s.get(d.id)!.validatedAt)
 assert.deepEqual(mockIssues(draft,s),[])
 assert.equal(s.check({source:d.id,quote:'A fabricated quotation from an old mock.'}),false)
 assert.equal(new MockSources().check(draft.design),false)
})
test('expired, future and invalid verifications remain blocked, including revalidated cache',()=>{
 for(const reused of [false,true])for(const date of [new Date(Date.now()-16*60*1000).toISOString(),new Date(Date.now()+60000).toISOString(),'invalid']){
  const {s,d,draft}=fixture(),source=s.get(d.id)!
  if(reused){s.markReused(d.id,Date.now()-3600000);source.validatedAt=date}else source.readAt=date
  assert.equal(s.check(draft.design),false)
  assert(mockIssues(draft,s).some(i=>i.startsWith('design: Atlas record #12')&&i.includes('refresh')))
 }
})
test('citation diagnostics identify the affected field and distinguish missing source from quote mismatch',()=>{
 const {s,draft}=fixture()
 draft.components[0].quote='A fabricated component definition.'
 draft.requirements[0].source='previous-run'
 const issues=mockIssues(draft,s)
 assert(issues.some(i=>i.startsWith('components[0]: Quote is not an exact substring of Atlas record #12')))
 assert(issues.some(i=>i.startsWith('requirements[0]: Source is not a full Atlas body verified in this run')))
})
