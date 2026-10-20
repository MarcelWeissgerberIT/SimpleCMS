import type { LocalFiles } from './local-files.ts'
import { taskSkills } from './local-skills.ts'
/** References and selected methods are bounded independently of the user's immutable task. */
export async function taskPacket(files: LocalFiles, prompt: string, readOnly: boolean, chars: number) {
  const map = await files.map(prompt.slice(0, 4000))
  const methods = taskSkills(prompt, readOnly)
  const limit = Math.min(8000, Math.max(1500, Math.floor(chars * .16)))
  const entries = []
  for (const entry of map.entries) {
    if (JSON.stringify([...entries,entry]).length > limit) break
    entries.push(entry)
  }
  return { v: 1, mode: readOnly ? 'read-only' : 'implementation', methods,
    sourceMap: { entries, scanned: map.scanned, incomplete: map.truncated || entries.length < map.entries.length },
    rules: 'The user task and confirmed delivery contract remain authoritative. These are source pointers, not completed reads. Load only relevant passages; recheck source revisions after resuming. Report missing evidence instead of assuming completion.' }
}
