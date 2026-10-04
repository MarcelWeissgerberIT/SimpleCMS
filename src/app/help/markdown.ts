/**
 * Help articles — the one parser, shared by the in-app Help panel and the static /help/ pages built by
 * src/help-site (Node, at build time). Pure TypeScript: no DOM, no Node APIs, no app imports.
 *
 * An article is a Markdown file with front matter:
 *
 *   ---
 *   id: formulas                       (file name without .md; the same in every language)
 *   title: Formulas
 *   section: databases                 (a HELP_SECTIONS id, see sections.ts)
 *   order: 3                           (position in the section → "§ 03.3")
 *   keywords: formula, prop, if        (extra search terms)
 *   related: properties, spreadsheets  (article ids)
 *   summary: One line under the title.
 *   ---
 *
 * The body is a small Markdown subset: `## ` / `### ` headings, paragraphs, `- ` and `1. ` lists,
 * `> ` notes, fenced code; inline **bold**, *italic*, `code`, <kbd>Mod+K</kbd> and links — `help:<id>`
 * links point to another article.
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'b' | 'i'; c: Inline[] }
  | { t: 'code' | 'kbd'; v: string }
  | { t: 'link'; href: string; c: Inline[] }

export type Block =
  | { t: 'h2' | 'h3' | 'p' | 'note'; c: Inline[] }
  | { t: 'ul' | 'ol'; items: Inline[][] }
  | { t: 'pre'; v: string; lang: string }

export interface ArticleMeta {
  id: string
  title: string
  section: string
  order: number
  keywords: string[]
  related: string[]
  summary: string
}

export interface ParsedArticle extends ArticleMeta {
  blocks: Block[]
  /** body as plain text (search, Claude's context) */
  plain: string
  /** the Markdown body as written (Claude's context) */
  source: string
}

/* ------------------------------------------------------------------ */
/* Front matter                                                        */
/* ------------------------------------------------------------------ */

const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)

/** Split `---` front matter from the body. Unknown keys are ignored. */
export function parseFrontMatter(raw: string): { meta: Record<string, string>; body: string } {
  const src = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(src)
  if (!m) return { meta: {}, body: src }
  const meta: Record<string, string> = {}
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':')
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return { meta, body: src.slice(m[0].length) }
}

/** Parse one article file. `fallbackId`: the file name, used when the front matter has no id. */
export function parseArticle(raw: string, fallbackId = ''): ParsedArticle {
  const { meta, body } = parseFrontMatter(raw)
  const blocks = parseBlocks(body)
  return {
    id: meta.id || fallbackId,
    title: meta.title || fallbackId,
    section: meta.section || 'start',
    order: Number(meta.order) || 99,
    keywords: list(meta.keywords),
    related: list(meta.related),
    summary: meta.summary || '',
    blocks,
    plain: blocksToPlain(blocks),
    source: body.trim(),
  }
}

/* ------------------------------------------------------------------ */
/* Blocks                                                              */
/* ------------------------------------------------------------------ */

const UL = /^[-*] +/
const OL = /^\d+[.)] +/

export function parseBlocks(body: string): Block[] {
  const lines = body.replace(/\r\n?/g, '\n').split('\n')
  const out: Block[] = []
  let para: string[] = []
  let items: string[] | null = null
  let kind: 'ul' | 'ol' = 'ul'
  let note: string[] | null = null

  const flushPara = () => {
    if (para.length) out.push({ t: 'p', c: parseInline(para.join(' ')) })
    para = []
  }
  const flushList = () => {
    if (items) out.push({ t: kind, items: items.map((x) => parseInline(x)) })
    items = null
  }
  const flushNote = () => {
    if (note) out.push({ t: 'note', c: parseInline(note.join(' ')) })
    note = null
  }
  const flushAll = () => {
    flushPara()
    flushList()
    flushNote()
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (trimmed.startsWith('```')) {
      flushAll()
      const lang = trimmed.slice(3).trim()
      const code: string[] = []
      for (i++; i < lines.length && !lines[i].trim().startsWith('```'); i++) code.push(lines[i])
      out.push({ t: 'pre', v: code.join('\n'), lang })
      continue
    }
    if (!trimmed) {
      flushAll()
      continue
    }
    const h = /^(#{2,3}) +(.*)$/.exec(trimmed)
    if (h) {
      flushAll()
      out.push({ t: h[1].length === 2 ? 'h2' : 'h3', c: parseInline(h[2]) })
      continue
    }
    if (trimmed.startsWith('>')) {
      flushPara()
      flushList()
      note ??= []
      note.push(trimmed.replace(/^> ?/, ''))
      continue
    }
    const isUl = UL.test(trimmed)
    const isOl = OL.test(trimmed)
    if (isUl || isOl) {
      flushPara()
      flushNote()
      const k = isUl ? 'ul' : 'ol'
      if (items && kind !== k) flushList()
      kind = k
      items ??= []
      items.push(trimmed.replace(isUl ? UL : OL, ''))
      continue
    }
    // an indented line continues the list item above
    if (items && /^\s{2,}/.test(line)) {
      items[items.length - 1] += ` ${trimmed}`
      continue
    }
    if (note) {
      note.push(trimmed)
      continue
    }
    flushList()
    para.push(trimmed)
  }
  flushAll()
  return out
}

/* ------------------------------------------------------------------ */
/* Inline                                                              */
/* ------------------------------------------------------------------ */

/** **bold**, *italic*, `code`, <kbd>…</kbd>, [text](href) — no nesting of the same kind. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let text = ''
  const push = (node: Inline) => {
    if (text) out.push({ t: 'text', v: text })
    text = ''
    out.push(node)
  }
  let i = 0
  while (i < src.length) {
    const rest = src.slice(i)
    let m: RegExpExecArray | null
    if ((m = /^`([^`]+)`/.exec(rest))) {
      push({ t: 'code', v: m[1] })
      i += m[0].length
      continue
    }
    if ((m = /^<kbd>([^<]+)<\/kbd>/i.exec(rest))) {
      push({ t: 'kbd', v: m[1] })
      i += m[0].length
      continue
    }
    if ((m = /^\*\*(.+?)\*\*/.exec(rest))) {
      push({ t: 'b', c: parseInline(m[1]) })
      i += m[0].length
      continue
    }
    if ((m = /^\*([^*\s][^*]*?)\*/.exec(rest))) {
      push({ t: 'i', c: parseInline(m[1]) })
      i += m[0].length
      continue
    }
    if ((m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest))) {
      push({ t: 'link', href: m[2], c: parseInline(m[1]) })
      i += m[0].length
      continue
    }
    text += src[i]
    i++
  }
  if (text) out.push({ t: 'text', v: text })
  return out
}

/* ------------------------------------------------------------------ */
/* Plain text                                                          */
/* ------------------------------------------------------------------ */

export function inlineToPlain(nodes: Inline[]): string {
  return nodes.map((n) => ('v' in n ? n.v : inlineToPlain(n.c))).join('')
}

export function blocksToPlain(blocks: Block[]): string {
  return blocks
    .map((b) => ('v' in b ? b.v : 'items' in b ? b.items.map(inlineToPlain).join('\n') : inlineToPlain(b.c)))
    .join('\n')
}

/** Article id of a `help:<id>` link (null for anything else). */
export function helpLinkId(href: string): string | null {
  const m = /^help:([a-z0-9-]+)$/.exec(href)
  return m ? m[1] : null
}
