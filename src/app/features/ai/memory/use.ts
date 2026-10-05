/**
 * One memory — what a free-form request takes along (AI terminal task, AI-menu own request, ⌘K "?",
 * custom agents) and what happens after Claude answered: the memories it cited ([M3]) count as used.
 */
import { codewordsIn } from '../mcp-servers/config'
import { citedIn, memoryBlock, pickMemories, readMemories } from './read'
import { bumpUses } from './save'
import { memoryReadOnly } from './schema'
import { memoryInUse } from './settings'
import type { MemoryUse, PickedMemory } from './types'

export interface MemoryFor {
  /** null: the memory is not in use (switched off, or none set up) */
  use: MemoryUse | null
  /** the `<one_memory>` block ('' = nothing goes along) */
  block: string
}

/** The memory for a task: the picked memories and their block — nothing when it is not in use or switched off for this request. */
export function memoryFor(task: string, opts: { off?: boolean } = {}): MemoryFor {
  if (!memoryInUse()) return { use: null, block: '' }
  if (opts.off) return { use: { items: [], off: true }, block: '' }
  const all = readMemories()
  // "kb: …" — the codewords are not part of the task
  const items = pickMemories(codewordsIn(task)?.text ?? task, all)
  return { use: { items }, block: memoryBlock(items, all) }
}

/** After the answer: the memories Claude cited get Uses + 1 / Last used = today (once a day). Returns them. */
export function noteCited(answer: string, use: MemoryUse | null | undefined): PickedMemory[] {
  if (!use?.items.length) return []
  const cited = citedIn(answer, use.items)
  if (cited.length && !memoryReadOnly()) {
    try {
      bumpUses(cited)
    } catch (e) {
      console.warn('[one] memory: could not count the use', e)
    }
  }
  return cited
}
