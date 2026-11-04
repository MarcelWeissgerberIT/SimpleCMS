/** Explicit /mock sources are read by ONE, then one bounded draft and at most one correction. */
import {MOCK_GUIDE,MockSources,type DesignMock} from '@/shared/ai/designMock'
import {workerMcpSession} from '../core/workerMcp'
import {createTaskContract} from '../core/taskContract'
import {beginLiveAudit} from '../core/liveAudit'
import {assertPreparedFlow,type Prepared} from '../core/gate'
import {tapSignal} from '../core/meter'
import {compileMock} from './designMocks'
import {repairDesignMock} from './repairDesignMock'
import {ToolInputError} from './tools'
import {explicitMockSources} from '@/shared/ai/mockPlan'
import type {runAgent} from './run'
export async function runGroundedMock(o:Parameters<typeof runAgent>[0],prepared:Prepared,sources:MockSources){
 const plan=explicitMockSources(o.typed??'');if(!plan||!o.mcp?.worker?.length)throw new ToolInputError('The explicit mock sources need a selected personal Atlas connection.')
 const candidates=o.mcp.worker.filter(s=>/atlas/i.test(s.name+new URL(s.url).hostname))
 if(candidates.length!==1)throw new ToolInputError('Select exactly one personal Atlas connection for this explicit mock; no server was guessed.')
 const server=candidates[0]
 if(plan.design&&new URL(plan.design.url).origin!==new URL(server.url).origin)throw new ToolInputError('The selected design link belongs to a different Atlas server.')
 const task=createTaskContract({reviewProfile:o.reviewProfile,prepared,goal:o.typed??'',instructions:MOCK_GUIDE,input:plan,tools:['create_design_mock'],one:false,atlas:true,sourcesRequired:true,bounds:{readOnly:true,externalWrite:false,execute:false},signal:o.signal,onReport:o.hooks.contract})
 const audit=await beginLiveAudit(prepared.route!,o.typed??'',o.purpose),untap=tapSignal(o.signal,{onEntry:e=>o.hooks.usage(e.usage,e)})
 let state='failed',failure:unknown,answer=''
 try{
  o.hooks.note('Mock-Quellenprüfung: ONE liest genau die ausdrücklich genannten Atlas-Records. Das Modell wählt keine Ersatzquellen und führt keine Werkzeuge aus.')
  const remote=workerMcpSession([server],o.signal,o.hooks.mcp,12000,audit,task,sources)
  await remote('one_mcp_search',{query:'atlas_get'},crypto.randomUUID())
  const read=async(address:import('@/shared/ai/mockPlan').MockRecordAddress)=>{assertPreparedFlow(prepared)
   const reply=await remote('one_mcp_call',{server:server.name,name:'atlas_get',arguments:{...address,parts:['body']}},crypto.randomUUID())
   const id=JSON.parse(reply).oneMockSource?.id,source=id?sources.get(id):null
   if(!source)throw new ToolInputError('The exact requested Atlas record did not return a complete readable body; no mock was generated.')
   o.hooks.note('Atlas: '+source.title+' · '+source.body.length.toLocaleString()+' Zeichen vollständig geladen; die KI erhält ausgewählte Ausschnitte.')
   return source
  }
  if(plan.design){sources.selectedDesign=(await read(plan.design.address)).id;if(plan.requirement)sources.selectedTarget=(await read(plan.requirement)).id}
  else for(const ref of plan.refs)await read({ref})
  let input:unknown=null,error:unknown='Initial draft from the exact requested source bodies.',artifact:DesignMock|undefined
  for(let i=0;i<2;i++){
   const draft=await repairDesignMock(o,prepared,sources,input,error,{phase:i?'repair':'draft',audit})
   try{artifact=compileMock(draft,sources);break}catch(e){input=draft;error=e;if(i)throw e;o.hooks.note('Der Mock-Entwurf wird einmal gegen echte Quellenausschnitte und das vollständige Schema korrigiert.')}
  }
  if(!artifact)throw new ToolInputError('No source-grounded mock passed the minimum checks.')
  assertPreparedFlow(prepared);task.dispatch('create_design_mock','read');sources.created++;o.hooks.mock?.({...artifact,route:prepared.route!})
  await audit.tool('ONE','create_design_mock',{target:artifact.target?.ref??null},()=>({htmlHash:artifact.htmlHash,sources:artifact.sources,checks:'quote origin, static markup and token mechanics; semantic and visual review open',png:'not rendered; explicit export only',writes:0}))
  answer='Statischer Design-Mock zur Prüfung erstellt. ONE hat die ausdrücklich genannten Atlas-Quellen tatsächlich gelesen und Quellenzitate, statisches HTML sowie Token-Verweise geprüft. HTML-Vorschau und PNG-Export stehen in der Mock-Karte. PNG wird erst beim Export gerendert. Fachliche und visuelle Prüfung bleiben offen; nichts wurde in ONE oder Atlas gespeichert.'
  task.finish(answer);o.hooks.text(answer);o.hooks.textDone('answer');o.hooks.history([...o.history,o.user,{role:'assistant',content:answer}]);state='done'
  await audit.tool('ONE','compiled_task',{phase:'result'},()=>task.report());return 'done' as const
 }catch(e){failure=e;task.fail('Explicit source mock did not pass its minimum checks. No artifact or external write was accepted.');throw e}finally{untap();task.release();await audit.end(o.signal.aborted?'cancelled':state,answer||undefined,failure)}
}
