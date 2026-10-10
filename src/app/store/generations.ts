/**
 * Document schema generations — which node types a build of One reads, what a copy written by an OLDER build
 * is missing, and how to take its other changes over without losing what it could not read. Pure (TipTap
 * JSON). The editor's schema (editor/schema/base.ts) re-exports the two constants; the team cloud's page
 * documents (cloud/content.ts) and the local workspace's records (persistence.ts) guard against older copies.
 *
 * An older build that meets a node type it does not know:
 *  - 'drop'   — y-prosemirror (team cloud) deletes the node from its copy of the shared document;
 *  - 'unwrap' — the editor's sanitize (local workspace) keeps its blocks, the node itself goes.
 * Its stored copy then lacks those nodes. Taken as it is, that loss would reach this build's copy, the
 * server or the other tabs. `restoreNewer` keeps the older copy's own edits (a three-way merge against what
 * the older build saw) and puts every newer node back.
 */
import type { JSONContent } from '@tiptap/core'
import { mergeContent } from './merge'

/**
 * Generation of the document schema this build reads and writes. A tab that does not know a node type
 * DELETES it from a shared document (y-prosemirror), so the team server lets a collab connection write only
 * when it sends a generation ≥ the server's minimum (docs/CLOUD.md § Schema gate). Bump it with every new
 * node type or attribute an older client would lose (and add the type below) — and raise the server's
 * MIN_CLIENT_SCHEMA one release later.
 *  1 = the task block (`workItem`)
 */
export const DOC_SCHEMA_VERSION = 1

/** Node types an older generation does not know: type → the generation that brought it. */
export const NODE_GENERATIONS: Readonly<Record<string, number>> = { workItem: 1 }

export type LossMode = 'drop' | 'unwrap'

const newerThan = (type: string | undefined, gen: number) => !!type && (NODE_GENERATIONS[type] ?? 0) > gen

/** How many nodes of each type newer than generation `gen` a doc holds. */
export function newerCounts(doc: JSONContent | null | undefined, gen: number): Map<string, number> {
  const out = new Map<string, number>()
  const walk = (n: JSONContent | undefined) => {
    if (!n || typeof n !== 'object') return
    if (newerThan(n.type, gen)) out.set(n.type!, (out.get(n.type!) ?? 0) + 1)
    n.content?.forEach(walk)
  }
  walk(doc ?? undefined)
  return out
}

/** Does any node newer than `gen` that `before` holds miss in `after`? */
export function lostNewer(before: JSONContent | null | undefined, after: JSONContent | null | undefined, gen: number): boolean {
  const a = newerCounts(after, gen)
  for (const [type, n] of newerCounts(before, gen)) if ((a.get(type) ?? 0) < n) return true
  return false
}

/** The doc as a client of generation `gen` holds it: newer nodes dropped, or unwrapped into their blocks. */
export function asGeneration(doc: JSONContent, gen: number, mode: LossMode): JSONContent {
  const walk = (n: JSONContent): JSONContent[] => {
    if (newerThan(n.type, gen)) return mode === 'drop' ? [] : (n.content ?? []).flatMap(walk)
    if (!n.content) return [n]
    const kids = n.content.flatMap(walk)
    return [kids.length === n.content.length && kids.every((k, i) => k === n.content![i]) ? n : { ...n, content: kids }]
  }
  return walk(doc)[0] ?? { type: 'doc', content: [] }
}

/**
 * `after` — what a client of generation `gen` made of `before` (losing its newer nodes, `mode`) plus its own
 * edits — with every newer node of `before` back: a three-way merge (base: `before` as that client saw it;
 * where both changed the same blocks, `before` wins). `after` itself when it lost nothing.
 */
export function restoreNewer(before: JSONContent | null, after: JSONContent | null, gen: number, mode: LossMode): JSONContent | null {
  if (!before || !lostNewer(before, after, gen)) return after
  if (!after) return before
  return mergeContent(asGeneration(before, gen, mode), after, before)
}
