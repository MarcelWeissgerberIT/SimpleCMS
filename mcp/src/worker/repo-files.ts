import { realpath } from 'node:fs/promises'
import type { RepoConfig } from './config.ts'
import { LocalFiles } from './local-files.ts'
import { git, worktreeOf } from './git.ts'
import { repoFileRefs, repoFileContext, type RepoFilesRequest, type RepoFilesResult } from '../../../src/shared/repo-files.ts'

/** Only explicitly registered checkouts; never a caller-supplied host path or a new checkout. */
export async function repoFiles(repos: RepoConfig[], request: RepoFilesRequest): Promise<RepoFilesResult> {
  if (!request || !['list','read'].includes(request.action)) throw new Error('Invalid repository file request.')
  const repo=repos.find(r=>r.name===request.repo)
  if (!repo) throw new Error('Select a repository registered with your own worker.')
  const current=(await git(repo.path,['branch','--show-current'],10000,{local:true})).stdout.trim()
  let root=repo.path
  if (request.branch && request.branch!==current) {
    if (typeof request.branch!=='string'||request.branch.length>200||request.branch.startsWith('-')) throw new Error('Invalid branch.')
    const tree=await worktreeOf(repo,request.branch)
    if (!tree) throw new Error('This branch has no local worktree. Open its task worktree first.')
    root=tree
  }
  const branch=request.branch||current||'(detached HEAD)'
  const files=new LocalFiles(await realpath(root))
  if (request.action==='list') return {repo:repo.name,branch,...await files.paths(request.query)}
  if (typeof request.path!=='string') throw new Error('Select a source file.')
  return {repo:repo.name,branch,file:{...await files.read(request.path,1,400),path:request.path}}
}

/** Loaded independently for every stage from its actual worktree, for every executor. */
export async function taskRepoFiles(text: string, repo: RepoConfig, root: string, branch: string): Promise<string> {
  const refs=repoFileRefs(text)
  if (!refs.length) return ''
  if(!branch) branch=(await git(root,['branch','--show-current'],10000,{local:true})).stdout.trim() || '(detached HEAD)'
  const files=new LocalFiles(await realpath(root))
  const out: string[]=[]; let size=0
  for (const ref of refs) {
    if (ref.repo!==repo.name) throw new Error('A selected file belongs to another repository. Re-select it for this task’s repository.')
    const file=await files.read(ref.path,1,200)
    size+=file.content.length
    if (size>80000) throw new Error('Selected file excerpts exceed 80,000 characters. Select fewer files.')
    out.push(repoFileContext({repo:repo.name,branch,file:{...file,path:ref.path}}))
  }
  return '\n\nExplicitly selected repository files — current stage snapshots:\n'+out.join('\n')
}
