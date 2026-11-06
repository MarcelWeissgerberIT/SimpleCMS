import {test} from 'node:test'
import assert from 'node:assert/strict'
import {McpActivityNames,mcpActivityText} from '../../src/shared/mcp/activityDisplay.ts'
const repo='1ed30e31-fe74-47ca-8448-d54dac528190',snapshot='f7950f16-302e-446d-b5d8-9c85fd5ac75e',args={repo,snapshot,path:'src/Host/MinimalApiEndpoints.cs',startLine:1,endLine:60}
const env=(d:unknown)=>({content:[{type:'text',text:JSON.stringify(d)}]})
test('observed repository names replace opaque ids while exact parameters remain available',()=>{
 const n=new McpActivityNames();n.observe('atlas','atlas_code_repos',{},env({items:[{id:repo,name:'icm-felix',newest:{id:snapshot,branch:'main',commit:'a'.repeat(40)}}]}))
 const d=n.describe('atlas','atlas_code_read',args),text=mcpActivityText('atlas_code_read',d,'','de')
 assert.equal(text.action,'Code lesen');assert.match(text.detail,/icm-felix.*main.*aaaaaaaa.*MinimalApiEndpoints.cs.*Zeilen 1–60/);assert.ok(!text.detail.includes(repo));assert.match(d.technical!,new RegExp(repo))
 assert.equal(n.describe('other','atlas_code_read',args).repo,undefined)
})
test('unknown ids are never guessed; errors cannot teach repository or record labels',()=>{
 const n=new McpActivityNames();n.observe('atlas','atlas_code_repos',{}, {isError:true,...env({items:[{id:repo,name:'WRONG'}]})})
 const d=n.describe('atlas','atlas_code_search',{repo,snapshot,query:'CoverMagazine'})
 assert.equal(d.repo,undefined);const text=mcpActivityText('atlas_code_search',d,'','en');assert.match(text.detail,/Repository.*CoverMagazine/);assert.ok(!text.detail.includes(repo))
 n.observe('atlas','atlas_get',{tenant:'a'},env({item:{ref:42,title:'Cover magazine'}}));assert.equal(n.describe('atlas','atlas_get',{tenant:'a',ref:42}).title,'Cover magazine');assert.equal(n.describe('atlas','atlas_get',{tenant:'b',ref:42}).title,undefined)
})
test('retained pages preserve source identity without retaining source bodies',()=>{
 const n=new McpActivityNames();n.retain(JSON.stringify({result_id:'source-1'}),{repo:'icm-felix',path:'src/a.cs',lines:'5–20',technical:'private args'})
 const d=n.describe('MCP','one_mcp_read_result',{result_id:'source-1',path:'/text',offset:3000})
 assert.equal(d.path,'src/a.cs');assert.equal(d.repo,'icm-felix');assert.equal(d.cached,true);assert.ok(!JSON.stringify(d).includes('private args'));assert.match(mcpActivityText('one_mcp_read_result',d,'','de').action,/Gesicherte Quelle/)
})
test('metadata is bounded and plain text; arbitrary body and credentials are not copied',()=>{
 const n=new McpActivityNames(),d=n.describe('atlas','atlas_code_read',{...args,body:'SOURCE_CODE',token:'SECRET',query:'x'.repeat(900)})
 assert.equal(d.query?.length,200);assert.ok(!JSON.stringify(d).includes('SECRET'));assert.ok(!JSON.stringify(d).includes('SOURCE_CODE'))
})

test('finished reads preserve the known branch and legacy code rows hide opaque ids',()=>{const n=new McpActivityNames();n.observe('atlas','atlas_code_repos',{},env({items:[{id:repo,name:'icm-felix',newest:{id:snapshot,branch:'main',commit:'a'.repeat(40)}}]}));n.observe('atlas','atlas_code_read',args,env({repo,snapshot,commit:'a'.repeat(40),text:'NOT_FOR_DISPLAY'}));assert.equal(n.describe('atlas','atlas_code_read',args).version,'main · aaaaaaaa');assert.ok(!mcpActivityText('atlas_code_read',undefined,repo,'de').detail.includes(repo))})
