/**
 * HTML → TipTap JSON for imports (browser only: DOMParser + DOMPurify + the editor schema).
 *
 * Used for .html/.htm files (Google Docs "Web page", Confluence, Dropbox Paper, Notion HTML …)
 * and Evernote ENML. The document is parsed inert (DOMParser never runs scripts or loads
 * images), stripped of scripts / iframes / forms / page chrome, sanitized with DOMPurify, and then
 * read by ProseMirror's DOM parser with the editor's own schema — so the result is always valid.
 * Before that, a few exporter idioms are normalized: class-based bold/italic (Google Docs),
 * checkbox lines (Evernote, Notion, Confluence) → task lists, callout boxes, <details> toggles.
 */
import type { JSONContent } from '@tiptap/core'

export interface HtmlToDocOptions {
  /** the page title: a leading <h1> repeating it is dropped */
  title?: string
  /** rewrite a relative link / image target (→ placeholder URL); null = unresolved */
  rewrite?: (href: string, isImage: boolean) => string | null
}

export type HtmlToDoc = (html: string, opts?: HtmlToDocOptions) => JSONContent

let ready: Promise<HtmlToDoc> | null = null

/** Load the sanitizer + editor schema once; returns a synchronous converter. */
export function htmlConverter(): Promise<HtmlToDoc> {
  ready ??= (async () => {
    const [{ default: purify }, { getExtensions }, { getSchema }, { DOMParser: PMParser }] = await Promise.all([
      import('dompurify'),
      import('../../../editor'),
      import('@tiptap/core'),
      import('@tiptap/pm/model'),
    ])
    const parser = PMParser.fromSchema(getSchema(getExtensions()))
    return (html: string, opts: HtmlToDocOptions = {}) => {
      const dom = new DOMParser().parseFromString(html, 'text/html')
      const root = prepare(dom, opts)
      purify.sanitize(root, { IN_PLACE: true, FORBID_TAGS: [...DROP_TAGS], ADD_ATTR: ['data-type', 'data-checked', 'data-icon', 'data-color'] })
      const doc = parser.parse(root).toJSON() as JSONContent
      return { type: 'doc', content: trimEnds(tidy(doc.content ?? [])) }
    }
  })()
  return ready
}

/* ------------------------------------------------------------------ */
/* DOM preparation                                                     */
/* ------------------------------------------------------------------ */

const DROP_TAGS = ['script', 'style', 'link', 'meta', 'base', 'noscript', 'template', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form', 'button', 'select', 'textarea', 'option', 'svg', 'math', 'canvas', 'video', 'audio', 'source', 'track', 'nav', 'footer', 'head']
/** page chrome of known exporters (Confluence breadcrumbs / footer …) */
const CHROME = '#breadcrumb-section, #footer, #footer-logo, .page-metadata, .pageSection.group, #main-header'
const SAFE_URL = /^(https?:|mailto:|tel:)/i
const SCHEME = /^[a-z][a-z0-9+.-]*:/i

function el(doc: Document, tag: string, attrs: Record<string, string> = {}): HTMLElement {
  const e = doc.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  return e
}

function prepare(dom: Document, opts: HtmlToDocOptions): HTMLElement {
  inlineClassStyles(dom)
  for (const x of dom.querySelectorAll([...DROP_TAGS, CHROME].join(','))) x.remove()
  const root = el(dom, 'div')
  while (dom.body.firstChild) root.appendChild(dom.body.firstChild)

  // imported data-* attributes must not smuggle in workspace nodes (mentions, databases …)
  for (const e of root.querySelectorAll('*')) for (const a of [...e.attributes]) if (a.name.startsWith('data-') || a.name.startsWith('on')) e.removeAttribute(a.name)

  dropTitle(root, opts.title)
  for (const h of root.querySelectorAll('h4, h5, h6')) {
    const p = el(dom, 'p')
    const b = el(dom, 'strong')
    while (h.firstChild) b.appendChild(h.firstChild)
    p.appendChild(b)
    h.replaceWith(p)
  }
  callouts(root)
  toggles(root)
  tasks(root)
  urls(root, opts)
  return root
}

/** Google Docs / Word style classes (".c3{font-weight:700}") → inline styles the schema reads. */
function inlineClassStyles(dom: Document) {
  const css = [...dom.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n')
  if (!css.trim()) return
  const rules = new Map<string, string[]>()
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const decl = m[2]
    const keep: string[] = []
    if (/font-weight\s*:\s*(bold|[6-9]00)\b/i.test(decl)) keep.push('font-weight:700')
    if (/font-style\s*:\s*italic/i.test(decl)) keep.push('font-style:italic')
    const deco = decl.match(/text-decoration(?:-line)?\s*:\s*([^;]+)/i)?.[1] ?? ''
    if (/underline/i.test(deco)) keep.push('text-decoration:underline')
    if (/line-through/i.test(deco)) keep.push('text-decoration:line-through')
    if (!keep.length) continue
    for (const sel of m[1].split(',').map((s) => s.trim())) {
      if (!/^\.[\w-]+$/.test(sel)) continue
      rules.set(sel.slice(1), [...(rules.get(sel.slice(1)) ?? []), ...keep])
    }
  }
  if (!rules.size) return
  for (const e of dom.body.querySelectorAll<HTMLElement>('[class]')) {
    const add: string[] = []
    for (const c of e.classList) for (const d of rules.get(c) ?? []) if (!(d.startsWith('text-decoration:underline') && e.closest('a'))) add.push(d)
    if (add.length) e.setAttribute('style', `${e.getAttribute('style') ?? ''};${add.join(';')}`)
  }
}

/** A first <h1> that repeats the page title (before any other text) is the title, not content. */
function dropTitle(root: HTMLElement, title?: string) {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
  const h1 = root.querySelector('h1')
  if (!title || !h1) return
  const text = norm(h1.textContent ?? '')
  if (text && text === norm(title) && norm(root.textContent ?? '').startsWith(text)) h1.remove()
}

/** Notion (figure.callout), Confluence info / note / warning / tip macros → callout blocks. */
function callouts(root: HTMLElement) {
  const doc = root.ownerDocument
  const make = (icon: string, color: string, body: Element) => {
    const box = el(doc, 'div', { 'data-type': 'callout', 'data-icon': icon, 'data-color': color })
    while (body.firstChild) box.appendChild(body.firstChild)
    return box
  }
  for (const fig of root.querySelectorAll('figure.callout')) {
    const icon = fig.querySelector('.icon')?.textContent?.trim() || '💡'
    fig.querySelector('.icon')?.closest('div')?.remove()
    fig.replaceWith(make(icon, 'gray', fig.children.length === 1 ? fig.children[0] : fig))
  }
  const KIND: Array<[string, string, string]> = [
    ['information', 'ℹ️', 'blue'],
    ['note', '⚠️', 'yellow'],
    ['warning', '🛑', 'red'],
    ['tip', '💡', 'green'],
  ]
  for (const box of root.querySelectorAll('.confluence-information-macro')) {
    const kind = KIND.find(([k]) => box.classList.contains(`confluence-information-macro-${k}`)) ?? KIND[0]
    box.querySelector('.confluence-information-macro-icon, .aui-icon')?.remove()
    const body = box.querySelector('.confluence-information-macro-body') ?? box
    box.replaceWith(make(kind[1], kind[2], body))
  }
}

/** <details><summary>…</summary>…</details> → the toggle's summary + content wrapper. */
function toggles(root: HTMLElement) {
  const doc = root.ownerDocument
  for (const d of [...root.querySelectorAll('details')].reverse()) {
    const summary = d.querySelector(':scope > summary') ?? el(doc, 'summary')
    const content = el(doc, 'div', { 'data-type': 'detailsContent' })
    for (const c of [...d.childNodes]) if (c !== summary) content.appendChild(c)
    if (!content.childNodes.length) content.appendChild(el(doc, 'p'))
    d.replaceChildren(summary, content)
  }
}

function taskItem(doc: Document, checked: boolean, content: Node | null): HTMLElement {
  const li = el(doc, 'li', { 'data-type': 'taskItem', 'data-checked': String(checked) })
  // TipTap reads a task item's content from its first <div>
  const wrap = el(doc, 'div')
  if (content) wrap.appendChild(content)
  li.appendChild(wrap)
  return li
}

/** Checkbox lines → task lists: Evernote (<en-todo> → checkbox), Notion and Confluence to-do lists, plain HTML checkboxes. */
function tasks(root: HTMLElement) {
  const doc = root.ownerDocument
  // Notion: <ul class="to-do-list"><li><div class="checkbox checkbox-on"></div> text</li>
  for (const li of root.querySelectorAll('ul.to-do-list > li')) {
    const box = li.querySelector('.checkbox')
    const input = el(doc, 'input', { type: 'checkbox' })
    if (box?.classList.contains('checkbox-on')) input.setAttribute('checked', '')
    box?.remove()
    li.prepend(input)
  }
  // Confluence: <ul class="inline-task-list"><li class="checked">
  for (const li of root.querySelectorAll('ul.inline-task-list > li')) {
    const input = el(doc, 'input', { type: 'checkbox' })
    if (li.classList.contains('checked')) input.setAttribute('checked', '')
    li.prepend(input)
  }

  const lists = new Set<Element>()
  const blocks = new Set<Element>()
  for (const box of [...root.querySelectorAll('input')]) {
    if ((box.getAttribute('type') ?? '').toLowerCase() !== 'checkbox') {
      box.remove()
      continue
    }
    const li = box.closest('li')
    if (li && root.contains(li)) {
      const checked = box.hasAttribute('checked')
      box.remove()
      const content = doc.createDocumentFragment()
      while (li.firstChild) content.appendChild(li.firstChild)
      li.replaceWith(taskItem(doc, checked, content))
      continue
    }
    const block = box.parentElement?.closest('div, p')
    if (block && block !== root && root.contains(block)) blocks.add(block)
    else box.remove()
  }
  // a list whose items are all tasks becomes a task list
  for (const li of root.querySelectorAll('li[data-type="taskItem"]')) if (li.parentElement) lists.add(li.parentElement)
  for (const list of lists) {
    const items = [...list.children]
    if (items.length && items.every((c) => c.getAttribute('data-type') === 'taskItem')) {
      const ul = el(doc, 'ul', { 'data-type': 'taskList' })
      while (list.firstChild) ul.appendChild(list.firstChild)
      list.replaceWith(ul)
    } else
      for (const c of items)
        if (c.getAttribute('data-type') === 'taskItem') {
          const plain = el(doc, 'li')
          plain.append(c.getAttribute('data-checked') === 'true' ? '☑ ' : '☐ ', ...(c.firstElementChild?.childNodes ?? []))
          c.replaceWith(plain)
        }
  }
  // "<div><en-todo/>Buy milk<br/><en-todo checked/>Call Bob</div>" → one task per checkbox
  for (const block of [...blocks].reverse()) {
    // (the root is detached from its document — isConnected is always false here)
    if (!root.contains(block)) continue
    const boxes = [...block.querySelectorAll('input[type="checkbox" i]')].filter((b) => !b.closest('li'))
    if (!boxes.length) continue
    const out: Node[] = []
    const lead = doc.createRange()
    lead.setStart(block, 0)
    lead.setEndBefore(boxes[0])
    const leadFrag = lead.extractContents()
    if (leadFrag.textContent?.trim() || (leadFrag as unknown as Element).querySelector?.('img')) {
      const p = el(doc, 'p')
      p.appendChild(leadFrag)
      out.push(p)
    }
    const ul = el(doc, 'ul', { 'data-type': 'taskList' })
    boxes.forEach((box, i) => {
      const r = doc.createRange()
      r.setStartAfter(box)
      if (i + 1 < boxes.length) r.setEndBefore(boxes[i + 1])
      else r.setEnd(block, block.childNodes.length)
      const frag = r.extractContents()
      const p = el(doc, 'p')
      p.appendChild(frag)
      ul.appendChild(taskItem(doc, box.hasAttribute('checked'), p))
    })
    for (const b of boxes) b.remove()
    out.push(ul)
    block.replaceWith(...out)
  }
  // neighbouring task lists (one ENML <div> per to-do) merge into one
  for (const ul of [...root.querySelectorAll('ul[data-type="taskList"]')]) {
    let prev = ul.previousSibling
    while (prev && prev.nodeType === 3 && !prev.textContent?.trim()) prev = prev.previousSibling
    if (prev instanceof Element && prev.matches('ul[data-type="taskList"]')) {
      while (ul.firstChild) prev.appendChild(ul.firstChild)
      ul.remove()
    }
  }
}

/** Resolve relative links / images; drop what cannot be shown (local paths, unknown schemes). */
function urls(root: HTMLElement, opts: HtmlToDocOptions) {
  for (const img of [...root.querySelectorAll('img')]) {
    const src = (img.getAttribute('src') ?? '').trim()
    let next: string | null = null
    if (/^https?:/i.test(src) || /^data:image\/(png|jpe?g|gif|webp|avif);/i.test(src)) next = src
    else if (src && !SCHEME.test(src) && !src.startsWith('//')) next = opts.rewrite?.(src, true) ?? null
    if (next) img.setAttribute('src', next)
    else img.remove()
  }
  for (const a of [...root.querySelectorAll('a')]) {
    let href = (a.getAttribute('href') ?? '').trim()
    // Google Docs wraps every link in a redirect
    const g = href.match(/^https?:\/\/www\.google\.[a-z.]+\/url\?(.*)$/i)
    if (g) href = new URLSearchParams(g[1]).get('q') ?? href
    let next: string | null = null
    if (SAFE_URL.test(href)) next = href
    else if (href && !href.startsWith('#') && !href.startsWith('//') && (!SCHEME.test(href) || /^evernote:/i.test(href))) next = opts.rewrite?.(href, false) ?? null
    if (next) {
      a.setAttribute('href', next)
      a.removeAttribute('target')
    } else a.replaceWith(...a.childNodes)
  }
}

/* ------------------------------------------------------------------ */
/* JSON tidy-up                                                        */
/* ------------------------------------------------------------------ */

const isEmptyPara = (n: JSONContent) => n.type === 'paragraph' && !n.content?.length

/** Drop empty textStyle marks, edge hard breaks, and runs of empty paragraphs (spacer <div><br></div>). */
function tidy(nodes: JSONContent[]): JSONContent[] {
  const out: JSONContent[] = []
  for (const raw of nodes) {
    const n: JSONContent = { ...raw }
    if (n.marks) {
      const marks = n.marks.filter((m) => !(m.type === 'textStyle' && !Object.values(m.attrs ?? {}).some((v) => v !== null && v !== undefined && v !== '')))
      if (marks.length) n.marks = marks
      else delete n.marks
    }
    if (n.content) n.content = tidy(n.content)
    if (n.type === 'paragraph' && n.content) {
      const c = [...n.content]
      while (c[0]?.type === 'hardBreak') c.shift()
      while (c[c.length - 1]?.type === 'hardBreak') c.pop()
      if (c.length) n.content = c
      else delete n.content
    }
    if (isEmptyPara(n) && out.length && isEmptyPara(out[out.length - 1])) continue
    out.push(n)
  }
  return out
}

function trimEnds(nodes: JSONContent[]): JSONContent[] {
  let a = 0
  let b = nodes.length
  while (a < b && isEmptyPara(nodes[a])) a++
  while (b > a && isEmptyPara(nodes[b - 1])) b--
  const out = nodes.slice(a, b)
  return out.length ? out : [{ type: 'paragraph' }]
}
