import type {SkillReceipt} from '../ai/skills.ts'
import {resolveTypedAI,verifyTypedSource,sourceKey,type TypedSource} from './typed-ai.ts'
import {taskMcpDiscoveryQuery} from '../mcp/discovery.ts'
import {atlasIdentityTask} from './task.ts'
import {atlasTransferChoice,atlasTransferEffectAllowed} from './atlas-transfer.ts'
import type {CapturedStep} from './program.ts'
import type {TaskCompiled,TaskContract,TaskEffect,TaskPhase,TaskQuestion,TaskReport,TaskRequest} from './task.ts'
import {taskEvidence} from './task.ts'
export class TaskBlocked extends Error {}
/** A correctable model request; no decision was opened and no effect was dispatched. */
export class TaskQuestionRejected extends TaskBlocked {}
/** Run-local host state. No model-facing operation can answer, accept, or change permissions. */
type TaskHost={compile:(request:TaskRequest)=>TaskCompiled;signature:()=>string;check:()=>void;report?:(report:TaskReport)=>void;signal?:AbortSignal;interactive?:boolean;skills?:SkillReceipt[];writeIntent?:'create'|'update'|'comment'|null}
export class TaskSession {
  private trace:CapturedStep[]=[]
  private contract:TaskContract
  private host:TaskHost
  private evidence=taskEvidence()
  private observations:TaskReport['observations']=[]
  private questions:TaskQuestion[]=[]
  private waiting:{id:string;resolve:(answer:string)=>void;reject:(error:Error)=>void}|null=null
  private typedReadAt=0
  private deniedEffects=0
  private closed=false
  private phase:TaskReport['phase']='working'
  private compiled:TaskCompiled
  private pinned:string
  constructor(contract:TaskContract,host:TaskHost){
    this.host=host
    this.contract=structuredClone(contract);this.pinned=host.signature();host.check();this.evidence.provider_checked=true
    this.compiled=this.check('compile');this.publish()
  }
  private check(phase:TaskPhase,tool:string|null=null,effect:TaskEffect|null=null,target:string|null=null){
    this.evidence.typed_sources_current=this.typedReadAt>0&&Date.now()>=this.typedReadAt&&Date.now()-this.typedReadAt<5*60000
    this.evidence.scope_current=this.host.signature()===this.pinned&&!this.closed&&!this.host.signal?.aborted
    this.evidence.provider_checked=false
    try{this.host.check();this.evidence.provider_checked=true}catch{ /* compiled failure is visible */ }
    this.compiled=this.host.compile({contract:this.contract,evidence:this.evidence,phase,tool,effect,target})
    return this.compiled
  }
  capture(step:CapturedStep){if(this.trace.length<40)this.trace.push(structuredClone(step))}
  captured(){return structuredClone(this.trace)}
  discoveryQuery(query:string){return taskMcpDiscoveryQuery(this.contract.goal,query)}
  writeIntent(){return this.host.writeIntent??null}
  keepsStatus(){return /(?:\b(?:ticketstatus|status)\b.{0,30}(?:unverändert|unveraendert|unchanged|nicht ändern|nicht aendern)|\bkeep\b.{0,30}\bstatus\b)/iu.test([this.contract.goal,...this.contract.decisions.map(d=>d.answer)].join('\n'))}
  identityOnly(){return atlasIdentityTask(this.contract.goal)}
  report():TaskReport{return structuredClone({...(this.host.skills?.length?{skills:this.host.skills}:{}),id:this.contract.id,at:Date.now(),phase:this.phase,compiled:this.compiled,observations:this.observations,questions:this.questions,evidence:this.evidence})}
  private publish(){this.host.report?.(this.report())}
  packet(){
    const c=this.check('compile');if(c.decision!=='allow')throw new TaskBlocked('Compiled task binding is no longer valid.')
    // Keep the complete compiler output, but put changing evidence after the stable instruction prefix.
    // Otherwise every exposed tool/revision invalidates Ollama's prefix cache before the long role instructions.
    const {contract_hash,revision,human_decisions,requirements,...stable}=c.model_context
    return JSON.stringify({...stable,contract_hash,revision,human_decisions,requirements})
  }
  /** Only selected host definitions can extend the exact tool catalogue. */
  expose(names:string[]){const next=[...new Set([...this.contract.allowed_tools,...names])].sort();if(next.length>256)throw new TaskBlocked('Compiled tool catalogue limit.');if(JSON.stringify(next)!==JSON.stringify(this.contract.allowed_tools)){this.contract.allowed_tools=next;this.contract.revision++}}
  dispatch(tool:string,effect:TaskEffect,target:string|null=null){
    const delivery=atlasTransferChoice(this.contract.goal)
    if(delivery&&!atlasTransferEffectAllowed(delivery,tool,effect))throw new TaskBlocked('The human selected Atlas delivery mode '+delivery+'. Only that operation and source reads are allowed. Ask the person before changing the delivery mode.')
    const c=this.check('dispatch',tool,effect,target)
    if(c.decision!=='allow'){this.evidence.denied_actions++;if(['write','execute'].includes(effect))this.deniedEffects++;this.phase='blocked';this.publish();const typed=c.findings.filter(f=>f.id.startsWith('typed_')&&f.hard&&f.status!=='verified');if(typed.length)throw new TaskBlocked('Typed AI check blocked: '+typed.map(f=>f.id).join(', '));throw new TaskBlocked('Compiled task blocked this action. Read-only bounds, an unresolved decision, unknown effects or a changed workspace/provider prevent dispatch. Do not retry the same effect. Continue independent reads or request a precise prerequisite decision after inspecting sources.')}
    return this.report()
  }
  observe(area:'one'|'atlas'|'other',success:boolean,contentRead:boolean,staged=false,inspects=contentRead,tool='source read'){
    if(contentRead){this.observations.push({area,tool,success,at:Date.now()});this.observations=this.observations.slice(-40)}
    // A real failed read is a checked-but-unavailable source, never evidence of absence.
    if(inspects){if(area==='one')this.evidence.one_checked=true;if(area==='atlas')this.evidence.atlas_checked=true}
    if(success&&contentRead){this.evidence.source_reads++;if(area==='atlas')this.evidence.atlas_reads++}
    if(success&&staged)this.evidence.staged_changes++
  }
  /** Host preflight receipt only; never exposed as a model tool. */
  bindTypedEvidence(keys:string[],at=Date.now()){this.typedReadAt=at;this.evidence.typed_sources=[...keys];this.check('compile');this.publish()}
  typedPlan(){const spec=this.contract.review_profile?.spec.typedAI;return spec?resolveTypedAI(spec):null}
  typedSources(){return this.typedPlan()?.spec.sources??[]}
  observeTypedSource(source:TypedSource,server:string,origin:string,args:Record<string,unknown>,record:Record<string,unknown>){
    const plan=this.typedPlan();if(!plan)throw new TaskBlocked('No Typed AI selection')
    const expected=plan.spec.sources.find(s=>sourceKey(s)===sourceKey(source));if(!expected)throw new TaskBlocked('Unknown Typed AI source')
    const key=verifyTypedSource(expected,server,origin,args,record,plan.spec),seen=this.evidence.typed_sources??=[]
    if(!seen.includes(key))seen.push(key)
    this.typedReadAt=Date.now()
    this.check('compile');this.publish()
  }
  /** Only adapters call this after a successful actual page/record body read; never discovery or model prose. */
  observeSource(area:'one'|'atlas'|'other',id:string){
    const key=area==='one'?'one_pages':area==='atlas'?'atlas_records':'other_sources'
    const list=this.evidence[key]??=[]
    if(id&&list.length<100&&!list.includes(id))list.push(id)
  }
  async question(input:Record<string,unknown>):Promise<string>{
    if(this.questions.length>=12)throw new TaskBlocked('Decision limit; split this task.')
    const question=typeof input.question==='string'?input.question.trim():''
    const neededFor=typeof input.needed_for==='string'?input.needed_for.trim():''
    if(!question||question.length>2000||!neededFor||neededFor.length>1000)throw new TaskBlocked('Provide one precise bounded question and the dependent step.')
    const checked=this.check('question')
    if(checked.decision!=='allow')throw new TaskQuestionRejected('First inspect the available ONE and Atlas sources for this prerequisite. Discovery is not a source read. If a read fails, report its actual failure; never assume no records exist.')
    if(this.waiting)throw new TaskBlocked('A prerequisite decision is already waiting.')
    const options=Array.isArray(input.options)?input.options.slice(0,3).flatMap(v=>v&&typeof v==='object'&&typeof v.label==='string'&&typeof v.effect==='string'?[{label:v.label.slice(0,160),effect:v.effect.slice(0,500)}]:[]):[]
    const q:TaskQuestion={id:crypto.randomUUID(),question,neededFor,options,sourceChecks:{one:this.evidence.one_checked,atlas:this.evidence.atlas_checked},state:'open'}
    this.capture({kind:'decision',question,neededFor});this.questions.push(q);this.evidence.pending_decisions++;this.phase='decision';this.check('compile')
    if(!this.host.interactive){this.publish();throw new TaskBlocked('A human prerequisite decision is needed: '+question+' Dependent step: '+neededFor)}
    return new Promise<string>((resolve,reject)=>{
      const stop=()=>{this.waiting=null;reject(new TaskBlocked('Task stopped before a human answer.'))}
      this.waiting={id:q.id,resolve:answer=>{this.host.signal?.removeEventListener('abort',stop);resolve(answer)},reject}
      this.host.signal?.addEventListener('abort',stop,{once:true});this.publish()
      if(this.host.signal?.aborted)stop()
    })
  }
  /** Inference receives a bounded repair result; scope/abort and an actual decision still remain strict. */
  async modelQuestion(input:Record<string,unknown>):Promise<string>{
    try{return await this.question(input)}catch(e){
      if(!(e instanceof TaskQuestionRejected))throw e
      // A changed actor, provider or workspace is not a recoverable missing-source question.
      if(!this.evidence.scope_current||!this.evidence.provider_checked||this.closed||this.host.signal?.aborted)throw e
      return JSON.stringify({isError:true,oneNotExecuted:true,error:e.message,next:'If the requested output is only an analysis, question list or recommendation, include unresolved questions in the final answer without pausing. Use the decision tool only when the requested next action cannot proceed without a human answer now. Otherwise inspect the available sources before asking again. No answer, decision or approval was recorded.'})
    }
  }
  /** UI reads this to distinguish a live waiter from a persisted/closed question card. */
  canAnswer(questionId:string){return !!this.waiting&&this.waiting.id===questionId&&!this.closed&&!this.host.signal?.aborted&&this.host.signature()===this.pinned&&this.questions.some(q=>q.id===questionId&&q.state==='open')}
  /** UI-only capability, never registered as an inference tool. No permission escalation. */
  answer(questionId:string,answer:string){
    const q=this.questions.find(q=>q.id===questionId&&q.state==='open'),waiting=this.waiting
    if(!q||!waiting||waiting.id!==q.id||this.closed||this.host.signal?.aborted||this.host.signature()!==this.pinned||!answer.trim()||answer.length>4000)return false
    this.host.check();q.state='answered';q.answer=answer.trim();this.contract.decisions.push({question:q.question,answer:q.answer});this.contract.revision++;this.evidence.pending_decisions--;this.waiting=null;this.phase='working';this.check('compile');this.publish();waiting.resolve(JSON.stringify({human_answer:q.answer,contract_revision:this.contract.revision,permissions_unchanged:true}));return true
  }
  finish(answer:string,issues=0){this.evidence.answer=answer;this.evidence.issues=issues+this.deniedEffects;this.compiled=this.check('result');this.phase=this.compiled.decision==='allow'?'ready':'blocked';this.publish();if(this.phase==='blocked')throw new TaskBlocked((this.compiled.findings.some(f=>f.id.startsWith('typed_')&&f.hard&&f.status!=='verified')?'Typed AI check blocked: ':'Compiled result check blocked: ')+this.compiled.findings.filter(f=>f.hard&&f.status!=='verified').map(f=>f.id).join(', '));return this.report()}
  /** Host-only failure: preserve a blocked compiler card instead of a stale working state. */
  fail(reason:string){this.evidence.answer=reason.slice(0,2000);this.evidence.issues++;this.compiled=this.check('result');this.phase='blocked';this.publish()}
  accept(){if(this.phase!=='ready'||this.host.signature()!==this.pinned)return false;this.host.check();this.evidence.human_accepted=true;const c=this.check('result');if(c.decision!=='allow')return false;this.phase='accepted';this.publish();return true}
  /** Host-only provider switch after the user's explicit model choice and a fresh data gate. */
  rebindHost(){if(this.closed||this.evidence.pending_decisions)throw new TaskBlocked('Resolve the current decision before changing the host binding.');this.host.check();this.pinned=this.host.signature();this.contract.scope_hash=this.pinned;this.contract.revision++;this.evidence.human_accepted=false;this.phase='working';this.check('compile');this.publish()}
  close(){this.closed=true;this.waiting?.reject(new TaskBlocked('Task ended before a human answer.'));this.waiting=null}
}
