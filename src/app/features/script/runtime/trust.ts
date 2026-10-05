/**
 * One Script — who decides what a script does in a team workspace. Scripts are shared and anyone who
 * can edit may change one, but a run acts with the runner's rights (their pages, their mail program,
 * their Claude key). So in a team workspace a script runs only in a version this device saved or the
 * person confirmed: the hash of every such version is kept per device and workspace (runs.ts,
 * "<scope>|trust"). The check never relies on `updatedBy` (the meta map is written by clients); that
 * name is only shown in the question. Local workspaces: nothing to confirm.
 */
import { useCloud } from '../../../cloud'
import type { OneScript } from '../../../store/types'
import { addTrusted, trustedHashes } from './runs'

function fnv(str: string, seed: number): string {
  let h = seed >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** A hash of the code (SHA-256 where the browser has it). */
export async function codeHash(code: string): Promise<string> {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))
      return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
    }
  } catch {
    /* fall back below */
  }
  return `f${fnv(code, 0x811c9dc5)}${fnv(code, 0x01234567)}${code.length.toString(16)}`
}

/** A team workspace (where scripts of others need a confirmation). */
export const inTeam = () => useCloud.getState().active.kind === 'cloud'

/** Saves being remembered right now (a run right after typing waits for them). */
const pending = new Set<Promise<void>>()

/** Whether this device may run the script as it is now without asking (team: a version saved or confirmed here). */
export async function isTrusted(script: Pick<OneScript, 'code'>): Promise<boolean> {
  if (!inTeam()) return true
  await Promise.all([...pending])
  return (await trustedHashes()).has(await codeHash(script.code))
}

/** Remember this exact code as confirmed (or saved) on this device. */
export function trustCode(code: string): Promise<void> {
  if (!inTeam()) return Promise.resolve()
  const job = (async () => addTrusted(await codeHash(code)))().catch(() => {})
  pending.add(job)
  void job.finally(() => pending.delete(job))
  return job
}
