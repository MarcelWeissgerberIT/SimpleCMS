import {MockSources,type MockDraft} from '../../src/shared/ai/designMock'
import {compileMock} from '../../src/app/features/ai/agent/designMocks'
const sources=new MockSources(),body='Search contains a search input. DataTable contains a table. Text color is #111111.'
const source=sources.observe('fixture','https://example.invalid','atlas_get',{ref:1},JSON.stringify({item:{ref:1,title:'Fixture catalogue',body}}))!
sources.selectDesign(source.id)
const draft:MockDraft={title:'Validation fixture',width:960,height:640,html:'<main><label data-ds-component="Search">Search<input type="search" name="q"></label><section data-ds-component="DataTable"><table><tbody><tr><td>Example</td></tr></tbody></table></section></main>',css:'main{color:var(--ink)}',design:{source:source.id,quote:body},authority:null,target:null,requirements:[],tokens:[{name:'--ink',value:'#111111',source:source.id,quote:body}],components:['Search','DataTable'].map(name=>({name,source:source.id,quote:body})),notes:['Synthetic fixture']}
const result:string[]=[]
try{
 const artifact=compileMock(draft,sources)
 if(!artifact.document.includes('name="q"')||!artifact.document.includes('<body inert>'))throw Error('Inert name attribute was not retained')
 result.push('PASS · cited wrapper controls and inert name attribute')
 for(const [label,html] of [
  ['unmapped control',draft.html+'<button>Unmapped</button>'],
  ['unknown component',draft.html.replace('data-ds-component="Search"','data-ds-component="Invented"')],
  ['event handler',draft.html.replace('name="q"','name="q" oninput="alert(1)"')],
  ['external URL',draft.html.replace('name="q"','name="q" src="https://example.invalid/"')],
  ['script',draft.html+'<script>alert(1)</script>']]){
  let blocked=false;try{compileMock({...draft,html},sources)}catch{blocked=true}
  if(!blocked)throw Error('Accepted '+label)
  result.push('PASS · blocked '+label)
 }
 document.querySelector('#status')!.textContent=result.join('\n')
}catch(e){document.querySelector('#status')!.textContent='FAIL '+e}
