/**
 * Word (.docx) → TipTap JSON, here in the browser (fflate + DOMParser; no AI, nothing sent).
 *
 * Read from word/document.xml with its styles, numbering and links:
 *  - headings by style (built-in "heading 1–9" / "Title", custom styles based on them, outline levels) →
 *    `heading` 1–3 (deeper levels become 3); a leading "Title" paragraph becomes the page title
 *  - list paragraphs (numbering on the paragraph or its style) → nested bullet / ordered lists
 *  - tables → `table` (first row as header row; merged cells as colspan / empty continuation cells)
 *  - bold, italic, underline, strike, web / mail links, line breaks; content controls and tracked
 *    insertions are read through, deletions and field codes left out
 *  - pictures are not carried over (counted: the preview says so)
 *
 * Every block is checked against the editor schema; one that does not fit becomes a plain paragraph.
 */
import { InflateBudgetError, unzipBounded } from './zip'
import type { JSONContent } from '@tiptap/core'
import { docSchema } from '../../../editor'
import { FileLoadError } from './load'

const WANT = new Set(['word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/_rels/document.xml.rels'])
/** Unpacked XML at most (a zip bomb stops here). */
const XML_MAX = 80 * 1024 * 1024
const MAX_BLOCKS = 20_000

export interface DocxResult {
  doc: JSONContent
  /** the document's "Title" paragraph, when it starts with one */
  title: string | null
  /** pictures left out */
  images: number
}

interface StyleInfo {
  name: string
  basedOn: string | null
  outline: number | null
  num: { numId: string; ilvl: number } | null
}

interface Ctx {
  styles: Map<string, StyleInfo>
  /** numId → ordered per level */
  ordered: Map<string, Map<number, boolean>>
  links: Map<string, string>
  images: number
}

const kids = (el: Element | null | undefined): Element[] => (el ? Array.from(el.children) : [])
const child = (el: Element | null | undefined, name: string): Element | null => kids(el).find((c) => c.localName === name) ?? null
/** w:val (any prefix). */
const val = (el: Element | null | undefined): string | null => {
  if (!el) return null
  for (const a of Array.from(el.attributes)) if (a.localName === 'val') return a.value
  return null
}
const attr = (el: Element | null | undefined, local: string): string | null => {
  if (!el) return null
  for (const a of Array.from(el.attributes)) if (a.localName === local) return a.value
  return null
}
/** A toggle property (<w:b/>, <w:b w:val="0"/>). */
const on = (el: Element | null): boolean => !!el && !/^(0|false|off|none)$/i.test(val(el) ?? '')

function parseXml(bytes: Uint8Array | undefined): Document | null {
  if (!bytes) return null
  const doc = new DOMParser().parseFromString(new TextDecoder('utf-8').decode(bytes), 'application/xml')
  return doc.getElementsByTagName('parsererror').length ? null : doc
}

function readStyles(doc: Document | null): Map<string, StyleInfo> {
  const out = new Map<string, StyleInfo>()
  for (const s of Array.from(doc?.documentElement.children ?? [])) {
    if (s.localName !== 'style') continue
    const id = attr(s, 'styleId')
    if (!id) continue
    const pPr = child(s, 'pPr')
    const numPr = child(pPr, 'numPr')
    const numId = val(child(numPr, 'numId'))
    const outline = val(child(pPr, 'outlineLvl'))
    out.set(id, {
      name: (val(child(s, 'name')) ?? id).toLowerCase(),
      basedOn: val(child(s, 'basedOn')),
      outline: outline !== null && /^\d$/.test(outline) ? Number(outline) : null,
      num: numId && numId !== '0' ? { numId, ilvl: Number(val(child(numPr, 'ilvl')) ?? 0) } : null,
    })
  }
  return out
}

function readNumbering(doc: Document | null): Map<string, Map<number, boolean>> {
  const abstract = new Map<string, Map<number, boolean>>()
  const out = new Map<string, Map<number, boolean>>()
  const root = doc?.documentElement
  for (const a of kids(root)) {
    if (a.localName !== 'abstractNum') continue
    const levels = new Map<number, boolean>()
    for (const lvl of kids(a)) {
      if (lvl.localName !== 'lvl') continue
      const fmt = val(child(lvl, 'numFmt')) ?? 'bullet'
      levels.set(Number(attr(lvl, 'ilvl') ?? 0), fmt !== 'bullet' && fmt !== 'none')
    }
    abstract.set(attr(a, 'abstractNumId') ?? '', levels)
  }
  for (const n of kids(root)) {
    if (n.localName !== 'num') continue
    const levels = abstract.get(val(child(n, 'abstractNumId')) ?? '')
    if (levels) out.set(attr(n, 'numId') ?? '', levels)
  }
  return out
}

function readLinks(doc: Document | null): Map<string, string> {
  const out = new Map<string, string>()
  for (const r of kids(doc?.documentElement)) {
    const id = attr(r, 'Id')
    const target = attr(r, 'Target') ?? ''
    if (id && /hyperlink$/i.test(attr(r, 'Type') ?? '') && /^(https?:|mailto:)/i.test(target.trim())) out.set(id, target.trim())
  }
  return out
}

/** The heading level of a style (1–9), following "based on" a few steps; 0 = none. Title → 1. */
function headingOf(ctx: Ctx, styleId: string | null, depth = 0): number {
  const s = styleId ? ctx.styles.get(styleId) : undefined
  if (!s || depth > 6) return 0
  const m = s.name.match(/^heading\s*(\d)$/)
  if (m) return Number(m[1])
  if (s.name === 'title') return 1
  if (s.outline !== null && s.outline < 9) return s.outline + 1
  return headingOf(ctx, s.basedOn, depth + 1)
}

const isTitleStyle = (ctx: Ctx, styleId: string | null) => !!styleId && ctx.styles.get(styleId)?.name === 'title'

function numOf(ctx: Ctx, styleId: string | null, depth = 0): StyleInfo['num'] {
  const s = styleId ? ctx.styles.get(styleId) : undefined
  if (!s || depth > 6) return null
  return s.num ?? numOf(ctx, s.basedOn, depth + 1)
}

/* ------------------------------------------------------------------ */
/* Inline content                                                       */
/* ------------------------------------------------------------------ */

type Mark = { type: string; attrs?: Record<string, unknown> }

function runMarks(rPr: Element | null, link: string | null): Mark[] {
  const marks: Mark[] = []
  if (on(child(rPr, 'b'))) marks.push({ type: 'bold' })
  if (on(child(rPr, 'i'))) marks.push({ type: 'italic' })
  const u = child(rPr, 'u')
  if (u && !/^none$/i.test(val(u) ?? 'single')) marks.push({ type: 'underline' })
  if (on(child(rPr, 'strike')) || on(child(rPr, 'dstrike'))) marks.push({ type: 'strike' })
  if (link) marks.push({ type: 'link', attrs: { href: link } })
  return marks
}

const sameMarks = (a: Mark[] | undefined, b: Mark[] | undefined) => JSON.stringify(a ?? []) === JSON.stringify(b ?? [])

function pushText(out: JSONContent[], text: string, marks: Mark[]) {
  if (!text) return
  const last = out[out.length - 1]
  if (last?.type === 'text' && sameMarks(last.marks as Mark[], marks)) last.text = `${last.text}${text}`
  else out.push({ type: 'text', text, ...(marks.length ? { marks } : {}) })
}

function inlines(ctx: Ctx, el: Element, out: JSONContent[], link: string | null = null) {
  for (const c of kids(el)) {
    switch (c.localName) {
      case 'r': {
        const marks = runMarks(child(c, 'rPr'), link)
        for (const x of kids(c)) {
          if (x.localName === 't') pushText(out, x.textContent ?? '', marks)
          else if (x.localName === 'tab' || x.localName === 'ptab') pushText(out, ' ', marks)
          else if (x.localName === 'noBreakHyphen') pushText(out, '‑', marks)
          else if ((x.localName === 'br' && attr(x, 'type') !== 'page') || x.localName === 'cr') out.push({ type: 'hardBreak' })
          else if (x.localName === 'drawing' || x.localName === 'pict' || x.localName === 'object') ctx.images++
        }
        break
      }
      case 'hyperlink': {
        const id = attr(c, 'id')
        inlines(ctx, c, out, (id && ctx.links.get(id)) || link)
        break
      }
      case 'ins':
      case 'smartTag':
      case 'customXml':
      case 'fldSimple':
        inlines(ctx, c, out, link)
        break
      case 'sdt':
        inlines(ctx, child(c, 'sdtContent') ?? c, out, link)
        break
      default:
        break
    }
  }
}

/** A paragraph's inline content, edges trimmed (hard breaks at the ends dropped). */
function paragraphContent(ctx: Ctx, p: Element): JSONContent[] {
  const out: JSONContent[] = []
  inlines(ctx, p, out)
  while (out[0]?.type === 'hardBreak') out.shift()
  while (out[out.length - 1]?.type === 'hardBreak') out.pop()
  const first = out[0]
  if (first?.type === 'text') first.text = first.text!.replace(/^\s+/, '')
  const last = out[out.length - 1]
  if (last?.type === 'text') last.text = last.text!.replace(/\s+$/, '')
  return out.filter((n) => n.type !== 'text' || n.text)
}

const para = (content: JSONContent[]): JSONContent => (content.length ? { type: 'paragraph', content } : { type: 'paragraph' })
const plainOf = (content: JSONContent[]) => content.map((n) => (n.type === 'text' ? n.text : ' ')).join('').trim()

/* ------------------------------------------------------------------ */
/* Blocks                                                               */
/* ------------------------------------------------------------------ */

interface ListPara {
  ordered: boolean
  level: number
  content: JSONContent[]
}

/** Consecutive list paragraphs → nested lists (a change of kind at the outer level starts a new list). */
function buildLists(items: ListPara[]): JSONContent[] {
  const out: JSONContent[] = []
  let i = 0
  const nest = (level: number): JSONContent => {
    const ordered = items[i].ordered
    const list: JSONContent = { type: ordered ? 'orderedList' : 'bulletList', content: [] }
    while (i < items.length && items[i].level >= level) {
      const it = items[i]
      if (it.level > level) {
        let last = list.content![list.content!.length - 1]
        if (!last) {
          last = { type: 'listItem', content: [{ type: 'paragraph' }] }
          list.content!.push(last)
        }
        last.content!.push(nest(it.level))
        continue
      }
      if (it.ordered !== ordered && list.content!.length) break
      list.content!.push({ type: 'listItem', content: [para(it.content)] })
      i++
    }
    return list
  }
  while (i < items.length) {
    const min = Math.min(...items.slice(i).map((x) => x.level))
    out.push(nest(Math.min(items[i].level, min)))
  }
  return out
}

function tableBlock(ctx: Ctx, tbl: Element): JSONContent | null {
  const rows = kids(tbl).filter((r) => r.localName === 'tr')
  if (!rows.length) return null
  const grid: Array<Array<{ text: JSONContent[]; span: number }>> = rows.map((tr) =>
    kids(tr)
      .flatMap((c) => (c.localName === 'sdt' ? kids(child(c, 'sdtContent')) : [c]))
      .filter((tc) => tc.localName === 'tc')
      .map((tc) => {
        const tcPr = child(tc, 'tcPr')
        const span = Math.max(1, Math.min(20, Number(val(child(tcPr, 'gridSpan')) ?? 1) || 1))
        const vMerge = child(tcPr, 'vMerge')
        // a continuation of a vertically merged cell stays empty
        if (vMerge && (val(vMerge) ?? 'continue') === 'continue') return { text: [], span }
        const lines: JSONContent[] = []
        for (const p of kids(tc).filter((x) => x.localName === 'p' || x.localName === 'tbl')) {
          const content = p.localName === 'p' ? paragraphContent(ctx, p) : [{ type: 'text', text: (p.textContent ?? '').replace(/\s+/g, ' ').trim() }].filter((n) => n.text)
          if (!content.length) continue
          if (lines.length) lines.push({ type: 'hardBreak' })
          lines.push(...content)
        }
        return { text: lines, span }
      }),
  )
  const width = Math.max(1, ...grid.map((r) => r.reduce((n, c) => n + c.span, 0)))
  const header = grid.length > 1
  return {
    type: 'table',
    content: grid.map((cells, ri) => {
      const type = header && ri === 0 ? 'tableHeader' : 'tableCell'
      const used = cells.reduce((n, c) => n + c.span, 0)
      const row = cells.map((c) => ({ type, attrs: { colspan: c.span, rowspan: 1 }, content: [para(c.text)] }))
      for (let k = used; k < width; k++) row.push({ type, attrs: { colspan: 1, rowspan: 1 }, content: [para([])] })
      return { type: 'tableRow', content: row.length ? row : [{ type, attrs: { colspan: 1, rowspan: 1 }, content: [para([])] }] }
    }),
  }
}

function bodyBlocks(ctx: Ctx, container: Element, out: JSONContent[], list: ListPara[]) {
  const flush = () => {
    if (list.length) out.push(...buildLists(list.splice(0)))
  }
  for (const el of kids(container)) {
    if (out.length > MAX_BLOCKS) break
    if (el.localName === 'p') {
      const pPr = child(el, 'pPr')
      const styleId = val(child(pPr, 'pStyle'))
      const content = paragraphContent(ctx, el)
      const numPr = child(pPr, 'numPr')
      const numId = val(child(numPr, 'numId'))
      const num = numId ? (numId === '0' ? null : { numId, ilvl: Number(val(child(numPr, 'ilvl')) ?? 0) }) : numOf(ctx, styleId)
      const level = headingOf(ctx, styleId)
      if (num && !level && content.length) {
        list.push({ ordered: ctx.ordered.get(num.numId)?.get(num.ilvl) ?? false, level: Math.max(0, Math.min(8, num.ilvl)), content })
        continue
      }
      flush()
      if (!content.length) continue
      if (level) out.push({ type: 'heading', attrs: { level: Math.min(3, level), ...(isTitleStyle(ctx, styleId) ? { title: true } : {}) }, content })
      else out.push(para(content))
    } else if (el.localName === 'tbl') {
      flush()
      const tb = tableBlock(ctx, el)
      if (tb) out.push(tb)
    } else if (el.localName === 'sdt') {
      bodyBlocks(ctx, child(el, 'sdtContent') ?? el, out, list)
    } else if (el.localName === 'ins' || el.localName === 'customXml') {
      bodyBlocks(ctx, el, out, list)
    }
  }
}

/** A block the schema takes as it is; else its text as a paragraph (null: nothing left). */
function checked(block: JSONContent): JSONContent | null {
  try {
    docSchema().nodeFromJSON(block).check()
    return block
  } catch {
    const text = JSON.stringify(block).match(/"text":"((?:[^"\\]|\\.)*)"/g)?.map((m) => JSON.parse(m.slice(7)) as string).join(' ').trim()
    return text ? { type: 'paragraph', content: [{ type: 'text', text }] } : null
  }
}

/** The page of a .docx. Throws FileLoadError('unreadable') for anything that is not one. */
export function docxToDoc(bytes: Uint8Array): DocxResult {
  let files: Record<string, Uint8Array>
  try {
    // counted as they inflate: the sizes in the zip's headers are the file maker's word
    files = unzipBounded(bytes, (name) => WANT.has(name), XML_MAX)
  } catch (e) {
    if (e instanceof InflateBudgetError) throw new FileLoadError({ issue: 'too_large', bytes: e.bytes, max: XML_MAX })
    throw new FileLoadError('unreadable', 'not a zip')
  }
  const main = parseXml(files['word/document.xml'])
  const body = main ? Array.from(main.documentElement.children).find((c) => c.localName === 'body') : null
  if (!body) throw new FileLoadError('unreadable', 'no word/document.xml')
  const ctx: Ctx = {
    styles: readStyles(parseXml(files['word/styles.xml'])),
    ordered: readNumbering(parseXml(files['word/numbering.xml'])),
    links: readLinks(parseXml(files['word/_rels/document.xml.rels'])),
    images: 0,
  }
  const raw: JSONContent[] = []
  const list: ListPara[] = []
  bodyBlocks(ctx, body, raw, list)
  if (list.length) raw.push(...buildLists(list))
  // a "Title" paragraph on top is the page's title
  let title: string | null = null
  if (raw[0]?.type === 'heading' && raw[0].attrs?.title) title = plainOf(raw.shift()!.content ?? []) || null
  const content = raw
    .map((b) => {
      if (b.type === 'heading' && b.attrs) b.attrs = { level: b.attrs.level }
      return checked(b)
    })
    .filter((b): b is JSONContent => !!b)
  return { doc: { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }, title, images: ctx.images }
}
