import {test} from 'node:test'
import assert from 'node:assert/strict'
import {inspectProgramInputs,sourceParameter,sourcePageAvailable,simpleInputKind} from '../../src/app/features/ai/programs/inputModel.ts'
import {type ProgramSpec} from '../../src/shared/quandprofile/program.ts'
const spec:ProgramSpec={protocol:'one.program.v1',goal:'Read a source',parameters:{source:{schema:{type:'string',minLength:1}},audience:{schema:{type:'string',minLength:3}},language:{schema:{type:'string',enum:['de','en']},default:'de'},count:{schema:{type:'integer',minimum:1,maximum:8},default:3},questions:{schema:{type:'boolean'}},options:{schema:{type:'object',properties:{ref:{type:'integer'}},additionalProperties:true},default:{ref:42}}},steps:[{id:'read',kind:'tool',tool:'read_page',effect:'read',schema:{type:'object',properties:{id:{type:'string'}}},args:{object:{id:{input:'source'}}}}],output:{result:'read',path:[]}}
const valid={source:'"page"',audience:'"Team"',questions:'false'}
test('guided values bind exact strings, false, integers and defaults, without accepting missing or schema-invalid values',()=>{
 const result=inspectProgramInputs(spec,valid);assert.equal(result.issues.length,0);assert.deepEqual(result.bound,{source:'page',audience:'Team',language:'de',count:3,questions:false,options:{ref:42}})
 assert.equal(inspectProgramInputs(spec,{...valid,audience:'"x"'}).issues[0]?.kind,'schema')
 assert.equal(inspectProgramInputs(spec,{...valid,questions:''}).issues[0]?.kind,'missing')
 assert.equal(inspectProgramInputs(spec,{...valid,count:'1.5'}).issues[0]?.kind,'schema')
 assert.equal(inspectProgramInputs(spec,{...valid,count:'10'}).issues[0]?.kind,'schema')
 assert.equal(inspectProgramInputs(spec,{...valid,language:'"custom"'}).issues[0]?.kind,'schema')
})
test('incomplete JSON, prototype keys and overflowing numbers produce issues rather than crashing the form',()=>{
 for(const raw of ['{"ref":-}','{"__proto__":{}}','{"ref":1e999}'])assert.ok(inspectProgramInputs(spec,{...valid,options:raw}).issues.length)
 assert.equal(inspectProgramInputs(spec,{...valid,audience:'Team'}).issues[0]?.kind,'json')
})
test('page fields are inferred only from actual ONE read/workflow bindings, never their names',()=>{
 assert.equal(sourceParameter(spec,'source'),true);assert.equal(sourceParameter(spec,'audience'),false)
 const workflow={...spec,steps:[{id:'workflow',kind:'workflow',mode:'ba',target:{input:'audience'},connections:[]}]} as ProgramSpec
 assert.equal(sourceParameter(workflow,'audience'),true)
})
test('source picker excludes missing, hidden, trashed, template and cyclic ancestry',()=>{
 const pages:any={a:{id:'a',parentId:null},b:{id:'b',parentId:'a'},c:{id:'c',parentId:'missing'}}
 assert.equal(sourcePageAvailable(pages,'b'),true);assert.equal(sourcePageAvailable(pages,'c'),false)
 for(const flag of ['trashed','hidden','template']){pages.a[flag]=true;assert.equal(sourcePageAvailable(pages,'b'),false);delete pages.a[flag]}
 pages.a.parentId='b';assert.equal(sourcePageAvailable(pages,'b'),false)
})
test('complex schema alternatives retain JSON editing; nullable primitive types retain explicit field controls',()=>{
 assert.equal(simpleInputKind({type:['string','null']}),'string');assert.equal(simpleInputKind({type:'integer'}),'number');assert.equal(simpleInputKind({anyOf:[{type:'string'},{type:'integer'}]}),'json');assert.equal(simpleInputKind({type:'object',properties:{ref:{type:'integer'}}}),'object')
})
