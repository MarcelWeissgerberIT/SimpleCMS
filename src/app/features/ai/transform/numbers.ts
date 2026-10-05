/**
 * "Never invent" for charts: every value Claude puts into a chart must be a number the text states.
 * numbersIn(text) reads every number of the selection — both decimal styles (1,234.5 / 1.234,5), with
 * k / Tsd / Mio / Mrd / bn / % suffixes and the small number words — into the values it can stand for;
 * grounded(value, pool) checks a chart value against them.
 */

const MULTIPLIERS: Array<[RegExp, number]> = [
  [/^(k|tsd\.?|tausend|thousand)$/i, 1e3],
  [/^(m|mio\.?|mn|million(en|s)?)$/i, 1e6],
  [/^(bn|b|mrd\.?|milliarde(n)?|billion(s)?)$/i, 1e9],
]

const WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  null: 0, eins: 1, ein: 1, eine: 1, zwei: 2, drei: 3, vier: 4, 'fünf': 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, 'zwölf': 12,
  dozen: 12, dutzend: 12, hundred: 100, hundert: 100, thousand: 1000, tausend: 1000,
}

const SUFFIX = String.raw`(\s?(?:%|k|tsd\.?|tausend|thousand|m|mio\.?|mn|millionen|millions?|bn|b|mrd\.?|milliarden?|billions?)(?!\p{L}))?`
/** a sign, the digits (thousands in groups of three, then decimals), a suffix that is not the start of a word */
const NUM = new RegExp(String.raw`([-\u2212\u2013]?)(\d{1,3}(?:[,.\u00a0\u202f '\u2019]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)` + SUFFIX, 'giu')
/** every run of digits on its own ("Q1 120" is read as 1 120 above — and as 1 and 120 here) */
const PLAIN = new RegExp(String.raw`([-\u2212\u2013]?)(\d+(?:[.,]\d+)?)` + SUFFIX, 'giu')

function readings(digits: string): number[] {
  const out = new Set<number>()
  const plain = digits.replace(/[\u00a0\u202f '\u2019]/g, '')
  // dot decimals, comma thousands (1,234.5)
  const dot = Number(plain.replace(/,/g, ''))
  if (Number.isFinite(dot)) out.add(dot)
  // comma decimals, dot thousands (1.234,5)
  const comma = Number(plain.replace(/\./g, '').replace(',', '.'))
  if (Number.isFinite(comma)) out.add(comma)
  // "1.234" may also be 1234 and "1,5" 1.5 — both readings above cover them
  return [...out]
}

/** Every value a number of the text can stand for. */
export function numbersIn(text: string): number[] {
  const pool = new Set<number>()
  for (const re of [NUM, PLAIN])
    for (const m of text.matchAll(re)) {
      const sign = m[1] ? -1 : 1
      const suffix = (m[3] ?? '').trim()
      for (const base of readings(m[2])) {
        const v = sign * base
        pool.add(v)
        pool.add(Math.abs(v))
        if (suffix === '%') pool.add(v / 100)
        for (const [re2, f] of MULTIPLIERS) if (re2.test(suffix)) pool.add(v * f)
      }
    }
  for (const w of text.toLowerCase().match(/\p{L}+/gu) ?? []) if (w in WORDS) pool.add(WORDS[w])
  return [...pool]
}

/** Is `v` one of the numbers of the text (exactly, up to floating-point noise)? */
export function grounded(v: number, pool: number[]): boolean {
  return pool.some((c) => Math.abs(c - v) <= 1e-9 * Math.max(1, Math.abs(c)))
}
