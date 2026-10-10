/**
 * Block-level diff between two TipTap docs (top-level blocks, LCS on normalized JSON).
 * Volatile attributes (block ids added by the editor) are ignored for equality.
 */
import type { JSONContent } from '@tiptap/core'

export type DiffKind = 'same' | 'added' | 'removed'

export interface DiffOp {
  kind: DiffKind
  block: JSONContent
}

export interface DiffSegment {
  kind: DiffKind
  blocks: JSONContent[]
}

/** a task block's itemId (copies re-mint it) and doneAt (follows the status) never count as a change either */
const VOLATILE = new Set(['id', 'blockId', 'uid', 'data-id', 'itemId', 'doneAt'])

function normalize(node: JSONContent): unknown {
  const out: Record<string, unknown> = { t: node.type }
  if (node.text !== undefined) out.x = node.text
  if (node.attrs) {
    const attrs: Record<string, unknown> = {}
    for (const k of Object.keys(node.attrs).sort()) {
      if (VOLATILE.has(k) && node.type !== 'mention') continue
      const v = node.attrs[k]
      if (v !== null && v !== undefined) attrs[k] = v
    }
    if (Object.keys(attrs).length) out.a = attrs
  }
  if (node.marks?.length) out.m = node.marks.map((m) => normalize(m as JSONContent))
  if (node.content?.length) out.c = node.content.map(normalize)
  return out
}

export function blockKey(block: JSONContent): string {
  return JSON.stringify(normalize(block))
}

/** Stable JSON of a whole doc without volatile attributes (for change detection). */
export function docKey(doc: JSONContent | null | undefined): string {
  return doc ? JSON.stringify(normalize(doc)) : 'null'
}

/** Diff old → new. 'removed' = only in old, 'added' = only in new. */
export function diffBlocks(oldDoc: JSONContent | null | undefined, newDoc: JSONContent | null | undefined): DiffOp[] {
  const a = oldDoc?.content ?? []
  const b = newDoc?.content ?? []
  const ka = a.map(blockKey)
  const kb = b.map(blockKey)

  // trim common prefix / suffix
  let start = 0
  while (start < a.length && start < b.length && ka[start] === kb[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && ka[endA - 1] === kb[endB - 1]) {
    endA--
    endB--
  }

  const ops: DiffOp[] = []
  for (let i = 0; i < start; i++) ops.push({ kind: 'same', block: b[i] })

  const n = endA - start
  const m = endB - start
  if (n * m > 4_000_000) {
    // too large for LCS — treat the middle as replaced
    for (let i = start; i < endA; i++) ops.push({ kind: 'removed', block: a[i] })
    for (let j = start; j < endB; j++) ops.push({ kind: 'added', block: b[j] })
  } else if (n || m) {
    // LCS table (suffix lengths)
    const w = m + 1
    const L = new Uint32Array((n + 1) * w)
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        L[i * w + j] = ka[start + i] === kb[start + j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1])
    let i = 0
    let j = 0
    while (i < n || j < m) {
      if (i < n && j < m && ka[start + i] === kb[start + j]) {
        ops.push({ kind: 'same', block: b[start + j] })
        i++
        j++
      } else if (j >= m || (i < n && L[(i + 1) * w + j] >= L[i * w + j + 1])) {
        // ties go to removals first → readable "old, then new" pairs
        ops.push({ kind: 'removed', block: a[start + i] })
        i++
      } else {
        ops.push({ kind: 'added', block: b[start + j] })
        j++
      }
    }
  }

  for (let j = endB; j < b.length; j++) ops.push({ kind: 'same', block: b[j] })
  return ops
}

/** Group consecutive ops of the same kind. */
export function segments(ops: DiffOp[]): DiffSegment[] {
  const out: DiffSegment[] = []
  for (const op of ops) {
    const last = out[out.length - 1]
    if (last && last.kind === op.kind) last.blocks.push(op.block)
    else out.push({ kind: op.kind, blocks: [op.block] })
  }
  return out
}

export function diffStats(ops: DiffOp[]): { added: number; removed: number; same: number } {
  let added = 0
  let removed = 0
  let same = 0
  for (const o of ops) {
    if (o.kind === 'added') added++
    else if (o.kind === 'removed') removed++
    else same++
  }
  return { added, removed, same }
}
