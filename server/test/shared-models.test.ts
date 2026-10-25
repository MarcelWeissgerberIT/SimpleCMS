import assert from 'node:assert/strict'
import {test} from 'node:test'
import {startServer,signIn} from './helpers.ts'
import {modelShareKey,sharedRequestBox,sharedWorkerKey,openShared,sealShared,type SharedText} from '../../src/shared/ai/shared-model.ts'

test('workspace model sharing: isolated encrypted FIFO, cancellation, revocation and guests',async()=>{
 const server=await startServer({AUTH_IP_LIMIT:'1000'})
 try{
  const owner=await signIn(server,'owner@share.test'),alice=await signIn(server,'alice@share.test'),bob=await signIn(server,'bob@share.test'),guest=await signIn(server,'guest@share.test'),alien=await signIn(server,'alien@share.test')
  const ws=(await owner.post('/api/workspaces',{name:'Workshop'})).body.id,other=(await owner.post('/api/workspaces',{name:'Other'})).body.id
  for(const [client,email,role]of [[alice,'alice@share.test','member'],[bob,'bob@share.test','member'],[guest,'guest@share.test','viewer']]as const){const link=(await owner.post(`/api/workspaces/${ws}/invites`,{email,role})).body.link;assert.equal((await client.post('/api/invites/'+link.split('#/invite/')[1]+'/accept')).status,200)}
  const worker=(await owner.post(`/api/workspaces/${ws}/coding/workers`,{label:'Local host'})).body
  const send=async(path:string,value:unknown,method='POST')=>{const r=await fetch(server.url+'/api/coding/shared-model/'+path,{method,headers:{authorization:'Bearer '+worker.token,'Content-Type':'application/json'},body:JSON.stringify(value)});return {status:r.status,body:await r.json() as any}}
  const config={model:'atlas-flow:latest',label:'Atlas Flow',enabled:true}
  assert.equal((await send('config',config,'PUT')).status,200)
  const keys=await modelShareKey(),publicKey=await crypto.subtle.exportKey('jwk',keys.publicKey)
  const poll=(extra:Record<string,unknown>={})=>send('poll',{publicKey,busy:false,available:true,active:null,...extra})
  assert.equal((await poll()).status,200)
  const path=`/api/workspaces/${ws}/model-shares`,id=worker.id
  const listed=(await alice.get(path)).body
  assert.equal(listed[0].dataFlow,false);assert.equal(listed[0].online,true);assert.equal(listed[0].mine,false);assert.equal(listed[0].model,config.model)
  assert.equal((await poll({dataFlow:true})).status,200)
  assert.equal((await alice.get(path)).body[0].dataFlow,true)
  assert.equal((await alien.get(path)).status,404)
  assert.equal((await guest.get(path)).status,403)
  assert.deepEqual((await owner.get(`/api/workspaces/${other}/model-shares`)).body,[])
  assert.equal((await alice.json('DELETE',path+'/'+id)).status,404)
  const request:SharedText={model:config.model,messages:[{role:'user',content:'Private synthetic review'}],maxTokens:512}
  const first=crypto.randomUUID(),second=crypto.randomUUID()
  const sealed=await sharedRequestBox(request,publicKey,id,first),sealed2=await sharedRequestBox(request,publicKey,id,second)
  const post=(client:typeof alice,job:string,box:unknown)=>client.post(path+'/'+id+'/jobs',{id:job,box,keyId:publicKey.n})
  assert.equal((await post(guest,first,sealed.box)).status,403)
  assert.equal((await owner.post(`/api/workspaces/${other}/model-shares/${id}/jobs`,{id:first,box:sealed.box,keyId:publicKey.n})).status,404)
  assert.equal((await post(alice,first,sealed.box)).status,201)
  assert.equal((await post(bob,second,sealed2.box)).status,201)
  assert.equal((await alice.get(`/api/workspaces/${ws}/model-jobs/${first}`)).body.position,1)
  assert.equal((await bob.get(`/api/workspaces/${ws}/model-jobs/${second}`)).body.position,2)
  assert.equal((await bob.get(`/api/workspaces/${ws}/model-jobs/${first}`)).status,404)
  const busy=await poll({busy:true});assert.equal(busy.body.job,undefined)
  const claimed=await poll();assert.equal(claimed.body.job.id,first)
  assert.ok(!JSON.stringify(claimed.body).includes('Private synthetic review'))
  const key=await sharedWorkerKey(claimed.body.job.box,keys.privateKey)
  assert.deepEqual(await openShared(claimed.body.job.box,key,id,first),request)
  await assert.rejects(openShared(claimed.body.job.box,key,id,second))
  assert.equal((await poll({active:first,busy:true})).body.job,undefined)
  const result={ok:true,result:{model:config.model,text:'Review result',inputTokens:8,outputTokens:4,usd:0}}
  const reply=await sealShared(result,key,id,first)
  const completed=await poll({outcome:{id:first,box:reply}})
  assert.equal(completed.body.job.id,second)
  const done=(await alice.get(`/api/workspaces/${ws}/model-jobs/${first}`)).body
  assert.equal(done.state,'done');assert.deepEqual(await openShared(done.box,sealed.key,id,first),result)
  assert.equal((await bob.json('DELETE',`/api/workspaces/${ws}/model-jobs/${second}`)).status,204)
  assert.equal((await poll({active:second,busy:true})).body.cancel,true)
  // Stop sharing cancels queued and in-flight work. Only an explicit configure can enable it again.
  assert.equal((await owner.json('DELETE',path+'/'+id)).status,204)
  assert.equal((await poll()).body.enabled,false)
  assert.equal((await post(alice,crypto.randomUUID(),sealed.box)).status,409)
  assert.equal((await owner.get(path)).body[0].enabled,false)
  assert.deepEqual((await alice.get(path)).body,[])
  assert.equal((await send('poll',{publicKey:{...publicKey,d:'do-not-accept-private-key'},busy:false,available:true,active:null})).status,400)
  // Worker revocation wins over a locally saved enabled flag.
  await owner.json('DELETE',`/api/workspaces/${ws}/coding/workers/${id}`)
  assert.equal((await poll()).status,401)
 }finally{await server.stop()}
})
