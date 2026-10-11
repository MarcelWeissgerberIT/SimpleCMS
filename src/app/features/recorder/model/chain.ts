/**
 * Whose segments are whose on a place W touched: W's own, the transparent ones (a synced copy of W's change, an undone
 * eject of W and its Undo — Δ14), everyone else's (foreign; an open one counts as having touched anything — Δ11), and
 * where the chain of digests breaks (a segment's before is not what the one before it left: something unseen
 * happened). Pure — the loader (window/load.ts) re-digests a break's pin to explain it and hands the rest back.
 */
import { causeChain, laneOf, parseWriterKey, runKeyOf } from './writerKeys'
import { F, type Foreign, type JSegment, type WindowSel } from './types'

/** Does a writer key name W (its run, or any writer on its lane)? */
export function namesW(sel: Pick<WindowSel, 'lane' | 'run'>, key: string): boolean {
  return sel.run ? runKeyOf(key) === sel.run : laneOf(key) === sel.lane
}

/** A derived writer's cause chain names W. */
export const causedByW = (sel: Pick<WindowSel, 'lane' | 'run'>, cause: string | undefined): boolean => !!cause && causeChain(cause).some((k) => namesW(sel, k))

/** A segment that is no one's change for W: a synced copy of W's change, an undone eject of W or that eject's Undo. */
export function transparent(sel: Pick<WindowSel, 'lane' | 'run'>, s: JSegment, undone: ReadonlySet<string>): boolean {
  if (s.f & F.COPY) return causedByW(sel, s.cause ?? parseWriterKey(s.w).cause)
  const p = parseWriterKey(s.w)
  if (p.kind === 'eject') return undone.has(p.parts[0] ?? '')
  if (p.kind === 'you' && p.via === 'undo' && !!p.ref) return undone.has(p.ref)
  return false
}

/** The digest a segment left on its place (an open one: its last event's). */
export const leftOf = (s: JSegment): string => s.left?.h ?? s.lastLh

/**
 * A place's segments from W's first one on, in order (transparent ones dropped), and the consecutive pairs whose
 * digests do not chain: `next.bh` is neither what `prev` left nor (rows) `next.bhr`; a place made again after it was
 * gone starts from nothing.
 */
export function placeChain(sel: Pick<WindowSel, 'lane' | 'run'>, segs: readonly JSegment[], own: ReadonlySet<string>, undone: ReadonlySet<string>): { chain: JSegment[]; breaks: Array<[JSegment, JSegment]> } {
  const list = segs.filter((g) => own.has(g.id) || !transparent(sel, g, undone)).sort((x, y) => x.from - y.from || (x.id < y.id ? -1 : 1))
  const start = list.findIndex((g) => own.has(g.id))
  const chain = start < 0 ? [] : list.slice(start)
  const breaks: Array<[JSegment, JSegment]> = []
  for (let i = 1; i < chain.length; i++) {
    const prev = chain[i - 1]
    const next = chain[i]
    const left = leftOf(prev)
    if (!left || next.bh === left || (!!next.bhr && next.bhr === left)) continue
    if (next.f & F.NEW && left === '-') continue
    breaks.push([prev, next])
  }
  return { chain, breaks }
}

/**
 * The foreign segments of a chain: everyone else's (open ones touched '*'), plus virtual ones (lane null) at a GAP
 * flag after W's first segment and at every break the loader could not explain (`unexplained`: the later segments'
 * ids). Oldest first.
 */
export function foreignOf(chain: readonly JSegment[], own: ReadonlySet<string>, unexplained: ReadonlySet<string>): Foreign[] {
  const out: Foreign[] = []
  const virtual = (g: JSegment): Foreign => ({ from: g.from, lane: null, w: null, touched: '*', seg: g.id, open: false })
  chain.forEach((g, i) => {
    if (!own.has(g.id)) {
      const open = g.o === 1 || g.left === null
      out.push({ from: g.from, lane: g.l, w: g.w, touched: open ? '*' : g.touched, seg: g.id, open })
    }
    if (i > 0 && (g.f & F.GAP || unexplained.has(g.id))) out.push(virtual(g))
  })
  return out.sort((x, y) => x.from - y.from)
}
