import assert from 'node:assert/strict'
import { after,test } from 'node:test'
import { readFileSync,writeFileSync,statSync,existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copilotArgs,copilotEnv,copilotInference,parseCopilotAnswer,probeCopilot,validCopilotModel } from '../src/worker/copilot.ts'
import { copilotFile,readCopilot,saveCopilot } from '../src/worker/copilot-config.ts'
import { runLocal } from '../src/worker/local-agent.ts'
import { sanitizeTask } from '../src/worker/worker.ts'
import { stageNeeds } from '../../src/app/features/coding/protocol.ts'
import { readRepairPolicy } from '../../src/shared/coding/repair.ts'
import { cleanupAll,tempDir,makeRepo,repoEntry,writeConfig,startWorker,FakeTab,WS_LOCAL,task,IS_WIN } from './worker-helpers.ts'
after(cleanupAll)
const fake=fileURLToPath(new URL('./fixtures/fake-copilot.mjs',import.meta.url))
const tool=(name:string,args:object)=>({content:'',tool_calls:[{function:{name,arguments:args}}]})
const envOf=(extra:NodeJS.ProcessEnv={})=>({...process.env,COPILOT_BIN:fake,...extra})
const request=(signal=new AbortController().signal)=>({model:'auto',messages:[{role:'user',content:'private task text'}],tools:[{type:'function',function:{name:'read_file',parameters:{type:'object'}}}],contextTokens:32768,outputTokens:8192,signal})

test('Copilot configuration stores only an explicit model, rejects secrets and executable input',()=>{
 const file=join(tempDir('copilot-config'),'worker.json')
 assert.equal(readCopilot(file,{}).model,'auto');saveCopilot(file,{model:'gpt-6.1-sol'});assert.equal(readCopilot(file,{}).model,'gpt-6.1-sol');assert.equal(readCopilot(file,{ONE_COPILOT_MODEL:'claude-opus-5.5'}).model,'claude-opus-5.5')
 if(!IS_WIN)assert.equal(statSync(copilotFile(file)).mode&0o777,0o600)
 assert.throws(()=>saveCopilot(file,{model:'auto',token:'private'}));assert.throws(()=>saveCopilot(file,{model:'github_pat_private_token'}));assert.throws(()=>saveCopilot(file,{model:'x; cat secret'}));assert.ok(!validCopilotModel('a\nb'))
 const t=task({kind:'implement'});assert.equal(sanitizeTask({...t,agent:'copilot'})?.agent,'copilot');assert.ok(stageNeeds({kind:'implement',agent:'copilot'}).includes('agent:copilot'));assert.equal(readRepairPolicy({agent:'copilot',attempts:1})?.agent,'copilot')
})
test('text-only SDK round uses stdin and isolated configuration, rejects native permission requests, never reports free usage',async()=>{
 const root=tempDir('copilot-rpc'),capture=join(root,'capture.json'),env=envOf({COPILOT_CAPTURE:capture,COPILOT_FAKE_PERMISSION:'1',ANTHROPIC_API_KEY:'sk-ant-do-not-forward',ONE_WORKER_TOKEN:'do-not-forward',COPILOT_ALLOW_ALL:'true'})
 const inference=copilotInference('gpt-6.1-sol',env),result=await inference(request())
 assert.equal(result.message.content,'Completed by Copilot fixture.');assert.equal(inference.unmetered,true);assert.equal(inference.cost,undefined)
 const events=JSON.parse(readFileSync(capture,'utf8')),created=events.find((e:any)=>e.method==='session.create'),sent=events.find((e:any)=>e.method==='session.send')
 assert.equal(created.params.model,'gpt-6.1-sol');assert.deepEqual(created.params.availableTools,[]);assert.deepEqual(created.params.excludedTools,['*']);assert.deepEqual(created.params.mcpServers,{});assert.equal(created.params.enableConfigDiscovery,false);assert.equal(created.params.enableFileHooks,false);assert.equal(created.params.enableSkills,false);assert.equal(created.params.enableSessionStore,false);assert.equal(created.params.enableManagedSettings,true)
 assert.equal(created.env.ANTHROPIC_API_KEY,undefined);assert.equal(created.env.ONE_WORKER_TOKEN,undefined);assert.equal(created.env.COPILOT_ALLOW_ALL,'false');assert.ok(!sent.args.join(' ').includes('private task text'));assert.ok(sent.params.prompt.includes('private task text'));assert.equal(existsSync(created.cwd),false)
 assert.ok(events.some((e:any)=>e.permissionResponse?.error));assert.ok(!copilotArgs(root).some(x=>x.startsWith('--allow-all')))
 assert.equal(copilotEnv({GH_TOKEN:'github-login',MINIMAX_API_KEY:'secret',PATH:process.env.PATH}).MINIMAX_API_KEY,undefined)
})
test('CLI probe sends no prompt; missing login and blocked models fail without a fallback or execution',async()=>{
 const root=tempDir('copilot-probe'),capture=join(root,'capture.json')
 const result=await probeCopilot(envOf({COPILOT_CAPTURE:capture,COPILOT_FAKE_SIGNED_OUT:'1'}));assert.equal(result.authenticated,false);assert.ok(!JSON.stringify(JSON.parse(readFileSync(capture,'utf8'))).includes('session.send'))
 await assert.rejects(copilotInference('blocked-model',envOf())(request()),/not available/)
 await assert.rejects(copilotInference('auto',envOf({COPILOT_FAKE_SIGNED_OUT:'1'}))(request()),/not signed in/)
 await assert.rejects(copilotInference('auto',envOf({COPILOT_FAKE_VERSION:'1.0.1'}))(request()),/Install or update/)
 assert.throws(()=>parseCopilotAnswer(JSON.stringify(tool('shell',{command:'bad'})),request().tools),/unavailable/);assert.throws(()=>parseCopilotAnswer('not JSON',[]),/invalid/)
})
test('Copilot harness reads before editing and completes only after actual configured checks',async()=>{
 const root=tempDir('copilot-harness'),index=join(tempDir('copilot-progress'),'index');writeFileSync(join(root,'feature.txt'),'BROKEN')
 const answers=[tool('read_file',{path:'feature.txt'}),tool('edit_file',{path:'feature.txt',old_text:'BROKEN',new_text:'FIXED'}),tool('finish_task',{status:'completed',summary:'Repaired feature.txt',next:''})]
 let checks=0
 const result=await runLocal({agent:'copilot',cwd:root,prompt:'Repair feature.txt',readOnly:false,completionRequired:true,maxSteps:8,taskMcp:null,signal:new AbortController().signal,log:()=>{},model:'gpt-6.1-sol',inference:copilotInference('gpt-6.1-sol',envOf({COPILOT_INDEX:index,COPILOT_ANSWERS:JSON.stringify(answers)})),verify:async()=>{checks++;return {ok:readFileSync(join(root,'feature.txt'),'utf8')==='FIXED',output:'actual fixture check'}}})
 assert.equal(result.ok,true,result.error);assert.equal(checks,1);assert.equal(result.cost,undefined);assert.match(result.text,/checks passed/)
})
test('planning cannot request writes; Stop aborts the SDK child and preserves existing files',async()=>{
 const root=tempDir('copilot-readonly');writeFileSync(join(root,'original.txt'),'KEEP')
 const result=await runLocal({agent:'copilot',cwd:root,prompt:'Read only',readOnly:true,maxSteps:2,taskMcp:null,signal:new AbortController().signal,log:()=>{},inference:copilotInference('auto',envOf({COPILOT_ANSWERS:JSON.stringify([tool('write_file',{path:'original.txt',content:'BAD'})])}))})
 assert.equal(result.ok,false);assert.equal(readFileSync(join(root,'original.txt'),'utf8'),'KEEP')
 const controller=new AbortController(),pending=copilotInference('auto',envOf({COPILOT_FAKE_HANG:'1'}))(request(controller.signal));setTimeout(()=>controller.abort(),250);await assert.rejects(pending,/Stopped|ended/)
})
test('built worker runs Copilot without Claude and returns the selected model result',async()=>{
 const r=makeRepo(),file=writeConfig(r,{workspace:WS_LOCAL.id,port:47412,pollSec:2,name:'copilot-worker',repos:[repoEntry(r)]})
 const worker=await startWorker(file,{COPILOT_BIN:fake,CLAUDE_BIN:'intentionally-missing-claude'});let tab:FakeTab|null=null
 try{tab=await FakeTab.connect(47412);tab.hello(WS_LOCAL);await tab.next('welcome');const outcome=await tab.run({...task({kind:'plan'},{id:'copilot_plan'}),agent:'copilot'});assert.equal(outcome.status,'ok',JSON.stringify(outcome));assert.match(outcome.plan??'',/Copilot fixture/);assert.equal(outcome.cost,undefined)}finally{tab?.close();await worker.stop()}
})

test('Copilot cooperates with the task-scoped Atlas MCP proxy without receiving the proxy credential',async()=>{
 const root=tempDir('copilot-atlas'),data=tempDir('copilot-atlas-wire'),capture=join(data,'capture.json'),index=join(data,'index'),secret='task_proxy_private_fixture_value'
 const answers=[tool('one_task_mcp_search',{query:'atlas requirement'}),tool('one_task_mcp_call',{server:'atlas-my-agent',name:'atlas_get',arguments:{ref:43}}),{content:'Reviewed approved Atlas requirement 43.',tool_calls:[]}]
 const env=envOf({COPILOT_CAPTURE:capture,COPILOT_INDEX:index,COPILOT_ANSWERS:JSON.stringify(answers)})
 const result=await runLocal({agent:'copilot',cwd:root,prompt:'Read the approved Atlas requirement.',readOnly:true,maxSteps:5,signal:new AbortController().signal,log:()=>{},inference:copilotInference('auto',env),taskMcp:{command:process.execPath,args:[fileURLToPath(new URL('./fixtures/fake-task-proxy.mjs',import.meta.url))],env:{ONE_WORKER_TASK_TOKEN:secret,ONE_WORKER_PERSONAL_READ_ONLY:'1'}}})
 assert.equal(result.ok,true,result.error);assert.match(result.text,/Atlas requirement 43/)
 const wire=readFileSync(capture,'utf8');assert.ok(wire.includes('Actual proxy result: Atlas record 43'));assert.ok(!wire.includes(secret));assert.ok(!wire.includes('Authorization'))
})
