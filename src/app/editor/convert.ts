/**
 * Schema-only extensions + conversion helpers (Markdown ⇄ TipTap JSON, JSON → HTML).
 * No React node views here, so everything works with generateHTML / generateJSON.
 */
import { generateHTML, getSchema, type Extensions, type JSONContent } from '@tiptap/core'
import type { Schema } from '@tiptap/pm/model'
import { MarkdownManager } from '@tiptap/markdown'
import { BLOCK_ID_TYPES, baseExtensions } from './schema/base'

export function getExtensions(opts: { readOnly?: boolean } = {}): Extensions {
  return baseExtensions({ readOnly: opts.readOnly })
}

let manager: MarkdownManager | null = null
let schemaCache: Schema | null = null

function md(): MarkdownManager {
  manager ??= new MarkdownManager({ extensions: getExtensions(), indentation: { style: 'space', size: 2 } })
  return manager
}

export function docSchema(): Schema {
  schemaCache ??= getSchema(getExtensions())
  return schemaCache
}

const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }

/* ------------------------------------------------------------------ */
/* Markdown → doc                                                      */
/* ------------------------------------------------------------------ */

const ALERTS: Record<string, { color: string; icon: string }> = {
  NOTE: { color: 'blue', icon: 'ℹ️' },
  TIP: { color: 'green', icon: '💡' },
  IMPORTANT: { color: 'purple', icon: '❗' },
  WARNING: { color: 'yellow', icon: '⚠️' },
  CAUTION: { color: 'red', icon: '🛑' },
}

const BLOCK_ATOMS = new Set(['image', 'blockMath', 'mermaid', 'pageLink', 'databaseBlock', 'bookmark', 'embed', 'toc', 'fileBlock', 'horizontalRule'])
const EMOJI_START = /^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)\s*/u

/** Normalise parser output: GitHub alerts → callouts, ```mermaid → mermaid, hoist block atoms out of paragraphs. */
function postProcess(nodes: JSONContent[] | undefined): JSONContent[] {
  if (!nodes) return []
  const out: JSONContent[] = []
  for (const raw of nodes) {
    const n: JSONContent = { ...raw }
    if (n.content) n.content = postProcess(n.content)

    if (n.type === 'codeBlock' && String(n.attrs?.language ?? '').toLowerCase() === 'mermaid') {
      out.push({ type: 'mermaid', attrs: { code: (n.content ?? []).map((c) => c.text ?? '').join('') } })
      continue
    }

    if (n.type === 'blockquote' && n.content?.[0]?.type === 'paragraph') {
      const first = n.content[0]
      const t0 = first.content?.[0]
      const m = t0?.type === 'text' ? t0.text?.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i) : null
      if (m && t0) {
        const kind = ALERTS[m[1].toUpperCase()]
        let rest = (t0.text ?? '').slice(m[0].length)
        let icon = kind.icon
        const em = rest.match(EMOJI_START)
        if (em) {
          icon = em[1]
          rest = rest.slice(em[0].length)
        }
        const inline = [...(rest ? [{ ...t0, text: rest }] : []), ...(first.content ?? []).slice(1)]
        // drop a leading hard break left over from the marker line
        while (inline[0]?.type === 'hardBreak') inline.shift()
        const body = [...(inline.length ? [{ ...first, content: inline }] : []), ...n.content.slice(1)]
        out.push({ type: 'callout', attrs: { icon, color: kind.color }, content: body.length ? body : [{ type: 'paragraph' }] })
        continue
      }
    }

    if (n.type === 'paragraph' && n.content?.some((c) => BLOCK_ATOMS.has(c.type ?? ''))) {
      let buf: JSONContent[] = []
      const flush = () => {
        const meaningful = buf.filter((c) => !(c.type === 'text' && !c.text?.trim()) && c.type !== 'hardBreak')
        if (meaningful.length) out.push({ type: 'paragraph', content: buf })
        buf = []
      }
      for (const c of n.content) {
        if (BLOCK_ATOMS.has(c.type ?? '')) {
          flush()
          out.push(c)
        } else buf.push(c)
      }
      flush()
      continue
    }
    out.push(n)
  }
  return out
}

/** Validate against the schema; repair by dropping invalid top-level blocks if necessary. */
export function sanitize(doc: JSONContent): JSONContent {
  const schema = docSchema()
  try {
    schema.nodeFromJSON(doc).check()
    return doc
  } catch {
    const content = (doc.content ?? []).filter((n) => {
      try {
        schema.nodeFromJSON(n).check()
        return true
      } catch {
        return false
      }
    })
    return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }
  }
}

export function markdownToDoc(markdown: string): JSONContent {
  const src = (markdown ?? '').replace(/\r\n?/g, '\n')
  if (!src.trim()) return EMPTY_DOC
  try {
    const parsed = md().parse(src)
    const content = postProcess(parsed.content)
    return sanitize({ type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] })
  } catch (err) {
    console.warn('[editor] markdown parse failed, falling back to paragraphs', err)
    return {
      type: 'doc',
      content: src.split(/\n{2,}/).map((p) => ({ type: 'paragraph', content: p.trim() ? [{ type: 'text', text: p.trim() }] : [] })),
    }
  }
}

/* ------------------------------------------------------------------ */
/* doc → Markdown / HTML                                               */
/* ------------------------------------------------------------------ */

export function docToMarkdown(doc: JSONContent | null): string {
  if (!doc) return ''
  try {
    const out = md().serialize(doc)
    return out.replace(/\n{3,}/g, '\n\n').trim() + '\n'
  } catch (err) {
    console.warn('[editor] markdown serialize failed', err)
    return ''
  }
}

export function docToHTML(doc: JSONContent | null): string {
  if (!doc) return ''
  try {
    return generateHTML(sanitize(doc.type === 'doc' ? doc : { type: 'doc', content: [doc] }), getExtensions({ readOnly: true }))
  } catch (err) {
    console.warn('[editor] html render failed', err)
    return ''
  }
}

/** Heuristic: does this plain text look like Markdown worth parsing on paste? */
export function looksLikeMarkdown(text: string): boolean {
  const s = text.trim()
  if (!s) return false
  const lines = s.split('\n')
  let score = 0
  for (const l of lines) {
    if (/^#{1,6}\s+\S/.test(l)) score += 3
    else if (/^\s*[-*+]\s+\[[ xX]\]\s/.test(l)) score += 3
    else if (/^\s*([-*+]|\d+[.)])\s+\S/.test(l)) score += 1
    else if (/^\s*>\s?/.test(l)) score += 1
    else if (/^```/.test(l)) score += 3
    else if (/^\|.*\|\s*$/.test(l)) score += 1
    else if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(l)) score += 1
    else if (/^\$\$/.test(l)) score += 2
  }
  if (/\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)|~~[^~\n]+~~/.test(s)) score += 2
  return score >= 3 || (lines.length === 1 && score >= 2)
}

const ID_TYPES = new Set(BLOCK_ID_TYPES)

function newBlockId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Give every block a unique `id` (UniqueID contract) directly on the JSON — far cheaper than
 * letting the UniqueID plugin patch hundreds of nodes with transactions on mount.
 * Returns the (possibly new) doc and whether anything changed.
 */
export function withBlockIds(doc: JSONContent): { doc: JSONContent; changed: boolean } {
  const seen = new Set<string>()
  let changed = false
  const walk = (n: JSONContent): JSONContent => {
    let out = n
    if (n.type && ID_TYPES.has(n.type)) {
      const id = n.attrs?.id as string | undefined
      if (!id || seen.has(id)) {
        const fresh = newBlockId()
        out = { ...n, attrs: { ...n.attrs, id: fresh } }
        seen.add(fresh)
        changed = true
      } else seen.add(id)
    }
    if (out.content) {
      const kids = out.content.map(walk)
      if (kids.some((k, i) => k !== out.content![i])) out = { ...out, content: kids }
    }
    return out
  }
  const next = walk(doc)
  return { doc: next, changed }
}
