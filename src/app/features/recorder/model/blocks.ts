/**
 * A page's content block by block, for the eject (design §6.2.2): the hunks one writer's segment made — the blocks
 * it had before (its pin) against the blocks it left — and where such a hunk sits in the page now. Blocks are the
 * journal's block strings `<id|#>=<digest>` (LeftHash.blocks). Hunks pair blocks by id where they have one, else by
 * digest (an LCS), a block whose id stayed but whose digest changed is a hunk of its own (its id still anchors a
 * neighbour after it went back), and they come last in doc order first (reverting them in that order keeps the
 * earlier ones' indexes). Locating a hunk in the page now: by id
 * where the range has one, else by its digest sequence with BOTH neighbours around it — no match or more than one →
 * null (the planner holds it: ambiguous). Pure.
 */

export interface Hunk {
  /** [from, to) in the before list */
  b: [number, number]
  /** [from, to) in the after list */
  l: [number, number]
  /** the blocks before (what goes back in) */
  B: string[]
  /** the blocks the writer left (what goes out) */
  L: string[]
  /** the after list's neighbours around L (null: the start / the end of the doc) */
  anchors: [string | null, string | null]
}

const idOf = (b: string): string | null => {
  const i = b.indexOf('=')
  const id = i < 0 ? b : b.slice(0, i)
  return id === '#' ? null : id
}
/** pairing key: the id, else the digest */
const keyOf = (b: string): string => idOf(b) ?? b

/** Longest common subsequence of two key lists → matched index pairs, in order. */
function lcs(a: string[], b: string[]): Array<[number, number]> {
  let lo = 0
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) lo++
  let ea = a.length
  let eb = b.length
  while (ea > lo && eb > lo && a[ea - 1] === b[eb - 1]) {
    ea--
    eb--
  }
  const out: Array<[number, number]> = []
  for (let i = 0; i < lo; i++) out.push([i, i])
  const n = ea - lo
  const m = eb - lo
  if (n && m) {
    // table of suffix lengths over the middle
    const w = m + 1
    const t = new Uint32Array((n + 1) * w)
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--) t[i * w + j] = a[lo + i] === b[lo + j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1])
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (a[lo + i] === b[lo + j]) {
        out.push([lo + i, lo + j])
        i++
        j++
      } else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) i++
      else j++
    }
  }
  for (let k = 0; k < a.length - ea; k++) out.push([ea + k, eb + k])
  return out
}

/** The hunks between a segment's before blocks and the blocks it left, last in doc order first. */
export function blockHunks(before: readonly string[], after: readonly string[]): Hunk[] {
  const pairs = lcs(before.map(keyOf), after.map(keyOf))
  const hunks: Hunk[] = []
  const add = (b0: number, b1: number, l0: number, l1: number) => {
    if (b0 === b1 && l0 === l1) return
    hunks.push({ b: [b0, b1], l: [l0, l1], B: before.slice(b0, b1), L: after.slice(l0, l1), anchors: [l0 > 0 ? after[l0 - 1] : null, l1 < after.length ? after[l1] : null] })
  }
  let pb = 0
  let pl = 0
  for (const [i, j] of pairs) {
    // the gap before a matched pair; a matched pair whose digest changed is a hunk of its own
    if (before[i] !== after[j]) {
      add(pb, i, pl, j)
      add(i, i + 1, j, j + 1)
    } else add(pb, i, pl, j)
    pb = i + 1
    pl = j + 1
  }
  add(pb, before.length, pl, after.length)
  return hunks.reverse()
}

/**
 * An anchor matches the block at `i`: by id where it has one (its text may have changed since), else exactly; a null
 * anchor is the doc's edge (`edge`: -1 before the first block, the length after the last).
 */
const anchorAt = (working: readonly string[], i: number, a: string | null, edge: number): boolean => {
  if (a === null) return i === edge
  if (i < 0 || i >= working.length) return false
  const id = idOf(a)
  return id ? idOf(working[i]) === id : working[i] === a
}

/**
 * Where `range` (the blocks a hunk left) sits in `working` (the page's blocks now, with the hunks already reverted):
 * [from, to), or null when it is not there exactly once. A range with an id is found by that id (and must match
 * block for block); a range of id-less blocks (or an empty one: blocks the writer took out) by its digest sequence
 * with both neighbours — the doc's start / end count as neighbours.
 */
export function locateUnique(working: readonly string[], range: readonly string[], anchors: [string | null, string | null]): [number, number] | null {
  const n = range.length
  const fits = (s: number) => {
    if (s < 0 || s + n > working.length) return false
    for (let k = 0; k < n; k++) if (working[s + k] !== range[k]) return false
    return true
  }
  const withId = range.findIndex((b) => idOf(b) !== null)
  if (withId >= 0) {
    const id = idOf(range[withId])
    const at = working.findIndex((b) => idOf(b) === id)
    if (at < 0) return null
    const s = at - withId
    return fits(s) ? [s, s + n] : null
  }
  let found: [number, number] | null = null
  for (let s = 0; s <= working.length - n; s++) {
    if (!fits(s) || !anchorAt(working, s - 1, anchors[0], -1) || !anchorAt(working, s + n, anchors[1], working.length)) continue
    if (found) return null
    found = [s, s + n]
  }
  return found
}
