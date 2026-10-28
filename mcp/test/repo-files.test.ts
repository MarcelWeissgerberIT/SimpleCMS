import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, symlink, link, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { repoFiles, taskRepoFiles } from '../src/worker/repo-files.ts'
import type { RepoConfig } from '../src/worker/config.ts'
import { repoFileRefs,repoFileMarkdown } from '../../src/shared/repo-files.ts'

test('registered repo path discovery, current snapshots and every file boundary',async()=>{
 const root=await mkdtemp(join(tmpdir(),'one-repo-files-'))
 const repo={name:'Demo',path:root} as RepoConfig
 try{
  execFileSync('git',['init','-b','main',root],{stdio:'ignore'})
  await mkdir(join(root,'src'));await mkdir(join(root,'node_modules'));await writeFile(join(root,'src','app.cpp'),'int value = 1;\n');await writeFile(join(root,'.env'),'NEVER-SEND');await writeFile(join(root,'secret.pem'),'NEVER-SEND');await writeFile(join(root,'node_modules','index.js'),'NEVER-SEND')
  await symlink(join(root,'.env'),join(root,'leak.txt'));await link(join(root,'.env'),join(root,'hardlink.txt'));await writeFile(join(root,'binary.dat'),Buffer.from([0,1]));await writeFile(join(root,'large.txt'),'a'.repeat(200001))
  const list=await repoFiles([repo],{repo:'Demo',action:'list',query:'src/'})
  assert.deepEqual(list.paths,['src/app.cpp']);assert.equal(list.branch,'main')
  const all=await repoFiles([repo],{repo:'Demo',action:'list'})
  assert.ok(!JSON.stringify(all).includes('NEVER-SEND'));assert.ok(!all.paths!.some(p=>p.includes('.env')||p.includes('pem')||p.includes('node_modules')||p==='leak.txt'))
  for(const path of ['../outside','/etc/passwd','C:\\private','.env','secret.pem','node_modules/index.js','leak.txt','hardlink.txt','binary.dat','large.txt','.git/config'])await assert.rejects(repoFiles([repo],{repo:'Demo',action:'read',path}))
  await assert.rejects(repoFiles([repo],{repo:'Other',action:'read',path:'src/app.cpp'}),/registered/)
  await assert.rejects(repoFiles([repo],{repo:'Demo',action:'list',branch:'unknown'}),/worktree/)
  execFileSync('git',['-C',root,'add','src/app.cpp'])
  execFileSync('git',['-C',root,'-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-m','fixture'],{stdio:'ignore'})
  const worktree=join(root,'task-worktree')
  execFileSync('git',['-C',root,'worktree','add','-b','feature/task',worktree],{stdio:'ignore'})
  await writeFile(join(worktree,'src','app.cpp'),'int branch_value = 3;')
  const branchFile=await repoFiles([repo],{repo:'Demo',action:'read',path:'src/app.cpp',branch:'feature/task'})
  assert.equal(branchFile.branch,'feature/task');assert.match(branchFile.file!.content,/branch_value = 3/)
  const stageFile=await taskRepoFiles(repoFileMarkdown({repo:'Demo',path:'src/app.cpp',branch:'main'}),repo,worktree,'feature/task')
  assert.match(stageFile,/branch_value = 3/,'Tasks use their actual stage worktree rather than the preview branch')
  const before=await repoFiles([repo],{repo:'Demo',action:'read',path:'src/app.cpp'})
  const text=repoFileMarkdown({repo:'Demo',path:'src/app.cpp',branch:'main'})
  assert.equal(repoFileRefs(text)[0]?.path,'src/app.cpp')
  await writeFile(join(root,'src','app.cpp'),'int value = 2;\n')
  const context=await taskRepoFiles(text,repo,root,'codex/task')
  assert.match(context,/value = 2/);assert.ok(!context.includes(before.file!.revision));assert.match(context,/codex\/task/)
  await assert.rejects(taskRepoFiles(repoFileMarkdown({repo:'Other',path:'src/app.cpp'}),repo,root,'main'),/another repository/)
  await assert.rejects(taskRepoFiles(Array.from({length:9},(_,i)=>repoFileMarkdown({repo:'Demo',path:`src/${i}.cpp`})).join('\n'),repo,root,'main'),/eight/)
  assert.throws(()=>repoFileRefs('one-repo://file?repo=Demo&path=..%2Foutside'),/Invalid/)
  await writeFile(join(root,'src','long.cpp'),Array.from({length:500},(_,i)=>`line ${i}`).join('\n'))
  const clipped=await repoFiles([repo],{repo:'Demo',action:'read',path:'src/long.cpp'});assert.equal(clipped.file!.complete,false);assert.equal(clipped.file!.end_line,400)
 }finally{await rm(root,{recursive:true,force:true})}
})
