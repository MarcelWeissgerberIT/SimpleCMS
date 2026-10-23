/** Small reproducible demo check, not a general model-quality benchmark. No agent shell/tool access. */
import {readFile,writeFile,mkdir,mkdtemp,rm,realpath} from 'node:fs/promises'
import {join,dirname} from 'node:path'
import {tmpdir} from 'node:os'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createHash} from 'node:crypto'
import {REVIEW_POLICY} from '../../../src/shared/ai/review.ts'
import type {WorkerTextResult} from '../../../src/shared/ai/worker.ts'
import {textRequest} from './text-models.ts'
import {prepareCopilotRun} from './copilot-run.ts'
const exec=promisify(execFile)
export type DemoCompletion=(messages:{role:'system'|'user'|'assistant';content:string}[],maxTokens:number)=>Promise<WorkerTextResult>
export async function demoCopilot(messages:Parameters<DemoCompletion>[0],maxTokens:number,model='auto',env:NodeJS.ProcessEnv=process.env):Promise<WorkerTextResult>{
 const run=await prepareCopilotRun(model,{model,contextTokens:32768},'task',env)
 try{
  const reply=await run.inference({model,messages,tools:[],contextTokens:run.context.tokens,outputTokens:Math.min(maxTokens,4096),signal:AbortSignal.timeout(180000)})
  if(reply.message?.tool_calls?.length||typeof reply.message?.content!=='string')throw new Error('Copilot returned an invalid text answer')
  return {model:run.model,text:reply.message.content,inputTokens:reply.inputTokens??null,outputTokens:reply.outputTokens??null,usd:null,copilotReceipt:run.receipt()}
 }catch(e){const error=e instanceof Error?e:new Error(String(e));Object.assign(error,{copilotReceipt:run.receipt()});throw error}
}
const cases=[{id:'cpp-temperature',source:'cpp/include/temperature.hpp',test:'cpp/tests/temperature_test.cpp',total:14},{id:'angular-validation',source:'web/api.ts',test:'tests/validation.test.mjs',total:13}]
export async function compareDemo(options:{repo:string;output:string;complete?:Record<string,DemoCompletion>;model?:string;copilotModel?:string;config?:string;cases?:string[];progress?:(line:string)=>void}){
 const repo=await realpath(options.repo),output=options.output,temporary=await mkdtemp(join(tmpdir(),'one-demo-compare-'))
 const {stdout:commit}=await exec('git',['-C',repo,'rev-parse','HEAD'],{timeout:10000})
 const pkg=JSON.parse(await readFile(join(repo,'package.json'),'utf8'))
 if(pkg.name!=='one-webserver-local-demo'||pkg.private!==true)throw new Error('Use the synthetic ONE WebServer demo repository.')
 const run=async(command:string,args:string[],cwd:string)=>{try{const r=await exec(command,args,{cwd,timeout:30000,maxBuffer:100000,env:{PATH:process.env.PATH??'',...(process.env.CXX?{CXX:process.env.CXX}:{})}});return {exit:0,output:r.stdout+r.stderr}}catch(e){const r=e as any;return {exit:typeof r.code==='number'?r.code:1,output:String(r.stdout??'')+String(r.stderr??'')+String(r.message??'')}}}
 const complete=options.complete??{local:(messages:Parameters<DemoCompletion>[0],maxTokens:number)=>textRequest(options.config??'',{provider:'local',model:options.model??'marcel-flow:latest',messages,maxTokens},AbortSignal.timeout(180000)),copilot:(messages:Parameters<DemoCompletion>[0],maxTokens:number)=>demoCopilot(messages,maxTokens,options.copilotModel??'auto')}
 const report:any={schema:1,at:new Date().toISOString(),commit:commit.trim(),synthetic:true,scope:'Two small text-to-patch checks. No full merge, browser, customer network or agent/MCP benchmark.',samePrompt:true,tools:false,sourceTestsUnchanged:true,results:[]}
 await mkdir(dirname(output),{recursive:true})
 const save=()=>writeFile(output,JSON.stringify(report,null,2)+'\n',{mode:0o600})
 try{
  if(options.cases?.some(id=>!cases.some(c=>c.id===id)))throw new Error('Unknown demo case')
  for(const c of cases.filter(c=>!options.cases||options.cases.includes(c.id))){
   const source=await readFile(join(repo,c.source),'utf8'),tests=await readFile(join(repo,c.test),'utf8')
   const messages:[{role:'system';content:string},{role:'user';content:string}]=[{role:'system',content:REVIEW_POLICY+'\nThis is an authorized synthetic coding exercise. Return ONLY JSON: {"content":"complete corrected source file","findings":[{"quote":"exact quote from input source","issue":"explanation"}]}. No Markdown fences. Edit only the supplied source, keep its interface, no imports/dependencies, no test edits, no approval claims.'},{role:'user',content:`Repair ${c.source} to satisfy the unchanged acceptance tests. Valid temperatures are 0–100 degrees Celsius inclusive or equivalent Fahrenheit. Reject non-finite/blank/invalid units. Preserve revision conflict precedence and API v2 request shape.\nSOURCE ${c.source}:\n${source}\nUNCHANGED TEST ${c.test}:\n${tests}`}]
   for(const [provider,completion]of Object.entries(complete)){
    options.progress?.(`${c.id} · ${provider}: starting`)
    const dir=join(temporary,c.id,provider),entry:any={case:c.id,provider,promptSha256:createHash('sha256').update(JSON.stringify(messages)).digest('hex'),source:c.source,test:c.test,testSha256:createHash('sha256').update(tests).digest('hex'),total:c.total,status:'not_run',passed:false}
    await mkdir(dirname(join(dir,c.source)),{recursive:true});await mkdir(dirname(join(dir,c.test)),{recursive:true})
    await writeFile(join(dir,c.source),source);await writeFile(join(dir,c.test),tests);await writeFile(join(dir,'package.json'),'{"type":"module"}')
    const check=()=>c.id==='cpp-temperature'?run(process.env.CXX??'c++',['-std=c++17','-Wall','-Wextra','-Werror','-Icpp/include',c.test,'-o',join(dir,'test-bin')],dir).then(async r=>r.exit?r:run(join(dir,'test-bin'),[],dir)):run(process.execPath,['--test',c.test],dir)
    const baseline=await check();entry.baseline=baseline
    const start=Date.now()
    try{
     const answer=await completion(messages,4096);entry.status='answer_received';entry.ms=Date.now()-start;entry.model=answer.model;entry.inputTokens=answer.inputTokens;entry.outputTokens=answer.outputTokens;entry.usd=answer.usd;entry.copilotReceipt=answer.copilotReceipt;entry.sharedQueue=(answer as any).sharedQueue
     const raw=answer.text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');const parsed=JSON.parse(raw)
     if(typeof parsed.content!=='string'||parsed.content.length>16000)throw new Error('Invalid replacement file')
     // This narrow exercise admits no new runtime integrations or process execution.
     if(/\b(import|require|eval|process|globalThis|fetch|system|popen|exec|fork|Function|Deno|Bun|WebAssembly)\b/.test(parsed.content)||c.id==='cpp-temperature'&&/#[ \t]*include[ \t]*[<"](?!cmath[>"]|string[>"])/.test(parsed.content))throw new Error('Replacement outside exercise scope')
     entry.findings=Array.isArray(parsed.findings)?parsed.findings.slice(0,8).map((f:any)=>({quote:f.quote,issue:f.issue,quoteVerified:typeof f.quote==='string'&&f.quote.length>=8&&source.includes(f.quote)})):[]
     await writeFile(join(dir,c.source),parsed.content)
     if(await readFile(join(dir,c.test),'utf8')!==tests)throw new Error('Protected tests changed')
     const checked=await check();entry.check=checked;entry.passed=baseline.exit!==0&&checked.exit===0;entry.status=entry.passed?'passed':'checks_failed';entry.patchSha256=createHash('sha256').update(parsed.content).digest('hex')
     const artifact=join(dirname(output),`${c.id}-${provider}.txt`);await writeFile(artifact,parsed.content,{mode:0o600});entry.patchArtifact=artifact
    }catch(e){entry.ms=Date.now()-start;entry.error=e instanceof Error?e.message:String(e);const receipt=(e as any)?.copilotReceipt;if(receipt){entry.copilotReceipt=receipt;entry.status=receipt.rounds?'transport_or_format_error':'not_run'}}
    report.results.push(entry);await save();options.progress?.(`${c.id} · ${provider}: ${entry.passed?'PASS':'FAIL'} (${entry.ms} ms)`)
   }
  }
  report.finishedAt=new Date().toISOString();await save();return report
 }finally{await rm(temporary,{recursive:true,force:true})}
}
