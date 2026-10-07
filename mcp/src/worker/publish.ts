/**
 * one-worker — an imported repository (no remote yet) becomes a project on GitLab or GitHub, only on the person's
 * click on the LOCAL setup page: the person's own glab / gh (their sign-in, their rights) creates the project
 * through the host's API, then the worker adds it as `origin` and pushes `main` — git without a terminal (git.ts).
 *
 *  - suggestName: a project name from what the code says about itself (package.json, composer.json, pom.xml,
 *    pyproject.toml / setup.py, Cargo.toml, go.mod, *.sln / *.csproj, the README's first heading), else the ZIP's
 *  - checkPublish: host gitlab | github, an optional group / owner, a name, private | internal | public
 *  - publishRepo: `glab api -X POST projects …` / `gh api -X POST user/repos | orgs/<owner>/repos …` (argv, never a
 *    shell), the clone address in the tool's own git protocol (ssh / https), `git remote add origin`, `git push -u`
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { folderName, cloneHint, parseCloneUrl, type CliRun } from './clone.ts'
import { git } from './git.ts'

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
const OWNER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}(\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}){0,5}$/

function read(dir: string, file: string, max = 256 * 1024): string | null {
  try {
    const p = join(dir, file)
    if (!existsSync(p)) return null
    const text = readFileSync(p, 'utf8')
    return text.length > max ? text.slice(0, max) : text
  } catch {
    return null
  }
}

/** "@acme/Billing Core" → "billing-core" */
export function slugName(raw: string): string {
  return raw
    .replace(/^@[^/]+\//, '')
    .split('/')
    .pop()!
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, 60)
}

/** A project name from the code itself, else the fallback (the ZIP's name). */
export function suggestName(dir: string, fallback: string): string {
  const tries: Array<() => string | null | undefined> = [
    () => (JSON.parse(read(dir, 'package.json') ?? 'null') as { name?: string } | null)?.name,
    () => (JSON.parse(read(dir, 'composer.json') ?? 'null') as { name?: string } | null)?.name,
    () => /<artifactId>\s*([^<\s]+)\s*<\/artifactId>/.exec((read(dir, 'pom.xml') ?? '').replace(/<parent>[\s\S]*?<\/parent>/, ''))?.[1],
    () => /^\s*name\s*=\s*["']([^"']+)["']/m.exec(read(dir, 'pyproject.toml') ?? '')?.[1],
    () => /name\s*=\s*["']([^"']+)["']/.exec(read(dir, 'setup.py') ?? '')?.[1],
    () => /^\s*name\s*=\s*"([^"]+)"/m.exec(read(dir, 'Cargo.toml') ?? '')?.[1],
    () => /^module\s+(\S+)/m.exec(read(dir, 'go.mod') ?? '')?.[1],
    () => {
      try {
        return readdirSync(dir).find((f) => /\.(sln|csproj|vbproj)$/i.test(f))?.replace(/\.[^.]+$/, '')
      } catch {
        return null
      }
    },
    () => /^#\s+(.+)$/m.exec(read(dir, 'README.md') ?? read(dir, 'readme.md') ?? '')?.[1]?.slice(0, 60),
  ]
  for (const t of tries) {
    try {
      const v = t()
      const s = v ? slugName(v) : ''
      if (s && NAME.test(s)) return s
    } catch {
      /* not that kind of project */
    }
  }
  return slugName(fallback) || folderName(fallback)
}

export interface PublishTarget {
  host: 'gitlab' | 'github'
  /** a GitLab group (path, may be nested) or a GitHub organisation; null: the person's own account */
  owner: string | null
  name: string
  visibility: 'private' | 'internal' | 'public'
}

export function checkPublish(raw: unknown): PublishTarget | { error: string } {
  const b = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const host = b.host === 'github' ? 'github' : b.host === 'gitlab' ? 'gitlab' : null
  if (!host) return { error: 'Pick GitLab or GitHub.' }
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (!NAME.test(name)) return { error: 'A project name has letters, digits, ".", "_" or "-" (at most 100).' }
  const ownerRaw = typeof b.owner === 'string' ? b.owner.trim().replace(/^\/+|\/+$/g, '') : ''
  if (ownerRaw && !OWNER.test(ownerRaw)) return { error: 'The group / owner looks wrong (e.g. acme or acme/platform).' }
  if (host === 'github' && ownerRaw.includes('/')) return { error: 'A GitHub owner is one name (an organisation).' }
  const visibility = b.visibility === 'public' ? 'public' : b.visibility === 'internal' && host === 'gitlab' ? 'internal' : 'private'
  return { host, owner: ownerRaw || null, name, visibility }
}

export interface Published {
  /** the project's page */
  web: string
  /** the address `origin` points to */
  remote: string
}

const parse = (s: string): Record<string, unknown> => {
  try {
    const v = JSON.parse(s) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const why = (r: { stdout: string; stderr: string }) => {
  const msg = str(parse(r.stdout).message) || r.stderr || r.stdout
  return (typeof msg === 'string' ? msg : JSON.stringify(msg)).replace(/\s+/g, ' ').trim().slice(0, 300)
}

/** Create the project with the person's glab / gh, add it as origin, push main. */
export async function publishRepo(dir: string, t: PublishTarget, run: CliRun, onLine: (s: string) => void = () => {}, local = false): Promise<Published> {
  const has = (await git(dir, ['remote'], 10_000)).stdout.split('\n').map((s) => s.trim())
  if (has.includes('origin')) throw new Error('This repository has a remote already.')
  let web = ''
  let ssh = ''
  let https = ''
  if (t.host === 'gitlab') {
    const fields = ['-f', `name=${t.name}`, '-f', `path=${t.name}`, '-f', `visibility=${t.visibility}`]
    if (t.owner) {
      onLine(`Looking up the group ${t.owner}…`)
      const g = await run('glab', ['api', `groups/${encodeURIComponent(t.owner)}`])
      const id = parse(g.stdout).id
      if (g.code !== 0 || typeof id !== 'number') throw new Error(`GitLab does not show the group ${t.owner} to you: ${why(g)}`)
      fields.push('-F', `namespace_id=${id}`)
    }
    onLine(`Creating ${t.owner ? `${t.owner}/` : ''}${t.name} on GitLab…`)
    const made = await run('glab', ['api', '-X', 'POST', 'projects', ...fields])
    const p = parse(made.stdout)
    if (made.code !== 0 || !str(p.web_url)) throw new Error(`GitLab did not create the project: ${why(made)}`)
    web = str(p.web_url)
    ssh = str(p.ssh_url_to_repo)
    https = str(p.http_url_to_repo)
  } else {
    onLine(`Creating ${t.owner ? `${t.owner}/` : ''}${t.name} on GitHub…`)
    const made = await run('gh', ['api', '-X', 'POST', t.owner ? `orgs/${t.owner}/repos` : 'user/repos', '-f', `name=${t.name}`, '-F', `private=${t.visibility !== 'public'}`])
    const p = parse(made.stdout)
    if (made.code !== 0 || !str(p.html_url)) throw new Error(`GitHub did not create the repository: ${why(made)}`)
    web = str(p.html_url)
    ssh = str(p.ssh_url)
    https = str(p.clone_url)
  }
  // the address in the protocol the tool is set up for (its sign-in works with it)
  const proto = (await run(t.host === 'gitlab' ? 'glab' : 'gh', ['config', 'get', 'git_protocol'])).stdout.trim()
  const preferSsh = proto ? proto === 'ssh' : t.host === 'gitlab'
  const remote = (preferSsh ? ssh : https) || https || ssh
  const checked = parseCloneUrl(remote, local)
  if ('error' in checked) throw new Error(`The new project's address looks wrong (${remote.slice(0, 120)}).`)
  const add = await git(dir, ['remote', 'add', 'origin', checked.url], 10_000)
  if (add.code !== 0) throw new Error(`git remote add failed: ${add.stderr.trim()}`)
  onLine('Pushing main…')
  const pushed = await git(dir, ['push', '-u', 'origin', 'HEAD:refs/heads/main'], 10 * 60_000)
  if (pushed.code !== 0) throw new Error(`The project is there (${web}), but the push failed: ${cloneHint(pushed.stderr)}`)
  return { web, remote: checked.url }
}
