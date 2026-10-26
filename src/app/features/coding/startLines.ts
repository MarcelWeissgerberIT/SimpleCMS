/**
 * The worker's start and download lines per computer — pure, no imports (scripts/worker-smoke.mjs imports it
 * under Node). Windows gets a PowerShell and a Command Prompt line, the file always quoted (user folders have
 * spaces; `~` reaches node.exe unexpanded in both shells, `%HOMEPATH%` has no drive) and the home folder spelled as
 * USERPROFILE in both — where the browser's Downloads folder is. Never PowerShell's `$HOME`: Windows PowerShell 5.1
 * takes it from HOMEDRIVE + HOMEPATH, a network home (H:\) on many company PCs. macOS and Linux one sh line as
 * before. Inputs are One's own constants, fixed verbs and a checked workspace id — never anything typed.
 */
export type StartOs = 'windows' | 'posix'
export type StartShell = 'powershell' | 'cmd' | 'sh'
export interface StartLine {
  shell: StartShell
  line: string
}
export interface StartOpts {
  os: StartOs
  /** A port other than the default: set for this start only. */
  port?: number | null
  /** After the file: fixed verbs and flags (`init`, `--workspace`, a checked id, `check`). */
  args?: string[]
  /** Where the file lies: the browser's Downloads folder (the paired download) or the home folder (manual setup). */
  dir?: 'downloads' | 'home'
}

const SHELLS: Record<StartOs, StartShell[]> = { windows: ['powershell', 'cmd'], posix: ['sh'] }
/** What may follow the file: no quote, space, variable or operator of any of the three shells. */
const ARG = /^[A-Za-z0-9_:.=-]+$/
const FILE = /^[A-Za-z0-9_.-]+$/

function where(shell: StartShell, dir: 'downloads' | 'home', file: string): string {
  if (shell === 'sh') return dir === 'home' ? `~/${file}` : `~/Downloads/${file}`
  const home = shell === 'powershell' ? '$env:USERPROFILE' : '%USERPROFILE%'
  return `"${home}\\${dir === 'home' ? '' : 'Downloads\\'}${file}"`
}

/** One line per shell of that computer: `node <file> [args]`, with the port set before it when given. */
export function startLines(file: string, { os, port = null, args = [], dir = 'downloads' }: StartOpts): StartLine[] {
  if (!FILE.test(file) || args.some((a) => !ARG.test(a))) throw new Error('not a start line')
  const p = port !== null && Number.isInteger(port) && port > 0 && port < 65536 ? port : null
  return SHELLS[os].map((shell) => {
    const run = ['node', where(shell, dir, file), ...args].join(' ')
    if (p === null) return { shell, line: run }
    const env = shell === 'sh' ? `ONE_WORKER_PORT=${p} ` : shell === 'powershell' ? `$env:ONE_WORKER_PORT = '${p}'; ` : `set "ONE_WORKER_PORT=${p}" && `
    return { shell, line: env + run }
  })
}

/** Save the plain worker in the home folder (manual setup). PowerShell 5.1's `curl` is Invoke-WebRequest: named in full. */
export function downloadLines(url: string, file: string, os: StartOs): StartLine[] {
  if (!FILE.test(file) || !/^https?:\/\/[^\s"'`$%^&|<>]+$/.test(url)) throw new Error('not a download line')
  return SHELLS[os].map((shell) => ({
    shell,
    line:
      shell === 'sh'
        ? `curl -fsSL ${url} -o ~/${file}`
        : shell === 'powershell'
          ? `Invoke-WebRequest -UseBasicParsing "${url}" -OutFile "$env:USERPROFILE\\${file}"`
          : `curl.exe -fsSL "${url}" -o "%USERPROFILE%\\${file}"`,
  }))
}

/** Windows or not, from the browser's own platform hint (else its user agent). */
export function detectOs(platform: string | null | undefined, userAgent: string): StartOs {
  return /^windows/i.test(platform ?? '') || (!platform && /Windows/i.test(userAgent)) ? 'windows' : 'posix'
}

/** Stable, token-free starter installed next to this profile's existing worker.json. */
export function installedStartLines(workspace: string | null, os: StartOs, verb: 'start' | 'update' | 'rollback' = 'start'): StartLine[] {
  if (workspace !== null && !/^team:[A-Za-z0-9_-]+$/.test(workspace)) throw new Error('Invalid workspace')
  const folder = workspace ? `cloud/${workspace.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80)}/` : ''
  const relative = `.config/one/${folder}installed-worker/start.cjs`
  return SHELLS[os].map(shell => {
    const path = shell === 'sh' ? `"$HOME/${relative}"` : `"${shell === 'powershell' ? '$env:USERPROFILE' : '%USERPROFILE%'}\\${relative.replace(/\//g, '\\')}"`
    return { shell, line: `node ${path}${verb === 'start' ? '' : ' ' + verb}` }
  })
}

/** Exact path reported over the authenticated worker link; shell-quoted without interpolation. */
export function actualInstalledStartLines(directory: string, os: StartOs): StartLine[] {
  if (!directory || /[\r\n\0]/.test(directory)) throw new Error('Invalid installation directory')
  const file = directory.replace(/[\\/]$/, '') + (os === 'windows' ? '\\' : '/') + 'start.cjs'
  return os === 'windows'
    ? [{ shell: 'powershell', line: "node '" + file.replace(/'/g, "''") + "'" }]
    : [{ shell: 'sh', line: "node '" + file.replace(/'/g, "'\\''") + "'" }]
}

export function migrationLines(file: string, os: StartOs): StartLine[] {
  if (!FILE.test(file)) throw new Error('Invalid worker filename')
  return startLines('one-worker-installer.mjs', {os, args:['install']}).map(l => ({...l, line: l.line + ' --from ' + where(l.shell, 'downloads', file)}))
}

/** A file explicitly selected from Downloads, including the browser's duplicate suffix.
 * Restrict the basename before placing it inside shell quotes; never interpolate file contents. */
export function selectedInstallLines(file: string, os: StartOs): StartLine[] {
  if (!/^[\p{L}\p{N}_. ()-]{1,180}\.mjs$/u.test(file) || file.startsWith('.')) throw new Error('Invalid worker filename')
  return SHELLS[os].map(shell => ({ shell, line: `node ${shell === 'sh' ? `"$HOME/Downloads/${file}"` : where(shell, 'downloads', file)} install` }))
}
