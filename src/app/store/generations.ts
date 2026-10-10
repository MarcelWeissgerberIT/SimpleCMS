/**
 * Document schema generations — which node types a build of One reads, what a copy written by an OLDER build
 * is missing, and how to take its other changes over without losing what it could not read. Pure (TipTap
 * JSON). The editor's schema (editor/schema/base.ts) re-exports the two constants; the team cloud's page
 * documents (cloud/content.ts) and the local workspace's records (persistence.ts) guard against older copies.
 *
 * An older build that meets a node type it does not know:
 *  - 'drop'   — y-prosemirror (team cloud) deletes the node from its copy of the shared document; the person
 *               there never saw it, so nothing they did can mean it — `restoreNewer` puts it back (a three-way
 *               merge that keeps the older copy's own edits);
 *  - 'unwrap' — the editor's sanitize (local workspace) keeps its blocks, the node itself goes; the person there
 *               saw its title and notes as plain blocks and may have edited them — `rewrapNewer` wraps the node
 *               again around what is left of its blocks (their edits kept), and lets a node go only when none of
 *               its blocks is left (deleted there, or the whole page replaced: a restore, an import).
 * Its stored copy then lacks those nodes. Taken as it is, that loss would reach this build's copy, the
 * server or the other tabs.
 */
import type { JSONContent } from '@tiptap/core'
import { diff, mergeContent } from './merge'

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
 * edits — with every newer node of `before` back. 'drop': a three-way merge (base: `before` as that client saw
 * it; where both changed the same blocks, `before` wins). 'unwrap': `rewrapNewer` (what is left of a node's
 * blocks, edits and all, wrapped again). `after` itself when it lost nothing.
 */
export function restoreNewer(before: JSONContent | null, after: JSONContent | null, gen: number, mode: LossMode): JSONContent | null {
  if (!before || !lostNewer(before, after, gen)) return after
  if (!after) return before
  if (mode === 'unwrap') return rewrapNewer(before, after, gen).doc
  return mergeContent(asGeneration(before, gen, mode), after, before)
}

/* ------------------------------------------------------------------ the local stamp's fingerprint */

/** A 53-bit hash of a string (cyrb53) — a fingerprint, not a secret. */
function hash53(str: string): number {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

/**
 * What the generation stamp of a stored copy is bound to (persistence.ts): 0 for content without a node newer
 * than generation 0, else a hash of its JSON. An older build copies the stamp along (an unknown field) — even onto
 * a copy it changed (its own cross-tab merge takes the newer side's stamp) — so a stamp counts only for content
 * with this very fingerprint.
 */
export function newerFingerprint(doc: JSONContent | null | undefined): number {
  if (!doc || !newerCounts(doc, 0).size) return 0
  try {
    return hash53(JSON.stringify(doc))
  } catch {
    return -1
  }
}

/* ------------------------------------------------------------------ rewrap (an older build that unwraps) */

/** The block a newer node's content has to start with (its schema) — put back when none of it is left there. */
const LEAD: Readonly<Record<string, string>> = { workItem: 'paragraph' }

/** A newer node's identity across copies: its item id, else its block id, else its value. */
function identity(n: JSONContent): string {
  const a = n.attrs
  if (typeof a?.itemId === 'string' && a.itemId) return `i:${a.itemId}`
  if (typeof a?.id === 'string' && a.id) return `b:${a.id}`
  return `v:${JSON.stringify(n)}`
}

function each(n: JSONContent | null | undefined, fn: (n: JSONContent) => void): void {
  if (!n || typeof n !== 'object') return
  fn(n)
  n.content?.forEach((c) => each(c, fn))
}

/** Attrs without empty values (an editor writes its defaults as null) and without `skip`, in a stable order. */
function cleanAttrs(attrs: Record<string, unknown> | undefined, skip: (k: string, v: unknown) => boolean): Record<string, unknown> | undefined {
  if (!attrs || typeof attrs !== 'object') return undefined
  const keys = Object.keys(attrs).filter((k) => attrs[k] !== null && attrs[k] !== undefined && !skip(k, attrs[k])).sort()
  if (!keys.length) return undefined
  return Object.fromEntries(keys.map((k) => [k, attrs[k]]))
}

export interface Rewrapped {
  doc: JSONContent | null
  /** Newer nodes of `before` none of whose blocks is left in `after`: gone (the caller keeps a version). */
  dropped: JSONContent[]
}

/** A block of the older build's copy, with the newer nodes it sat in (outermost first). */
interface Slot {
  /** as the older build held it (lost nodes unwrapped) */
  node: JSONContent
  /** as it is in `before` */
  orig: JSONContent
  owners: JSONContent[]
}

interface Placed {
  node: JSONContent
  owners: JSONContent[]
}

/**
 * `after` — a copy an older build (generation `gen`, whose editor UNWRAPS node types it does not know) stored
 * of `before`, plus whatever the person did there — with every newer node of `before` that `after` lacks wrapped
 * again around what is left of its blocks:
 *  - text typed into a task's title or notes (plain blocks there) stays in the task; blocks added between two of
 *    its blocks join it, blocks added at its edge stay outside;
 *  - blocks that the older editor gave a block id they did not have here (it fills in missing ids) are matched by
 *    value and come back as they were — the page is never doubled;
 *  - a node none of whose blocks is left (the person deleted them, or the page was replaced as a whole: a restore,
 *    an import) stays gone: it is listed in `dropped`, so the caller can keep the version that had it.
 * `after` itself when it lost nothing.
 */
export function rewrapNewer(before: JSONContent | null, after: JSONContent | null, gen: number): Rewrapped {
  if (!before || !lostNewer(before, after, gen)) return { doc: after, dropped: [] }
  if (!after) return { doc: before, dropped: [] }

  // the newer nodes of `before` that `after` lacks (one each for every copy `after` still holds)
  const have = new Map<string, number>()
  each(after, (n) => {
    if (newerThan(n.type, gen)) have.set(identity(n), (have.get(identity(n)) ?? 0) + 1)
  })
  const lost = new Set<JSONContent>()
  each(before, (n) => {
    if (!newerThan(n.type, gen)) return
    const k = identity(n)
    const left = have.get(k) ?? 0
    if (left > 0) have.set(k, left - 1)
    else lost.add(n)
  })
  // every block id `before` knows: any other id in `after` was made up by the older editor
  const known = new Set<string>()
  each(before, (n) => {
    const id = n.attrs?.id
    if (typeof id === 'string' && id) known.add(id)
  })
  const madeUp = (k: string, v: unknown) => k === 'id' && typeof v === 'string' && !known.has(v)
  const value = (n: JSONContent): unknown => {
    const attrs = cleanAttrs(n.attrs, madeUp)
    const marks = n.marks?.map((m) => ({ type: m.type, attrs: cleanAttrs(m.attrs, () => false) }))
    return [n.type, attrs ?? null, n.text ?? null, marks ?? null, n.content ? n.content.map(value) : null]
  }
  const keyOf = (n: JSONContent): string => {
    const id = n.attrs?.id
    return typeof id === 'string' && id && known.has(id) ? `#${n.type}:${id}` : `=${JSON.stringify(value(n))}`
  }
  const holdsLost = (n: JSONContent): boolean => lost.has(n) || !!n.content?.some(holdsLost)
  /** a block as the older build held it */
  const project = (n: JSONContent): JSONContent[] => {
    if (lost.has(n)) return (n.content ?? []).flatMap(project)
    if (!n.content || !holdsLost(n)) return [n]
    return [{ ...n, content: n.content.flatMap(project) }]
  }
  const slotsOf = (list: JSONContent[], owners: JSONContent[]): Slot[] =>
    list.flatMap((n) => (lost.has(n) ? slotsOf(n.content ?? [], [...owners, n]) : [{ node: project(n)[0], orig: n, owners }]))
  const common = (a: JSONContent[] | undefined, b: JSONContent[] | undefined): JSONContent[] => {
    if (!a || !b) return []
    let i = 0
    while (i < a.length && i < b.length && a[i] === b[i]) i++
    return a.slice(0, i)
  }
  const blocky = (n: JSONContent) => !!n.content?.length && n.content.every((c) => c.type !== 'text' && c.type !== 'hardBreak' && c.type !== 'mention' && c.type !== 'inlineMath')

  const used = new Set<JSONContent>()
  const holdsNewer = (n: JSONContent): boolean => newerThan(n.type, gen) || !!n.content?.some(holdsNewer)
  /** A block of `before` taken whole: the lost nodes in it are back with it. */
  const whole = (orig: JSONContent): JSONContent => {
    each(orig, (n) => {
      if (lost.has(n)) used.add(n)
    })
    return orig
  }
  /** A block the older copy changed: its version — with the lost nodes it held put back inside, level by level. */
  const edited = (s: Slot, a: JSONContent): JSONContent =>
    holdsLost(s.orig) && blocky(s.orig) && a.content && blocky(a) ? { ...a, content: level(s.orig.content!, a.content) } : a
  const group = (placed: Placed[], depth: number): JSONContent[] => {
    const out: JSONContent[] = []
    for (let k = 0; k < placed.length; ) {
      const owner = placed[k].owners[depth]
      let e = k + 1
      if (!owner) {
        out.push(placed[k].node)
        k = e
        continue
      }
      while (e < placed.length && placed[e].owners[depth] === owner) e++
      const kids = group(placed.slice(k, e), depth + 1)
      // a node is put back once (its blocks never come apart; were they to, the rest stays plain)
      if (used.has(owner)) out.push(...kids)
      else {
        used.add(owner)
        const lead = LEAD[owner.type ?? '']
        out.push({ ...owner, content: lead && kids[0]?.type !== lead ? [{ type: lead }, ...kids] : kids })
      }
      k = e
    }
    return out
  }

  /** One level: `bList` (from `before`) against `aList` (the older copy). */
  const level = (bList: JSONContent[], aList: JSONContent[]): JSONContent[] => {
    const slots = slotsOf(bList, [])
    const hunks = diff(slots.map((s) => keyOf(s.node)), aList.map(keyOf))
    /** A block both copies hold (same id, or same value): unchanged there → as `before` has it, else the edited block. */
    const kept = (s: Slot, a: JSONContent): JSONContent => {
      if (keyOf(a).startsWith('=') || JSON.stringify(value(a)) === JSON.stringify(value(s.node))) return whole(s.orig)
      return edited(s, a)
    }
    const placed: Placed[] = []
    let i = 0
    let j = 0
    const same = (to: number) => {
      for (; i < to; i++, j++) placed.push({ node: kept(slots[i], aList[j]), owners: slots[i].owners })
    }
    for (const h of hunks) {
      same(h.a0)
      const u = slots.slice(h.a0, h.a1)
      const a = aList.slice(h.b0, h.b1)
      if (u.length && u.length === a.length && u.every((s, k) => s.node.type === a[k].type)) {
        // the same blocks, edited there: each stays where it was (inside a node or not)
        u.forEach((s, k) => placed.push({ node: edited(s, a[k]), owners: s.owners }))
      } else {
        // replaced or added: inside a node only when every block it replaced was in that node, or when it was
        // added between two of its blocks (at a node's edge it stays outside)
        const owners = u.length ? u.slice(1).reduce((o, s) => common(o, s.owners), u[0].owners) : common(slots[h.a0 - 1]?.owners, slots[h.a0]?.owners)
        // a newer node never goes inside one (no task in a task)
        for (const n of a) placed.push({ node: n, owners: holdsNewer(n) ? [] : owners })
      }
      i = h.a1
      j = h.b1
    }
    same(slots.length)
    return group(placed, 0)
  }

  const content = level(before.content ?? [], after.content ?? [])
  const dropped: JSONContent[] = []
  for (const n of lost) if (!used.has(n)) dropped.push(n)
  return { doc: { ...after, content }, dropped }
}
