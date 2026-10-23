import assert from 'node:assert/strict'
import { after,test } from 'node:test'
import { readFileSync,writeFileSync,statSync,existsSync,mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copilotArgs,copilotEnv,copilotInference,parseCopilotAnswer,probeCopilot,validCopilotModel } from '../src/worker/copilot.ts'
import { copilotFile,readCopilot,saveCopilot } from '../src/worker/copilot-config.ts'
import { runLocal } from '../src/worker/local-agent.ts'
import { sanitizeTask } from '../src/worker/worker.ts'
import { stageNeeds } from '../../src/app/features/coding/protocol.ts'
import { readRepairPolicy } from '../../src/shared/coding/repair.ts'
import { prepareCopilotRun } from '../src/worker/copilot-run.ts'
import { readCopilotChoice, readCopilotReceipt } from '../../src/shared/copilot.ts'
import { cleanupAll,tempDir,makeRepo,repoEntry,writeConfig,startWorker,FakeTab,WS_LOCAL,task,IS_WIN,sh } from './worker-helpers.ts'
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
test('task model overrides the worker; advertised reasoning and bounded context reach the isolated session',async()=>{
 const root=tempDir('copilot-choice'),capture=join(root,'capture.json')
 const run=await prepareCopilotRun('gpt-6.1-sol',{model:'claude-opus-5.5',reasoningEffort:'high',contextTokens:262144},'task',envOf({COPILOT_CAPTURE:capture}))
 assert.equal(run.model,'claude-opus-5.5');assert.equal(run.context.tokens,200000);assert.equal(run.context.inputLimit,191808)
 const before=JSON.parse(readFileSync(capture,'utf8'));assert.ok(!before.some((r:any)=>r.method==='session.send'))
 await run.inference({...request(),contextTokens:run.context.tokens})
 const created=JSON.parse(readFileSync(capture,'utf8')).find((r:any)=>r.method==='session.create')
 assert.equal(created.params.model,'claude-opus-5.5');assert.equal(created.params.reasoningEffort,'high')
 const receipt=run.receipt();assert.equal(receipt.source,'task');assert.deepEqual(receipt.models,['claude-opus-5.5']);assert.deepEqual(receipt.reasoningEfforts,['high']);assert.equal(receipt.inputTokens,50);assert.equal(receipt.nanoAiu,null);assert.ok(readCopilotReceipt(receipt))
 assert.equal((await prepareCopilotRun('auto',undefined,'worker',envOf())).context.tokens,32768)
 assert.equal((await prepareCopilotRun('auto',{model:'claude-opus-5.5',contextTokens:32768},'role',envOf())).context.tokens,32768)
})
test('unsupported choices fail before sending a prompt; credential-shaped or malformed settings are rejected',async()=>{
 const root=tempDir('copilot-refuse'),capture=join(root,'capture.json'),env=envOf({COPILOT_CAPTURE:capture})
 await assert.rejects(prepareCopilotRun('auto',{model:'blocked-model'},'task',env),/preflight/)
 await assert.rejects(prepareCopilotRun('auto',{model:'gpt-6.1-sol',reasoningEffort:'high'},'role',env),/effort/)
 await assert.rejects(prepareCopilotRun('auto',{model:'auto',reasoningEffort:'high'},'task',env),/effort/)
 await assert.rejects(prepareCopilotRun('auto',{contextTokens:9999999},'task',env),/Invalid/)
 assert.ok(!JSON.parse(readFileSync(capture,'utf8')).some((r:any)=>r.method==='session.send'))
 assert.equal(readCopilotChoice({model:'github_pat_should_not_store'}),null);assert.equal(readCopilotChoice({token:'private'}),null)
 assert.equal(sanitizeTask({...task({kind:'plan'}),agent:'copilot',stage:{...task({kind:'plan'}).stage,copilot:{model:'bad; command'}}}),null)
 assert.equal(readRepairPolicy({agent:'claude',attempts:1,copilot:{model:'auto'}}),null)
 assert.deepEqual(readRepairPolicy({agent:'copilot',attempts:1,copilot:{model:'gpt-6.1-sol'}})?.copilot,{model:'gpt-6.1-sol'})
})
test('auto receipts preserve actual models, deduplicate usage, sum units without inventing currency or missing values',async()=>{
 const usage=[{eventId:'u1',model:'gpt-6.1-sol',inputTokens:50,outputTokens:20,copilotUsage:{totalNanoAiu:1000000000},quotaSnapshots:{premium:{remainingPercentage:72.5,resetDate:'2026-11-01T00:00:00Z'}},cost:999,secret:'not allowed'}]
 const run=await prepareCopilotRun('auto',undefined,'worker',envOf({COPILOT_FAKE_USAGE:JSON.stringify([...usage,...usage])}))
 await run.inference(request());await run.inference(request())
 let r=run.receipt();assert.equal(r.rounds,2);assert.equal(r.usageReports,2);assert.equal(r.inputTokens,100);assert.equal(r.outputTokens,40);assert.equal(r.nanoAiu,2000000000);assert.deepEqual(r.models,['gpt-6.1-sol']);assert.equal(r.requestedModel,'auto');assert.equal(r.quotas[0]?.remainingPercentage,72.5);assert.ok(!JSON.stringify(r).includes('secret'));assert.equal((r as any).cost,undefined)
 const missing=await prepareCopilotRun('auto',undefined,'worker',envOf({COPILOT_FAKE_USAGE:'[{"outputTokens":20,"cost":99}]'}));await missing.inference(request());r=missing.receipt();assert.equal(r.inputTokens,null);assert.equal(r.outputTokens,20);assert.deepEqual(r.models,[]);assert.equal(r.nanoAiu,null)
 const malformed=await prepareCopilotRun('auto',undefined,'worker',envOf({COPILOT_ANSWERS:'["malformed JSON"]'}));await assert.rejects(malformed.inference(request()),/invalid/);assert.equal(malformed.receipt().inputTokens,50)
 const silent=await prepareCopilotRun('auto',undefined,'worker',envOf({COPILOT_FAKE_USAGE:'[]'}));await silent.inference(request());assert.equal(silent.receipt().inputTokens,null);assert.deepEqual(silent.receipt().models,[])
 assert.equal(readCopilotReceipt({...r,models:['sk-private']}),null)
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
 try{tab=await FakeTab.connect(47412);tab.hello(WS_LOCAL);await tab.next('welcome');const outcome=await tab.run({...task({kind:'plan',copilot:{model:'claude-opus-5.5',reasoningEffort:'high',contextTokens:65536},copilotSource:'task'},{id:'copilot_plan'}),agent:'copilot'});assert.equal(outcome.status,'ok',JSON.stringify(outcome));assert.match(outcome.plan??'',/Copilot fixture/);assert.equal(outcome.cost,undefined);assert.equal(outcome.copilotReceipts?.[0]?.requestedModel,'claude-opus-5.5');assert.deepEqual(outcome.copilotReceipts?.[0]?.models,['claude-opus-5.5']);assert.equal(outcome.copilotReceipts?.[0]?.contextTokens,65536);assert.equal(outcome.copilotReceipts?.[0]?.status,'ok')}finally{tab?.close();await worker.stop()}
})
test('built QA repair uses Coding model then QA model and retains both real harness receipts',async()=>{
 const r=makeRepo();mkdirSync(r.worktrees);const dir=join(r.worktrees,'copilot-repair');sh(r.path,'worktree','add','-b','one/copilot-repair',dir);writeFileSync(join(dir,'feature.txt'),'BROKEN')
 const data=tempDir('copilot-role-proof'),capture=join(data,'capture.json'),index=join(data,'index')
 const answers=[tool('read_file',{path:'feature.txt'}),tool('edit_file',{path:'feature.txt',old_text:'BROKEN',new_text:'FIXED'}),tool('finish_task',{status:'completed',summary:'Repaired fixed source.',next:''}),tool('finish_task',{status:'completed',summary:'Reviewed repaired branch.',next:''})]
 const file=writeConfig(r,{workspace:WS_LOCAL.id,port:47416,pollSec:2,name:'copilot-roles',repos:[repoEntry(r)]})
 const worker=await startWorker(file,{COPILOT_BIN:fake,COPILOT_CAPTURE:capture,COPILOT_INDEX:index,COPILOT_ANSWERS:JSON.stringify(answers),CLAUDE_BIN:'intentionally-missing-claude'})
 let tab:FakeTab|null=null
 try{
  tab=await FakeTab.connect(47416);tab.hello(WS_LOCAL);await tab.next('welcome')
  const out=await tab.run(task({kind:'doc',copilot:{model:'claude-opus-5.5',reasoningEffort:'high'},copilotSource:'role'},{id:'copilotRoleRepair',agent:'copilot',branch:'one/copilot-repair',quality:{review:true,requirements:['R1: Fix source'],acceptance:['Host tests pass'],repair:{attempts:1,agent:'copilot',copilot:{model:'gpt-6.1-sol'}},packages:[{id:'codeOne',title:'Fix feature',requirements:['R1']}]}}))
  assert.equal(out.status,'ok',JSON.stringify(out));assert.equal(out.test?.ok,true);assert.equal(out.repairs?.length,1)
  assert.deepEqual(out.copilotReceipts?.map(r=>[r.requestedModel,r.stageKind,r.rounds]),[['gpt-6.1-sol','implement',3],['claude-opus-5.5','doc',1]])
  assert.deepEqual(out.copilotReceipts?.map(r=>r.status),['ok','ok']);assert.ok(out.copilotReceipts?.every(r=>r.source==='role'&&r.inputTokens!==null))
  const creates=JSON.parse(readFileSync(capture,'utf8')).filter((e:any)=>e.method==='session.create')
  assert.deepEqual(creates.map((c:any)=>c.params.model),['gpt-6.1-sol','gpt-6.1-sol','gpt-6.1-sol','claude-opus-5.5']);assert.equal(creates.at(-1).params.reasoningEffort,'high')
 }finally{tab?.close();await worker.stop()}
})

test('Copilot cooperates with the task-scoped Atlas MCP proxy without receiving the proxy credential',async()=>{
 const root=tempDir('copilot-atlas'),data=tempDir('copilot-atlas-wire'),capture=join(data,'capture.json'),index=join(data,'index'),secret='task_proxy_private_fixture_value'
 const answers=[tool('one_task_mcp_search',{query:'atlas requirement'}),tool('one_task_mcp_call',{server:'atlas-my-agent',name:'atlas_get',arguments:{ref:43}}),{content:'Reviewed approved Atlas requirement 43.',tool_calls:[]}]
 const env=envOf({COPILOT_CAPTURE:capture,COPILOT_INDEX:index,COPILOT_ANSWERS:JSON.stringify(answers)})
 const result=await runLocal({agent:'copilot',cwd:root,prompt:'Read the approved Atlas requirement.',readOnly:true,maxSteps:5,signal:new AbortController().signal,log:()=>{},inference:copilotInference('auto',env),taskMcp:{command:process.execPath,args:[fileURLToPath(new URL('./fixtures/fake-task-proxy.mjs',import.meta.url))],env:{ONE_WORKER_TASK_TOKEN:secret,ONE_WORKER_PERSONAL_READ_ONLY:'1'}}})
 assert.equal(result.ok,true,result.error);assert.match(result.text,/Atlas requirement 43/)
 const wire=readFileSync(capture,'utf8');assert.ok(wire.includes('Actual proxy result: Atlas record 43'));assert.ok(!wire.includes(secret));assert.ok(!wire.includes('Authorization'))
})
