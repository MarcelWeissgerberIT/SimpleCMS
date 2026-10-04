/**
 * Mail HTML → TipTap blocks (browser only: DOMParser + DOMPurify + the editor's schema).
 *
 * Mail HTML is layout soup: nested tables, hidden preheaders, tracking pixels, remote images. Before the
 * editor's schema reads it (ProseMirror's DOM parser — the result is always a valid document):
 *  - the document is parsed inert (DOMParser never runs scripts or loads images), then sanitized with
 *    DOMPurify (no data-* attributes: a mail can't smuggle in workspace nodes like mentions or databases);
 *  - hidden elements go (display:none, max-height:0, mso-hide …), styles shrink to bold / italic /
 *    underline / strike;
 *  - layout tables are unwrapped into blocks — only real data tables (header cells, no nested tables) stay;
 *  - tracking pixels (≤ 3 px, hidden) are dropped ALWAYS; remote images are replaced by their alt text
 *    unless images are switched on for this mail ("Load images"); inline cid: images are not loaded (v1);
 *  - links keep http(s) / mailto / tel targets only.
 */
import type { JSONContent } from '@tiptap/core'

export interface MailBlocks {
  content: JSONContent[]
  /** remote images in the mail (pixels not counted) */
  remote: number
  /** tracking pixels dropped */
  pixels: number
}

type Converter = (html: string, images: boolean) => MailBlocks

let ready: Promise<Converter> | null = null

const DROP = ['script', 'style', 'link', 'meta', 'base', 'title', 'head', 'noscript', 'template', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form', 'input', 'button', 'select', 'textarea', 'option', 'svg', 'math', 'canvas', 'video', 'audio', 'source', 'track', 'picture', 'map', 'area']
const SAFE_HREF = /^(https?:|mailto:|tel:)/i
/** Inline styles that hide an element (font-size:0 is NOT one: hybrid layouts zero it on wrappers around visible text). */
const HIDDEN_STYLE = /(^|;)\s*(display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all|max-height\s*:\s*0(px)?\s*(;|$|!)|opacity\s*:\s*0(\.0+)?\s*(;|$|!))/i
const ZERO_WIDTH = /[\u200b-\u200d\u2060\ufeff\u034f\u00ad]/g

/** Load the sanitizer + editor schema once; returns a synchronous converter. */
export function mailConverter(): Promise<Converter> {
  ready ??= (async () => {
    const [{ default: purify }, { docSchema }, { DOMParser: PMParser }] = await Promise.all([import('dompurify'), import('../../editor'), import('@tiptap/pm/model')])
    const parser = PMParser.fromSchema(docSchema())
    return (html: string, images: boolean) => {
      const clean = purify.sanitize(html, {
        WHOLE_DOCUMENT: false,
        RETURN_DOM: true,
        FORBID_TAGS: DROP,
        FORBID_ATTR: ['contenteditable', 'srcset', 'background', 'poster', 'formaction', 'action', 'id', 'name'],
        ALLOW_DATA_ATTR: false,
      }) as HTMLElement
      const root = clean.ownerDocument.createElement('div')
      while (clean.firstChild) root.appendChild(clean.firstChild)
      const stats = prepare(root, images)
      const doc = parser.parse(root).toJSON() as JSONContent
      return { content: tidy(doc.content ?? []), ...stats }
    }
  })().catch((e) => {
    ready = null
    throw e
  })
  return ready
}

/** HTML of a mail → blocks (remote images only when `images`). */
export async function htmlToBlocks(html: string, images: boolean): Promise<MailBlocks> {
  return (await mailConverter())(html, images)
}

/* ------------------------------------------------------------------ DOM preparation */

const px = (v: string | null | undefined): number | null => {
  if (!v) return null
  const m = v.trim().match(/^(\d+(?:\.\d+)?)(px)?$/i)
  return m ? Number(m[1]) : null
}

function styleSize(style: string, prop: 'width' | 'height'): number | null {
  const m = style.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`, 'i'))
  return m ? Number(m[1]) : null
}

function isPixel(img: Element): boolean {
  const style = img.getAttribute('style') ?? ''
  const w = px(img.getAttribute('width')) ?? styleSize(style, 'width')
  const h = px(img.getAttribute('height')) ?? styleSize(style, 'height')
  if ((w !== null && w <= 3) || (h !== null && h <= 3)) return true
  return HIDDEN_STYLE.test(style)
}

function prepare(root: HTMLElement, images: boolean): { remote: number; pixels: number } {
  const doc = root.ownerDocument
  let remote = 0
  let pixels = 0

  // invisible content: preheaders, mobile-only duplicates, MSO fallbacks
  for (const el of [...root.querySelectorAll<HTMLElement>('[style], [hidden]')]) {
    if (!root.contains(el) || el.tagName === 'IMG') continue
    if (el.hasAttribute('hidden') || HIDDEN_STYLE.test(el.getAttribute('style') ?? '')) el.remove()
  }

  // images: pixels always go; remote ones only when switched on
  for (const img of [...root.querySelectorAll('img')]) {
    const src = (img.getAttribute('src') ?? '').trim()
    const alt = (img.getAttribute('alt') ?? '').replace(/\s+/g, ' ').trim()
    if (isPixel(img)) {
      pixels++
      img.remove()
      continue
    }
    const isRemote = /^https?:\/\//i.test(src)
    const isData = /^data:image\/(png|jpe?g|gif|webp|avif);base64,/i.test(src) && src.length < 300_000
    if (isRemote) remote++
    if ((isRemote && images) || isData) {
      const w = px(img.getAttribute('width')) ?? styleSize(img.getAttribute('style') ?? '', 'width')
      for (const a of [...img.attributes]) if (a.name !== 'src' && a.name !== 'alt') img.removeAttribute(a.name)
      if (w && w > 3) img.setAttribute('width', String(Math.min(1200, Math.round(w))))
      continue
    }
    // blocked / unloadable: its alt text stands in (if it has one worth reading)
    img.replaceWith(alt && alt.length <= 120 ? doc.createTextNode(`[${alt}]`) : doc.createTextNode(''))
  }

  // layout tables → blocks; data tables (header cells, no nested table) stay tables
  for (const table of [...root.querySelectorAll('table')].reverse()) {
    if (!root.contains(table)) continue
    const data = !!table.querySelector('th') && !table.querySelector('table') && table.querySelectorAll('tr').length >= 2
    if (data) continue
    const box = doc.createElement('div')
    for (const row of [...table.querySelectorAll('tr')]) {
      if (row.closest('table') !== table) continue
      for (const cell of [...row.children]) {
        if (!cell.childNodes.length) continue
        const d = doc.createElement('div')
        while (cell.firstChild) d.appendChild(cell.firstChild)
        box.appendChild(d)
      }
    }
    table.replaceWith(box)
  }

  // links: web, mail and phone targets only
  for (const a of [...root.querySelectorAll('a')]) {
    const href = (a.getAttribute('href') ?? '').trim()
    if (SAFE_HREF.test(href)) {
      for (const at of [...a.attributes]) if (at.name !== 'href') a.removeAttribute(at.name)
    } else a.replaceWith(...a.childNodes)
  }

  // styles: only what the schema reads as marks
  for (const el of [...root.querySelectorAll<HTMLElement>('[style]')]) {
    const s = el.getAttribute('style') ?? ''
    const keep: string[] = []
    if (/font-weight\s*:\s*(bold|bolder|[6-9]00)\b/i.test(s)) keep.push('font-weight:700')
    if (/font-style\s*:\s*italic/i.test(s)) keep.push('font-style:italic')
    const deco = s.match(/text-decoration(?:-line)?\s*:\s*([^;]+)/i)?.[1] ?? ''
    if (/underline/i.test(deco) && !el.closest('a')) keep.push('text-decoration:underline')
    if (/line-through/i.test(deco)) keep.push('text-decoration:line-through')
    if (keep.length) el.setAttribute('style', keep.join(';'))
    else el.removeAttribute('style')
  }
  for (const el of [...root.querySelectorAll('[class], [align], [color], [bgcolor], [face], [size], [dir], [lang], [title]')]) {
    for (const name of ['class', 'align', 'color', 'bgcolor', 'face', 'size', 'title']) el.removeAttribute(name)
  }
  // headings beyond H3 read as bold lines
  for (const h of [...root.querySelectorAll('h4, h5, h6')]) {
    const p = doc.createElement('p')
    const b = doc.createElement('strong')
    while (h.firstChild) b.appendChild(h.firstChild)
    p.appendChild(b)
    h.replaceWith(p)
  }

  // zero-width padding (preheader filler) and empty spacer text
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const texts: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text)
  for (const tn of texts) {
    const v = tn.data.replace(ZERO_WIDTH, '')
    if (v !== tn.data) tn.data = v
  }
  return { remote, pixels }
}

/* ------------------------------------------------------------------ JSON tidy-up */

const isBlankText = (n: JSONContent) => n.type === 'text' && !(n.text ?? '').replace(/[\s\u00a0]/g, '')
const isEmptyPara = (n: JSONContent) => n.type === 'paragraph' && !(n.content ?? []).some((c) => !isBlankText(c) && c.type !== 'hardBreak')
/** Containers whose content is any blocks ('block+'): tidied inside, dropped when nothing is left. */
const LOOSE = new Set(['blockquote', 'callout', 'detailsContent', 'column'])

/** Trim a text block's edge breaks / blank text; three line breaks in a row are spacing, not content. */
function trimInline(n: JSONContent): JSONContent {
  if (!n.content) return n
  const c = [...n.content]
  while (c.length && (c[0].type === 'hardBreak' || isBlankText(c[0]))) c.shift()
  while (c.length && (c[c.length - 1].type === 'hardBreak' || isBlankText(c[c.length - 1]))) c.pop()
  const merged: JSONContent[] = []
  for (const x of c) if (!(x.type === 'hardBreak' && merged.length >= 2 && merged[merged.length - 1].type === 'hardBreak' && merged[merged.length - 2].type === 'hardBreak')) merged.push(x)
  const out = { ...n }
  if (merged.length) out.content = merged
  else delete out.content
  return out
}

/** Drop runs of empty paragraphs (at most one empty line between blocks), empty headings and emptied quotes. */
function tidy(nodes: JSONContent[]): JSONContent[] {
  const out: JSONContent[] = []
  for (const raw of nodes) {
    let n: JSONContent = raw
    if (n.type === 'paragraph' || n.type === 'heading') n = trimInline(n)
    else if (n.type && LOOSE.has(n.type) && n.content) {
      const inner = tidy(n.content)
      if (!inner.length) continue
      n = { ...n, content: inner }
    }
    if (n.type === 'heading' && !n.content) continue
    if (isEmptyPara(n)) {
      if (!out.length || isEmptyPara(out[out.length - 1])) continue
      out.push({ type: 'paragraph' })
      continue
    }
    out.push(n)
  }
  while (out.length && isEmptyPara(out[out.length - 1])) out.pop()
  return out
}

/* ------------------------------------------------------------------ text/plain */

const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?]/g

function lineContent(line: string): JSONContent[] {
  const out: JSONContent[] = []
  let at = 0
  for (const m of line.matchAll(URL_RE)) {
    const i = m.index ?? 0
    if (i > at) out.push({ type: 'text', text: line.slice(at, i) })
    out.push({ type: 'text', text: m[0], marks: [{ type: 'link', attrs: { href: m[0] } }] })
    at = i + m[0].length
  }
  if (at < line.length) out.push({ type: 'text', text: line.slice(at) })
  return out
}

/** text/plain → paragraphs (blank lines) with line breaks; web addresses become links. */
export function textToBlocks(text: string): JSONContent[] {
  const clean = text.replace(/\r\n?/g, '\n').replace(ZERO_WIDTH, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  const out: JSONContent[] = []
  for (const para of clean.split(/\n{2,}/)) {
    const lines = para.split('\n').map((l) => l.replace(/\s+$/, ''))
    if (!lines.some((l) => l.trim())) continue
    const content: JSONContent[] = []
    lines.forEach((l, i) => {
      if (i > 0) content.push({ type: 'hardBreak' })
      content.push(...lineContent(l))
    })
    out.push({ type: 'paragraph', content: content.filter((c) => c.type !== 'text' || c.text) })
  }
  return out
}
