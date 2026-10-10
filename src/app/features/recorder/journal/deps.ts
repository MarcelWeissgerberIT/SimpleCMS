/**
 * The app's helpers the pure model takes as `deps` (content identity, value keys, icon keys, block keys,
 * the schema-normalised doc), with a cache per content object: classification, the event's digest and
 * the segment's parts read the same content once.
 */
import type { JSONContent } from '@tiptap/core'
import type { CanonDeps } from '../model/canon'
import { normalizeContent } from '../../history/snapshots'
import { iconKey, valueKey } from '../../history/props'
import { blockKey, docKey } from '../../history/diff'

const keys = new WeakMap<object, string>()
const normal = new WeakMap<object, JSONContent | null>()

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
}
