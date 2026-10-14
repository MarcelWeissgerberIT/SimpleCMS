/**
 * one-worker — opens the setup page in the default browser: `open` (macOS), `xdg-open` (Linux, only with a
 * display), `cmd /d /c start` (Windows, cmd.exe by its path in System32) — always as a program with an argument
 * list, never a shell line. The only argument is the page's own address (http://127.0.0.1:<port>/setup#k=<token>),
 * built by the worker and checked before it goes anywhere. ONE_WORKER_BROWSER: a program to use instead (it gets the
 * address as its only argument; looked up like the person's own commands, exec.ts) · "none": never open a browser
 * (the address is printed).
 */
import { spawnSafe, systemTool, type Allow, type SpawnSafeOptions } from './exec.ts'

export interface OpenCommand {
  cmd: string
  args: string[]
  opts: SpawnSafeOptions
  /** the built-in openers are programs; ONE_WORKER_BROWSER is the person's own command */
  allow: Allow
}

/** How to open `url` here (null: no browser to open — headless, or switched off). */
export function browserCommand(url: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): OpenCommand | null {
  // one pair of quotes around a path with spaces is the person's quoting, not part of the name
  const custom = (env.ONE_WORKER_BROWSER ?? '').trim().replace(/^"(.+)"$/, '$1')
  const base: SpawnSafeOptions = { stdio: 'ignore', windowsHide: true }
  if (custom === 'none') return null
  if (custom) return { cmd: custom, args: [url], opts: base, allow: 'person' }
  if (platform === 'darwin') return { cmd: 'open', args: [url], opts: base, allow: 'exe' }
  // "start" is part of cmd; the empty "" is its window title; /d: no AutoRun. The address holds no character cmd reads.
  if (platform === 'win32') return { cmd: systemTool('cmd', env, platform), args: ['/d', '/c', 'start', '""', url], opts: { ...base, windowsVerbatimArguments: true }, allow: 'exe' }
  if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return null
  return { cmd: 'xdg-open', args: [url], opts: base, allow: 'exe' }
}

/** Open `url`; resolves false when there is no browser to open or the opener failed. */
export function openUrl(url: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (!/^http:\/\/127\.0\.0\.1:\d{4,5}\/setup#k=[A-Za-z0-9_-]{43}$/.test(url)) return Promise.resolve(false)
  const how = browserCommand(url, env)
  if (!how) return Promise.resolve(false)
  return new Promise((resolve) => {
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      resolve(ok)
    }
    const s = spawnSafe(how.cmd, how.args, { ...how.opts, detached: process.platform !== 'win32', allow: how.allow })
    if (!s.ok) return finish(false)
    const child = s.child
    child.once('error', () => finish(false))
    child.once('exit', (code) => finish(code === 0))
    // an opener that keeps running (some do) has opened the page by then
    setTimeout(() => {
      child.unref()
      finish(true)
    }, 4000).unref()
  })
}
