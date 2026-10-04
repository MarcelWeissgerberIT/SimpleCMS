/**
 * Search over the manual: every query word is looked up in the title, keywords, summary and body of
 * the article in the UI language — and in the other language's title, keywords and body, so "Formel"
 * finds "Formulas" in an English UI and "share" finds "Freigabe-Links" in a German one. A word that
 * matches nothing exactly gets a fuzzy second chance (Fuse.js) on titles and keywords: "formla" still
 * finds "Formulas". Articles that match more of the words rank higher; filler words of a question
 * ("how do I …", "wie kann ich …") are ignored.
 */
import Fuse from 'fuse.js'
import { findArticle, type HelpArticle, type HelpLang, type HelpLibrary } from './library'

export type Range = [number, number]

export interface HelpHit {
  article: HelpArticle
  score: number
  titleRanges: Range[]
  snippet: { text: string; ranges: Range[] } | null
}

interface Entry {
  article: HelpArticle
  title: string
  keywords: string
  summary: string
  body: string
  /** the other language: title + keywords, and the body */
  alt: string
  altBody: string
}

/** Lower case without accents, one character per character (ranges stay valid in the original). */
function fold(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i].normalize('NFD')[0]
    const l = c.toLowerCase()
    out += l.length === 1 ? l : c
  }
  return out
}

const STOP = new Set(
  (
    'a an the to of in on for with and or how do does did i can could my is it its what why where when which who you your me be this that from at by as are was ' +
    'not no yes if into about there get use using want need make should would will one ' +
    'der die das den dem des ein eine einen einem einer und oder wie kann können ich mich mir mein meine meinen ist es was warum wo wann welche welcher ' +
    'wer du dich dir dein deine zu zum zur von mit im in auf für an am bei aus nicht kein keine ja wenn ob über man wird werden muss soll will gibt geht'
  ).split(' '),
)

const WORD = /[\p{L}\p{N}_]+(?:[-.][\p{L}\p{N}_]+)*/gu

/** Query → folded words: filler words dropped (unless that leaves nothing), duplicates removed. */
export function queryWords(q: string): string[] {
  const all = [...new Set((fold(q).match(WORD) ?? []).filter((w) => w.length >= 2 || /\d/.test(w)))]
  const kept = all.filter((w) => !STOP.has(w))
  return kept.length ? kept : all
}

const wordStart = (hay: string, w: string) => {
  let i = hay.indexOf(w)
  while (i >= 0) {
    if (i === 0 || !/[\p{L}\p{N}]/u.test(hay[i - 1])) return true
    i = hay.indexOf(w, i + 1)
  }
  return false
}

const count = (hay: string, w: string, cap: number) => {
  let n = 0
  for (let i = hay.indexOf(w); i >= 0 && n < cap; i = hay.indexOf(w, i + w.length)) n++
  return n
}

interface Index {
  entries: Entry[]
  fuse: Fuse<Entry>
}

const cache = new WeakMap<HelpLibrary, Partial<Record<HelpLang, Index>>>()

function indexOf(lib: HelpLibrary, lang: HelpLang): Index {
  let per = cache.get(lib)
  if (!per) cache.set(lib, (per = {}))
  if (per[lang]) return per[lang]
  const other: HelpLang = lang === 'de' ? 'en' : 'de'
  const entries = lib[lang].map((a): Entry => {
    const twin = lib[other].find((x) => x.id === a.id)
    return {
      article: a,
      title: fold(a.title),
      keywords: fold(a.keywords.join(' · ')),
      summary: fold(a.summary),
      body: fold(a.plain),
      alt: twin ? fold(`${twin.title} · ${twin.keywords.join(' · ')}`) : '',
      altBody: twin ? fold(twin.plain) : '',
    }
  })
  const fuse = new Fuse(entries, {
    keys: [
      { name: 'title', weight: 3 },
      { name: 'keywords', weight: 2 },
      { name: 'alt', weight: 1 },
    ],
    includeScore: true,
    ignoreLocation: true,
    threshold: 0.34,
    minMatchCharLength: 3,
  })
  return (per[lang] = { entries, fuse })
}

function wordScore(e: Entry, w: string): number {
  const scores = [
    wordStart(e.title, w) ? 12 : e.title.includes(w) ? 8 : 0,
    wordStart(e.keywords, w) ? 7 : e.keywords.includes(w) ? 5 : 0,
    e.summary.includes(w) ? 4 : 0,
    wordStart(e.alt, w) ? 5 : e.alt.includes(w) ? 3 : 0,
    Math.min(4, count(e.body, w, 4) * 1.2),
    e.altBody.includes(w) ? 1 : 0,
  ]
  const max = Math.max(...scores)
  const sum = scores.reduce((x, y) => x + y, 0)
  return max + 0.3 * (sum - max)
}

/** Ranges of the words in `text` (folded comparison, original positions). */
function rangesIn(text: string, words: string[]): Range[] {
  const hay = fold(text)
  const out: Range[] = []
  for (const w of words) {
    for (let i = hay.indexOf(w), n = 0; i >= 0 && n < 20; i = hay.indexOf(w, i + w.length), n++) out.push([i, i + w.length - 1])
  }
  out.sort((a, b) => a[0] - b[0])
  // merge overlaps
  const merged: Range[] = []
  for (const r of out) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1])
    else merged.push([...r])
  }
  return merged
}

function snippetOf(a: HelpArticle, words: string[]): HelpHit['snippet'] {
  const text = a.plain.replace(/\s+/g, ' ')
  const hay = fold(text)
  let at = -1
  for (const w of words) {
    const i = hay.indexOf(w)
    if (i >= 0 && (at < 0 || i < at)) at = i
  }
  if (at < 0) return null
  let from = Math.max(0, at - 48)
  let to = Math.min(text.length, at + 120)
  if (from > 0) from = text.indexOf(' ', from) + 1 || from
  if (to < text.length) to = text.lastIndexOf(' ', to) > at ? text.lastIndexOf(' ', to) : to
  const prefix = from > 0 ? '…' : ''
  const suffix = to < text.length ? '…' : ''
  const body = text.slice(from, to)
  const shown = prefix + body + suffix
  return { text: shown, ranges: rangesIn(body, words).map(([s, e]) => [s + prefix.length, e + prefix.length] as Range) }
}

/** Best matches first. `limit` caps the list (default 24). */
export function searchHelp(lib: HelpLibrary, lang: HelpLang, query: string, limit = 24): HelpHit[] {
  const words = queryWords(query)
  if (!words.length) return []
  const { entries, fuse } = indexOf(lib, lang)
  const phrase = fold(query.trim())
  const fuzzy = new Map<string, Map<Entry, number>>()
  const fuzzyFor = (w: string) => {
    let m = fuzzy.get(w)
    if (!m) {
      m = new Map()
      if (w.length >= 4) for (const r of fuse.search(w, { limit: 8 })) m.set(r.item, r.score ?? 1)
      fuzzy.set(w, m)
    }
    return m
  }
  const hits: HelpHit[] = []
  for (const e of entries) {
    let total = 0
    let matched = 0
    for (const w of words) {
      let s = wordScore(e, w)
      if (!s) {
        const f = fuzzyFor(w).get(e)
        if (f !== undefined) s = 5 * (1 - f)
      }
      if (s > 0) matched++
      total += s
    }
    if (!total) continue
    if (phrase.length >= 4 && words.length > 1 && e.title.includes(phrase)) total += 10
    const coverage = matched / words.length
    const score = total * (0.4 + 0.6 * coverage * coverage)
    hits.push({ article: e.article, score, titleRanges: rangesIn(e.article.title, words), snippet: snippetOf(e.article, words) })
  }
  hits.sort((a, b) => b.score - a.score || a.article.num.localeCompare(b.article.num, undefined, { numeric: true }))
  return hits.slice(0, limit)
}

/** The articles for Claude: the best matches, plus the article open in the panel (if any). */
export function articlesForQuestion(lib: HelpLibrary, lang: HelpLang, question: string, max = 6, current?: string): HelpArticle[] {
  const out = searchHelp(lib, lang, question, max).map((h) => h.article)
  if (current && !out.some((a) => a.id === current)) {
    const a = findArticle(lib, lang, current)
    if (a) out.splice(Math.min(out.length, max - 1), out.length >= max ? 1 : 0, a)
  }
  return out.slice(0, max)
}
