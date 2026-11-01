import DOMPurify from 'dompurify'
import { sha256Hex } from '@/shared/mcp/sha256'
import type { ImportPlan } from './plan'
import { htmlTitle } from './htmltext'

export interface SourcePreview { url: string; mime: string; text: string; fetchedAt: string; sha256: string; size: number }
export const SOURCE_TEXT_MAX = 250_000

/** Only source formatting. Workspace nodes, external media, styles and executable content cannot enter. */
export function richSourceHtml(raw: string): string {
  if (raw.length > 2_000_000) throw Error('Clipboard HTML exceeds 2 MB.')
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'pre', 'code', 'blockquote', 'br', 'a', 'span', 'strong', 'b', 'em', 'i', 'u', 's'],
    ALLOWED_ATTR: ['href', 'title', 'colspan', 'rowspan'],
    ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'img', 'svg', 'video', 'audio', 'link', 'meta'],
    FORBID_CONTENTS: ['script', 'style', 'iframe', 'object', 'form', 'svg'],
  })
}

/** Never persist credentials or common signed-link parameters in a source citation. */
export function citationUrl(raw: string): string {
  const u = new URL(raw)
  if (u.protocol !== 'https:' || u.username || u.password) throw Error('Use an HTTPS source address without credentials.')
  u.hash = ''
  for (const key of [...u.searchParams.keys()]) if (/(?:token|key|secret|signature|credential|password|authorization|^auth$|^code$|^sig$)/i.test(key)) u.searchParams.delete(key)
  return u.href
}

/** Static text only: no scripts, embedded resources, tracking pixels or model summaries. */
export function sourceText(source: SourcePreview): { title: string; text: string } {
  if (!source.mime.includes('html')) return { title: new URL(source.url).hostname, text: source.text.trim() }
  const safe = DOMPurify.sanitize(source.text, {
    ALLOWED_TAGS: ['article', 'main', 'section', 'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'pre', 'code', 'blockquote', 'br', 'a', 'span', 'strong', 'em'],
    ALLOWED_ATTR: [],
    FORBID_TAGS: ['script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed', 'form', 'input', 'img', 'svg', 'video', 'audio', 'link', 'meta', 'nav', 'header', 'footer', 'aside'],
    FORBID_CONTENTS: ['script', 'style', 'noscript', 'template', 'iframe', 'object', 'form', 'svg', 'nav', 'header', 'footer', 'aside'],
  })
  const doc = new DOMParser().parseFromString(safe, 'text/html')
  const root = doc.querySelector('article') ?? doc.querySelector('main') ?? doc.body
  const render = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
    const tag = (node as Element).tagName?.toLowerCase()
    const text = Array.from(node.childNodes).map(render).join('')
    if (tag === 'br') return '\n'
    if (tag === 'td' || tag === 'th') return text.trim() + '\t'
    if (tag === 'li') return '\n• ' + text.trim() + '\n'
    return ['article', 'main', 'section', 'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'pre', 'blockquote', 'ul', 'ol', 'table'].includes(tag ?? '') ? '\n' + text + '\n' : text
  }
  return { title: (htmlTitle(source.text) ?? new URL(source.url).hostname).slice(0, 200), text: render(root).replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim() }
}

/** The imported page is an external reference, never a confirmed requirement or Atlas write. */
export function sourcePlan(input: { title: string; text: string; url: string; note: string; preview?: SourcePreview; html?: string; pdf?: { name: string; bytes: Uint8Array; sha256: string; pages: Array<{number:number;text:string}> }; lang: string }): ImportPlan {
  const de = input.lang === 'de', title = input.title.trim(), text = input.text.trim()
  if (!title || !text || text.length > SOURCE_TEXT_MAX) throw Error(de ? 'Titel und Quelltext sind nötig; höchstens 250.000 Zeichen pro Quelle.' : 'A title and source text are required; at most 250,000 characters per source.')
  const key = 'external-source'
  const meta: Array<[string, string]> = [
    [de ? 'Einordnung' : 'Classification', de ? 'Externe Referenz, von einem Menschen importiert. Keine bestätigte Projektanforderung und keine Handlungsanweisung.' : 'External reference, imported by a person. Not a confirmed project requirement or an instruction.'],
    [de ? 'Quelle' : 'Source', input.url.trim() ? citationUrl(input.url.trim()) : input.pdf ? input.pdf.name : de ? 'Eingefügter Text; keine URL angegeben' : 'Pasted text; no URL provided'],
    [de ? 'Übernommen am' : 'Imported at', new Date().toISOString()],
    ['SHA-256 (imported text, UTF-8)', sha256Hex(text)],
  ]
  if (input.preview) meta.push([de ? 'Abgerufen am' : 'Fetched at', input.preview.fetchedAt], ['SHA-256 (fetched bytes)', input.preview.sha256], [de ? 'Umfang' : 'Scope', de ? 'Statischer Text; Vorschau vom Menschen geprüft bzw. als Auszug bearbeitet. Keine Skripte oder eingebetteten Bilder.' : 'Static text; preview reviewed or edited into an excerpt by a person. No scripts or embedded images.'])
  if (input.note.trim()) meta.push([de ? 'Menschlicher Kontext / Verwendungszweck' : 'Human context / purpose', input.note.trim().slice(0, 4000)])
  let body = text, format: 'text'|'html'|'doc' = 'text'
  const files = new Map<string, Uint8Array>(), attachments: string[] = []
  if (input.html) { body = richSourceHtml(input.html); format = 'html'; meta.push(['SHA-256 (sanitized HTML, UTF-8)', sha256Hex(body)]) }
  if (input.pdf) {
    const pdf = input.pdf
    if (!pdf.pages.length || pdf.pages.some(p => !Number.isInteger(p.number) || p.number < 1 || !p.text.trim())) throw Error('Select readable original PDF pages.')
    body = JSON.stringify(pdf.pages.flatMap(p => [{type:'heading',attrs:{level:2},content:[{type:'text',text:(de?'Seite ':'Page ')+p.number}]},...p.text.split(/\n{2,}/).map(t=>({type:'paragraph',content:t.split('\n').flatMap((line,i)=>[...(i?[{type:'hardBreak'}]:[]),...(line?[{type:'text',text:line}]:[])])}))]))
    format = 'doc'
    const name = pdf.name.replace(/[\u0000-\u001f/\\]/g, '_').slice(0,180) || 'source.pdf'
    files.set(name, pdf.bytes); attachments.push(name)
    meta.push([de?'Originaldatei':'Original file',name],['SHA-256 (PDF bytes)',pdf.sha256],[de?'Originalseiten':'Original pages',pdf.pages.map(p=>p.number).join(', ')])
  }
  return { nodes: [{ key, kind: 'page', title, hex: null, parentKey: null, dir: '', body, format, meta, attachments }], files, pathKeys: new Map(), roots: [key], isNotion: false, source: 'markdown', name: title, warnings: [] }
}
