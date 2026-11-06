import test from 'node:test'
import assert from 'node:assert/strict'
import {hostCosts,readCostPlan} from './costs.mjs'
const from=Date.UTC(2026,10,1),to=from+3600000
const plan={currency:'EUR',computePerHour:3.6,diskPerMonth:72,asOf:'2026-11-01',source:'Synthetic test rate, not a live tariff'}
const record=(id,a,b,extra={})=>({auditId:id,processingAt:from+a,finishedAt:from+b,state:'processed',trace:{workspace:'ws',user:'person',run:'task'},...extra})
const report=(records,window={from,to})=>hostCosts(records,{plan,...window})
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`)
test('multi-round task allocation excludes queue, counts failures and reconciles the host subtotal',()=>{
 const result=report([record('a',10000,20000,{queuedAt:from}),record('b',30000,50000,{state:'failed'}),record('c',60000,70000,{trace:{workspace:'other',user:'other',job:'job'}})])
 assert.equal(result.tasks.length,2);assert.equal(result.tasks[0].rounds,2);assert.equal(result.tasks[0].failedRounds,1);assert.equal(result.tasks[0].queueMs,10000)
 near(result.tasks[0].computeEUR,.03);near(result.totals.allocatedComputeEUR,.04);near(result.totals.unallocatedComputeEUR,3.56);near(result.totals.diskEUR,.1)
 near(result.workspaces.reduce((s,w)=>s+w.computeEUR,0),result.totals.allocatedComputeEUR);near(result.totals.estimatedEUR,3.7)
 assert.ok(!JSON.stringify(result).includes('prompt'))
})
test('incomplete, queued, duplicate and run-envelope records cannot inflate occupancy',()=>{
 const row=record('a',1000,2000),result=report([row,row,{...row,kind:'run',auditId:'envelope'},record('unfinished',3000,5000,{finishedAt:null}),record('queued',0,9000,{processingAt:null}),record('invalid',4000,2000)])
 assert.equal(result.totals.rounds,1);assert.equal(result.totals.incompleteRounds,2);assert.equal(result.totals.busyMs,1000);near(result.totals.allocatedComputeEUR,.001)
})
test('overlapping completed intervals share capacity instead of charging the same time twice',()=>{
 const result=report([record('a',0,20000),record('b',10000,30000,{trace:{workspace:'other',run:'other'}})])
 assert.equal(result.totals.overlapMs,10000);assert.equal(result.totals.busyMs,30000);near(result.tasks[0].computeEUR,.015);near(result.tasks[1].computeEUR,.015)
})
test('current boot clips earlier intervals; same run ID in another workspace or actor stays separate',()=>{
 const result=report([record('prior',-2000,-1000),record('spanning',-1000,1000),record('other',1000,2000,{trace:{workspace:'ws',user:'other-person',run:'task'}})])
 assert.equal(result.tasks.length,2);assert.equal(result.totals.busyMs,2000)
})
test('storage is prorated over UTC month boundaries; absent or invalid rates never imply zero',()=>{
 const result=report([],{from:Date.UTC(2026,9,31),to:Date.UTC(2026,10,2)})
 near(result.totals.diskEUR,72/31+72/30);near(result.totals.allocatedComputeEUR,0)
 for(const value of [null,{}, {...plan,computePerHour:-1},{...plan,diskPerMonth:NaN},{...plan,currency:'USD'}])assert.throws(()=>readCostPlan(value))
 assert.throws(()=>report([],{from:to,to:from}));assert.equal(result.basis,'estimate')
})
