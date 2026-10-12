/**
 * Row part keys across schema changes (Δ12). A row's canon names a `p:<id>` part for every stored property its
 * database has at that moment, so adding or deleting a property changes every row's whole digest without any value
 * changing. Compared here: rows over the property keys present on both sides, a key absent on one side equal to the
 * empty value — never a canon change (old tape digests keep matching). Pure.
 */
import type { PropertyType } from '../../../store/types'
import { isStoredType } from './canon'
import type { JEvent } from './types'

const isProp = (k: string) => k.startsWith('p:')

/** A row's parts restricted to `keys`: non-`p:` parts kept, `p:<id>` only for `keys`, a missing key → '' (canonical strings, before signing). */
export function restrictRowParts(parts: Record<string, string>, keys: ReadonlySet<string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of Object.keys(parts)) if (!isProp(k) || keys.has(k)) out[k] = parts[k]
  for (const k of keys) if (isProp(k) && !(k in out)) out[k] = ''
  return out
}

/** The sorted `p:` keys of a row's parts, joined (an identity of its key set). */
export function propKeysOf(parts: Record<string, string>): string {
  const keys: string[] = []
  for (const k of Object.keys(parts)) if (isProp(k)) keys.push(k)
  return keys.sort().join(',')
}

/** A key set back from propKeysOf. */
export const keySet = (joined: string): Set<string> => new Set(joined ? joined.split(',') : [])

/**
 * The part keys whose digests differ, over the union of both sides' keys: a key present on one side only is equal
 * when that side's digest is the empty value's (`empty(k)` = the digest of '' for that part); `o` (order) and
 * `ignore(k)` (kit-computed value properties) never differ.
 */
export function partsDiffer(left: Record<string, string>, now: Record<string, string>, empty: (k: string) => string, ignore?: (k: string) => boolean): string[] {
  const out: string[] = []
  const keys = new Set([...Object.keys(left), ...Object.keys(now)])
  for (const k of keys) {
    if (k === 'o' || ignore?.(k)) continue
    const a = left[k]
    const b = now[k]
    if (a !== undefined && b !== undefined) {
      if (a !== b) out.push(k)
      continue
    }
    const one = (a ?? b) as string
    if (one !== empty(k)) out.push(k)
  }
  return out.sort()
}

/**
 * The row part keys a database had at `t`: the stored properties now, minus the ones added after `t`, plus the ones
 * deleted after `t` (their schema deltas carry id + type), walked newest first. null when a property changed between
 * a stored and a computed type after `t` (the caller holds the row) — a delta that does not say its old type (`was`,
 * tapes from before it) counts as no type change; the part compare stays the net.
 */
export function propKeysAt(nowProps: ReadonlyArray<{ id: string; type: PropertyType }>, schemaEvents: readonly JEvent[], t: number): Set<string> | null {
  const keys = new Set<string>()
  for (const p of nowProps) if (isStoredType(p.type)) keys.add(`p:${p.id}`)
  const later = schemaEvents.filter((e) => e.at > t && e.x?.length).sort((a, b) => b.at - a.at || (a.k < b.k ? 1 : -1))
  for (const e of later) {
    const deltas = e.x ?? []
    for (let i = deltas.length - 1; i >= 0; i--) {
      const d = deltas[i]
      if (!d.prop) continue
      const k = `p:${d.prop.id}`
      if (d.part === 'prop+') keys.delete(k)
      else if (d.part === 'prop-') {
        if (isStoredType(d.prop.type)) keys.add(k)
      } else if (d.part === 'prop~' && d.was && isStoredType(d.was) !== isStoredType(d.prop.type)) return null
    }
  }
  return keys
}
