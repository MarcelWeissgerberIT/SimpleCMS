/** Host-controlled QA feedback. Writes only happen through a separately authorised implementation run. */
import { createHash, randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, readdir, mkdir, open, rename, rm } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import type { RepairPolicy } from '../../../src/shared/coding/repair.ts'
import type { StageOutcome } from '../../../src/app/features/coding/protocol.ts'
const digest = (s:string) => createHash('sha256').update(s).digest('hex')
const skipped=/^(?:\..*|node_modules|vendor|dist|build|coverage|target|__pycache__)$/
/** Existing checks are protected across automatic repair; new tests are allowed. */
export async function checkManifest(root:string, commands: readonly (readonly string[])[] = []) {
  const files:Record<string,string>={}; let visited=0,bytes=0
  const walk=async(dir:string,depth:number):Promise<void>=>{
    if(depth>16) throw new Error('QA check inventory is too deep; repair manually.')
    for(const e of await readdir(join(root,dir),{withFileTypes:true})) {
      if(skipped.test(e.name)||e.isSymbolicLink())continue
      const path=dir?dir+'/'+e.name:e.name
      if(++visited>8000) throw new Error('QA check inventory limit reached; repair manually.')
      if(e.isDirectory())await walk(path,depth+1)
      else if(/(^|\/)(?:tests?|__tests__|specs?|fixtures)(\/|$)|\.(?:test|spec)\.[^.]+$|(^|\/)(?:package(?:-lock)?\.json|.*lock.*|tsconfig.*\.json|(?:vitest|jest|playwright|eslint)\.config\.[^.]+)$/.test(path)) {
        const file=await open(join(root,path),constants.O_RDONLY|(constants.O_NOFOLLOW||0))
        try { const info=await file.stat(); if(!info.isFile()||info.nlink>1||info.size>2_000_000||(bytes+=info.size)>12_000_000)throw new Error('QA check inventory is too large; repair manually.');files[path]=digest((await file.readFile()).toString('base64')) } finally {await file.close()}
      }
    }
  }
  await walk('',0)
  // Owner-configured entry points such as check.mjs need protection even outside test folders.
  for (const path of commands.flatMap(c => c.slice(1))) {
    if (isAbsolute(path) || path.startsWith('-') || path.split(/[/\\]/).includes('..')) continue
    const info = await lstat(join(root,path)).catch(() => null)
    if (info?.isSymbolicLink()) throw new Error('Unsafe verification entry point.')
    if (!info?.isFile()) continue
    if (info.nlink > 1 || info.size > 2_000_000) throw new Error('Unsafe verification entry point.')
    const f = await open(join(root,path),constants.O_RDONLY|(constants.O_NOFOLLOW||0))
    try { files[path] = digest((await f.readFile()).toString('base64')) } finally { await f.close() }
  }
  return files
}
export async function checksUnchanged(root:string, manifest:Record<string,string>) {
  for(const [path,hash] of Object.entries(manifest)) {
    const info=await lstat(join(root,path)).catch(()=>null)
    if(!info?.isFile()||info.isSymbolicLink()||info.nlink>1||info.size>2_000_000) return false
    const f=await open(join(root,path),constants.O_RDONLY|(constants.O_NOFOLLOW||0))
    try {if(digest((await f.readFile()).toString('base64'))!==hash)return false} finally{await f.close()}
  }
  return true
}
export interface RepairJournal { attempts:number; fingerprint?:string }
export async function readRepairJournal(directory:string,scope:string):Promise<RepairJournal> {
  await mkdir(directory,{recursive:true,mode:0o700})
  const d=await lstat(directory);if(!d.isDirectory()||d.isSymbolicLink())throw new Error('Invalid repair journal directory.')
  let file
  try {file=await open(join(directory,digest(scope)+'.json'),constants.O_RDONLY|(constants.O_NOFOLLOW||0));const info=await file.stat();if(!info.isFile()||info.nlink>1||info.size>5000)throw new Error('Invalid repair journal.');const v=JSON.parse(await file.readFile('utf8'));if(!Number.isInteger(v.attempts)||v.attempts<0||v.attempts>2||v.fingerprint!==undefined&&!/^[a-f0-9]{64}$/.test(v.fingerprint))throw new Error('Invalid repair journal.');return v}
  catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {attempts:0};throw e}finally{await file?.close()}
}
export async function writeRepairJournal(directory:string,scope:string,journal:RepairJournal) {
  const target=join(directory,digest(scope)+'.json'),temp=target+'.'+randomBytes(6).toString('hex')+'.tmp'
  const file=await open(temp,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY,0o600)
  try{await file.writeFile(JSON.stringify(journal));await file.sync()}finally{await file.close()}
  try{await rename(temp,target)}finally{await rm(temp,{force:true})}
}
export async function qaFeedback(input:{policy?:RepairPolicy;remainingSteps:number;signal:AbortSignal;review:(remaining:number)=>Promise<StageOutcome>;repair:(finding:string,remaining:number)=>Promise<StageOutcome>;unchanged:()=>Promise<boolean>;journal:RepairJournal;save:(j:RepairJournal)=>Promise<void>;note:(s:string)=>void;packages:string[]}) {
  let turns=0,cost=0,hasCost=false
  const receipts:NonNullable<StageOutcome['repairs']>=[]
  const observe=(out:StageOutcome)=>{turns+=out.turns??0;if(out.cost!==undefined){cost+=out.cost;hasCost=true}}
  const aggregate=(out:StageOutcome):StageOutcome=>({...out,turns,cost:hasCost?cost:undefined, ...(receipts.length?{repairs:receipts}: {})})
  let out=await input.review(input.remainingSteps)
  observe(out)
  while(out.status==='failed' && input.policy && input.journal.attempts<input.policy.attempts && turns<input.remainingSteps) {
    input.signal.throwIfAborted()
    const finding=(out.error??out.plan??'').trim()
    // Environment/auth failures and unknown review failures are never repair authority.
    if(!finding || !/^(?:needs_rework:|Delivery QA checks failed:)/.test(finding)) break
    const fingerprint=digest(finding.replace(/\s+/g,' '))
    if(input.journal.fingerprint===fingerprint){input.note('QA repair stopped: the same finding returned without convergence.');break}
    input.journal={attempts:input.journal.attempts+1,fingerprint}
    await input.save(input.journal) // write-ahead: retries/restarts do not grant a fresh budget
    const receipt={attempt:input.journal.attempts,packageIds:input.packages,finding:finding.slice(0,4000),outcome:'interrupted or outcome unknown; inspect the branch before retrying'}
    receipts.push(receipt);input.note(`QA repair ${receipt.attempt}: returning findings to ${input.packages.join(', ')}.`)
    let fixed:StageOutcome
    try { fixed=await input.repair(finding,input.remainingSteps-turns) }
    catch(e) { receipt.outcome='Repair interrupted: '+(e instanceof Error?e.message:String(e));return aggregate({status:'failed',error:receipt.outcome}) }
    observe(fixed);receipt.outcome=fixed.summary??fixed.error??fixed.status
    if(!await input.unchanged().catch(()=>false)) return aggregate({...fixed,status:'failed',error:'Automatic QA repair changed existing checks or dependency/configuration files, or their integrity could not be verified. Inspect the branch; no acceptance was granted.'})
    if(fixed.status!=='ok') return aggregate(fixed)
    if(turns>=input.remainingSteps)return aggregate({...fixed,status:'limit',error:'QA repair reached the shared stage step budget; fresh QA is still required.'})
    try { out=await input.review(input.remainingSteps-turns) }
    catch(e) {return aggregate({status:'failed',error:'Fresh QA interrupted: '+(e instanceof Error?e.message:String(e))})}
    observe(out)
  }
  return aggregate(out)
}
