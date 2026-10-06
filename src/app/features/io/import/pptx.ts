/**
 * PowerPoint (.pptx) → slides, here in the browser (fflate + DOMParser; nothing leaves the device).
 *
 * Read from ppt/presentation.xml (the slide order through its relationships) and each slide with its rels:
 *  - the title (title / ctrTitle placeholder), text frames → paragraphs; bulleted body placeholders and
 *    bullet paragraphs → nested bullet / numbered lists by level (a:pPr lvl); bold, italic, underline,
 *    strike, web links, line breaks. Footer, date and slide-number placeholders are left out.
 *  - tables → `table` (the first row as header row when the table says so; spans as colspan)
 *  - pictures (ppt/media through the slide's rels) → `image` blocks whose src is the media path inside the
 *    file — the caller stores the files (`media`). EMF / WMF / TIFF cannot be shown in a browser: counted.
 *  - charts → their cached data as a table, SmartArt → its text as a list (both counted as converted);
 *    video, audio and embedded objects → counted as left out
 *  - speaker notes (the notes slide's body) → `notes` blocks
 *  - the theme's colours and fonts, the master's title / body sizes, the title in docProps/core.xml
 * Shapes are read top to bottom, left to right when every one has a position (placeholders take theirs
 * from the slide layout), else in the file's order.
 *
 * Zip-bomb guard: at most PPTX_MAX_BYTES unpacked (declared sizes — fflate never inflates past them), at
 * most PPTX_MAX_SLIDES slides.
 */
import { unzipSync } from 'fflate'
import type { JSONContent } from '@tiptap/core'
import { basename, dirname, extname, normPath } from './plan'

/** Unpacked bytes at most (XML + the pictures that are used). */
export const PPTX_MAX_BYTES = 200 * 1024 * 1024
export const PPTX_MAX_SLIDES = 300

export type PptxIssue = 'unreadable' | 'too_large' | 'slides' | 'empty'

export class PptxError extends Error {
  issue: PptxIssue
  /** unpacked bytes (too_large) / slides (slides) */
  count?: number
  constructor(issue: PptxIssue, count?: number) {
    super(count !== undefined ? `${issue}: ${count}` : issue)
    this.name = 'PptxError'
    this.issue = issue
    this.count = count
  }
}

/** What did not come over 1:1: a chart (→ table), SmartArt (→ list), video / audio, an embedded object, a picture format browsers cannot show. */
export type PptxLost = 'chart' | 'smartart' | 'media' | 'ole' | 'picture'

export interface PptxSlide {
  /** 1-based, in the deck's order */
  no: number
  /** the title placeholder's text ('' = none) */
  title: string
  /** a title slide (ctrTitle placeholder or the "title" layout) */
  titleSlide: boolean
  hidden: boolean
  /** the content (images: src = the media path inside the file) */
  blocks: JSONContent[]
  /** the speaker notes */
  notes: JSONContent[]
  images: number
  tables: number
  lost: PptxLost[]
}

export interface PptxColor {
  /** clrScheme slot: dk1, lt1, dk2, lt2, accent1 … accent6, hlink, folHlink */
  slot: string
  /** #rrggbb (lower case) */
  hex: string
}

export interface PptxTheme {
  name: string
  colors: PptxColor[]
  /** headings / body typefaces */
  major: string | null
  minor: string | null
  /** the master's sizes in pt: title, body levels 1–3 */
  titleSize: number | null
  bodySizes: number[]
}

export interface PptxDeck {
  /** docProps/core.xml title ('' = none) */
  title: string
  slides: PptxSlide[]
  /** media path → bytes (only the pictures the slides show) */
  media: Map<string, Uint8Array>
  theme: PptxTheme | null
}

/** Words the reader puts into the content (chart tables). */
export interface PptxLabels {
  category: string
  chart: (title: string) => string
  chartLost: string
}

const DEFAULT_LABELS: PptxLabels = { category: 'Category', chart: (title) => (title ? `Chart: ${title}` : 'Chart'), chartLost: 'A chart without data — not carried over.' }

/* ------------------------------------------------------------------ */
/* XML                                                                  */
/* ------------------------------------------------------------------ */

const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

const kids = (el: Element | null | undefined): Element[] => (el ? Array.from(el.children) : [])
const child = (el: Element | null | undefined, name: string): Element | null => kids(el).find((c) => c.localName === name) ?? null
const path = (el: Element | null | undefined, ...names: string[]): Element | null => names.reduce<Element | null | undefined>((e, n) => child(e, n), el) ?? null
/** An attribute by its local name (no namespace — `id` and `r:id` differ). */
const attr = (el: Element | null | undefined, local: string): string | null => {
  if (!el) return null
  for (const a of Array.from(el.attributes)) if (a.localName === local && !a.namespaceURI) return a.value
  return null
}
/** A relationship reference attribute (r:id, r:embed, r:link, r:dm …). */
const relAttr = (el: Element | null | undefined, local: string): string | null => {
  if (!el) return null
  for (const a of Array.from(el.attributes)) if (a.localName === local && (a.namespaceURI === REL_NS || a.prefix === 'r')) return a.value
  return null
}
/** Every descendant with this local name. */
const all = (el: Element | Document | null | undefined, local: string): Element[] => (el ? Array.from(el.getElementsByTagName('*')).filter((e) => e.localName === local) : [])

function parseXml(bytes: Uint8Array | undefined): Document | null {
  if (!bytes) return null
  const doc = new DOMParser().parseFromString(new TextDecoder('utf-8').decode(bytes), 'application/xml')
  return doc.getElementsByTagName('parsererror').length ? null : doc
}

interface Rel {
  type: string
  target: string
  external: boolean
}

/* ------------------------------------------------------------------ */
/* The archive                                                          */
/* ------------------------------------------------------------------ */

/** name → declared unpacked size (nothing is inflated). */
function listZip(bytes: Uint8Array): Map<string, number> {
  const out = new Map<string, number>()
  try {
    unzipSync(bytes, {
      filter: (f) => {
        out.set(f.name, f.originalSize)
        return false
      },
    })
  } catch {
    throw new PptxError('unreadable')
  }
  return out
}

class Archive {
  private files = new Map<string, Uint8Array>()
  private used = 0
  constructor(
    private bytes: Uint8Array,
    readonly names: Map<string, number>,
  ) {}

  /** Inflate these entries (once each), within the budget. */
  load(paths: Iterable<string>) {
    const want = new Set([...paths].filter((p) => this.names.has(p) && !this.files.has(p)))
    if (!want.size) return
    let got: Record<string, Uint8Array>
    try {
      got = unzipSync(this.bytes, {
        filter: (f) => {
          if (!want.has(f.name)) return false
          this.used += f.originalSize
          if (this.used > PPTX_MAX_BYTES) throw new PptxError('too_large', this.used)
          return true
        },
      })
    } catch (e) {
      if (e instanceof PptxError) throw e
      throw new PptxError('unreadable')
    }
    for (const [k, v] of Object.entries(got)) this.files.set(k, v)
  }

  get(p: string): Uint8Array | undefined {
    return this.files.get(p)
  }

  xml(p: string): Document | null {
    this.load([p])
    return parseXml(this.files.get(p))
  }

  /** The relationships of a part (targets resolved to archive paths). */
  rels(part: string): Map<string, Rel> {
    const out = new Map<string, Rel>()
    const doc = this.xml(`${dirname(part) ? `${dirname(part)}/` : ''}_rels/${basename(part)}.rels`)
    for (const r of kids(doc?.documentElement)) {
      const id = attr(r, 'Id')
      const target = attr(r, 'Target') ?? ''
      if (!id || !target) continue
      const external = /^external$/i.test(attr(r, 'TargetMode') ?? '')
      out.set(id, { type: attr(r, 'Type') ?? '', target: external ? target.trim() : normPath(target.startsWith('/') ? target : `${dirname(part)}/${target}`), external })
    }
    return out
  }
}

const relOfType = (rels: Map<string, Rel>, suffix: string): Rel | undefined => [...rels.values()].find((r) => r.type.endsWith(suffix))

/* ------------------------------------------------------------------ */
/* Text                                                                 */
/* ------------------------------------------------------------------ */

type Mark = { type: string; attrs?: Record<string, unknown> }

const SAFE_LINK = /^(https?:|mailto:)/i
const on = (v: string | null) => v === '1' || v === 'true'

function runMarks(rPr: Element | null, rels: Map<string, Rel>): Mark[] {
  const marks: Mark[] = []
  if (on(attr(rPr, 'b'))) marks.push({ type: 'bold' })
  if (on(attr(rPr, 'i'))) marks.push({ type: 'italic' })
  const u = attr(rPr, 'u')
  if (u && u !== 'none') marks.push({ type: 'underline' })
  const strike = attr(rPr, 'strike')
  if (strike && strike !== 'noStrike') marks.push({ type: 'strike' })
  const link = rels.get(relAttr(child(rPr, 'hlinkClick'), 'id') ?? '')
  if (link?.external && SAFE_LINK.test(link.target)) marks.push({ type: 'link', attrs: { href: link.target } })
  return marks
}

const sameMarks = (a: unknown, b: Mark[]) => JSON.stringify(a ?? []) === JSON.stringify(b)

function pushText(out: JSONContent[], text: string, marks: Mark[]) {
  const clean = text.replace(/[\u0000-\u0008\u000e-\u001f]/g, '')
  if (!clean) return
  // a vertical tab is PowerPoint's soft line break inside a run
  clean.split('\u000b').forEach((part, i) => {
    if (i) out.push({ type: 'hardBreak' })
    if (!part) return
    const last = out[out.length - 1]
    if (last?.type === 'text' && sameMarks(last.marks, marks)) last.text = `${last.text}${part}`
    else out.push({ type: 'text', text: part, ...(marks.length ? { marks } : {}) })
  })
}

/** A paragraph's inline content, edges trimmed. */
function inlineOf(p: Element, rels: Map<string, Rel>): JSONContent[] {
  const out: JSONContent[] = []
  for (const c of kids(p)) {
    if (c.localName === 'r' || c.localName === 'fld') pushText(out, child(c, 't')?.textContent ?? '', runMarks(child(c, 'rPr'), rels))
    else if (c.localName === 'br') out.push({ type: 'hardBreak' })
  }
  while (out[0]?.type === 'hardBreak') out.shift()
  while (out[out.length - 1]?.type === 'hardBreak') out.pop()
  const first = out[0]
  if (first?.type === 'text') first.text = first.text!.replace(/^\s+/, '')
  const last = out[out.length - 1]
  if (last?.type === 'text') last.text = last.text!.replace(/\s+$/, '')
  return out.filter((n) => n.type !== 'text' || n.text)
}

const plainOf = (content: JSONContent[]) =>
  content
    .map((n) => (n.type === 'text' ? n.text : ' '))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()

interface Para {
  content: JSONContent[]
  level: number
  list: 'bullet' | 'ordered' | null
}

/** The paragraphs of a text body; `bulleted`: a body placeholder (bullets unless a paragraph says none). */
function parasOf(txBody: Element | null, rels: Map<string, Rel>, bulleted: boolean): Para[] {
  return kids(txBody)
    .filter((p) => p.localName === 'p')
    .map((p) => {
      const pPr = child(p, 'pPr')
      const level = Math.max(0, Math.min(8, Number(attr(pPr, 'lvl') ?? 0) || 0))
      const list = child(pPr, 'buAutoNum') ? 'ordered' : child(pPr, 'buChar') || child(pPr, 'buBlip') ? 'bullet' : child(pPr, 'buNone') ? null : bulleted ? 'bullet' : null
      return { content: inlineOf(p, rels), level, list } as Para
    })
}

const para = (content: JSONContent[]): JSONContent => (content.length ? { type: 'paragraph', content } : { type: 'paragraph' })

/** Consecutive list paragraphs → nested lists (a change of kind at the outer level starts a new list). */
function buildLists(items: Para[]): JSONContent[] {
  const out: JSONContent[] = []
  let i = 0
  const nest = (level: number): JSONContent => {
    const ordered = items[i].list === 'ordered'
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
      if ((it.list === 'ordered') !== ordered && list.content!.length) break
      list.content!.push({ type: 'listItem', content: [para(it.content)] })
      i++
    }
    return list
  }
  while (i < items.length) out.push(nest(Math.min(...items.slice(i).map((x) => x.level))))
  return out
}

/** Paragraphs → blocks (empty paragraphs drop out; they end a list). */
function blocksOf(paras: Para[]): JSONContent[] {
  const out: JSONContent[] = []
  let list: Para[] = []
  const flush = () => {
    if (list.length) out.push(...buildLists(list))
    list = []
  }
  for (const p of paras) {
    if (!p.content.length) {
      flush()
      continue
    }
    if (p.list) list.push(p)
    else {
      flush()
      out.push(para(p.content))
    }
  }
  flush()
  return out
}

/* ------------------------------------------------------------------ */
/* Tables, charts, SmartArt                                             */
/* ------------------------------------------------------------------ */

function tableOf(tbl: Element, rels: Map<string, Rel>): JSONContent | null {
  const header = on(attr(child(tbl, 'tblPr'), 'firstRow'))
  const grid = kids(tbl)
    .filter((r) => r.localName === 'tr')
    .map((tr) =>
      kids(tr)
        .filter((tc) => tc.localName === 'tc' && !on(attr(tc, 'hMerge')))
        .map((tc) => {
          const span = Math.max(1, Math.min(20, Number(attr(tc, 'gridSpan') ?? 1) || 1))
          // a continuation of a vertically merged cell stays empty
          if (on(attr(tc, 'vMerge'))) return { text: [] as JSONContent[], span }
          const lines: JSONContent[] = []
          for (const p of parasOf(child(tc, 'txBody'), rels, false)) {
            if (!p.content.length) continue
            if (lines.length) lines.push({ type: 'hardBreak' })
            lines.push(...p.content)
          }
          return { text: lines, span }
        }),
    )
    .filter((r) => r.length)
  if (!grid.length) return null
  const width = Math.max(1, ...grid.map((r) => r.reduce((n, c) => n + c.span, 0)))
  return {
    type: 'table',
    content: grid.map((cells, ri) => {
      const type = header && ri === 0 && grid.length > 1 ? 'tableHeader' : 'tableCell'
      const used = cells.reduce((n, c) => n + c.span, 0)
      const row = cells.map((c) => ({ type, attrs: { colspan: c.span, rowspan: 1 }, content: [para(c.text)] }))
      for (let k = used; k < width; k++) row.push({ type, attrs: { colspan: 1, rowspan: 1 }, content: [para([])] })
      return { type: 'tableRow', content: row }
    }),
  }
}

const cellPara = (s: string): JSONContent => para(s ? [{ type: 'text', text: s }] : [])

/** A chart's cached data → a caption line + a table (categories down, series across). */
function chartBlocks(doc: Document | null, labels: PptxLabels): JSONContent[] {
  const root = doc?.documentElement
  const titleEl = all(root, 'title').find((e) => e.parentElement?.localName === 'chart')
  const title = titleEl ? all(titleEl, 't').map((x) => x.textContent ?? '').join('').replace(/\s+/g, ' ').trim() : ''
  const points = (el: Element | null): Map<number, string> => {
    const m = new Map<number, string>()
    for (const pt of all(el, 'pt')) {
      const idx = Number(attr(pt, 'idx'))
      if (Number.isFinite(idx) && idx >= 0 && idx < 500) m.set(idx, (child(pt, 'v')?.textContent ?? '').trim())
    }
    return m
  }
  const series = all(root, 'ser')
    .slice(0, 12)
    .map((ser, i) => ({
      name: all(child(ser, 'tx'), 'v')[0]?.textContent?.trim() || all(child(ser, 'tx'), 't').map((x) => x.textContent).join('').trim() || `${i + 1}`,
      cats: points(child(ser, 'cat') ?? child(ser, 'xVal')),
      vals: points(child(ser, 'val') ?? child(ser, 'yVal')),
    }))
    .filter((s) => s.vals.size)
  const line: JSONContent = { type: 'paragraph', content: [{ type: 'text', text: labels.chart(title), marks: [{ type: 'italic' }] }] }
  if (!series.length) return [line, cellPara(labels.chartLost)]
  const n = Math.max(...series.map((s) => Math.max(s.vals.size ? Math.max(...s.vals.keys()) + 1 : 0, s.cats.size ? Math.max(...s.cats.keys()) + 1 : 0)))
  const cats = series.find((s) => s.cats.size)?.cats ?? new Map<number, string>()
  const head = { type: 'tableRow', content: [labels.category, ...series.map((s) => s.name)].map((h) => ({ type: 'tableHeader', attrs: { colspan: 1, rowspan: 1 }, content: [cellPara(h)] })) }
  const rows = Array.from({ length: Math.min(n, 200) }, (_, r) => ({
    type: 'tableRow',
    content: [cats.get(r) ?? String(r + 1), ...series.map((s) => s.vals.get(r) ?? '')].map((v) => ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [cellPara(v)] })),
  }))
  return [line, { type: 'table', content: [head, ...rows] }]
}

/** SmartArt: the text of its nodes as a list. */
function smartArtBlocks(doc: Document | null): JSONContent[] {
  const texts: string[] = []
  for (const pt of all(doc?.documentElement, 'pt')) {
    const type = attr(pt, 'type')
    if (type && type !== 'node') continue
    const text = all(child(pt, 't'), 't')
      .map((x) => x.textContent ?? '')
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
    if (text && texts.length < 100) texts.push(text)
  }
  if (!texts.length) return []
  return [{ type: 'bulletList', content: texts.map((x) => ({ type: 'listItem', content: [cellPara(x)] })) }]
}

/* ------------------------------------------------------------------ */
/* Slides                                                               */
/* ------------------------------------------------------------------ */

const SKIP_PH = new Set(['dt', 'ftr', 'sldNum', 'hdr', 'sldImg'])
const TITLE_PH = new Set(['title', 'ctrTitle', 'vertTitle'])
const SHOWN = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'])

interface Item {
  y: number | null
  x: number | null
  blocks: JSONContent[]
}

interface Ph {
  type: string
  idx: string | null
}

const phOf = (nvPr: Element | null): Ph | null => {
  const ph = child(nvPr, 'ph')
  return ph ? { type: attr(ph, 'type') ?? 'obj', idx: attr(ph, 'idx') } : null
}

const offOf = (xfrm: Element | null): { x: number; y: number } | null => {
  const off = child(xfrm, 'off')
  const x = Number(attr(off, 'x'))
  const y = Number(attr(off, 'y'))
  return off && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
}

interface SlideCtx {
  arc: Archive
  part: string
  rels: Map<string, Rel>
  labels: PptxLabels
  /** the layout's placeholder positions (by idx, then by type) */
  layout: Map<string, { x: number; y: number }>
  layoutType: string | null
  media: Set<string>
  slide: Omit<PptxSlide, 'no' | 'hidden' | 'notes'>
}

function layoutPositions(doc: Document | null): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>()
  for (const sp of all(doc?.documentElement, 'sp')) {
    const ph = phOf(path(sp, 'nvSpPr', 'nvPr'))
    const pos = offOf(path(sp, 'spPr', 'xfrm'))
    if (!ph || !pos) continue
    if (ph.idx && !out.has(`idx:${ph.idx}`)) out.set(`idx:${ph.idx}`, pos)
    if (!out.has(`type:${ph.type}`)) out.set(`type:${ph.type}`, pos)
  }
  return out
}

function imageBlock(ctx: SlideCtx, blip: Element | null, alt: string): JSONContent | null {
  const rel = ctx.rels.get(relAttr(blip, 'embed') ?? '')
  if (!rel || rel.external || !ctx.arc.names.has(rel.target)) return null
  if (!SHOWN.has(extname(rel.target))) {
    ctx.slide.lost.push('picture')
    return null
  }
  ctx.media.add(rel.target)
  ctx.slide.images++
  return { type: 'image', attrs: { src: rel.target, alt: alt.slice(0, 500) } }
}

function shapeItems(ctx: SlideCtx, el: Element, out: Item[], at?: { x: number; y: number } | null) {
  for (const s of kids(el)) {
    switch (s.localName) {
      case 'sp': {
        const nvPr = path(s, 'nvSpPr', 'nvPr')
        const ph = phOf(nvPr)
        if (ph && SKIP_PH.has(ph.type)) break
        const txBody = child(s, 'txBody')
        if (ph && TITLE_PH.has(ph.type)) {
          const text = plainOf(parasOf(txBody, ctx.rels, false).flatMap((p, i) => (i ? [{ type: 'text', text: ' ' }, ...p.content] : p.content)))
          if (!ctx.slide.title && text) {
            ctx.slide.title = text
            if (ph.type === 'ctrTitle') ctx.slide.titleSlide = true
            break
          }
          // a second title: plain text below
        }
        const pos = at ?? offOf(path(s, 'spPr', 'xfrm')) ?? (ph ? (ph.idx ? ctx.layout.get(`idx:${ph.idx}`) : undefined) ?? ctx.layout.get(`type:${ph.type}`) ?? null : null)
        // body / content placeholders show bullets unless a paragraph says none; a title slide's or section
        // header's body is a plain line, a subtitle and a text box are text
        const bulleted = !!ph && (ph.type === 'obj' || (ph.type === 'body' && ctx.layoutType !== 'title' && ctx.layoutType !== 'secHead'))
        const blocks = blocksOf(parasOf(txBody, ctx.rels, bulleted))
        const fill = path(s, 'spPr', 'blipFill')
        const img = fill ? imageBlock(ctx, child(fill, 'blip'), attr(path(s, 'nvSpPr', 'cNvPr'), 'descr') ?? '') : null
        if (img) blocks.unshift(img)
        if (blocks.length) out.push({ y: pos?.y ?? null, x: pos?.x ?? null, blocks })
        break
      }
      case 'pic': {
        const nvPr = path(s, 'nvPicPr', 'nvPr')
        if (child(nvPr, 'videoFile') || child(nvPr, 'audioFile') || child(nvPr, 'quickTimeFile') || all(nvPr, 'media').length) {
          ctx.slide.lost.push('media')
          break
        }
        const ph = phOf(nvPr)
        const pos = at ?? offOf(path(s, 'spPr', 'xfrm')) ?? (ph?.idx ? (ctx.layout.get(`idx:${ph.idx}`) ?? null) : null)
        const img = imageBlock(ctx, path(s, 'blipFill', 'blip'), attr(path(s, 'nvPicPr', 'cNvPr'), 'descr') ?? '')
        if (img) out.push({ y: pos?.y ?? null, x: pos?.x ?? null, blocks: [img] })
        break
      }
      case 'graphicFrame': {
        const data = path(s, 'graphic', 'graphicData')
        const uri = attr(data, 'uri') ?? ''
        const ph = phOf(path(s, 'nvGraphicFramePr', 'nvPr'))
        const pos = at ?? offOf(child(s, 'xfrm')) ?? (ph?.idx ? (ctx.layout.get(`idx:${ph.idx}`) ?? null) : null)
        let blocks: JSONContent[] = []
        if (uri.endsWith('/table')) {
          const tb = child(data, 'tbl') ? tableOf(child(data, 'tbl')!, ctx.rels) : null
          if (tb) {
            blocks = [tb]
            ctx.slide.tables++
          }
        } else if (uri.endsWith('/chart')) {
          const rel = ctx.rels.get(relAttr(child(data, 'chart'), 'id') ?? '')
          blocks = chartBlocks(rel && !rel.external ? ctx.arc.xml(rel.target) : null, ctx.labels)
          ctx.slide.lost.push('chart')
        } else if (uri.endsWith('/diagram')) {
          const rel = ctx.rels.get(relAttr(child(data, 'relIds'), 'dm') ?? '')
          blocks = smartArtBlocks(rel && !rel.external ? ctx.arc.xml(rel.target) : null)
          ctx.slide.lost.push('smartart')
        } else ctx.slide.lost.push('ole')
        if (blocks.length) out.push({ y: pos?.y ?? null, x: pos?.x ?? null, blocks })
        break
      }
      case 'grpSp': {
        // a group's members sit where the group sits (their own offsets are in the group's coordinates)
        shapeItems(ctx, s, out, at ?? offOf(path(s, 'grpSpPr', 'xfrm')))
        break
      }
      case 'AlternateContent': {
        const pick = child(s, 'Fallback') ?? child(s, 'Choice')
        if (pick) shapeItems(ctx, pick, out, at)
        break
      }
      default:
        break
    }
  }
}

/** Reading order: rows top to bottom (a quarter inch apart), left to right — when every item has a position. */
function ordered(items: Item[]): JSONContent[] {
  const placed = items.every((it) => it.y !== null && it.x !== null)
  const list = placed ? [...items].sort((a, b) => Math.round(a.y! / 228600) - Math.round(b.y! / 228600) || a.x! - b.x!) : items
  return list.flatMap((it) => it.blocks)
}

function notesOf(arc: Archive, rels: Map<string, Rel>): JSONContent[] {
  const rel = relOfType(rels, '/notesSlide')
  if (!rel || rel.external) return []
  const doc = arc.xml(rel.target)
  const nrels = arc.rels(rel.target)
  const out: JSONContent[] = []
  for (const sp of all(doc?.documentElement, 'sp')) {
    if (phOf(path(sp, 'nvSpPr', 'nvPr'))?.type !== 'body') continue
    out.push(...blocksOf(parasOf(child(sp, 'txBody'), nrels, false)))
  }
  return out
}

function readSlide(arc: Archive, part: string, no: number, labels: PptxLabels, media: Set<string>): PptxSlide {
  const doc = arc.xml(part)
  if (!doc) throw new PptxError('unreadable')
  const rels = arc.rels(part)
  const layoutRel = relOfType(rels, '/slideLayout')
  const layoutDoc = layoutRel && !layoutRel.external ? arc.xml(layoutRel.target) : null
  const layoutType = attr(layoutDoc?.documentElement, 'type')
  const ctx: SlideCtx = {
    arc,
    part,
    rels,
    labels,
    layout: layoutPositions(layoutDoc),
    layoutType,
    media,
    slide: { title: '', titleSlide: layoutType === 'title', blocks: [], images: 0, tables: 0, lost: [] },
  }
  const items: Item[] = []
  const tree = path(doc.documentElement, 'cSld', 'spTree')
  if (tree) shapeItems(ctx, tree, items)
  return { ...ctx.slide, no, hidden: attr(doc.documentElement, 'show') === '0', blocks: ordered(items), notes: notesOf(arc, rels) }
}

/* ------------------------------------------------------------------ */
/* Theme                                                                */
/* ------------------------------------------------------------------ */

const SLOTS = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink']

function readTheme(arc: Archive, presRels: Map<string, Rel>): PptxTheme | null {
  const rel = relOfType(presRels, '/theme')
  const doc = rel && !rel.external ? arc.xml(rel.target) : null
  const root = doc?.documentElement
  if (!root) return null
  const scheme = all(root, 'clrScheme')[0]
  const colors: PptxColor[] = []
  for (const slot of SLOTS) {
    const el = child(scheme, slot)
    const c = child(el, 'srgbClr') ?? child(el, 'sysClr')
    const raw = c ? (c.localName === 'srgbClr' ? attr(c, 'val') : attr(c, 'lastClr')) : null
    if (raw && /^[0-9a-f]{6}$/i.test(raw)) colors.push({ slot, hex: `#${raw.toLowerCase()}` })
  }
  const font = (name: string) => attr(child(all(root, name)[0], 'latin'), 'typeface')?.trim() || null
  // the master's text sizes (hundredths of a point)
  const masterRel = relOfType(presRels, '/slideMaster')
  const master = masterRel && !masterRel.external ? arc.xml(masterRel.target)?.documentElement : null
  const size = (el: Element | null) => {
    const sz = Number(attr(child(el, 'defRPr'), 'sz'))
    return Number.isFinite(sz) && sz > 0 ? Math.round(sz / 100) : null
  }
  const styles = path(master, 'txStyles')
  const titleSize = size(path(styles, 'titleStyle', 'lvl1pPr'))
  const bodySizes = ['lvl1pPr', 'lvl2pPr', 'lvl3pPr'].map((l) => size(path(styles, 'bodyStyle', l))).filter((n): n is number => n !== null)
  return { name: attr(root, 'name') ?? '', colors, major: font('majorFont'), minor: font('minorFont'), titleSize, bodySizes }
}

/* ------------------------------------------------------------------ */
/* The deck                                                             */
/* ------------------------------------------------------------------ */

export const isPptxBytes = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4

/** Read a .pptx. Throws PptxError ('unreadable', 'too_large', 'slides', 'empty'). */
export function readPptx(bytes: Uint8Array, labels: PptxLabels = DEFAULT_LABELS): PptxDeck {
  if (!isPptxBytes(bytes)) throw new PptxError('unreadable')
  const names = listZip(bytes)
  if (!names.has('ppt/presentation.xml')) throw new PptxError('unreadable')
  const arc = new Archive(bytes, names)
  // every XML part at once (one pass over the archive), the pictures later — only those that are shown
  arc.load([...names.keys()].filter((n) => /\.(xml|rels)$/i.test(n) && /^(ppt|docProps|_rels)\//.test(n)))
  const pres = arc.xml('ppt/presentation.xml')
  if (!pres) throw new PptxError('unreadable')
  const presRels = arc.rels('ppt/presentation.xml')
  const ids = kids(child(pres.documentElement, 'sldIdLst')).filter((e) => e.localName === 'sldId')
  if (ids.length > PPTX_MAX_SLIDES) throw new PptxError('slides', ids.length)
  const media = new Set<string>()
  const slides: PptxSlide[] = []
  for (const id of ids) {
    const rel = presRels.get(relAttr(id, 'id') ?? '')
    if (!rel || rel.external || !names.has(rel.target)) continue
    slides.push(readSlide(arc, rel.target, slides.length + 1, labels, media))
  }
  if (!slides.length) throw new PptxError('empty')
  arc.load(media)
  const files = new Map<string, Uint8Array>()
  for (const p of media) {
    const b = arc.get(p)
    if (b?.length) files.set(p, b)
  }
  const core = arc.xml('docProps/core.xml')
  const title = (all(core?.documentElement, 'title')[0]?.textContent ?? '').replace(/\s+/g, ' ').trim()
  return { title, slides, media: files, theme: readTheme(arc, presRels) }
}

/** Only these pictures of a .pptx (media paths as the deck's image blocks carry them), within the budget. */
export function readPptxMedia(bytes: Uint8Array, paths: Iterable<string>): Map<string, Uint8Array> {
  if (!isPptxBytes(bytes)) throw new PptxError('unreadable')
  const arc = new Archive(bytes, listZip(bytes))
  const want = [...paths].filter((p) => SHOWN.has(extname(p)))
  arc.load(want)
  const out = new Map<string, Uint8Array>()
  for (const p of want) {
    const b = arc.get(p)
    if (b?.length) out.set(p, b)
  }
  return out
}

/** Counts for a preview. */
export function deckStats(deck: PptxDeck) {
  let images = 0
  let tables = 0
  let notes = 0
  let hidden = 0
  const lost: Record<PptxLost, number> = { chart: 0, smartart: 0, media: 0, ole: 0, picture: 0 }
  for (const s of deck.slides) {
    images += s.images
    tables += s.tables
    if (s.notes.length) notes++
    if (s.hidden) hidden++
    for (const l of s.lost) lost[l]++
  }
  return { slides: deck.slides.length, images, tables, notes, hidden, lost }
}
