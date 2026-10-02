/**
 * Counted nouns for the data features (EN + DE both pluralise as "1 = one, else other").
 * Messages: `features.n.<noun>.one|other` ("{n} page" / "{n} pages") and
 * `features.u.<noun>.one|other` (bare unit labels under a readout: "Page" / "Pages").
 */
type T = (key: string, vars?: Record<string, string | number>) => string

export type Noun = 'page' | 'subpage' | 'db' | 'row' | 'file' | 'view' | 'link' | 'child'

const form = (n: number) => (n === 1 ? 'one' : 'other')

/** "1 page", "3 Datenbanken" */
export function countOf(t: T, noun: Noun, n: number): string {
  return t(`features.n.${noun}.${form(n)}`, { n })
}

/** Unit label that goes with a big number: "Page" / "Pages" */
export function unitOf(t: T, noun: Noun, n: number): string {
  return t(`features.u.${noun}.${form(n)}`)
}

/** "2 pages, 1 database, 4 files" — zero entries are left out (at least one entry stays). */
export function countList(t: T, items: Array<[Noun, number]>): string {
  const nonZero = items.filter(([, n]) => n > 0)
  return (nonZero.length ? nonZero : items.slice(0, 1)).map(([noun, n]) => countOf(t, noun, n)).join(', ')
}
