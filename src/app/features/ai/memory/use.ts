/**
 * One memory — what a free-form request takes along (AI terminal task, AI-menu own request, ⌘K "?",
 * custom agents) and what happens after Claude answered: the request goes into the memory log with
 * the memories it took along and the ones Claude cited ([M3]) — Uses / Last used count those.
 */
import type { ID } from '../../../store/types'
import { codewordsIn } from '../mcp-servers/config'
import { citedIn, memoryBlock, pickMemories, readMemories } from './read'
import { logUse, type LogWhere } from './log'
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

/**
 * After the request (answered, stopped or failed): the memories Claude cited, and a row in the memory
 * log — the request as typed, where, the page, what went along and what was cited. Returns the cited ones.
 */
export function noteUse(answer: string, use: MemoryUse | null | undefined, ctx: { task: string; where: LogWhere; pageId?: ID | null; result?: string }): PickedMemory[] {
  if (!use?.items.length) return []
  const cited = citedIn(answer, use.items)
  try {
    logUse({ ...ctx, use, cited })
  } catch (e) {
    console.warn('[one] memory: could not log the use', e)
  }
  return cited
}
