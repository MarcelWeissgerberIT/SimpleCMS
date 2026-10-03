/**
 * Evernote export (.enex) → ImportPlan (pure string work, no DOM — unit-testable in Node).
 *
 * Every .enex file is a notebook → a page listing its notes. A note's ENML (an XHTML subset)
 * becomes HTML that apply.ts converts with the editor schema (sanitized there):
 *   <en-todo checked="true"/>  → checkbox → task item
 *   <en-media hash="…"/>       → the <resource> whose bytes have that MD5 → image or file block
 *   <en-crypt>                 → a placeholder (reported)
 *   evernote:/// note links     → page links, matched by the linked note's title
 * Created / updated dates are kept; tags, source URL and author go into a small properties line.
 * Notes are cut out of the file one by one (no giant XML DOM), so big exports stay responsive.
 */
import { md5 } from './md5'
import { decodeEntities, escapeHtml, fromBase64, textOf } from './htmltext'
import type { ImportPlan, PlanNode } from './plan'
import type { ReportItem } from './report'

export interface EnexFile {
  name: string
  text: string
}

export interface EnexOptions {
  /** localized labels for the properties line + the encrypted-text placeholder */
  labels: { tags: string; source: string; author: string; encrypted: string }
  onProgress?: (done: number, total: number) => void
}

export const isEnexPath = (p: string) => /\.enex$/i.test(p)

const IMAGE_MIME = /^image\/(png|jpe?g|gif|webp|svg\+xml|avif|bmp)$/i
const EXT_OF_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'application/pdf': 'pdf',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'video/mp4': 'mp4',
  'text/plain': 'txt',
}

/** First <name>…</name> inside `xml` (raw inner XML), or null. */
function child(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`))
  return m ? m[1] : null
}

/** Text of an element: CDATA as is, otherwise entity-decoded. */
function textValue(raw: string | null): string {
  if (raw === null) return ''
  const s = raw.trim()
  if (s.startsWith('<![CDATA[')) return s.replace(/\]\]><!\[CDATA\[/g, '').replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '')
  return decodeEntities(s)
}

/** "20230115T101500Z" → epoch ms */
export function enexDate(raw: string | null): number | undefined {
  const m = (raw ?? '').trim().match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/)
  if (!m) return undefined
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]))
}

function attrsOf(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of s.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? '')
  return out
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim()

interface Resource {
  name: string
  mime: string
  bytes: Uint8Array
  used: boolean
}

function pacer(ms = 12) {
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
  let last = now()
  return async () => {
    if (now() - last < ms) return
    await new Promise<void>((r) => {
      if (typeof MessageChannel === 'undefined') return setTimeout(r, 0)
      const ch = new MessageChannel()
      ch.port1.onmessage = () => {
        ch.port1.close()
        r()
      }
      ch.port2.postMessage(null)
    })
    last = now()
  }
}

/** Positions of every <note>…</note> in an export. */
function noteSpans(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const open = /<note[\s>]/g
  let m: RegExpExecArray | null
  while ((m = open.exec(text))) {
    const end = text.indexOf('</note>', m.index)
    if (end < 0) break
    out.push([m.index, end + 7])
    open.lastIndex = end + 7
  }
  return out
}

export async function buildEnexPlan(input: EnexFile[], opts: EnexOptions): Promise<ImportPlan> {
  const report: ReportItem[] = []
  const nodes: PlanNode[] = []
  const files = new Map<string, Uint8Array>()
  const pathKeys = new Map<string, string>()
  const roots: string[] = []
  const pause = pacer()
  const spans = input.map((f) => noteSpans(f.text))
  const total = spans.reduce((a, s) => a + s.length, 0)
  const usedTitles = new Set<string>()
  let done = 0

  input.forEach((f, fi) => {
    let title = f.name.replace(/\.enex$/i, '').trim() || 'Evernote'
    for (let k = 2; usedTitles.has(title.toLowerCase()); k++) title = `${f.name.replace(/\.enex$/i, '')} (${k})`
    usedTitles.add(title.toLowerCase())
    const key = `enex${fi}`
    nodes.push({ key, kind: 'folder', title, hex: null, parentKey: null, dir: key, body: '', format: 'html', attachments: [] })
    roots.push(key)
  })

  for (let fi = 0; fi < input.length; fi++) {
    const text = input[fi].text
    const nb = `enex${fi}`
    for (let j = 0; j < spans[fi].length; j++) {
      const [a, b] = spans[fi][j]
      const xml = text.slice(a, b)
      const key = `${nb}/${j}`
      const title = textValue(child(xml, 'title')).trim()
      const where = title || `#${j + 1}`

      // resources by MD5 of their bytes
      const resources = new Map<string, Resource>()
      const names = new Set<string>()
      for (const r of xml.matchAll(/<resource>([\s\S]*?)<\/resource>/g)) {
        const data = child(r[1], 'data')
        if (!data) continue
        let bytes: Uint8Array
        try {
          bytes = fromBase64(data)
        } catch {
          continue
        }
        const mime = textValue(child(r[1], 'mime')).toLowerCase() || 'application/octet-stream'
        const hash = md5(bytes)
        let name = safeName(textValue(child(r[1], 'file-name')))
        if (!name) name = `${hash.slice(0, 12)}.${EXT_OF_MIME[mime] ?? 'bin'}`
        else if (!/\.\w{1,5}$/.test(name) && EXT_OF_MIME[mime]) name += `.${EXT_OF_MIME[mime]}`
        let unique = name
        for (let k = 2; names.has(unique.toLowerCase()); k++) unique = name.replace(/(\.\w+)?$/, ` (${k})$1`)
        names.add(unique.toLowerCase())
        if (!resources.has(hash)) resources.set(hash, { name: unique, mime, bytes, used: false })
      }

      const enml = textValue(child(xml, 'content'))
      const html = enml
        .replace(/<\?xml[^>]*\?>/gi, '')
        .replace(/<!DOCTYPE[^>]*>/gi, '')
        .replace(/<en-note\b[^>]*>/gi, '<div>')
        .replace(/<\/en-note>/gi, '</div>')
        .replace(/<en-todo\b([^>]*?)\/?>(?:\s*<\/en-todo>)?/gi, (_all, attrs: string) => `<input type="checkbox"${/checked\s*=\s*["']?true/i.test(attrs) ? ' checked' : ''}>`)
        .replace(/<en-crypt\b[^>]*>[\s\S]*?<\/en-crypt>/gi, () => {
          report.push({ code: 'crypt', detail: where, where })
          return `<p><em>[${escapeHtml(opts.labels.encrypted)}]</em></p>`
        })
        .replace(/<en-media\b([^>]*?)\/?>(?:\s*<\/en-media>)?/gi, (_all, raw: string) => {
          const at = attrsOf(raw)
          const res = resources.get((at.hash ?? '').toLowerCase())
          if (!res) {
            report.push({ code: 'embed', detail: at.type || 'media', where })
            return ''
          }
          res.used = true
          const src = encodeURIComponent(res.name)
          if (IMAGE_MIME.test(res.mime)) {
            const width = Number(at.width) > 0 ? ` width="${Math.round(Number(at.width))}"` : ''
            return `<img src="${src}" alt="${escapeHtml(at.alt ?? '')}"${width}>`
          }
          return `<a href="${src}">${escapeHtml(res.name)}</a>`
        })

      const attachments: string[] = []
      for (const res of resources.values()) {
        const path = `${key}/${res.name}`
        files.set(path, res.bytes)
        if (!res.used) attachments.push(path)
      }

      const meta: Array<[string, string]> = []
      const tags = [...xml.matchAll(/<tag>([\s\S]*?)<\/tag>/g)].map((m) => textValue(m[1]).trim()).filter(Boolean)
      if (tags.length) meta.push([opts.labels.tags, tags.join(', ')])
      const attrs = child(xml, 'note-attributes') ?? ''
      const source = textValue(child(attrs, 'source-url')).trim()
      if (/^https?:\/\//i.test(source)) meta.push([opts.labels.source, source])
      const author = textValue(child(attrs, 'author')).trim()
      if (author) meta.push([opts.labels.author, author])

      const createdAt = enexDate(child(xml, 'created'))
      const updatedAt = enexDate(child(xml, 'updated')) ?? createdAt
      nodes.push({
        key,
        kind: 'page',
        title,
        hex: null,
        parentKey: nb,
        dir: key,
        body: html,
        format: 'html',
        attachments,
        ...(meta.length ? { meta } : {}),
        ...(createdAt ? { createdAt } : {}),
        ...(updatedAt ? { updatedAt } : {}),
      })
      done++
      opts.onProgress?.(done, total)
      await pause()
    }
  }

  // evernote:/// links between notes → page links, matched by the linked note's title
  const byTitle = new Map<string, string>()
  for (const n of nodes) if (n.kind === 'page' && n.title && !byTitle.has(n.title.toLowerCase())) byTitle.set(n.title.toLowerCase(), n.key)
  for (const n of nodes) {
    if (!n.body.includes('evernote:')) continue
    n.body = n.body.replace(/<a\b[^>]*?\bhref\s*=\s*(["'])(evernote:[^"']*)\1[^>]*>([\s\S]*?)<\/a>/gi, (_all, _q, _href, inner: string) => {
      const target = byTitle.get(textOf(inner).toLowerCase())
      if (!target) {
        report.push({ code: 'link', detail: textOf(inner) || 'evernote:///', where: n.title })
        return inner
      }
      return `<a href="../../${target}">${inner}</a>`
    })
  }

  input.forEach((f, fi) => spans[fi].length === 0 && report.push({ code: 'skipped', detail: f.name }))
  // notebooks list their notes; the import report counts what was left out
  return { nodes: order(nodes), files, pathKeys, roots, isNotion: false, warnings: [], source: 'evernote', name: input.length === 1 ? input[0].name.replace(/\.enex$/i, '') : undefined, report }
}

/** Parents before children (notebook, then its notes in export order). */
function order(nodes: PlanNode[]): PlanNode[] {
  const out: PlanNode[] = []
  for (const nb of nodes.filter((n) => !n.parentKey)) {
    out.push(nb)
    for (const n of nodes) if (n.parentKey === nb.key) out.push(n)
  }
  return out
}
