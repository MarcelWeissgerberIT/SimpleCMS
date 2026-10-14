/**
 * one-worker — how every git call starts, on every OS (git.ts, clone.ts, config.ts, zipimport.ts):
 *  - gitArgs: Windows: `-c core.longpaths=true` first — Git for Windows otherwise stops at 260 characters, whatever
 *    Windows allows. Only on the worker's own calls: the person's config is never written.
 *  - gitEnv: no terminal prompt, no optional locks, the C locale, no Git Credential Manager window. Windows only: ssh in
 *    BatchMode — a host-key or passphrase question fails at once instead of waiting on the worker's console — and only
 *    while the person set nothing of their own (GIT_SSH_COMMAND, GIT_SSH, core.sshCommand — a plain `ssh` there opts out;
 *    for a clone also any includeIf in their global / system config, which may set one for the new repository). macOS /
 *    Linux: as before 1.9.0 (git runs without a terminal there; an askpass dialog still asks). The worker never answers
 *    such a question.
 *  - gitHint: what git's error means for the person — One shows it in their language by its code.
 */
import type { ChildProcess } from 'node:child_process'
import { homedir } from 'node:os'
import { envGet, killTree, spawnSafe } from './exec.ts'
import { pathId } from './paths.ts'

/** What every git call of the worker runs with. */
export const GIT_ENV = { GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C', GCM_INTERACTIVE: 'never' }

/** ssh that never asks: a host key it does not know, a key with a passphrase outside the agent — refused at once. */
export const BATCH_SSH = 'ssh -o BatchMode=yes'

/** git's arguments as the worker runs them (Windows: long paths on). */
export function gitArgs(args: string[], platform: NodeJS.Platform = process.platform): string[] {
  return platform === 'win32' ? ['-c', 'core.longpaths=true', ...args] : args
}

/** core.sshCommand set where git runs (true / false) — per folder, until the worker reads its config again. */
const sshConfig = new Map<string, boolean>()

/** Forget what was read of core.sshCommand (the worker reloaded: the person may have set one meanwhile). */
export function forgetGitEnv(): void {
  sshConfig.clear()
}

const isSet = (env: NodeJS.ProcessEnv, key: string, platform: NodeJS.Platform) => !!envGet(env, key, platform)?.trim()

/** The terminal's line when a clone keeps the person's ssh because their config holds an includeIf. */
export const INCLUDE_IF_NOTE = 'ssh for this clone runs as you set it up (not in BatchMode): your global or system git config has includeIf sections, and one may set core.sshCommand for the new repository — a host-key or passphrase question then waits until the clone\'s time limit.'

/**
 * The environment git runs with in `cwd` (null: no repository — a clone; then the global and system config decide).
 * Windows only, BatchMode while the person set nothing: a variable of theirs, or core.sshCommand in the config git reads
 * there — for a clone also no includeIf at all in the global / system config (its condition cannot be read before the
 * repository exists: `note` says so). When that config cannot be read (git missing, a slow disk, a refused folder)
 * nothing is added — their setup stays. macOS / Linux: no BatchMode, nothing read (as before 1.9.0).
 */
export async function gitEnv(cwd: string | null, base: NodeJS.ProcessEnv = process.env, opts: { platform?: NodeJS.Platform; timeoutMs?: number; note?: (msg: string) => void } = {}): Promise<NodeJS.ProcessEnv> {
  const platform = opts.platform ?? process.platform
  const env: NodeJS.ProcessEnv = { ...base, ...GIT_ENV }
  if (platform !== 'win32') return env
  if (isSet(base, 'GIT_SSH_COMMAND', platform) || isSet(base, 'GIT_SSH', platform)) return env
  const key = cwd === null ? '' : pathId(cwd, platform)
  let set = sshConfig.get(key)
  if (set === undefined) {
    const ms = Math.min(opts.timeoutMs ?? 10_000, 10_000)
    const get = (args: string[], dir: string) => configGet(['config', ...args], dir, env, ms, platform)
    let found: boolean | null
    if (cwd !== null) found = await get(['--get', 'core.sshCommand'], cwd)
    else {
      // --includes: a plain [include] of theirs counts (a scoped read leaves it out by default)
      found = await get(['--global', '--includes', '--get', 'core.sshCommand'], homedir())
      if (found === false) found = await get(['--system', '--includes', '--get', 'core.sshCommand'], homedir())
      if (found === false) {
        let cond = await get(['--global', '--includes', '--get-regexp', '^includeif\\.'], homedir())
        if (cond === false) cond = await get(['--system', '--includes', '--get-regexp', '^includeif\\.'], homedir())
        // an includeIf may set core.sshCommand for the new repository: their setup stays (not remembered — a clone reads again)
        if (cond !== false) {
          if (cond) opts.note?.(INCLUDE_IF_NOTE)
          return env
        }
      }
    }
    if (found === null) return env
    set = found
    sshConfig.set(key, set)
  }
  if (!set) env.GIT_SSH_COMMAND = BATCH_SSH
  return env
}

/**
 * `git config --get …`: true (set), false (not set: exit 1), null (unknown — not started, refused, too slow). Answers at
 * its time limit at once; the program is ended behind it (a git stuck in the file system may not die quickly).
 */
function configGet(args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number, platform: NodeJS.Platform): Promise<boolean | null> {
  const s = spawnSafe('git', gitArgs(args, platform), { cwd, env, stdio: ['ignore', 'pipe', 'ignore'], detached: process.platform !== 'win32', windowsHide: true, allow: 'exe' })
  if (!s.ok) return Promise.resolve(null)
  const child: ChildProcess = s.child
  return new Promise((done) => {
    let out = ''
    let settled = false
    const finish = (v: boolean | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      done(v)
    }
    const timer = setTimeout(() => {
      void killTree(child)
      finish(null)
    }, timeoutMs)
    child.stdout?.on('data', (d: Buffer) => {
      out = (out + d.toString()).slice(0, 4096)
    })
    child.on('error', () => finish(null))
    child.on('close', (code) => finish(code === 0 ? !!out.trim() : code === 1 ? false : null))
  })
}

/* ------------------------------------------------------------------ hints */

/** What a git error means for the person (the codes One shows in their language). */
export type GitHintCode = 'longpaths' | 'sshHostKey' | 'sshKey' | 'gitSignIn' | 'dubiousOwnership' | 'gitLock'

/** The hint for git's message (null: none). "Filename too long" only on Windows (its 260-character limit). */
export function gitHint(text: string, platform: NodeJS.Platform = process.platform): GitHintCode | null {
  const s = text.replace(/\r/g, '\n')
  if (/detected dubious ownership/i.test(s)) return 'dubiousOwnership'
  if (/index\.lock'?: File exists/i.test(s)) return 'gitLock'
  if (/Host key verification failed|HOST IDENTIFICATION HAS CHANGED/i.test(s)) return 'sshHostKey'
  if (/Permission denied \(publickey|Load key .*passphrase/i.test(s)) return 'sshKey'
  if (/could not read (?:Username|Password)|terminal prompts disabled|Authentication failed/i.test(s)) return 'gitSignIn'
  if (platform === 'win32' && /Filename too long/i.test(s)) return 'longpaths'
  return null
}

/** The hint as a log line: its code, its values (names only — never a path) and the English text. */
export function hintLine(code: GitHintCode, at: { repo: string; remote: string }): { s: string; c: GitHintCode; v: Record<string, string> } {
  const { repo, remote } = at
  switch (code) {
    case 'longpaths':
      return { c: code, v: {}, s: 'A path is longer than Windows allows by default (260 characters). The worker’s own git already uses long paths; for your git and other tools run `git config --global core.longpaths true` once and switch on long paths in Windows (LongPathsEnabled) — or set a shorter worktreeDir in worker.json (e.g. C:\\w).' }
    case 'sshHostKey':
      return { c: code, v: { remote }, s: `${remote}: this computer does not know (or no longer trusts) the host’s SSH key, and the worker never answers that question. In a terminal run \`ssh -T git@<host>\` once and read what ssh says, then press Retry.` }
    case 'sshKey':
      return { c: code, v: { remote }, s: `${remote}: the SSH key was refused or needs its passphrase, which the worker cannot type. Add the key to your SSH agent (\`ssh-add\`) and to your account on the host — or use the HTTPS address. On Windows, Git for Windows’ own ssh does not use the “OpenSSH Authentication Agent” service: to use that agent, run \`git config --global core.sshCommand C:/Windows/System32/OpenSSH/ssh.exe\` once.` }
    case 'gitSignIn':
      return { c: code, v: { remote }, s: `${remote} wants a sign-in, and git may not ask while the worker runs it. Sign in once in a terminal (\`git fetch\` in that repo — Git Credential Manager keeps the login; or \`gh auth setup-git\` / \`glab auth login\`), then press Retry.` }
    case 'dubiousOwnership':
      return { c: code, v: { repo }, s: `git refuses ${repo}: the folder belongs to another user account (git calls it “dubious ownership”). If it is yours, mark it as safe with \`git config --global --add safe.directory\` and the folder — the worker’s terminal shows the exact line. The worker never sets this itself.` }
    case 'gitLock':
      return { c: code, v: { repo }, s: `git in ${repo} is blocked by a lock file (index.lock) that a stopped git left behind. When no git runs there, delete the file the worker’s terminal names, then press Retry.` }
  }
}

/**
 * What only this computer's terminal may show for a hint (never One): git's own line for safe.directory, the lock
 * file's path. Null when git's message names neither.
 */
export function hintTerminal(code: GitHintCode, text: string): string | null {
  const s = text.replace(/\r/g, '\n')
  if (code === 'dubiousOwnership') {
    const line = /git config --global --add safe\.directory\s+(\S.*)$/m.exec(s)?.[1]?.trim()
    return line ? `git refuses a folder of another user account — if it is yours: git config --global --add safe.directory ${line}` : null
  }
  if (code === 'gitLock') {
    const file = /'([^'\n]+index\.lock)'/.exec(s)?.[1]
    return file ? `a stopped git left ${file} behind — delete it when no git runs there` : null
  }
  return null
}

/** The English text of a folder Windows still holds (rmRetry gave up). */
export const FOLDER_BUSY = 'Windows still holds files in the worktree folder (an editor, the search indexer or antivirus), so it could not be removed yet. Close what has it open; the worker tries again next time.'

/** The folderBusy code — Windows only (elsewhere git's own error says why a folder could not be removed). */
export const folderBusyCode = (platform: NodeJS.Platform = process.platform): 'folderBusy' | undefined => (platform === 'win32' ? 'folderBusy' : undefined)
