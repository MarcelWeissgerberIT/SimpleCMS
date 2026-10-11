/**
 * Stable JSON of a stored value: object keys sorted, arrays in their order, `undefined` left out (as JSON does) —
 * so the same value compares equal however its object was built (another device, a sanitizer, a remote copy).
 */
export function stableJson(v: unknown): string {
  return JSON.stringify(norm(v)) ?? 'null'
}

function norm(v: unknown): unknown {
  if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : norm(x)))
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {}
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const x = (v as Record<string, unknown>)[k]
      if (x !== undefined) o[k] = norm(x)
    }
    return o
  }
  return v === undefined ? null : v
}
