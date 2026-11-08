/** Literal search: offsets always refer to the original source, including Unicode. */
export function scriptMatches(source: string, query: string, matchCase: boolean): Array<{ start: number; end: number }> {
  if (!query) return []
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return Array.from(source.matchAll(new RegExp(escaped, matchCase ? 'gu' : 'giu')), (m) => ({ start: m.index, end: m.index + m[0].length }))
}

