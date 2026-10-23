import assert from 'node:assert/strict'
import {test} from 'node:test'
import * as Y from 'yjs'
import {startServer,signIn,openDoc,flushed,waitFor,mailbox} from './helpers.ts'

test('account-bound automatic checks cannot target another person, leak a draft, elevate guests or clear a manual hold',async()=>{
 const server=await startServer({AUTH_IP_LIMIT:'1000'})
 let meta:ReturnType<typeof openDoc>|undefined
 try{
  const owner=await signIn(server,'organizer@readiness.test'),alice=await signIn(server,'alice@readiness.test'),bob=await signIn(server,'bob@readiness.test'),alien=await signIn(server,'alien@readiness.test')
  const ws=(await owner.post('/api/workspaces',{name:'Readiness workshop'})).body.id,path=`/api/workspaces/${ws}/readiness`
  for(const [client,email,role]of [[alice,'alice@readiness.test','member'],[bob,'bob@readiness.test','viewer']] as const){const invite=(await owner.post(`/api/workspaces/${ws}/invites`,{email,role})).body.link;await client.post('/api/invites/'+invite.split('#/invite/')[1]+'/accept')}
  await owner.json('PUT',`/api/workspaces/${ws}/welcome`,{revision:0,title:'Workshop',notBefore:Date.now()+86400000,lang:'en',recipients:[{id:'alice-recipient',name:'Same name',email:'alice@readiness.test',workspaceId:ws,role:'member',guest:false,note:'',atlasLink:'https://atlas.example/a'},{id:'bob-recipient',name:'Same name',email:'bob@readiness.test',workspaceId:ws,role:'viewer',guest:true,note:'',atlasLink:'https://atlas.example/b'}]})
  const mails=(await mailbox(server)).length
  meta=openDoc(server,owner,`ws:${ws}`);await meta.synced
  const checks=['one','atlas','worker','copilot','repo'],c={v:1,checks:Object.fromEntries(checks.map(k=>[k,k])),role:'role',participation:'participation',blocker:'blocker',next:'next',owner:'owner',note:'note',changedAt:'at',changedBy:'by',automation:{recipient:'recipient',evidence:'evidence',atlasProjects:['one-webserver']}}
  const properties=[...checks.map(id=>({id,type:'select',options:['open','ready','blocked','na'].map(id=>({id}))})),...['role','participation'].map(id=>({id,type:'select'})),...['blocker','next','owner','note','at','by','recipient','evidence'].map(id=>({id,type:'text'}))]
  const db=new Y.Map<unknown>(),defs=new Y.Map();for(const p of properties)defs.set(p.id,p);db.set('properties',defs);db.set('readiness',c)
  const pages=meta.doc.getMap<Y.Map<unknown>>('pages')
  meta.doc.transact(()=>{const page=new Y.Map<unknown>();page.set('kind','database');pages.set('tracker',page);meta!.doc.getMap('databases').set('tracker',db);for(const key of ['alice','bob']){const row=new Y.Map<unknown>(),p=new Y.Map<unknown>();row.set('databaseId','tracker');row.set('title','Same name');row.set('properties',p);p.set('recipient',key+'-recipient');p.set('role',key==='bob'?'guest':'team');p.set('participation','workshop');for(const k of checks)p.set(k,'open');pages.set(key,row)}});await flushed(meta)
  const props=(person:string)=>pages.get(person)!.get('properties') as Y.Map<unknown>
  assert.equal((await alien.post(path,{signal:'sync'})).status,404)
  assert.equal((await alice.post(path,{signal:'sync',rowId:'bob'})).status,400)
  assert.equal((await alice.post(path,{signal:'sync'})).body.matched,true)
  await waitFor(()=>props('alice').get('one')==='ready');assert.equal(props('bob').get('one'),'open');assert.equal(props('alice').get('worker'),'open','Downloaded/unconnected worker is not proof')
  assert.equal((await alice.post(path,{signal:'atlas',project:'foreign-project',record:1})).status,403)
  assert.equal(props('alice').get('atlas'),'open')
  assert.equal((await alice.post(path,{signal:'atlas',project:'one-webserver',record:31503})).body.atlas,true)
  await waitFor(()=>props('alice').get('atlas')==='ready');const proof=JSON.parse(String(props('alice').get('evidence')));assert.equal(proof.atlas.source,'device-mcp');assert.equal(proof.atlas.record,31503)
  assert.equal((await bob.post(path,{signal:'repo'})).status,403);assert.equal((await bob.post(path,{signal:'copilot'})).status,403)
  await bob.post(path,{signal:'sync'});await waitFor(()=>props('bob').get('one')==='ready');assert.equal(props('alice').get('repo'),'open')
  props('alice').set('copilot','blocked');await flushed(meta);await alice.post(path,{signal:'copilot'});assert.equal(props('alice').get('copilot'),'blocked')
  assert.equal((await mailbox(server)).length,mails,'Status updates send no mail')
  assert.equal((await alice.get(`/api/workspaces/${ws}/welcome`)).status,403,'Private preparation is still private')
 }finally{meta?.destroy();await server.stop()}
})
