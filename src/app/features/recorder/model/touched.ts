/**
 * Which parts of a place a segment changed: its first `prev` against its last `next`, by canonical
 * strings (no HMAC). Pages name their blocks (`b:<id>`; `b#` an id-less block; `bo` order or membership).
 * A new or deleted place, or more than 400 keys, is '*'. Pure.
 */
import { placeCanon, type BlockCanon, type CanonDeps, type PlaceObject } from './canon'

export const MAX_TOUCHED = 400

function blocksTouched(a: BlockCanon[], b: BlockCanon[], out: Set<string>) {
  const before = new Map<string, string>()
  const after = new Map<string, string>()
  for (const x of a) if (x.id) before.set(x.id, x.canon)
  for (const x of b) if (x.id) after.set(x.id, x.canon)
  for (const [id, canon] of after) if (before.has(id) && before.get(id) !== canon) out.add(`b:${id}`)
  // id-less blocks compare as a multiset
  const loose = (l: BlockCanon[]) => l.filter((x) => !x.id).map((x) => x.canon).sort().join('\u0000')
  if (loose(a) !== loose(b)) out.add('b#')
  // order or membership: the sequence of ids (and id-less slots)
  const seq = (l: BlockCanon[]) => l.map((x) => x.id ?? '#').join(',')
  if (seq(a) !== seq(b)) {
    out.add('bo')
    for (const id of after.keys()) if (!before.has(id)) out.add(`b:${id}`)
    for (const id of before.keys()) if (!after.has(id)) out.add(`b:${id}`)
  }
}

export function touchedParts(prev: PlaceObject | null | undefined, next: PlaceObject | null | undefined, deps: CanonDeps): string[] | '*' {
  if (!prev || !next) return '*'
  const a = placeCanon(prev, deps)
  const b = placeCanon(next, deps)
  const out = new Set<string>()
  const keys = new Set([...Object.keys(a.parts), ...Object.keys(b.parts)])
  for (const k of keys) if ((a.parts[k] ?? '') !== (b.parts[k] ?? '')) out.add(k)
  if (a.blocks || b.blocks) blocksTouched(a.blocks ?? [], b.blocks ?? [], out)
  if (out.size > MAX_TOUCHED) return '*'
  return [...out].sort()
}
