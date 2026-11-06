import {test} from 'node:test'
import assert from 'node:assert/strict'
import {guardedAtlasCodeCall,ATLAS_CODE_READ_TOOLS} from '../../src/shared/mcp/atlasCode.ts'
import {atlasTaskEffect,atlasReceipt} from '../../src/shared/mcp/facts.ts'
import {reusableMcpRead} from '../../src/shared/mcp/readReuse.ts'
import {ATLAS_CODE_ANALYSIS_SKILL} from '../../src/shared/ai/atlas-code-skill.ts'
import {skillMarkdown,parseSkillFile} from '../../src/shared/ai/skills.ts'
const envelope=(data:unknown)=>({content:[{type:'text',text:JSON.stringify(data)}]})
const citation={repo:'repo-a',snapshot:'snapshot-a',commit:'a'.repeat(40),path:'src/run.ts',lines:[5,12],digest:'d'.repeat(64)}
test('code operations have explicit effects, fresh reads and complete citation receipts',()=>{
 for(const name of ATLAS_CODE_READ_TOOLS){assert.equal(atlasTaskEffect(name,{}),'read');assert.equal(reusableMcpRead(name,'read'),false)}
 assert.equal(atlasTaskEffect('atlas_code_propose',{}),'write')
 for(const name of ['atlas_code_review','atlas_code_repo_update','atlas_code_repo_create'])assert.equal(atlasTaskEffect(name,{}),'forbidden')
 assert.deepEqual(atlasReceipt('atlas_code_verify',envelope({valid:true,citation})).code,{citation,verified:true})
 assert.equal(atlasReceipt('atlas_code_verify',envelope({valid:false,citation})).code?.verified,false)
 assert.equal(atlasReceipt('atlas_code_read',envelope({citation,text:'actual code'})).code?.verified,false)
 assert.deepEqual(atlasReceipt('atlas_code_repos',envelope({items:[{id:'repo-a'}],next:null})).counts,[{unit:'repositories',value:1}])
})
test('disabled, missing and malformed model permission never trigger a code read',async()=>{
 for(const value of [false,undefined,'true']){
  const calls:string[]=[]
  const result=await guardedAtlasCodeCall('atlas_code_read',{repo:'repo-a'},async name=>{calls.push(name);return envelope({items:[{id:'repo-a',modelProcessing:value}],next:null})},()=>true)
  assert.deepEqual(calls,['atlas_code_repos']);assert.equal((result as any).isError,true)
 }
})
test('permission lookup follows pages and repeats after the exact content call',async()=>{
 const calls:any[]=[]
 const result=await guardedAtlasCodeCall('atlas_code_read',{repo:'repo-a',snapshot:'snapshot-a'},async(name,args)=>{calls.push({name,args});return name==='atlas_code_repos'?envelope(args.offset?{items:[{id:'repo-a',modelProcessing:true}],next:null}:{items:[],next:25}):envelope({text:'CONFIDENTIAL',citation})},()=>true)
 assert.equal(calls.length,5);assert.deepEqual(calls[2],{name:'atlas_code_read',args:{repo:'repo-a',snapshot:'snapshot-a'}});assert.match(JSON.stringify(result),/CONFIDENTIAL/)
})
test('revocation while reading withholds all result bytes without claiming no execution',async()=>{
 let checked=0
 const result:any=await guardedAtlasCodeCall('atlas_code_read',{repo:'repo-a'},async name=>name==='atlas_code_repos'?envelope({items:[{id:'repo-a',modelProcessing:++checked===1}],next:null}):envelope({text:'CONFIDENTIAL'}),()=>true)
 assert.equal(result.isError,true);assert.equal(result.oneNotExecuted,undefined);assert.ok(!JSON.stringify(result).includes('CONFIDENTIAL'))
})
test('denied metadata and human-only operations cannot dispatch; pagination loops fail closed',async()=>{
 for(const name of ['atlas_code_read','atlas_code_review','atlas_code_repo_update']){const result:any=await guardedAtlasCodeCall(name,{repo:'repo-a'},async()=>{throw Error('must not call')},()=>false);assert.equal(result.oneNotExecuted,true)}
 let calls=0;const result:any=await guardedAtlasCodeCall('atlas_code_read',{repo:'repo-a'},async()=>{calls++;return envelope({items:[],next:0})},()=>true);assert.equal(result.isError,true);assert.equal(calls,2)
})
test('code analysis template imports, preserves evidence and uses actual One dispatch conventions',()=>{
 const parsed=parseSkillFile(skillMarkdown(ATLAS_CODE_ANALYSIS_SKILL)).spec
 assert.equal(parsed.name,'atlas-code-analyse-one');assert.match(parsed.instructions,/one_workspace_search/);assert.match(parsed.instructions,/digest/);assert.match(parsed.instructions,/modelProcessing/);assert.match(parsed.instructions,/Keine wi_-IDs/)
 assert.ok(!parsed.instructions.includes('1ed30e31-fe74'));assert.ok(parsed.instructions.length<12000)
})
