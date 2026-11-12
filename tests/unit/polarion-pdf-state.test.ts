import {test} from 'node:test'
import assert from 'node:assert/strict'
import {hasPdfAttachment,pdfExportSteps} from '../../src/app/features/ai/agent/polarionPdfState.ts'
import type {AgentStep} from '../../src/app/features/ai/agent/types.ts'

test('attachment evidence requires a file node, not text, a link or old staged metadata',()=>{
 const src='onefile:original'
 for(const content of [null,{type:'text',text:src},{type:'paragraph',attrs:{src}},{type:'fileBlock',attrs:{src:'onefile:other'}}])assert.equal(hasPdfAttachment(content,src),false)
 assert.equal(hasPdfAttachment({type:'doc',content:[{type:'details',content:[{type:'fileBlock',attrs:{src}}]}]},src),true)
})

test('repeated status polling cannot duplicate exports or lose an import receipt',()=>{
 const step=(id:string,job='job-a',server='atlas')=>({id,state:'ok',mcp:{receipt:{server,polarionPdf:{job}}}} as AgentStep)
 const saved={...step('saved'),mcp:{...step('saved').mcp!,pdfImported:{src:'onefile:a',pageId:'page-a'}}}
 const exports=pdfExportSteps([step('first'),saved,step('later'),step('other-job','job-b'),step('other-server','job-a','atlas-other'),{...step('failed','job-c'),state:'err'}])
 assert.deepEqual(exports.map(s=>s.id),['saved','other-job','other-server'])
 assert.equal(exports[0].mcp?.pdfImported?.src,'onefile:a')
})
