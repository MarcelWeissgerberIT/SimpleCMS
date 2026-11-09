import {test} from 'node:test'
import assert from 'node:assert/strict'
import {sourceWindowEnd,estimatedReadTokens,STANDARD_READ,SMALL_READ,ReadPool} from '../../src/shared/ai/readPlanning.ts'
import {readBatches,settleReadBatch} from '../../src/shared/quandprofile/readBatches.ts'
import type {ProgramStep} from '../../src/shared/quandprofile/program.ts'
import {ReadRunMetrics} from '../../src/shared/ai/readMetrics.ts'

test('a 30k document fits one bounded delivery; dense Unicode still obeys estimated token budget',()=>{
 const text='A short source sentence. '.repeat(1200)
 assert.equal(sourceWindowEnd(text,0,STANDARD_READ),text.length)
 const unicode='測定🧪'.repeat(10000),end=sourceWindowEnd(unicode,0,STANDARD_READ)
 assert.ok(end<unicode.length);assert.ok(estimatedReadTokens(unicode.slice(0,end))<=STANDARD_READ.estimatedTokens)
 assert.ok(!/[\uD800-\uDBFF]$/u.test(unicode.slice(0,end)))
 assert.ok(sourceWindowEnd(text,0,SMALL_READ)<=5000)
})
test('paragraphs inside a code fence do not become split boundaries; headings stay with the next section',()=>{
 const text='Intro\n\n'+'x'.repeat(70)+'\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\n## Next\nmore'.repeat(3)
 const end=sourceWindowEnd(text,0,{maxCharacters:105,estimatedTokens:1000})
 assert.equal(end,78)
 const huge='```ts\n'+'x'.repeat(50000)
 assert.ok(sourceWindowEnd(huge,0,STANDARD_READ)>0)
})
test('out-of-order completion cannot reorder program dependencies or cross writes',()=>{
 const read=(id:string,args:any={literal:{}}):ProgramStep=>({id,kind:'tool',tool:'read_page',effect:'read',schema:{type:'object'},args})
 const write:ProgramStep={...read('write'),effect:'stage'} as ProgramStep
 const steps=[read('a'),read('b'),read('c',{object:{id:{result:'a',path:[]}}}),read('d'),write,read('e')]
 assert.deepEqual(readBatches(steps).map(b=>b.map(s=>s.id)),[['a','b'],['c','d'],['write'],['e']])
 assert.ok(readBatches(Array.from({length:10},(_,i)=>read('s'+i))).every(b=>b.length<=3))
})
test('failed batch settles pending reads before throwing',async()=>{
 let finish!:()=>void,settled=false,thrown=false
 const waiting=new Promise<void>(r=>finish=r)
 const batch=settleReadBatch([0,1],async n=>{if(!n)throw Error('failed');await waiting;settled=true}).catch(()=>{thrown=true})
 await new Promise(r=>setTimeout(r,5));assert.equal(thrown,false)
 finish();await batch;assert.equal(settled,true);assert.equal(thrown,true)
})
test('read pool bounds active work and never starts queued cancelled work',async()=>{
 const pool=new ReadPool(3),controller=new AbortController();let active=0,peak=0,started=0
 let release!:()=>void;const waiting=new Promise<void>(r=>release=r)
 const jobs=Array.from({length:8},()=>pool.run(async()=>{started++;active++;peak=Math.max(peak,active);await waiting;active--},controller.signal))
 controller.abort();release();await Promise.allSettled(jobs)
 assert.equal(peak,3);assert.equal(started,3)
 assert.equal(await pool.run(async()=>42),42)
})
test('cache metrics distinguish billed input, read, write and unpriced responses',()=>{
 const m=new ReadRunMetrics();m.observe({input:10,cacheRead:20,cacheWrite:30,cacheWrite1h:40,output:5,reasoning:0},.05)
 m.observe({input:1,cacheRead:2,cacheWrite:3,cacheWrite1h:4,output:5,reasoning:0},null)
 const s=m.snapshot();assert.equal(s.cacheReadTokens,22);assert.equal(s.cacheWriteTokens,77);assert.equal(s.inputTokens,11);assert.equal(s.unpricedRounds,1);assert.equal(s.costUsd,.05)
})
