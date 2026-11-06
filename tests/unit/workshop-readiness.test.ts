import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CHECKS, participant, readReadiness } from '../../src/app/database/views/readiness/model.ts'
import type { Database, Page, ReadinessConfig } from '../../src/app/store/types.ts'
const c:ReadinessConfig={v:1,checks:{one:'one',atlas:'atlas',worker:'worker',copilot:'copilot',repo:'repo'},role:'role',participation:'participation',blocker:'blocker',next:'next',owner:'owner',note:'note',changedAt:'at',changedBy:'by'}
const row=(properties:Record<string,string>)=>({properties} as Page)
test('team readiness requires five actual ready values; unknown and na never count as success',()=>{
 assert.equal(participant(row({}),c).overall,'open')
 const p=Object.fromEntries(CHECKS.map(k=>[k,'ready']))
 assert.equal(participant(row(p),c).overall,'ready')
 for(const invalid of ['na','invented',''])assert.equal(participant(row({...p,repo:invalid}),c).overall,'open')
 assert.equal(participant(row({...p,atlas:'blocked'}),c).overall,'blocked')
})
test('guests need only ONE/Atlas; later users remain separate from active readiness',()=>{
 const guest=participant(row({role:'guest',one:'ready',atlas:'ready',worker:'blocked'}),c)
 assert.equal(guest.overall,'ready');assert.equal(guest.total,2);assert.equal(guest.states.worker,'na')
 assert.equal(participant(row({role:'guest',one:'ready',atlas:'blocked'}),c).overall,'blocked')
 assert.equal(participant(row({participation:'later'}),c).overall,'later')
})
test('invalid/future tracker config falls back to ordinary gallery; data are not reinterpreted',()=>{
 const options=['open','ready','blocked','na'].map(id=>({id,name:id,color:'gray'}))
 const db={readiness:c,properties:[...CHECKS.map(id=>({id,type:'select',options})),...['role','participation'].map(id=>({id,type:'select'})),...['blocker','next','owner','note','at','by'].map(id=>({id,type:'text'}))]} as Database
 assert.equal(readReadiness(db),c)
 assert.equal(readReadiness({...db,readiness:{...c,v:2} as unknown as ReadinessConfig}),null)
 assert.equal(readReadiness({...db,properties:db.properties.filter(p=>p.id!=='atlas')}),null)
 assert.equal(readReadiness({...db,readiness:{...c,note:'owner'}}),null)
})

import {atlasReadProof} from '../../src/shared/readiness.ts'
test('only a real Atlas record result becomes a minimal observation, not login, discovery, errors or arbitrary content',()=>{
 assert.deepEqual(atlasReadProof('atlas_get',[{type:'text',text:JSON.stringify({item:{ref:31503,project:'one-webserver',body:'Not forwarded',token:'not-forwarded'}})}]),{project:'one-webserver',record:31503})
 for(const tool of ['atlas_whoami','atlas_search','atlas_agent_list'])assert.equal(atlasReadProof(tool,{item:{ref:1,project:'one-webserver'}}),null)
 for(const result of [{isError:true,content:[{type:'text',text:'failed'}]},{item:{ref:0,project:'one-webserver'}},{item:{ref:1,project:'bad project'}},'Successfully signed in','https://atlas.example/?token=SECRET'])assert.equal(atlasReadProof('atlas_get',result),null)
})

import {workerConnection} from '../../src/shared/readiness.ts'
test('connection expires independently of preserved setup and manual blockers',()=>{
 const at=100000
 assert.equal(workerConnection({at,source:'relay',online:true,version:'1.30.0'},at+30000),'online')
 assert.equal(workerConnection({at,source:'relay',online:false},at+30000),'offline')
 assert.equal(workerConnection({at,source:'device-worker',online:true},at+90001),'stale')
 assert.equal(workerConnection({at:at+6000,source:'relay',online:true},at),'stale')
 assert.equal(workerConnection({at,source:'session',online:true},at),'unknown')
})

test('active temporary guests need all five checks; expiry restores read-only scope without losing evidence',()=>{
 const now=100000,properties={role:'guest',one:'ready',atlas:'ready',worker:'na',copilot:'open',repo:'open'}
 const active=participant(row(properties),c,{until:now+1000,now})
 assert.equal(active.guest,true);assert.equal(active.participating,true);assert.equal(active.total,5)
 assert.equal(active.states.worker,'open');assert.equal(active.overall,'open')
 assert.equal(participant(row({...properties,worker:'blocked'}),c,{until:now+1000,now}).overall,'blocked')
 const checked=row({...properties,worker:'ready',copilot:'ready',repo:'ready'})
 assert.equal(participant(checked,c,{until:now+1000,now}).overall,'ready')
 const expired=participant(checked,c,{until:now,now})
 assert.equal(expired.participating,false);assert.equal(expired.total,2);assert.equal(expired.states.worker,'na')
 assert.equal(checked.properties.worker,'ready','Projection preserves the previous setup evidence')
 assert.equal(participant(row({...properties,participation:'later'}),c,{until:now+1000,now}).overall,'later')
})
test('unknown cloud participation cannot falsely waive guest technical checks',()=>{
 const s=participant(row({role:'guest',one:'ready',atlas:'ready'}),c,{known:false})
 assert.equal(s.participationUnknown,true);assert.equal(s.total,5);assert.equal(s.states.worker,'open');assert.equal(s.overall,'open')
})
