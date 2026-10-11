/**
 * The task graph — pure. Edges are `blockedBy` links among LIVE tasks (the index winners): X → Y means
 * "X waits for Y". Blocked is computed, never stored, and only advisory (a task can be marked done anyway).
 *
 *  - dependents: Y → [X…] (who waits for Y), relatedBack: Y → [X…] (who lists Y as related);
 *  - loops: every edge inside a strongly connected component (iterative Tarjan — no recursion on long chains)
 *    is a loop edge: shown LOOP, never blocking;
 *  - wouldLoop(index, from, to): would `from` waiting for `to` close a loop? (the picker greys it, write.ts refuses).
 */
import type { ItemEntry } from './itemIndex'

export interface ItemGraph {
  dependents: Map<string, string[]>
  relatedBack: Map<string, string[]>
  loopEdges: Set<string>
}

export const edgeKey = (from: string, to: string) => `${from}>${to}`

export function graphOf(byId: ReadonlyMap<string, Pick<ItemEntry, 'attrs'>>): ItemGraph {
  const dependents = new Map<string, string[]>()
  const relatedBack = new Map<string, string[]>()
  const edges = new Map<string, string[]>()
  for (const [id, e] of byId) {
    const out: string[] = []
    for (const to of e.attrs.blockedBy) {
      if (!byId.has(to)) continue
      out.push(to)
      const list = dependents.get(to)
      if (list) list.push(id)
      else dependents.set(to, [id])
    }
    if (out.length) edges.set(id, out)
    for (const to of e.attrs.related) {
      if (!byId.has(to)) continue
      const list = relatedBack.get(to)
      if (list) list.push(id)
      else relatedBack.set(to, [id])
    }
  }
  return { dependents, relatedBack, loopEdges: loopEdgesOf(edges) }
}

/** Every edge inside a strongly connected component of more than one node (or a self edge). Iterative Tarjan. */
export function loopEdgesOf(edges: ReadonlyMap<string, readonly string[]>): Set<string> {
  const out = new Set<string>()
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const comp = new Map<string, number>()
  let counter = 0
  let comps = 0
  for (const start of edges.keys()) {
    if (index.has(start)) continue
    const work: Array<{ v: string; i: number }> = [{ v: start, i: 0 }]
    index.set(start, counter)
    low.set(start, counter++)
    stack.push(start)
    onStack.add(start)
    while (work.length) {
      const top = work[work.length - 1]
      const next = edges.get(top.v) ?? []
      if (top.i < next.length) {
        const w = next[top.i++]
        if (!index.has(w)) {
          index.set(w, counter)
          low.set(w, counter++)
          stack.push(w)
          onStack.add(w)
          work.push({ v: w, i: 0 })
        } else if (onStack.has(w)) low.set(top.v, Math.min(low.get(top.v)!, index.get(w)!))
        continue
      }
      work.pop()
      if (work.length) {
        const parent = work[work.length - 1].v
        low.set(parent, Math.min(low.get(parent)!, low.get(top.v)!))
      }
      if (low.get(top.v) === index.get(top.v)) {
        let w: string
        do {
          w = stack.pop()!
          onStack.delete(w)
          comp.set(w, comps)
        } while (w !== top.v)
        comps++
      }
    }
  }
  const size = new Map<number, number>()
  for (const c of comp.values()) size.set(c, (size.get(c) ?? 0) + 1)
  for (const [from, tos] of edges) {
    for (const to of tos) {
      if (from === to || (comp.get(from) === comp.get(to) && (size.get(comp.get(from)!) ?? 0) > 1)) out.add(edgeKey(from, to))
    }
  }
  return out
}

/** Would "`from` waits for `to`" close a loop? (DFS from `to` along blockedBy among live tasks reaches `from`.) */
export function wouldLoop(index: { byId: ReadonlyMap<string, Pick<ItemEntry, 'attrs'>> }, from: string, to: string): boolean {
  if (from === to) return true
  const seen = new Set<string>([to])
  const stack = [to]
  while (stack.length) {
    const v = stack.pop()!
    for (const w of index.byId.get(v)?.attrs.blockedBy ?? []) {
      if (w === from) return true
      if (seen.has(w)) continue
      seen.add(w)
      stack.push(w)
    }
  }
  return false
}
