import React from 'react'
import {createRoot} from 'react-dom/client'
import {MockSources} from '../../src/shared/ai/designMock'
import {compileMock} from '../../src/app/features/ai/agent/designMocks'
import {publishEpicMock} from '../../src/app/features/ai/agent/publishEpicMock'
import {DesignMockCard} from '../../src/app/features/ai/agent/DesignMockCard'
import {useWorkspace} from '../../src/app/store/store'
import {useCloud} from '../../src/app/cloud/state'
import {setServerKnown} from '../../src/app/cloud/api'
import {currentSetup} from '../../src/app/features/ai/mcp-servers/config'
import {sha256Hex} from '../../src/shared/mcp/sha256'
const status=document.querySelector('#status')!,ui=createRoot(document.querySelector('#card')!)
const log=(text:string)=>{status.textContent+='\n'+text}
const base={project:'fixture',tags:['ui-package:design-v5']}
const index='Design V5 library for new use cases.\n<!-- ui-collection-members: '+JSON.stringify([{ref:110,name:'Button',category:'Component'}])+' -->'
const body='Button uses --primary: #A50034. Surface uses #FFFFFF. Text uses #111111. Spacing uses 16px. Font uses system-ui.'
const records=new Map<number,any>([[42,{...base,ref:42,kind:'epic',title:'Design V5',body:index}],[110,{...base,ref:110,kind:'doc',parent:{ref:42},title:'Button',body}]])
let created=0,uploads=0,rate=true,failed=false
const realFetch=window.fetch.bind(window)
window.fetch=async(input,init)=>{
 const url=String(input)
 if(!url.includes('/api/'))return realFetch(input,init)
 const req=init?.body?JSON.parse(String(init.body)):{}
 const json=(v:any)=>Promise.resolve(new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}}))
 if(url.includes('atlas-mcp')){
  if(req.action==='search')return json({tools:[{server:'atlas',name:req.query,inputSchema:{type:'object',properties:Object.fromEntries(['ref','project','parts','includeConstraints','aql','limit','kind','title','parent','tags','body','filename','mime','text','contentBase64'].map(k=>[k,{}])),additionalProperties:false}}]})
  if(rate&&req.name==='atlas_get'){rate=false;return json({result:JSON.stringify({isError:true,content:[{type:'text',text:'Rate limit — too many AQL queries, retry in 1s.'}]})})}
  let data:any;const a=req.arguments
  if(req.name==='atlas_get')data={item:records.get(a.ref)}
  else if(req.name==='atlas_search')data={rows:[...records.values()].filter(r=>r.ref>110).map(r=>({ref:r.ref}))}
  else if(req.name==='atlas_constraints')data={constraints:[]}
  else if(req.name==='atlas_create'){created++;const r={...a,ref:200,parent:{ref:Number(a.parent)}};records.set(200,r);data={ok:true,item:r}}
  else if(req.name==='atlas_attach'){
   if((document.querySelector('#fail') as HTMLInputElement).checked&&a.mime==='image/png'&&!failed){failed=true;return json({result:JSON.stringify({isError:true,content:[{type:'text',text:'Synthetic attachment failure'}]})})}
   const bytes=a.contentBase64?Uint8Array.from(atob(a.contentBase64),c=>c.charCodeAt(0)):new TextEncoder().encode(a.text);uploads++
   data={ok:true,attachment:{filename:a.filename,sha256:sha256Hex(bytes),bytes:bytes.length,url:'https://aj-atlas.com/fixture/'+a.filename}}
  }else throw Error('Unexpected fixture call '+req.name)
  return json({result:JSON.stringify({content:[{type:'text',text:JSON.stringify(data)}]})})
 }
 return json(url.includes('/session')?{user:null,workspaces:[]}:url.includes('/config')?{supports:[],schema_min:2}:{});
}
async function start(){
 const server={id:'fixture-atlas',name:'atlas',url:'https://aj-atlas.com/api/atlas/mcp',token:'synthetic-not-a-real-secret',enabled:true,prompt:'Fixture',tools:['atlas_get'],checkedAt:Date.now()}
 useWorkspace.getState().updateSettings({language:'de',mcpServers:[server],workspaceMcpServers:[server]})
 useWorkspace.getState().setWorkspaceAI({onboarding:{startPageId:'fixture',mcpUrl:server.url,mcpName:'atlas',project:'fixture',tenant:'analytik-jena',skipIntro:true}})
 useCloud.setState({active:{kind:'cloud',id:'fixture'},user:{id:'fixture-user',email:'fixture@example.org',name:'Fixture'},supports:['atlas-mcp:1'],role:'owner',readOnly:false} as any)
 const sources=new MockSources()
 const observe=(ref:number)=>sources.observe('atlas','https://aj-atlas.com','atlas_get',{ref},JSON.stringify({item:records.get(ref)}))!
 const root=observe(42),child=observe(110);sources.selectDesign(root.id);sources.acceptEpicMember(child.id)
 const artifact=compileMock({title:'Neuer Anwendungsfall · Kopf auswählen',width:960,height:640,html:'<main><h1>Kopf auswählen</h1><p>Beispieldaten · Entwurf zur Prüfung</p><button data-ds-component="Button">CyBio Head auswählen</button></main>',css:'body{background:var(--surface);color:var(--ink);font-family:var(--font)}main{padding:var(--space)}button{background:var(--primary);color:var(--surface);padding:var(--space)}',design:{source:root.id,quote:'Design V5 library for new use cases.'},authority:null,target:null,requirements:[],tokens:[['--primary','#A50034'],['--surface','#FFFFFF'],['--ink','#111111'],['--space','16px'],['--font','system-ui']].map(([name,value])=>({name,value,source:child.id,quote:body})),components:[{name:'Button',source:child.id,quote:body}],notes:['Statischer Vorschlag. Keine Produktionsdaten.']},sources)
 artifact.request='Neuen Dialog zur Auswahl eines CyBio-Kopfs erstellen.'
 const show=()=>ui.render(<DesignMockCard key={String(uploads)} artifact={{...artifact}}/>)
 const save=async()=>{setServerKnown(true);log('START');useWorkspace.getState().setWorkspaceAI({onboarding:{startPageId:'fixture',mcpUrl:server.url,mcpName:'atlas',project:'fixture',tenant:'analytik-jena',skipIntro:true}});useWorkspace.getState().updateSettings({mcpServers:[server],workspaceMcpServers:[server]});useCloud.setState({active:{kind:'cloud',id:'fixture'},user:{id:'fixture-user',email:'fixture@example.org',name:'Fixture'},supports:['atlas-mcp:1'],role:'owner',readOnly:false} as any);log('Connections '+currentSetup().servers.map(s=>s.name).join(','));try{await publishEpicMock(artifact,new AbortController().signal,log);log('PASS: gespeichert #'+artifact.atlasSaved?.ref)}catch(e){log('FEHLER: '+String(e))}log(JSON.stringify({created,uploads,parent:records.get(200)?.parent,tags:records.get(200)?.tags,atlasDestination:artifact.atlasDestination}));show()}
 document.querySelector('#save')!.addEventListener('click',save);document.querySelector('#resume')!.addEventListener('click',save)
 status.textContent='BEREIT · echte HTML-Prüfung erfolgreich · Epic und Child-Zitate geprüft';show()
}
start().catch(e=>status.textContent='FEHLER '+String(e))
