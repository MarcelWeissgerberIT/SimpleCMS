/**
 * A worker older than 1.9.0 running on this Windows computer (pure but for `browserOs`, which reads `navigator`).
 * Windows looks for a program in the folder it starts in before PATH, and every worker before 1.9.0 ran git and
 * Claude Code by name inside the repository — so it can start a git.exe / claude.exe a cloned or imported repository
 * brought along (docs/CODING.md § Windows). The welcome names no system (protocol.ts stays as it is: One learns
 * nothing it would decide on), but a Local link reaches 127.0.0.1 — the browser's own computer — so the browser's
 * platform says it: never the start-line switch (that is the person's pick for lines). Through the relay (Cloud) the
 * worker runs on another computer: never flagged. A worker in WSL is a Linux one — the notice says so. A version One
 * cannot read ("dev", garbage) is never flagged, as `workerUnsafe`; a pre-release of 1.9.0 is older than 1.9.0.
 */
import { detectOs, type StartOs } from './startLines'

/** The first worker that looks up programs in PATH only on Windows. */
export const WORKER_WIN_SAFE = '1.9.0'

/** "1.8.1", "v1.9.0-rc.1+abc" → numeric parts + pre-release (protocol.ts reads versions the same way); else null. */
function readVersion(v: unknown): { parts: number[]; pre: boolean } | null {
  if (typeof v !== 'string' || v.length > 64) return null
  const m = /^v?(\d+(?:\.\d+){0,3})(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.exec(v.trim())
  if (!m) return null
  const parts = m[1]!.split('.').map(Number)
  return parts.every(Number.isSafeInteger) ? { parts, pre: !!m[2] } : null
}

function below(v: { parts: number[]; pre: boolean }, min: { parts: number[]; pre: boolean }): boolean {
  for (let i = 0; i < Math.max(v.parts.length, min.parts.length); i++) {
    const d = (v.parts[i] ?? 0) - (min.parts[i] ?? 0)
    if (d) return d < 0
  }
  return v.pre && !min.pre
}

/** The worker `version` reached over `link` from a browser on `os`: older than 1.9.0 on Windows? */
export function workerOldOnWindows(version: string | null | undefined, link: 'local' | 'cloud', os: StartOs): boolean {
  if (link !== 'local' || os !== 'windows') return false
  const v = readVersion(version)
  return !!v && below(v, readVersion(WORKER_WIN_SAFE)!)
}

/** The computer this browser runs on: its platform hint, else its user agent. */
export function browserOs(): StartOs {
  if (typeof navigator === 'undefined') return 'posix'
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  return detectOs(nav.userAgentData?.platform, nav.userAgent)
}
