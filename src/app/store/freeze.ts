/**
 * Deep-freeze data entering the store, down to the parts already frozen — what Immer's auto-freeze
 * does with a write (plain objects and arrays only, like Immer). Pure.
 */
export function deepFreeze<T>(v: T): T {
  if (!v || typeof v !== 'object' || Object.isFrozen(v)) return v
  const proto = Object.getPrototypeOf(v)
  if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) return v
  Object.freeze(v)
  for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k])
  return v
}
