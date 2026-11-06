/** Per-account installation. Pairing lives in private release files, never in the launcher or public manifest.
 * A supervisor owns the profile lock and worker child. Updates drain all work, probe readiness, then commit.
 * Only the original HTTPS site supplies updates; a download with a different pairing cannot replace it silently.
 */
import type { ChildProcess } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { spawnSafe, execFileSyncSafe, starterText } from './exec.ts'
import { createServer, connect } from 'node:net'
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { readPreset, sameSecret, type WorkerPreset } from './preset.ts'

const GLOBAL = 'globalThis.ONE_WORKER_PRESET = '
const MARKER = /^\/\/ SimpleCMS One — coding worker (\d+\.\d+\.\d+) \(MIT\)\./m
const RELEASE = /^\d+\.\d+\.\d+-[a-f0-9]{16}\.mjs$/
const MAX_BYTES = 16 * 1024 * 1024
const hash = (s: string | Buffer) => createHash('sha256').update(s).digest('hex')
interface Manifest { schema: 1; config: string; workspace: string; origin: string; name: string; current: string; previous: string | null; updateUrl: string; args: string[] }
export interface ManagedStatus { installed: boolean; version: string; previous: string | null; phase: string; error?: string; available?: string; path: string }
interface Context { dir: string; file: string; preset: WorkerPreset | null; version: string; config: string; args: string[]; desktop?: string | null }
interface Control { port: number; key: string; pid: number }

export function profileDir(config: string): string { return join(dirname(resolve(config)), basename(config) === 'worker.json' ? 'installed-worker' : 'installed-worker-' + hash(resolve(config)).slice(0, 10)) }
function privateDir(dir: string) {
  if (existsSync(dir) && (lstatSync(dir).isSymbolicLink() || !lstatSync(dir).isDirectory())) throw new Error('Installation folder must be a real directory.')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') chmodSync(dir, 0o700)
  else {
    const system = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
    const identity = execFileSyncSafe(join(system,'whoami.exe'), ['/user','/fo','csv','/nh'], {allow:'exe',timeoutMs:5000})
    if (identity.code !== 0) throw new Error('Cannot determine Windows account for private worker permissions.')
    const who = identity.stdout
    const sid = /S-\d+-\d+(?:-\d+)+/.exec(who)?.[0]
    if (!sid) throw new Error('Cannot determine Windows account for private worker permissions.')
    const acl = execFileSyncSafe(join(system,'icacls.exe'), [dir,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F'], {allow:'exe',timeoutMs:10000})
    if (acl.code !== 0) throw new Error('Cannot protect the Windows worker installation.')
  }
}
function atomic(file: string, text: string, mode = 0o600) {
  const temp = file + '.' + randomBytes(8).toString('hex') + '.tmp'
  writeFileSync(temp, text, { flag: 'wx', mode }); renameSync(temp, file)
  if (process.platform !== 'win32') chmodSync(file, mode)
}
function manifest(dir: string): Manifest {
  const m = JSON.parse(readFileSync(join(dir, 'current.json'), 'utf8')) as Manifest
  if (m.schema !== 1 || !RELEASE.test(m.current) || (m.previous !== null && !RELEASE.test(m.previous)) || !Array.isArray(m.args) || m.args.some(a => a !== '--no-browser' && a !== '--model-host') || typeof m.config !== 'string') throw new Error('Invalid installation manifest; reinstall from a trusted ONE download.')
  return m
}
function codePreset(source: string): WorkerPreset {
  const line = source.split('\n')[1] ?? ''
  if (!line.startsWith(GLOBAL)) throw new Error('This installation has no pairing. Download a paired worker from ONE first.')
  const p = readPreset(JSON.parse(line.slice(GLOBAL.length)))
  if (!p.preset) throw new Error('Invalid installed pairing.')
  return p.preset
}
/** Import only the JSON preset line of a legacy file. Never import/execute its JavaScript. */
export function importWorkerPreset(file: string): WorkerPreset {
  if (lstatSync(file).size > MAX_BYTES) throw new Error('The existing worker file is too large.')
  const line = readFileSync(file, 'utf8').split('\n')[1] ?? ''
  const raw = /^globalThis\.ONE_WORKER_PRESET\s*=\s*(.+?)\s*;?\s*$/.exec(line)?.[1]
  if (!raw) throw new Error('No JSON pairing found in that file. Select the existing paired worker, not a plain public bundle.')
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new Error('The existing pairing is not a JSON literal. It was not executed.') }
  const checked = readPreset(value)
  if (!checked.preset) throw new Error('The existing worker pairing is invalid.')
  return checked.preset
}
function unpairedSource(source: string): string {
  const lines=source.split('\n')
  if (/^globalThis\.ONE_WORKER_PRESET\s*=/.test(lines[1] ?? '')) lines.splice(1,1)
  return lines.join('\n')
}
function samePair(a: WorkerPreset, b: WorkerPreset) { return a.workspace === b.workspace && a.origin === b.origin && a.port === b.port && sameSecret(a.pair, b.pair) && a.cloud?.token === b.cloud?.token }
function paired(source: string, preset: WorkerPreset) { const n = source.indexOf('\n'); return source.slice(0, n + 1) + GLOBAL + JSON.stringify(preset).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029') + '\n' + source.slice(n + 1) }
export function updateAddress(p: WorkerPreset): string {
  const url = new URL(p.updateUrl ?? '/mcp/one-worker.mjs', p.origin)
  if (url.origin !== p.origin || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/mcp/one-worker.mjs') || (url.protocol !== 'https:' && !(p.dev && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new Error('Updates require the original HTTPS ONE site (localhost only for development).')
  return url.href
}
export { starterText } from './exec.ts'

function quoteSh(s: string) { return "'" + s.replace(/'/g, "'\\''") + "'" }
/** Windows launcher paths are literal, including percent signs and exclamation marks. */
export function shortcutText(node: string, start: string, windows: boolean): string {
  if (windows) {
    if (/[\r\n"]/.test(node + start)) throw new Error('Unsupported launcher path.')
    return '@echo off\r\nsetlocal DisableDelayedExpansion\r\n"' + node.replace(/%/g, '%%') + '" "' + start.replace(/%/g, '%%') + '"\r\nif errorlevel 1 pause\r\n'
  }
  return '#!/bin/sh\nexec ' + quoteSh(node) + ' ' + quoteSh(start) + '\n'
}
function release(dir: string, source: string): string {
  const v = MARKER.exec(source)?.[1]
  if (!v || !source.startsWith('#!')) throw new Error('Not an official ONE worker bundle.')
  const name = v + '-' + hash(source).slice(0, 16) + '.mjs'
  const file = join(dir, name)
  if (existsSync(file)) { if (lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile() || hash(readFileSync(file)) !== hash(source)) throw new Error('Installed release was changed; refusing to execute it.') } else atomic(file, source)
  const check = execFileSyncSafe(process.execPath, ['--check', file], { allow: 'exe', timeoutMs: 15000 })
  if (check.code !== 0) throw new Error('Worker validation failed; the installed version is unchanged.')
  return name
}
async function request(dir: string, op: string): Promise<ManagedStatus> {
  const c = JSON.parse(readFileSync(join(dir, 'control.json'), 'utf8')) as Control
  if (!Number.isInteger(c.port) || c.port < 1024 || c.port > 65535 || !/^[A-Za-z0-9_-]{43}$/.test(c.key)) throw new Error('Invalid worker control.')
  return new Promise((resolve, reject) => {
    const socket = connect(c.port, '127.0.0.1'); let data = ''
    socket.setTimeout(45000, () => socket.destroy(new Error('Worker control timed out.')))
    socket.on('connect', () => socket.write(JSON.stringify({ key: c.key, op }) + '\n'))
    socket.on('data', chunk => { data += chunk; if (data.length > 16000) return socket.destroy(new Error('Invalid response.')); if (data.includes('\n')) { socket.end(); try { const v=JSON.parse(data); if(v.error && v.failed) reject(new Error(v.error)); else resolve(v) } catch(e){reject(e)} } })
    socket.on('error', reject); socket.on('end', () => { if (!data.includes('\n')) reject(new Error('Worker control closed.')) })
  })
}
function lock(dir: string): () => void {
  const file = join(dir, 'supervisor.lock')
  try { mkdirSync(file, { mode: 0o700 }) }
  catch {
    // Never signal/kill a PID from disk. A stale lock can only be removed when its recorded process is absent.
    let pid: number
    try { pid = Number(readFileSync(join(file, 'pid'), 'utf8')); if (!Number.isInteger(pid) || pid < 1) throw new Error('bad pid') }
    catch { throw new Error('Worker lock is incomplete. Close the other starter; if it crashed, remove supervisor.lock manually.') }
    let alive = true
    try { process.kill(pid, 0) } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ESRCH') alive = false }
    if (alive) throw new Error('ONE Worker is already starting/running. Use its existing window or the ONE settings.')
    rmSync(file, { recursive: true }); mkdirSync(file, { mode: 0o700 })
  }
  writeFileSync(join(file, 'pid'), String(process.pid), { mode: 0o600 })
  return () => rmSync(file, { recursive: true, force: true })
}
export async function installManaged(ctx: Context, replace = false): Promise<string> {
  if (!ctx.preset) throw new Error('Download the paired worker from ONE before installing.')
  updateAddress(ctx.preset)
  privateDir(ctx.dir)
  try { await request(ctx.dir, 'status'); throw new Error('Worker is running. Use Update in ONE; stop it before reinstalling or changing pairing.') }
  catch (e) { if (!['ENOENT', 'ECONNREFUSED'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e }
  const unlock = lock(ctx.dir)
  try {
    const source = paired(unpairedSource(readFileSync(ctx.file, 'utf8')), ctx.preset), file = release(ctx.dir, source)
    if (process.platform !== 'win32') chmodSync(ctx.file, 0o600)
    let old: Manifest | null = null
    if (existsSync(join(ctx.dir, 'current.json'))) {
      old = manifest(ctx.dir)
      const oldPair = codePreset(readFileSync(join(ctx.dir, old.current), 'utf8'))
      if (!samePair(oldPair, ctx.preset) && !replace) throw new Error('This download has another pairing. For software updates use the installed starter with update. To intentionally reconnect: install --replace-pairing (worker stopped).')
    }
    const m: Manifest = { schema: 1, config: ctx.config, workspace: ctx.preset.workspace, origin: ctx.preset.origin, name: ctx.preset.name, current: file, previous: old && samePair(codePreset(readFileSync(join(ctx.dir, old.current), 'utf8')), ctx.preset) ? (old.current !== file ? old.current : old.previous) : null, updateUrl: updateAddress(ctx.preset), args: ctx.args }
    atomic(join(ctx.dir, 'start.cjs'), starterText(process.execPath, ctx.dir))
    const safeName = ctx.preset.name.replace(/[^\p{L}\p{N} _.-]/gu, '').slice(0, 45) || 'Workspace'
    const shortcut = `ONE Worker - ${safeName} - ${hash(ctx.dir).slice(0, 6)}.${process.platform === 'win32' ? 'cmd' : 'command'}`
    const script = shortcutText(process.execPath, join(ctx.dir, 'start.cjs'), process.platform === 'win32')
    atomic(join(ctx.dir, shortcut), script, 0o700)
    // Desktop is optional (redirected/managed corporate desktops may deny it). The local starter always exists.
    const desktop = ctx.desktop === undefined ? join(homedir(), 'Desktop') : ctx.desktop
    if (!process.argv.includes('--no-shortcut') && desktop && existsSync(desktop)) { try { atomic(join(desktop, shortcut), script, 0o700) } catch { /* print the stable local path */ } }
    atomic(join(ctx.dir, 'current.json'), JSON.stringify(m, null, 2) + '\n')
    return join(ctx.dir, 'start.cjs')
  } finally { unlock() }
}
async function fetchRelease(m: Manifest, dir: string): Promise<string> {
  const p = codePreset(readFileSync(join(dir, m.current), 'utf8'))
  const url = updateAddress({ ...p, updateUrl: m.updateUrl })
  const downloadDeadline = AbortSignal.timeout(30000)
  const get = async (address: string, limit: number) => {
    const res = await fetch(address, { redirect: 'error', credentials: 'omit', signal: downloadDeadline, headers: { 'Cache-Control': 'no-cache' } })
    if (!res.ok || Number(res.headers.get('content-length')) > limit) throw new Error('Update download failed; installed worker retained.')
    const reader=res.body?.getReader(); if(!reader) throw new Error('Empty update response.')
    const chunks:Buffer[]=[];let size=0
    try { while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>limit)throw new Error('Update exceeds size limit.');chunks.push(Buffer.from(r.value))} } finally { await reader.cancel().catch(()=>{}) }
    return Buffer.concat(chunks)
  }
  const meta=JSON.parse((await get(url.replace(/one-worker\.mjs$/, 'one-worker.release.json'),4096)).toString())
  if(!/^\d+\.\d+\.\d+$/.test(meta.version)||!/^[a-f0-9]{64}$/.test(meta.sha256)||!Number.isInteger(meta.size)||meta.size<1||meta.size>MAX_BYTES)throw new Error('Invalid release manifest.')
  const body=await get(url,MAX_BYTES)
  if(body.length!==meta.size||hash(body)!==meta.sha256||MARKER.exec(body.toString())?.[1]!==meta.version||body.toString().split('\n')[1]?.startsWith(GLOBAL))throw new Error('Update checksum/version mismatch; installed worker retained.')
  const current=MARKER.exec(readFileSync(join(dir,m.current),'utf8'))?.[1]??'0.0.0'
  const compare=(a:string,b:string)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++){if(x[i]!==y[i])return x[i]!-y[i]!}return 0}
  if(compare(meta.version,current)<0)throw new Error('The server offers an older worker. Use explicit rollback instead.')
  return release(dir,paired(body.toString(),p))
}

export async function managedCommand(ctx: Context, command: string): Promise<void> {
  if(command==='install') { const start=await installManaged(ctx,process.argv.includes('--replace-pairing'));process.stdout.write(`ONE Worker installed for ${ctx.preset?.name}.\nStart: node ${JSON.stringify(start)}\nUpdate: node ${JSON.stringify(start)} update\nPairing, repositories and settings retained. A workspace-named starter is available in the installation folder and, when writable, on your Desktop.\n`);return }
  if(command!=='managed-start'&&command!=='managed-setup') {
    try { const r=await request(ctx.dir,command.replace('managed-',''));process.stdout.write(JSON.stringify(r,null,2)+'\n');return }
    catch(e){if(!['ENOENT','ECONNREFUSED'].includes((e as NodeJS.ErrnoException).code??''))throw e
      if(command==='managed-status'){const m=manifest(ctx.dir);process.stdout.write(JSON.stringify({installed:true,version:m.current.split('-')[0],previous:m.previous?.split('-')[0]??null,phase:'stopped',path:ctx.dir},null,2)+'\n');return}
      if(command==='managed-rollback')return supervise(ctx,true)
      throw new Error('Start the installed ONE Worker before updating or cancelling an update.')
    }
  }
  try { const r=await request(ctx.dir,'open');process.stdout.write(`ONE Worker already running · ${r.version} · ${r.phase}\n`);return } catch(e){ if(!['ENOENT','ECONNREFUSED'].includes((e as NodeJS.ErrnoException).code??''))throw e }
  await supervise(ctx)
}
export async function redirectInstalled(ctx: Context, setup: boolean): Promise<boolean> {
  if(process.env.ONE_WORKER_MANAGED_CHILD==='1'||!existsSync(join(ctx.dir,'current.json')))return false
  const m=manifest(ctx.dir),p=codePreset(readFileSync(join(ctx.dir,m.current),'utf8'))
  if(ctx.preset&&!samePair(p,ctx.preset))throw new Error(`This is an older/different pairing. Start the installed ONE Worker: node ${JSON.stringify(join(ctx.dir,'start.cjs'))}. Reconnect explicitly only when intended.`)
  process.stderr.write('[one-worker] Using the fixed installation instead of this download.\n')
  await managedCommand(ctx,setup?'managed-setup':'managed-start');return true
}

async function supervise(ctx: Context, initialRollback = false): Promise<void> {
  const unlock=lock(ctx.dir);let m=manifest(ctx.dir),child:ChildProcess|null=null,closed=false,switching=false,pending:string|null=null,draining=false,ready=false,error:string|undefined,available:string|undefined
  let phase='starting',counter=0
  const waiters=new Map<number,{resolve:(v:unknown)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>()
  const status=():ManagedStatus=>({installed:true,version:m.current.split('-')[0]!,previous:m.previous?.split('-')[0]??null,phase,...(error?{error}:{}),...(available?{available}:{}),path:ctx.dir})
  const send=(op:string):Promise<unknown>=>new Promise((resolve,reject)=>{if(!child?.connected)return reject(new Error('Worker is starting.'));const id=++counter;const timer=setTimeout(()=>{waiters.delete(id);reject(new Error('Worker control timed out.'))},8000);waiters.set(id,{resolve,reject,timer});child.send({oneManaged:true,id,op})})
  const stopChild=async()=>{if(!child)return;const c=child;await send('shutdown').catch(()=>{});if(c.exitCode!==null)return;await new Promise<void>((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('Worker did not stop cleanly; no replacement started.')),20000);c.once('exit',()=>{clearTimeout(t);resolve()})})}
  const launch=(file:string):Promise<void>=>new Promise((resolve,reject)=>{
    ready=false;const started=spawnSafe(process.execPath,[join(ctx.dir,file),'run','--config',m.config,...m.args],{allow:'exe',cwd:ctx.dir,stdio:['inherit','inherit','inherit','ipc'],env:{...process.env,ONE_WORKER_MANAGED_CHILD:'1',ONE_WORKER_MANAGED_DIR:ctx.dir},windowsHide:true});if(!started.ok)return reject(new Error(started.error));const c=started.child;child=c
    const timer=setTimeout(()=>reject(new Error('New worker did not become ready.')),30000)
    c.on('message',(raw:unknown)=>{const r=raw as {oneManaged?:boolean;ready?:boolean;id?:number;value?:unknown;error?:string};if(!r?.oneManaged)return;if(r.ready){ready=true;clearTimeout(timer);resolve()}if(r.id){const w=waiters.get(r.id);if(w){clearTimeout(w.timer);waiters.delete(r.id);r.error?w.reject(new Error(r.error)):w.resolve(r.value)}}})
    c.once('error',e=>{clearTimeout(timer);reject(e)})
    c.once('exit',(code)=>{clearTimeout(timer);if(!ready)reject(new Error('New worker exited before readiness.'));if(!closed&&!switching){error=`Worker stopped (exit ${code ?? 'signal'}). Start ONE Worker again; no automatic restart loop.`;phase='stopped';void close(code??1)}})
  })
  const close=async(code=0)=>{if(closed)return;closed=true;phase='stopping';if(poll)clearInterval(poll);await stopChild().catch(e=>process.stderr.write(String(e)+'\n'));server.close();rmSync(join(ctx.dir,'control.json'),{force:true});unlock();process.exitCode=code}
  const swap=async()=>{
    if(!pending||switching||closed)return
    switching=true;const target=pending;pending=null;const old=m
    try {
      phase='switching';await stopChild();await launch(target)
      m={...m,current:target,previous:old.current};atomic(join(ctx.dir,'current.json'),JSON.stringify(m,null,2)+'\n');draining=false;phase='running';error=undefined
      process.stderr.write(`[one-worker] Active release ${status().version}; pairing and configuration retained.\n`)
    }catch(e){error=e instanceof Error?e.message:String(e);phase='rolling-back';
      // Only our own spawned child is stopped. Never kill a PID found in a stale file.
      if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise<void>(r=>{if(child!.exitCode!==null)return r();child!.once('exit',()=>r())})}
      m=old;atomic(join(ctx.dir,'current.json'),JSON.stringify(old,null,2)+'\n');await launch(old.current);draining=false;phase='running';process.stderr.write('[one-worker] Update failed; previous release restored.\n')
    }finally{switching=false}
  }
  let operation=false
  const action=async(op:string):Promise<ManagedStatus>=>{
    if(op==='status')return status()
    if(op==='shutdown'){setTimeout(()=>void close(),100);return status()}
    if(op==='open'){await send('open');return status()}
    if(op==='cancel'){if(switching||operation)throw new Error('Wait for the current update operation.');pending=null;draining=false;await send('resume');phase='running';return status()}
    if(op!=='update'&&op!=='rollback')throw new Error('Unknown worker management action.')
    if(operation||pending||switching)throw new Error('An update is already being prepared or waiting for current work.')
    operation=true;error=undefined
    try{
      phase='checking';const target=op==='rollback'?m.previous:await fetchRelease(m,ctx.dir)
      if(!target)throw new Error('No previous release is available.')
      if(target===m.current){phase='running';return status()}
      available=target.split('-')[0];pending=target;draining=true;phase='waiting-for-idle';await send('drain');return status()
    }catch(e){pending=null;draining=false;await send('resume').catch(()=>{});phase='running';error=e instanceof Error?e.message:String(e);throw e}finally{operation=false}
  }
  const key=randomBytes(32).toString('base64url')
  const server=createServer(socket=>{let input='';socket.setTimeout(5000,()=>socket.destroy());socket.on('error',()=>{});socket.on('data',chunk=>{input+=chunk;if(input.length>4096)return socket.destroy();if(!input.includes('\n'))return;socket.removeAllListeners('data');void(async()=>{try{const r=JSON.parse(input);socket.setTimeout(45000,()=>socket.destroy());if(!sameSecret(key,r.key))throw new Error('Worker control authentication failed.');socket.end(JSON.stringify(await action(r.op))+'\n')}catch(e){socket.end(JSON.stringify({failed:true,error:e instanceof Error?e.message:String(e)})+'\n')}})()})})
  let poll:ReturnType<typeof setInterval>|undefined
  try{
    await new Promise<void>((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r)})
    atomic(join(ctx.dir,'control.json'),JSON.stringify({port:(server.address() as {port:number}).port,key,pid:process.pid}))
    switching=true
    const original=m
    try{
      if(initialRollback){if(!m.previous)throw new Error('No previous release is available.');await launch(m.previous);m={...m,current:m.previous,previous:m.current};atomic(join(ctx.dir,'current.json'),JSON.stringify(m,null,2)+'\n')}
      else{
        try {await launch(m.current)}
        catch(e){
          if(!original.previous)throw e
          await stopChild().catch(()=>{})
          if((child as ChildProcess|null)?.exitCode===null)throw new Error('Failed startup is still running; no fallback was started.')
          error='Current release failed to start; previous release restored.'
          await launch(original.previous);m={...original,current:original.previous,previous:original.current};atomic(join(ctx.dir,'current.json'),JSON.stringify(m,null,2)+'\n')
        }
      }
    }finally{switching=false}
    phase='running'
    if(commandWantsSetup(ctx))void send('open').catch(()=>{})
    poll=setInterval(()=>{if(draining&&!switching&&!closed)void send('idle').then(idle=>{if(idle===true)void swap().catch(e=>{error=String(e);void close(1)})}).catch(()=>{})},750)
    for(const signal of process.platform==='win32'?['SIGINT','SIGTERM','SIGBREAK'] as const:['SIGINT','SIGTERM','SIGHUP'] as const)process.once(signal,()=>void close())
    process.stderr.write(`[one-worker] Fixed installation · ${status().version} · ${m.name}\n[one-worker] Starter: ${join(ctx.dir,'start.cjs')}\n`)
  }catch(e){await close(1);throw e}
}
function commandWantsSetup(_ctx:Context){return process.argv.includes('managed-setup')}

/** Child-only IPC bridge. Unavailable to documents, HTTP callers and arbitrary parentless workers. */
export function managedChild(handlers:{ready:()=>boolean;drain:()=>void;resume:()=>void;idle:()=>boolean;open:()=>Promise<unknown>;shutdown:()=>Promise<void>}) {
  if(process.env.ONE_WORKER_MANAGED_CHILD!=='1'||!process.send)return
  const answer=(v:unknown)=>{if(process.connected)process.send?.(v)}
  process.on('message',async(raw:unknown)=>{const r=raw as {oneManaged?:boolean;id?:number;op?:string};if(!r?.oneManaged)return;try{let value:unknown
    if(r.op==='drain'){handlers.drain();value=true}else if(r.op==='resume'){handlers.resume();value=true}else if(r.op==='idle')value=handlers.idle();else if(r.op==='open')value=await handlers.open();else if(r.op==='shutdown'){answer({oneManaged:true,id:r.id,value:true});await handlers.shutdown();return}else throw new Error('Unknown management action')
    answer({oneManaged:true,id:r.id,value})
  }catch(e){answer({oneManaged:true,id:r.id,error:e instanceof Error?e.message:String(e)})}})
  if(handlers.ready())answer({oneManaged:true,ready:true})
  process.once('disconnect',()=>{handlers.drain();const t=setInterval(()=>{if(handlers.idle()){clearInterval(t);void handlers.shutdown()}},500)})
}
export async function manageInstalled(op:'status'|'update'|'rollback'|'cancel'):Promise<ManagedStatus> {
  const dir=process.env.ONE_WORKER_MANAGED_DIR
  if(process.env.ONE_WORKER_MANAGED_CHILD!=='1'||!dir)throw new Error('This worker is running from a download. Install it first with: node <downloaded-worker.mjs> install')
  return request(dir,op)
}
