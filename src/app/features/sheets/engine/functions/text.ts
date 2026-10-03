/** Text functions. Every result is bounded to 32,000 characters (the interpreter checks). */
import type { FnSpec, Value } from '../types'
import { cellsOf, err, isErr, isMulti, MAX_STRING, parseNumeric, toText } from '../values'
import { formatWithCode } from '../format'
import { arg, def, globSearch, hasWildcard, int, s, b } from './helpers'

const TEXT = (name: string, opts?: { optional?: boolean; repeat?: boolean }) => arg(name, 'text', opts)
const NUMA = (name: string, opts?: { optional?: boolean; repeat?: boolean }) => arg(name, 'number', opts)

/** Texts of the arguments, ranges / datasets flattened. */
function texts(a: Value[], skipEmpty: boolean): string[] | ReturnType<typeof err> {
  const out: string[] = []
  let size = 0
  for (const v of a) {
    for (const c of isMulti(v) ? cellsOf(v) : [v]) {
      const t = toText(c as Value)
      if (isErr(t)) return t
      if (skipEmpty && t === '') continue
      size += t.length
      if (size > MAX_STRING) return err('#VALUE!', 'text longer than 32,000 characters')
      out.push(t)
    }
  }
  return out
}

const chars = (x: string) => Array.from(x)

export const textFunctions: FnSpec[] = [
  def('LEN', 'text', [TEXT('text')], 'Number of characters.', 'Anzahl der Zeichen.', '=LEN(A1)', (a) => {
    const t = s(a[0])
    return isErr(t) ? t : chars(t).length
  }, { keywords: 'LÄNGE length länge' }),
  def('LEFT', 'text', [TEXT('text'), NUMA('count', { optional: true })], 'The first characters of a text.', 'Die ersten Zeichen eines Textes.', '=LEFT(A1; 3)', (a) => {
    const t = s(a[0])
    const k = int(a[1], 1)
    if (isErr(t)) return t
    if (isErr(k)) return k
    return k < 0 ? err('#VALUE!') : chars(t).slice(0, k).join('')
  }, { keywords: 'LINKS' }),
  def('RIGHT', 'text', [TEXT('text'), NUMA('count', { optional: true })], 'The last characters of a text.', 'Die letzten Zeichen eines Textes.', '=RIGHT(A1; 2)', (a) => {
    const t = s(a[0])
    const k = int(a[1], 1)
    if (isErr(t)) return t
    if (isErr(k)) return k
    if (k < 0) return err('#VALUE!')
    const c = chars(t)
    return k === 0 ? '' : c.slice(Math.max(0, c.length - k)).join('')
  }, { keywords: 'RECHTS' }),
  def('MID', 'text', [TEXT('text'), NUMA('start'), NUMA('count')], 'Characters from the middle of a text (start at 1).', 'Zeichen aus der Mitte eines Textes (Start bei 1).', '=MID(A1; 2; 3)', (a) => {
    const t = s(a[0])
    const st = int(a[1])
    const k = int(a[2])
    if (isErr(t)) return t
    if (isErr(st)) return st
    if (isErr(k)) return k
    if (st < 1 || k < 0) return err('#VALUE!')
    return chars(t).slice(st - 1, st - 1 + k).join('')
  }, { keywords: 'TEIL substring' }),
  def('UPPER', 'text', [TEXT('text')], 'Text in capitals.', 'Text in Großbuchstaben.', '=UPPER(A1)', (a) => {
    const t = s(a[0])
    return isErr(t) ? t : t.toUpperCase()
  }, { keywords: 'GROSS uppercase großbuchstaben' }),
  def('LOWER', 'text', [TEXT('text')], 'Text in small letters.', 'Text in Kleinbuchstaben.', '=LOWER(A1)', (a) => {
    const t = s(a[0])
    return isErr(t) ? t : t.toLowerCase()
  }, { keywords: 'KLEIN lowercase kleinbuchstaben' }),
  def('PROPER', 'text', [TEXT('text')], 'Capitalises the first letter of each word.', 'Schreibt den ersten Buchstaben jedes Wortes groß.', '=PROPER("ada lovelace")', (a) => {
    const t = s(a[0])
    return isErr(t) ? t : t.toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (_m, p: string, c: string) => p + c.toUpperCase())
  }, { keywords: 'GROSS2 title case' }),
  def('TRIM', 'text', [TEXT('text')], 'Removes extra spaces (keeps single spaces between words).', 'Entfernt überzählige Leerzeichen (einzelne zwischen Wörtern bleiben).', '=TRIM(A1)', (a) => {
    const t = s(a[0])
    return isErr(t) ? t : t.replace(/ +/g, ' ').trim()
  }, { keywords: 'GLÄTTEN spaces leerzeichen' }),
  def('CONCAT', 'text', [TEXT('text1'), TEXT('text2', { optional: true, repeat: true })], 'Joins texts, cells and ranges.', 'Verbindet Texte, Zellen und Bereiche.', '=CONCAT(A1; " "; B1)', (a) => {
    const t = texts(a, false)
    return Array.isArray(t) ? t.join('') : t
  }, { keywords: 'TEXTKETTE VERKETTEN concatenate join verbinden' }),
  def('TEXTJOIN', 'text', [TEXT('delimiter'), arg('ignore_empty', 'bool'), TEXT('text1'), TEXT('text2', { optional: true, repeat: true })], 'Joins texts with a delimiter, optionally skipping empty ones.', 'Verbindet Texte mit Trennzeichen, leere optional übersprungen.', '=TEXTJOIN(", "; TRUE; A1:A5)', (a) => {
    const d = s(a[0])
    const skip = b(a[1])
    if (isErr(d)) return d
    if (isErr(skip)) return skip
    const t = texts(a.slice(2), skip)
    return Array.isArray(t) ? t.join(d) : t
  }, { keywords: 'TEXTVERKETTEN join delimiter trennzeichen' }),
  def('SUBSTITUTE', 'text', [TEXT('text'), TEXT('old'), TEXT('new'), NUMA('instance', { optional: true })], 'Replaces text (all occurrences, or only the n-th).', 'Ersetzt Text (alle Vorkommen oder nur das n-te).', '=SUBSTITUTE(A1; "-"; "/")', (a) => {
    const t = s(a[0])
    const o = s(a[1])
    const nw = s(a[2])
    if (isErr(t)) return t
    if (isErr(o)) return o
    if (isErr(nw)) return nw
    if (!o) return t
    if (a[3] === undefined) return t.split(o).join(nw)
    const k = int(a[3])
    if (isErr(k)) return k
    if (k < 1) return err('#VALUE!')
    let at = -1
    for (let i = 0; i < k; i++) {
      at = t.indexOf(o, at + 1)
      if (at < 0) return t
    }
    return t.slice(0, at) + nw + t.slice(at + o.length)
  }, { keywords: 'WECHSELN replace ersetzen' }),
  def('FIND', 'text', [TEXT('find'), TEXT('within'), NUMA('start', { optional: true })], 'Position of a text inside another (case-sensitive, from 1).', 'Position eines Textes in einem anderen (Groß-/Kleinschreibung beachtet, ab 1).', '=FIND("@"; A1)', (a) => {
    const f = s(a[0])
    const w = s(a[1])
    const st = int(a[2], 1)
    if (isErr(f)) return f
    if (isErr(w)) return w
    if (isErr(st)) return st
    if (st < 1 || st > w.length + 1) return err('#VALUE!')
    const i = w.indexOf(f, st - 1)
    return i < 0 ? err('#VALUE!', 'not found') : i + 1
  }, { keywords: 'FINDEN position' }),
  def('SEARCH', 'text', [TEXT('find'), TEXT('within'), NUMA('start', { optional: true })], 'Position of a text inside another (ignores case, wildcards * ?).', 'Position eines Textes in einem anderen (ohne Groß-/Kleinschreibung, Platzhalter * ?).', '=SEARCH("an*"; A1)', (a, ctx) => {
    const f = s(a[0])
    const w = s(a[1])
    const st = int(a[2], 1)
    if (isErr(f)) return f
    if (isErr(w)) return w
    if (isErr(st)) return st
    if (st < 1 || st > w.length + 1) return err('#VALUE!')
    const at = hasWildcard(f) ? globSearch(f, w, st - 1, ctx) : w.toLowerCase().indexOf(f.replace(/~([*?~])/g, '$1').toLowerCase(), st - 1)
    return at < 0 ? err('#VALUE!', 'not found') : at + 1
  }, { keywords: 'SUCHEN position' }),
  def('TEXT', 'text', [arg('value', 'number'), TEXT('format')], 'A number as text in a format ("0.00", "#,##0", "0%", "yyyy-mm-dd", "dd.mm.yyyy").', 'Eine Zahl als Text in einem Format ("0.00", "#,##0", "0%", "yyyy-mm-dd", "dd.mm.yyyy").', '=TEXT(A1; "yyyy-mm-dd")', (a, ctx) => {
    const code = s(a[1])
    if (isErr(code)) return code
    let v = a[0]
    if (isMulti(v)) {
      const c = [...cellsOf(v)]
      if (c.length !== 1) return err('#VALUE!')
      v = c[0]
    }
    if (isErr(v)) return v
    if (typeof v === 'string') {
      const x = parseNumeric(v)
      if (x !== null) v = x
    }
    return formatWithCode(v as never, code, ctx.lang)
  }, { keywords: 'format formatieren' }),
  def('VALUE', 'text', [TEXT('text')], 'Turns a numeric text into a number ("12%", "1.5", "2026-10-03").', 'Wandelt einen Zahlentext in eine Zahl um ("12%", "1.5", "2026-10-03").', '=VALUE("12%")', (a) => {
    const t = s(a[0])
    if (isErr(t)) return t
    const x = parseNumeric(t)
    return x === null ? err('#VALUE!', 'not a number') : x
  }, { keywords: 'WERT number zahl' }),
]
