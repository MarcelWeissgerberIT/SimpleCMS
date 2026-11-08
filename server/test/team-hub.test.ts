import assert from 'node:assert/strict'
import {test} from 'node:test'
import {randomUUID} from 'node:crypto'
import * as Y from 'yjs'
import {Client,openDoc,flushed,signIn,startServer} from './helpers.ts'
function page(title:string,kind='page'){const p=new Y.Map();for(const [k,v]of Object.entries({title,kind,createdAt:Date.now(),updatedAt:Date.now(),trashed:false,parentId:null,databaseId:null,settings:{locked:false}}))p.set(k,v);p.set('properties',new Y.Map());return p}
test('team hub: verified versions, actual area isolation, revocable forms, scoped SCIM',async t=>{
 let server=await startServer({AUTH_IP_LIMIT:'1000'}),owner=await signIn(server,'owner@team.test')
 const ws=(await owner.post('/api/workspaces',{name:'Team hub test'})).body.id,ownerId=(await owner.get('/api/me')).body.user.id
 let member=await signIn(server,'member@team.test'),viewer=await signIn(server,'viewer@team.test'),outsider=await signIn(server,'outsider@team.test')
 for(const [c,role]of [[member,'member'],[viewer,'viewer']]as const){const link=(await owner.post(`/api/workspaces/${ws}/invites`,{role})).body.link;assert.equal((await c.post('/api/invites/'+link.split('#/invite/')[1]+'/accept')).status,200)}
 const meta=openDoc(server,owner,`ws:${ws}`);await meta.synced
 meta.doc.transact(()=>{meta.doc.getMap('pages').set('p-review',page('Knowledge'));meta.doc.getMap('pages').set('db-form',page('Responses','database'));const db=new Y.Map(),props=new Y.Map();props.set('title',{id:'title',name:'Title',type:'title',order:0});props.set('check',{id:'check',name:'Check',type:'checkbox',order:1});props.set('extra',{id:'extra',name:'Extra',type:'text',order:2});props.set('received',{id:'received',name:'Received',type:'select',order:3,options:[{id:'yes',name:'Received',color:'green'}]});db.set('properties',props);db.set('views',new Y.Map());meta.doc.getMap('databases').set('db-form',db)})
 await flushed(meta)
 try{
 await t.test('verification pins content and rejects stale/concurrent/unauthorized changes',async()=>{
  const path=`/api/workspaces/${ws}/knowledge/p-review`,r=(await owner.get(path)).body
  const input={version:0,owner:ownerId,due:Date.now()+86400000,hash:r.source.hash,verify:true}
  assert.equal((await viewer.json('PUT',path,input)).status,403)
  assert.equal((await outsider.get(path)).status,404)
  assert.equal((await owner.json('PUT',path,input)).status,200)
  assert.equal((await owner.json('PUT',path,input)).status,409)
  assert.equal((await owner.get(path)).body.stale,false)
  const content=openDoc(server,owner,`ws:${ws}:p:p-review`);await content.synced;content.doc.getXmlFragment('default').insert(0,[new Y.XmlText('Changed after review')]);await flushed(content)
  const changed=await owner.get(path);content.destroy();assert.equal(changed.body.stale,true,JSON.stringify(changed.body))
  assert.equal((await owner.get(`/api/workspaces/${ws}/knowledge`)).body[0].stale,true)
  assert.equal((await owner.json('PUT',path,{...input,version:1})).status,409)
  content.destroy()
 })
 await t.test('open, closed and private areas have real separate membership',async()=>{
  const path=`/api/workspaces/${ws}/areas`
  assert.equal((await member.post(path,{name:'Denied',visibility:'open'})).status,403)
  const open=(await owner.post(path,{name:'Open',visibility:'open'})).body.id,closed=(await owner.post(path,{name:'Closed',visibility:'closed'})).body.id,privateArea=(await owner.post(path,{name:'Private',visibility:'private'})).body.id
  assert.equal((await outsider.get(path)).status,404)
  assert.equal((await member.get(path)).body.some((a:any)=>a.id===privateArea),false)
  assert.equal((await member.post(path+'/'+closed+'/join')).status,403)
  assert.equal((await member.get(`/api/workspaces/${open}/members`)).status,404)
  assert.equal((await viewer.post(path+'/'+open+'/join')).status,200)
  const me=(await viewer.get('/api/me')).body;assert.equal(me.workspaces.find((w:any)=>w.id===open).role,'viewer')
 })
 await t.test('public form validates required/hidden fields, deduplicates and never exposes rows',async()=>{
  const path=`/api/workspaces/${ws}/public-forms`,form={database:'db-form',view:'v-form',title:'Public response',description:'Direct',days:30,marker:{propertyId:'received',optionId:'yes'},fields:[{key:'title',name:'Name',kind:'short',required:true,help:''},{key:'check',name:'Check',kind:'checkbox',required:false,help:''},{key:'extra',name:'Extra',kind:'long',required:true,help:'',showIf:{op:'and',conditions:[{q:'check',op:'checked'}]}}]}
  assert.equal((await member.post(path,form)).status,403)
  const published=await owner.post(path,form);assert.equal(published.status,201,JSON.stringify(published.body))
  const pub=new Client(server.url),url='/api/public-forms/'+published.body.token
  const info=await pub.get(url);assert.equal(info.status,200);assert.equal(info.body.database_id,undefined);assert.equal(info.body.rows,undefined)
  assert.equal((await pub.post(url,{delivery:randomUUID(),answers:{}})).status,400)
  assert.equal((await pub.post(url,{delivery:randomUUID(),answers:{title:'A',check:true}})).status,400)
  assert.equal((await pub.post(url,{delivery:randomUUID(),answers:{title:'A',unexpected:'no'}})).status,400)
  const answer={delivery:randomUUID(),answers:{title:'Received',check:false,extra:'hidden malicious value'}}
  assert.equal((await pub.post(url,answer)).status,201)
  assert.equal((await pub.post(url,answer)).status,200)
  await new Promise(r=>setTimeout(r,150))
  const rows=[...meta.doc.getMap('pages').values()].filter((p:any)=>p.get('databaseId')==='db-form') as Y.Map<unknown>[]
  assert.equal(rows.length,1);assert.equal((rows[0]!.get('properties')as Y.Map<unknown>).get('received'),'yes');assert.equal((rows[0]!.get('properties')as Y.Map<unknown>).get('extra'),undefined)
  assert.equal((await owner.json('DELETE',path+'/'+published.body.id)).status,200)
  assert.equal((await pub.get(url)).status,404);assert.equal((await pub.post(url,answer)).status,404)
 })
 const jars=[owner,member,viewer,outsider].map(c=>c.cookies),dir=server.dataDir
 meta.destroy();await server.stop()
 server=await startServer({AUTH_IP_LIMIT:'1000',ONE_COMPANY_PROVIDERS:JSON.stringify([{id:'test-google',label:'Test company',issuer:'https://accounts.google.com',clientId:'test-only',clientSecret:'test-only-not-a-real-secret',workspaceId:ws,calendar:'google'}])},dir)
 ;[owner,member,viewer,outsider]=jars.map(j=>{const c=new Client(server.url);for(const [k,v]of j)c.cookies.set(k,v);return c}) as [Client,Client,Client,Client]
 await t.test('company setup is scoped; OAuth state cannot be forged and calendar is personal',async()=>{
  assert.equal((await outsider.get(`/api/workspaces/${ws}/company`)).status,404)
  assert.equal((await owner.get('/api/company/providers')).body[0].clientSecret,undefined)
  assert.equal((await owner.get('/api/company/callback?state=forged&code=forged')).status,400)
  assert.equal((await owner.get(`/api/workspaces/${ws}/company/test-google/calendar`)).status,404)
  assert.equal((await member.post(`/api/workspaces/${ws}/company/scim-token`,{provider:'test-google'})).status,403)
 })
 await t.test('SCIM token scope, group membership, deprovisioning and rotation',async()=>{
  const setup=await owner.post(`/api/workspaces/${ws}/company/scim-token`,{provider:'test-google'});assert.equal(setup.status,200)
  const prefix=`/api/v1/scim/${ws}`,headers={authorization:'Bearer '+setup.body.token}
  const req=async(method:string,path:string,json?:unknown)=>{const r=await new Client(server.url).fetch(prefix+path,{method,json,headers});return {status:r.status,body:r.status===204?null:await r.json() as any}}
  assert.equal((await new Client(server.url).get(prefix+'/Users')).status,401)
  const p=await req('POST','/Users',{userName:'provisioned@team.test',externalId:'idp-user-1',displayName:'Provisioned',active:true});assert.equal(p.status,201,JSON.stringify(p.body));const uid=p.body.id
  const g=await req('POST','/Groups',{displayName:'Engineers',members:[{value:uid}]});assert.equal(g.status,201,JSON.stringify(g.body))
  const area=(await owner.get(`/api/workspaces/${ws}/areas`)).body.find((a:any)=>a.name==='Engineers').id
  assert.equal((await owner.get(`/api/workspaces/${area}/members`)).body.some((m:any)=>m.user.id===uid),true)
  assert.equal((await req('PATCH','/Users/'+uid,{Operations:[{op:'replace',path:'active',value:false}]})).status,200)
  assert.equal((await owner.get(`/api/workspaces/${ws}/members`)).body.some((m:any)=>m.user.id===uid),false)
  assert.equal((await owner.get(`/api/workspaces/${area}/members`)).body.some((m:any)=>m.user.id===uid),false)
  assert.equal((await req('PATCH','/Users/'+uid,{Operations:[{op:'replace',path:'active',value:true}]})).status,200)
  assert.equal((await owner.get(`/api/workspaces/${area}/members`)).body.some((m:any)=>m.user.id===uid),true)
  assert.equal((await req('POST','/Users',{userName:'owner@team.test',externalId:'evil'})).status,403)
  assert.equal((await req('DELETE','/Users/'+uid)).status,204)
  assert.equal((await req('GET','/Users/'+uid)).status,404)
  assert.equal((await owner.get(`/api/workspaces/${area}/members`)).body.some((m:any)=>m.user.id===uid),false)
  await owner.post(`/api/workspaces/${ws}/company/scim-token`,{provider:'test-google'})
  assert.equal((await req('GET','/Users')).status,401)
 })
 }finally{meta.destroy();await server.stop()}
})
