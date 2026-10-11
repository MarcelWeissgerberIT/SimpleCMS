/**
 * The app's helpers the pure model takes as `deps` (content identity, value keys, icon keys, block keys,
 * the schema-normalised doc), with a cache per content object: classification, the event's digest and
 * the segment's parts read the same content once.
 */
import type { JSONContent } from '@tiptap/core'
import type { CanonDeps } from '../model/canon'
import { normalizeContent } from '../../history/snapshots'
import { iconKey, valueKey } from '../../history/props'
import { blockKey, docKey, sameBlock } from '../../history/diff'

const keys = new WeakMap<object, string>()
const normal = new WeakMap<object, JSONContent | null>()

/** A block both sides share around a compared region (the trailing-paragraph rule then acts as on the whole doc). */
const SENTINEL: JSONContent = { type: 'paragraph', content: [{ type: 'text', text: '\u0000' }] }
const emptyPara = (b: JSONContent) => b.type === 'paragraph' && !b.content?.length

/**
 * contentKey(a) === contentKey(b) without the whole doc's key when the docs share most blocks (typing in a long page):
 * the blocks equal as stored at the start and the end are left out (equal as stored ⇒ equal as the schema reads them —
 * its normalisation is block by block), and only the region between them is normalised and keyed — framed so the
 * trailing empty paragraphs go exactly as they would on the whole doc.
 */
function contentSame(a: JSONContent | null | undefined, b: JSONContent | null | undefined): boolean {
  if (a === b) return true
  if (!a || !b || a.type !== b.type || a.attrs || b.attrs) return deps.contentKey(a) === deps.contentKey(b)
  const A = a.content ?? []
  const B = b.content ?? []
  let lo = 0
  while (lo < A.length && lo < B.length && sameBlock(A[lo], B[lo])) lo++
  let ea = A.length
  let eb = B.length
  while (ea > lo && eb > lo && sameBlock(A[ea - 1], B[eb - 1])) {
    ea--
    eb--
  }
  if (lo === A.length && lo === B.length) return true
  // the shared tail holds only empty paragraphs: the region reaches the end (they may go, as on the whole doc)
  let toEnd = true
  for (let i = ea; i < A.length; i++)
    if (!emptyPara(A[i])) {
      toEnd = false
      break
    }
  const region = (X: JSONContent[], end: number): JSONContent => ({ type: 'doc', content: [...(lo ? [SENTINEL] : []), ...X.slice(lo, toEnd ? X.length : end), ...(toEnd ? [] : [SENTINEL])] })
  return docKey(normalizeContent(region(A, ea))) === docKey(normalizeContent(region(B, eb)))
}

export const deps: CanonDeps = {
  // = history's contentKey(), sharing the one schema parse with normalize()
  contentKey(content) {
    if (!content) return docKey(content)
    let k = keys.get(content)
    if (k === undefined) {
      k = docKey(deps.normalize!(content))
      keys.set(content, k)
    }
    return k
  },
  normalize(content) {
    if (!content) return null
    let n = normal.get(content)
    if (n === undefined) {
      n = normalizeContent(content)
      normal.set(content, n)
    }
    return n
  },
  valueKey,
  iconKey,
  blockKey,
  sameBlock,
  contentSame,
}
