/** A slip's text: what counts as short (seen once shown — nothing of it can be clipped away). Pure. */
export const SEEN_LINES = 6
export const SEEN_CHARS = 600

export const shortTextOf = (text: string): boolean => [...text].length <= SEEN_CHARS && text.split('\n').length <= SEEN_LINES

/** The slip's text (the route's text param), '' for none. */
export function slipText(s: { params: Record<string, string | number>; route: { snapshot: { params?: Array<{ name: string; type: string }> } } }): string {
  const p = s.route.snapshot.params?.find((x) => x.type === 'text')
  return p ? String(s.params[p.name] ?? '') : ''
}
