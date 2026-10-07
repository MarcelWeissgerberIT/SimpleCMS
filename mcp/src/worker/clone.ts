/**
 * one-worker — clone a repository from GitLab, GitHub or any git host into the clone folder (default
 * ~/one-repos: outside iCloud Drive and other synced folders), only on the person's click on the LOCAL setup
 * page — One can never ask for a clone. Then the page ticks it like a folder added by hand.
 *
 *  - parseCloneUrl: https://host/group/project(.git) · ssh://[user@]host[:port]/… · user@host:group/project — no
 *    user name or token inside an https address (it would be kept in .git/config: git asks the credential
 *    helper instead), no option-like or ext:: / file:: addresses, no "..".
 *  - cloneInto: `git -c protocol.ext.allow=never -c protocol.file.allow=never clone --progress -- <url> <dir>`
 *    without a terminal (git.ts: a password / passphrase question fails at once with a hint); progress per line;
 *    up to 30 min (ONE_WORKER_CLONE_MS); a failed clone removes the folder it made.
 *  - listProjects: the person's projects from the glab / gh command-line tools when they are installed and
 *    signed in (names and clone addresses only; nothing is stored).
 */
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { inICloud } from './config.ts'
import { git } from './git.ts'

export interface CloneUrl {
  url: string
  host: string
  /** group/sub/project — without ".git" */
  path: string
  /** the folder name (and the suggested name in One) */
  name: string
  kind: 'https' | 'ssh' | 'local'
}

const HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/
const SEGMENT = /^[A-Za-z0-9_~][A-Za-z0-9_.~+-]{0,99}$/
const USER = /^[A-Za-z0-9._-]{1,64}$/

function segments(path: string): string[] | null {
  const parts = path.replace(/\.git$/, '').replace(/\/+$/, '').split('/')
  if (parts.length < 2 || parts.length > 20) return null
  return parts.every((p) => SEGMENT.test(p) && p !== '.' && p !== '..') ? parts : null
}

/** A folder name from the project's last segment: letters, digits, ".", "_" and "-" (at most 64). */
export function folderName(path: string): string {
  const last = path.split('/').pop() ?? ''
  return last.replace(/\.git$/, '').replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[.-]+/, '').slice(0, 64) || 'repo'
}

/** Check a typed clone address. `local` (tests only): a path or file:// URL of a repository on this computer. */
export function parseCloneUrl(raw: unknown, local = false): CloneUrl | { error: string } {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) return { error: 'Paste the clone address of the repository (HTTPS or SSH).' }
  if (text.length > 500 || /[\s\u0000-\u001f\u007f]/.test(text) || text.startsWith('-')) return { error: 'That is not a clone address.' }
  if (local && (text.startsWith('/') || text.startsWith('file://'))) {
    const dir = text.startsWith('file://') ? decodeURIComponent(text.slice(7)) : text
    if (!isAbsolute(dir) || dir.split(/[\\/]/).includes('..')) return { error: 'That is not a clone address.' }
    return { url: dir, host: 'local', path: dir.replace(/^\/+/, ''), name: folderName(dir), kind: 'local' }
  }
  if (/^[a-z][a-z0-9+.-]*::/i.test(text)) return { error: 'Only HTTPS and SSH addresses can be cloned here.' }
  if (/[\\/:]\.\.?(?=[\\/]|$)/.test(text)) return { error: 'The project path looks wrong (group/project).' }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    let u: URL
    try {
      u = new URL(text)
    } catch {
      return { error: 'That is not a clone address.' }
    }
    if (u.protocol !== 'https:' && u.protocol !== 'ssh:') return { error: 'Only HTTPS and SSH addresses can be cloned here (https://… or git@…).' }
    if (u.protocol === 'https:' && (u.username || u.password)) return { error: 'Leave the user name and any token out of the address — git asks your credential helper (or use the SSH address).' }
    if (u.protocol === 'ssh:' && (u.password || (u.username && !USER.test(u.username)))) return { error: 'That SSH address has a password or an odd user name in it.' }
    if (u.search || u.hash) return { error: 'That is not a clone address (it has ? or # in it).' }
    const host = u.hostname.toLowerCase()
    if (!HOST.test(host)) return { error: 'That host name looks wrong.' }
    const parts = segments(decodeURIComponent(u.pathname).replace(/^\/+/, ''))
    if (!parts) return { error: 'The project path looks wrong (group/project).' }
    return { url: text, host, path: parts.join('/'), name: folderName(parts.join('/')), kind: u.protocol === 'https:' ? 'https' : 'ssh' }
  }
  // scp-like: git@gitlab.com:group/project.git
  const scp = /^([A-Za-z0-9._-]{1,64})@([^:/\\]+):([^\\]+)$/.exec(text)
  if (scp) {
    const host = scp[2]!.toLowerCase()
    if (!HOST.test(host)) return { error: 'That host name looks wrong.' }
    if (scp[3]!.startsWith('/') || scp[3]!.startsWith('-')) return { error: 'The project path looks wrong (group/project).' }
    const parts = segments(scp[3]!)
    if (!parts) return { error: 'The project path looks wrong (group/project).' }
    return { url: text, host, path: parts.join('/'), name: folderName(parts.join('/')), kind: 'ssh' }
  }
  return { error: 'That is not a clone address — copy it from the project page (Clone → HTTPS or SSH).' }
}

/** Where clones go: an absolute folder (~/… allowed), never inside iCloud Drive. */
export function cloneBase(raw: unknown, home = homedir(), platform: NodeJS.Platform = process.platform): string | { error: string } {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text || text.length > 1000 || /[\u0000-\u001f]/.test(text)) return { error: 'Type the folder the clones go into.' }
  let dir: string
  if (text === '~' || text.startsWith('~/')) dir = join(home, text.slice(2))
  else if (isAbsolute(text)) dir = resolve(text)
  else return { error: 'Type a full folder path (~/one-repos or /…).' }
  if (inICloud(dir, home, platform)) return { error: 'That folder lies in iCloud Drive — git would wait for files from the cloud. Pick one that is not synced, like ~/one-repos.' }
  return dir
}

export const defaultCloneDir = (home = homedir()) => join(home, 'one-repos')

/** What git said, made into one line a person can act on. */
export function cloneHint(stderr: string): string {
  const s = stderr.replace(/\r/g, '\n')
  if (/Permission denied \(publickey/i.test(s)) return 'The SSH key was refused: add your key to the SSH agent (ssh-add) and to your account on the host — or use the HTTPS address.'
  if (/Host key verification failed/i.test(s)) return 'This computer does not know the host yet: run `ssh -T git@<host>` once in a terminal and confirm, then clone again.'
  if (/could not read (Username|Password)|terminal prompts disabled|Authentication failed|HTTP Basic: Access denied/i.test(s))
    return 'The host wants a sign-in: set up a credential helper (Git Credential Manager, or `glab auth login` / `gh auth setup-git`) — or use the SSH address with your SSH key.'
  if (/not found|does not exist|Repository not found|could not be found/i.test(s)) return 'The host does not know this project, or your account cannot see it.'
  if (/Could not resolve host|unable to access|Connection (timed out|refused)/i.test(s)) return 'The host could not be reached — check the address and the network.'
  const last = s.split('\n').map((l) => l.trim()).filter(Boolean).slice(-2).join(' ')
  return last.slice(0, 300) || 'git clone failed.'
}

export interface CloneProgress {
  line: string
  percent: number | null
}

/**
 * Clone into `<base>/<name>`. A folder that is already there: fine when it is a clone of the same address
 * (`already`), refused otherwise. A failed clone removes the folder it created.
 */
export async function cloneInto(target: CloneUrl, base: string, onProgress: (p: CloneProgress) => void, opts: { timeoutMs?: number; local?: boolean } = {}): Promise<{ dir: string; already: boolean }> {
  const dir = join(base, target.name)
  if (!dir.startsWith(base + sep)) throw new Error('That folder name is not allowed.')
  if (existsSync(dir)) {
    const entries = readdirSync(dir)
    if (entries.length) {
      const origin = existsSync(join(dir, '.git')) ? (await git(dir, ['remote', 'get-url', 'origin'], 10_000)).stdout.trim() : ''
      if (origin && origin.replace(/\.git$/, '') === target.url.replace(/\.git$/, '')) return { dir, already: true }
      throw new Error(`${dir} already exists — pick another clone folder, or add that folder instead.`)
    }
  }
  mkdirSync(base, { recursive: true })
  const made = !existsSync(dir)
  const timeoutMs = opts.timeoutMs ?? (Number(process.env.ONE_WORKER_CLONE_MS) || 30 * 60_000)
  const args = ['-c', 'protocol.ext.allow=never', '-c', `protocol.file.allow=${opts.local ? 'always' : 'never'}`, 'clone', '--progress', '--', target.url, dir]
  const res = await new Promise<{ code: number; stderr: string; timedOut: boolean }>((done) => {
    const child = spawn('git', args, { cwd: base, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', LC_ALL: 'C' }, stdio: ['ignore', 'ignore', 'pipe'], detached: process.platform !== 'win32', windowsHide: true })
    let err = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL')
        else child.kill('SIGKILL')
      } catch {
        /* gone */
      }
    }, timeoutMs)
    child.stderr!.on('data', (d: Buffer) => {
      const text = d.toString()
      err = (err + text).slice(-64 * 1024)
      const line = text.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean).pop()
      if (line) onProgress({ line: line.slice(0, 200), percent: /(\d{1,3})%/.test(line) ? Number(/(\d{1,3})%/.exec(line)![1]) : null })
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      done({ code: 127, stderr: e.message, timedOut })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      done({ code: code ?? 1, stderr: err, timedOut })
    })
  })
  if (res.code !== 0) {
    if (made) rmSync(dir, { recursive: true, force: true })
    throw new Error(res.timedOut ? `The clone did not finish within ${Math.round(timeoutMs / 60_000)} min.` : cloneHint(res.stderr))
  }
  return { dir, already: false }
}

/* ------------------------------------------------------------------ the person's projects (glab / gh) */

export interface RemoteProject {
  source: 'gitlab' | 'github'
  host: string
  /** group/project */
  path: string
  https: string
  ssh: string
  updated: number | null
}

export type CliRun = (cmd: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>

export const runCli: CliRun = (cmd, args) =>
  new Promise((done) => {
    try {
      execFile(cmd, args, { timeout: 20_000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_PROMPT: '1', NO_COLOR: '1' }, windowsHide: true }, (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 127) : 0
        done({ code, stdout: String(stdout), stderr: String(stderr) })
      })
    } catch (e) {
      done({ code: 127, stdout: '', stderr: (e as Error).message })
    }
  })

const time = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? Date.parse(v) : null)
const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** GitLab (glab) and GitHub (gh) projects of the signed-in person, newest activity first (≤ 100 each). */
export async function listProjects(run: CliRun = runCli): Promise<{ projects: RemoteProject[]; tools: { glab: boolean; gh: boolean } }> {
  const out: RemoteProject[] = []
  const tools = { glab: false, gh: false }
  const [lab, hub] = await Promise.all([
    run('glab', ['api', 'projects?membership=true&simple=true&order_by=last_activity_at&per_page=100']),
    run('gh', ['repo', 'list', '--limit', '100', '--json', 'nameWithOwner,url,sshUrl,updatedAt']),
  ])
  if (lab.code === 0) {
    tools.glab = true
    try {
      const list = JSON.parse(lab.stdout) as unknown
      for (const p of Array.isArray(list) ? list : []) {
        const o = (p ?? {}) as Record<string, unknown>
        const https = str(o.http_url_to_repo)
        const ssh = str(o.ssh_url_to_repo)
        const a = parseCloneUrl(https)
        const b = parseCloneUrl(ssh)
        if ('error' in a || 'error' in b) continue
        out.push({ source: 'gitlab', host: a.host, path: str(o.path_with_namespace) || a.path, https, ssh, updated: time(o.last_activity_at) })
      }
    } catch {
      /* not JSON: no list */
    }
  }
  if (hub.code === 0) {
    tools.gh = true
    try {
      const list = JSON.parse(hub.stdout) as unknown
      for (const p of Array.isArray(list) ? list : []) {
        const o = (p ?? {}) as Record<string, unknown>
        const https = str(o.url) ? `${str(o.url).replace(/\/+$/, '')}.git` : ''
        const ssh = str(o.sshUrl)
        const a = parseCloneUrl(https)
        const b = parseCloneUrl(ssh)
        if ('error' in a || 'error' in b) continue
        out.push({ source: 'github', host: a.host, path: str(o.nameWithOwner) || a.path, https, ssh, updated: time(o.updatedAt) })
      }
    } catch {
      /* not JSON: no list */
    }
  }
  out.sort((x, y) => (y.updated ?? 0) - (x.updated ?? 0))
  return { projects: out.slice(0, 200), tools }
}
