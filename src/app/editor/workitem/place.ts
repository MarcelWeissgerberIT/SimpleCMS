/**
 * Task block — where a task may sit: anywhere a block may, but never inside another task and never in a
 * table (its cells). A task that lands there anyway (a paste or a drop into a task's notes or a cell, a
 * document written elsewhere) is MOVED out whole — right after the outermost task / table around it — with
 * every field; it is never taken apart.
 *
 *  - `liftMisplacedItems(json)`: TipTap JSON (sanitize() in convert.ts: every editor load, external
 *    content, Markdown, read-only renders) — pure;
 *  - `liftMisplaced(tr)`: inside the editor (schema/workItem.ts: after local transactions that insert a task).
 * Remote collab changes are never repaired here: every client would repair the same spot at once and the
 * merge would duplicate it — a misplaced task in a shared document just shows where it is.
 */
import type { JSONContent } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { WORK_ITEM } from './attrs'

/** Containers a task never sits in (a cell is always inside its table). */
const CONTAINERS = new Set([WORK_ITEM, 'table'])

/** The doc with every misplaced task moved after its outermost task / table (same object when there is none). */
export function liftMisplacedItems(doc: JSONContent): JSONContent {
  const visit = (n: JSONContent, banned: boolean): { node: JSONContent; lifted: JSONContent[] } => {
    if (!n.content?.length) return { node: n, lifted: [] }
    const kids: JSONContent[] = []
    const lifted: JSONContent[] = []
    let changed = false
    for (const c of n.content) {
      if (!c || typeof c !== 'object') {
        kids.push(c)
        continue
      }
      if (c.type === WORK_ITEM && banned) {
        // it leaves whole; tasks inside it follow right after it
        const inner = visit(c, true)
        lifted.push(inner.node, ...inner.lifted)
        changed = true
        continue
      }
      const r = visit(c, banned || CONTAINERS.has(c.type ?? ''))
      if (r.node !== c) changed = true
      kids.push(r.node)
      if (!r.lifted.length) continue
      // `c` is the outermost task / table: what left it goes right after it
      if (banned) lifted.push(...r.lifted)
      else {
        kids.push(...r.lifted)
        changed = true
      }
    }
    return { node: changed ? { ...n, content: kids } : n, lifted }
  }
  const r = visit(doc, false)
  // a task directly in the doc is never banned: nothing can be left over
  return r.node
}

/** Tasks that sit inside another task or a table (outermost first, in document order). */
export function misplacedItems(doc: PMNode): Array<{ pos: number; node: PMNode }> {
  const hits: Array<{ pos: number; node: PMNode }> = []
  const walk = (node: PMNode, pos: number, banned: boolean) => {
    node.forEach((child, offset) => {
      const at = pos + offset
      if (child.isTextblock || child.isLeaf) return
      if (child.type.name === WORK_ITEM && banned) hits.push({ pos: at, node: child })
      walk(child, at + 1, banned || CONTAINERS.has(child.type.name))
    })
  }
  walk(doc, 0, false)
  return hits
}

/**
 * Move every misplaced task in `tr.doc` after its outermost task / table. Returns where the last one moved
 * to (the position before it), or null when nothing had to move.
 */
export function liftMisplaced(tr: Transaction): number | null {
  let last: number | null = null
  for (let guard = 0; guard < 100; guard++) {
    const [hit] = misplacedItems(tr.doc)
    if (!hit) break
    const $pos = tr.doc.resolve(hit.pos)
    let depth = 0
    for (let d = 1; d <= $pos.depth; d++) {
      if (CONTAINERS.has($pos.node(d).type.name)) {
        depth = d
        break
      }
    }
    if (!depth) break
    const target = $pos.after(depth)
    const parent = $pos.parent
    const index = $pos.index()
    // the only block of a cell / of notes that need one: an empty paragraph stays in its place
    if (parent.canReplace(index, index + 1)) tr.delete(hit.pos, hit.pos + hit.node.nodeSize)
    else tr.replaceWith(hit.pos, hit.pos + hit.node.nodeSize, tr.doc.type.schema.nodes.paragraph.create())
    const at = tr.mapping.slice(tr.mapping.maps.length - 1).map(target)
    tr.insert(at, hit.node)
    last = at
  }
  return last
}
