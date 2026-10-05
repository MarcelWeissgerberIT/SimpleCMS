/**
 * One memory (features/ai/memory) — what other areas use (through features/index.ts):
 *  - memoryFor(task, { off }) → { use, block }: the memories a free-form request takes along and its
 *    `<one_memory>` block (pass `block` to runAI({ memory })); noteUse(answer, use, ctx): after the request —
 *    the memory log row (+ the cited memories); MemoryNote { use }: the "MEMORY · 2" key for an answer
 *  - MemorySettings: the section of Settings → Claude AI
 */
export { memoryFor, noteUse, type MemoryFor } from './use'
export { MemoryNote } from './MemoryNote'
export { MemorySettings } from './MemorySettings'
export { ExampleDialog } from './ExampleDialog'
export type { MemoryUse, PickedMemory } from './types'
