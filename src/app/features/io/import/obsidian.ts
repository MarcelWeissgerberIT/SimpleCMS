/**
 * Obsidian vault → ImportPlan (pure, no DOM — unit-testable in Node).
 *
 * The vault's Markdown is rewritten into the Markdown the regular planner + apply.ts understand,
 * then buildPlan() does the tree (folders → pages listing their children), front matter, files:
 *   [[Note]]            → link with #one-m   → mention of the page
 *   [[Note|alias]]      → link with #one-l   → inline link "alias"
 *   [[Note#Heading]]    → link with #one-h=… → link to that heading (block anchor)
 *   ![[Note]]           → link with #one-e   → page link block
 *   ![[image.png|300]]  → image (width 300)   ![[file.pdf]] → file block
 *   > [!type]± Title    → marker paragraph   → callout (see calloutBlocks)
 * Links resolve like Obsidian: exact vault path, then the unique file name (same folder first,
 * then the shortest path), then front matter aliases. Unresolved links stay plain text and are
 * listed in the import report. `.obsidian/`, `.trash/` and other hidden folders are ignored.
 */
import type { JSONContent } from '@tiptap/core'
import { basename, buildPlan, decodeText, dirname, extname, normPath, rewriteLinks, takeFrontMatter, type ImportEntry, type ImportPlan } from './plan'
import type { ReportItem } from './report'

/* ------------------------------------------------------------------ */
/* Markers shared with apply.ts                                        */
/* ------------------------------------------------------------------ */

/** Link fragments the planner adds; apply.ts turns them into mentions, inline links, anchors, embeds. */
export const FRAG = { mention: 'one-m', link: 'one-l', embed: 'one-e', heading: 'one-h=', width: 'one-w=' } as const

const C_OPEN = 'callout:'
const C_CLOSE = ''

/* ------------------------------------------------------------------ */
/* Detection                                                           */
/* ------------------------------------------------------------------ */

const NOTE_EXT = new Set(['md', 'markdown'])
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp'])
const HIDDEN = (p: string) => p.split('/').some((seg) => seg.startsWith('.') || seg === '__MACOSX')
const WIKI = /(!?)\[\[([^[\]\n]+?)\]\]/g

/** A vault: the `.obsidian/` settings folder is part of the files. */
export const isObsidianVault = (entries: ImportEntry[]) => entries.some((e) => /(^|\/)\.obsidian\//.test(e.path.replace(/\\/g, '/')))

/** Markdown with [[wiki links]] and no Notion ids in the file names (Obsidian, Foam, Logseq …). */
export function hasWikiLinks(entries: ImportEntry[]): boolean {
  let notion = false
  let wiki = false
  for (const e of entries) {
    const ext = extname(e.path)
    if (/\s[0-9a-f]{32}(\.\w+)?$/.test(basename(e.path))) notion = true
    if (!wiki && NOTE_EXT.has(ext) && e.data.length < 4_000_000 && e.data.includes(0x5b)) {
      const text = decodeText(e.data)
      WIKI.lastIndex = 0
      if (WIKI.test(text)) wiki = true
    }
  }
  return wiki && !notion
}

/* ------------------------------------------------------------------ */
/* Code-aware rewriting                                                */
/* ------------------------------------------------------------------ */

const FENCE = /^\s{0,3}(?:>\s*)*(`{3,}|~{3,})/
/** a code span: a backtick run, content without a blank line, the same run again */
const INLINE_CODE = /(`+)((?:(?!\1)(?!\n[ \t]*\n)[\s\S])+?)\1(?!`)/g

/**
 * Apply `lines` (line-based) and `inline` to everything outside fenced code blocks and outside
 * inline code spans — links or callouts in a code sample stay untouched.
 */
export function mapOutsideCode(md: string, lines: (text: string) => string, inline: (text: string) => string): string {
  const out: string[] = []
  let buf: string[] = []
  let fence: string | null = null
  const flush = () => {
    if (!buf.length) return
    const text = lines(buf.join('\n'))
    let last = 0
    let res = ''
    for (const m of text.matchAll(INLINE_CODE)) {
      res += inline(text.slice(last, m.index)) + m[0]
      last = m.index! + m[0].length
    }
    out.push(res + inline(text.slice(last)))
    buf = []
  }
  for (const line of md.split('\n')) {
    const m = line.match(FENCE)
    if (fence) {
      out.push(line)
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !line.slice(line.indexOf(m[1]) + m[1].length).trim()) fence = null
      continue
    }
    if (m) {
      flush()
      fence = m[1]
      out.push(line)
      continue
    }
    buf.push(line)
  }
  flush()
  return out.join('\n')
}

/** "> [!tip]- Title" → a marker paragraph + the body as its own paragraph (see calloutBlocks). */
export function markCallouts(text: string): string {
  if (!text.includes('[!')) return text
  return text.replace(/^((?:[ \t]*>)+)[ \t]*\[!([\w-]+)\]([+-]?)[ \t]*(.*)$/gm, (_all, quote: string, type: string, fold: string, title: string) => {
    return `${quote} ${C_OPEN}${type.toLowerCase()}:${fold}${C_CLOSE}${title}\n${quote}`
  })
}

/* ------------------------------------------------------------------ */
/* Callouts (JSON side, used by apply.ts)                              */
/* ------------------------------------------------------------------ */

const CALLOUT_KIND: Record<string, { icon: string; color: string }> = {
  note: { icon: '✏️', color: 'blue' },
  abstract: { icon: '📋', color: 'blue' },
  info: { icon: 'ℹ️', color: 'blue' },
  todo: { icon: '☑️', color: 'blue' },
  tip: { icon: '💡', color: 'green' },
  important: { icon: '❗', color: 'purple' },
  success: { icon: '✅', color: 'green' },
  question: { icon: '❓', color: 'yellow' },
  warning: { icon: '⚠️', color: 'orange' },
  failure: { icon: '❌', color: 'red' },
  danger: { icon: '⚡', color: 'red' },
  bug: { icon: '🐛', color: 'red' },
  example: { icon: '📝', color: 'purple' },
  quote: { icon: '💬', color: 'gray' },
}
const CALLOUT_ALIAS: Record<string, string> = {
  summary: 'abstract',
  tldr: 'abstract',
  hint: 'tip',
  check: 'success',
  done: 'success',
  help: 'question',
  faq: 'question',
  caution: 'warning',
  attention: 'warning',
  fail: 'failure',
  missing: 'failure',
  error: 'danger',
  cite: 'quote',
}

export const calloutStyle = (type: string) => CALLOUT_KIND[CALLOUT_ALIAS[type] ?? type] ?? { icon: '📌', color: 'gray' }

const bold = (nodes: JSONContent[]): JSONContent[] =>
  nodes.map((n) => (n.type === 'text' ? { ...n, marks: [...(n.marks ?? []).filter((m) => m.type !== 'bold'), { type: 'bold' }] } : n))

/** Blockquotes that start with a callout marker → `callout` blocks (foldable ones hold a toggle). */
export function calloutBlocks(nodes: JSONContent[]): JSONContent[] {
  return nodes.map((raw) => {
    const n: JSONContent = raw.content ? { ...raw, content: calloutBlocks(raw.content) } : raw
    if (n.type !== 'blockquote') return n
    const first = n.content?.[0]
    const t0 = first?.type === 'paragraph' ? first.content?.[0] : undefined
    if (t0?.type !== 'text' || !t0.text?.startsWith(C_OPEN)) return n
    const end = t0.text.indexOf(C_CLOSE)
    if (end < 0) return n
    const [type, fold] = t0.text.slice(C_OPEN.length, end).split(':')
    const style = calloutStyle(type)
    const rest = t0.text.slice(end + C_CLOSE.length).replace(/^\s+/, '')
    const titleInline = [...(rest ? [{ ...t0, text: rest }] : []), ...(first!.content ?? []).slice(1)]
    while (titleInline[0]?.type === 'hardBreak') titleInline.shift()
    const body = (n.content ?? []).slice(1)
    let content: JSONContent[]
    if (fold) {
      const summary = titleInline.length ? titleInline : [{ type: 'text', text: type.charAt(0).toUpperCase() + type.slice(1) }]
      content = [
        {
          type: 'details',
          attrs: { open: fold === '+' },
          content: [
            { type: 'detailsSummary', content: summary },
            { type: 'detailsContent', content: body.length ? body : [{ type: 'paragraph' }] },
          ],
        },
      ]
    } else {
      content = [...(titleInline.length ? [{ type: 'paragraph', content: bold(titleInline) }] : []), ...body]
    }
    return { type: 'callout', attrs: { icon: style.icon, color: style.color }, content: content.length ? content : [{ type: 'paragraph' }] }
  })
}

/** Cheap check before walking a doc. */
export const hasCalloutMarker = (md: string) => md.includes(C_OPEN)

/* ------------------------------------------------------------------ */
/* Planner                                                             */
/* ------------------------------------------------------------------ */

const lower = (s: string) => s.normalize('NFC').toLowerCase()
const stripNoteExt = (p: string) => p.replace(/\.(md|markdown)$/i, '')
const mdLabel = (s: string) => s.replace(/[[\]\\]/g, '\\$&')
/** Inside "<…>" link destinations only "%" needs care (the importer URL-decodes paths) */
const encPath = (p: string) => p.replace(/%/g, '%25')

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** Front matter date ("2024-03-01", "2024-03-01 14:30", ISO) → local timestamp. */
export function parseLooseDate(raw: string): number | null {
  const m = raw.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0))
  return Number.isNaN(d.getTime()) ? null : d.getTime()
}

export interface ObsidianOptions {
  looseTitle?: string
  /** vault name when the files carry no wrapper folder (e.g. the ZIP's file name) */
  name?: string
  onProgress?: (done: number, total: number) => void
}

/** Yield to the browser every ~12 ms (MessageChannel isn't clamped like setTimeout). */
function pacer(ms = 12) {
  let last = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
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

export async function buildObsidianPlan(input: ImportEntry[], opts: ObsidianOptions = {}): Promise<ImportPlan> {
  const report: ReportItem[] = []
  let entries = input.map((e) => ({ path: normPath(e.path), data: e.data })).filter((e) => e.path)

  // the vault root: the folder holding ".obsidian/", else the common wrapper folder
  let root = ''
  const settings = entries.map((e) => e.path.match(/^(.*?)(?:^|\/)\.obsidian\//)).filter(Boolean) as RegExpMatchArray[]
  if (settings.length) root = settings.map((m) => m[1]).sort((a, b) => a.length - b.length)[0]
  else
    for (;;) {
      const visible = entries.filter((e) => !HIDDEN(e.path.slice(root ? root.length + 1 : 0)))
      const firsts = new Set(visible.map((e) => {
        const rest = root ? e.path.slice(root.length + 1) : e.path
        return rest.includes('/') ? rest.split('/')[0] : ''
      }))
      if (firsts.size !== 1) break
      const [d] = [...firsts]
      if (!d) break
      root = root ? `${root}/${d}` : d
    }
  const vault = (root ? basename(root) : '') || opts.name || ''
  if (root) entries = entries.filter((e) => e.path.startsWith(`${root}/`)).map((e) => ({ ...e, path: e.path.slice(root.length + 1) }))
  entries = entries.filter((e) => !HIDDEN(e.path))
  // canvases are Obsidian-only JSON boards
  for (const e of entries) if (extname(e.path) === 'canvas') report.push({ code: 'skipped', detail: basename(e.path) })
  entries = entries.filter((e) => extname(e.path) !== 'canvas')

  /* ---------- index: paths, file names, aliases ---------- */
  const exact = new Map<string, string>()
  const byName = new Map<string, string[]>()
  const aliases = new Map<string, string>()
  const add = (k: string, p: string) => {
    const list = byName.get(k)
    if (!list) byName.set(k, [p])
    else if (!list.includes(p)) list.push(p)
  }
  const isNote = (p: string) => NOTE_EXT.has(extname(p))
  const texts = new Map<string, string>()
  const pause = pacer()
  for (const e of entries) {
    await pause()
    const p = e.path
    exact.set(lower(p), p)
    add(lower(basename(p)), p)
    if (isNote(p)) {
      exact.set(lower(stripNoteExt(p)), p)
      add(lower(stripNoteExt(basename(p))), p)
      const text = decodeText(e.data)
      texts.set(p, text)
      const fm = takeFrontMatter(text)
      for (const [k, v] of fm.meta) if (/^(aliases|alias)$/i.test(k)) for (const a of v.split(',').map((s) => s.trim()).filter(Boolean)) if (!aliases.has(lower(a))) aliases.set(lower(a), p)
    }
  }

  const depth = (p: string) => p.split('/').length
  const pick = (list: string[], from: string): string => {
    if (list.length === 1) return list[0]
    const same = list.filter((p) => dirname(p) === dirname(from))
    if (same.length) return same[0]
    return [...list].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))[0]
  }

  /** Obsidian's link resolution: relative, exact vault path, unique file name, alias. */
  const resolve = (link: string, from: string, allowAlias = true): string | null => {
    let l = link.trim().replace(/\\/g, '/')
    if (!l) return from
    if (l.startsWith('/')) l = l.slice(1)
    if (l.startsWith('./') || l.startsWith('../')) {
      const p = normPath(`${dirname(from)}/${l}`)
      const hit = exact.get(lower(p)) ?? exact.get(lower(`${p}.md`))
      if (hit) return hit
    }
    const n = normPath(l)
    const hit = exact.get(lower(n)) ?? exact.get(lower(`${n}.md`))
    if (hit) return hit
    let list = byName.get(lower(basename(n))) ?? []
    if (n.includes('/')) list = list.filter((p) => lower(p).endsWith(`/${lower(n)}`) || lower(stripNoteExt(p)).endsWith(`/${lower(n)}`))
    if (list.length) return pick(list, from)
    return allowAlias ? (aliases.get(lower(l)) ?? null) : null
  }

  /** shortest relative path (via the common ancestor — buildPlan may strip a shared wrapper folder) */
  const relFrom = (fromDir: string, target: string) => {
    const from = fromDir ? fromDir.split('/') : []
    const to = target.split('/')
    let i = 0
    while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++
    return encPath('../'.repeat(from.length - i) + to.slice(i).join('/'))
  }
  const noteName = (p: string) => stripNoteExt(basename(p))

  /* ---------- rewrite every note ---------- */
  const out: ImportEntry[] = []
  const enc = new TextEncoder()
  const notes = entries.filter((e) => isNote(e.path))
  let done = 0
  for (const e of entries) {
    if (!isNote(e.path)) {
      out.push(e)
      continue
    }
    const path = e.path
    const dir = dirname(path)
    const where = noteName(path)
    const text = texts.get(path) ?? decodeText(e.data)
    // keep the front matter block verbatim (buildPlan reads it)
    const fmMatch = text.replace(/^﻿/, '').match(/^---[ \t]*\r?\n[\s\S]*?\r?\n?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/)
    const head = fmMatch && takeFrontMatter(text).meta.length ? fmMatch[0] : ''
    const body = text.replace(/^﻿/, '').slice(head.length).replace(/\r\n?/g, '\n')

    const wiki = (all: string, bang: string, raw: string): string => {
      const inner = raw.replace(/\\\|/g, '|')
      const bar = inner.indexOf('|')
      const target = (bar >= 0 ? inner.slice(0, bar) : inner).trim()
      const alias = bar >= 0 ? inner.slice(bar + 1).trim() : ''
      const hashAt = target.indexOf('#')
      const linkpath = (hashAt >= 0 ? target.slice(0, hashAt) : target).trim()
      const sub = hashAt >= 0 ? target.slice(hashAt + 1).trim() : ''
      const heading = sub && !sub.startsWith('^') ? sub.split('#').pop()!.trim() : ''
      const p = resolve(linkpath, path)
      if (!p) {
        report.push({ code: bang ? 'embed' : 'link', detail: `${bang}[[${target}]]`, where })
        return alias || basename(linkpath) || target
      }
      const rel = relFrom(dir, p)
      const name = isNote(p) ? noteName(p) : basename(p)
      if (bang) {
        if (IMAGE_EXT.has(extname(p))) {
          const size = alias.match(/^(\d+)(?:x\d+)?$/)
          const alt = size ? '' : alias
          return `![${mdLabel(alt)}](<${rel}${size ? `#${FRAG.width}${size[1]}` : ''}>)`
        }
        if (isNote(p)) return `[${mdLabel(alias || name)}](<${rel}#${FRAG.embed}>)`
        return `![${mdLabel(alias || name)}](<${rel}>)`
      }
      if (!isNote(p)) return `[${mdLabel(alias || name)}](<${rel}>)`
      if (heading) return `[${mdLabel(alias || `${linkpath ? name : where} › ${heading}`)}](<${rel}#${FRAG.heading}${encodeURIComponent(heading)}>)`
      if (alias) return `[${mdLabel(alias)}](<${rel}#${FRAG.link}>)`
      return `[${mdLabel(name)}](<${rel}#${FRAG.mention}>)`
    }

    const inline = (seg: string): string => {
      let s = seg.replace(/%%[\s\S]*?%%/g, '')
      // standard Markdown links first: "shortest path" / vault-absolute targets, heading fragments
      s = rewriteLinks(s, (href) => {
        if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.includes('#one-')) return null
        const hashAt = href.indexOf('#')
        const pathPart = hashAt >= 0 ? href.slice(0, hashAt) : href
        const frag = hashAt >= 0 ? safeDecode(href.slice(hashAt + 1)) : ''
        if (!pathPart) return null
        const decoded = safeDecode(pathPart)
        const direct = exact.get(lower(normPath(`${dir}/${decoded}`)))
        const p = direct ?? resolve(decoded, path, false)
        if (!p) return null
        const rel = direct ? encPath(decoded) : relFrom(dir, p)
        const tail = frag && isNote(p) && !frag.startsWith('^') ? `#${FRAG.heading}${encodeURIComponent(frag)}` : ''
        return `<${rel}${tail}>`
      })
      s = s.replace(WIKI, wiki)
      // block ids ("text ^a1b2c3") are Obsidian-internal
      return s.replace(/[ \t]\^[\w-]+$/gm, '')
    }

    const next = mapOutsideCode(body, markCallouts, inline)
    out.push({ path, data: enc.encode(head + next) })
    done++
    opts.onProgress?.(done, notes.length)
    await pause()
  }

  const plan = buildPlan(out, { looseTitle: opts.looseTitle, titleFromFile: true, skipWikiLinks: true })

  // front matter: created / updated become the page's dates, tags read as #tags
  for (const n of plan.nodes) {
    if (!n.meta?.length) continue
    const meta: Array<[string, string]> = []
    for (const [k, v] of n.meta) {
      if (/^(created|date created|created at|created_at|creation date|ctime)$/i.test(k) && parseLooseDate(v) !== null) n.createdAt = parseLooseDate(v)!
      else if (/^(updated|modified|date modified|last modified|updated at|updated_at|mtime)$/i.test(k) && parseLooseDate(v) !== null) n.updatedAt = parseLooseDate(v)!
      else if (/^tags?$/i.test(k))
        meta.push([
          k,
          v
            .split(/[,\s]+/)
            .map((x) => x.trim().replace(/^#/, ''))
            .filter(Boolean)
            .map((x) => `#${x}`)
            .join(' '),
        ])
      else meta.push([k, v])
    }
    if (n.createdAt && !n.updatedAt) n.updatedAt = n.createdAt
    n.meta = meta
  }

  // like Obsidian's file explorer: folders first, then notes A–Z (rows keep their CSV order)
  const kids = new Map<string | null, typeof plan.nodes>()
  for (const n of plan.nodes) {
    const k = n.kind === 'row' ? `row:${n.parentKey}` : n.parentKey
    const list = kids.get(k)
    if (list) list.push(n)
    else kids.set(k, [n])
  }
  const isFolder = (n: (typeof plan.nodes)[number]) => n.kind === 'folder' || kids.has(n.key)
  const ordered: typeof plan.nodes = []
  const visit = (parent: string | null) => {
    const list = [...(kids.get(parent) ?? [])].sort((a, b) => Number(isFolder(b)) - Number(isFolder(a)) || a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }))
    for (const n of list) {
      ordered.push(n)
      for (const r of kids.get(`row:${n.key}`) ?? []) {
        ordered.push(r)
        visit(r.key)
      }
      visit(n.key)
    }
  }
  visit(null)

  return { ...plan, nodes: ordered, roots: ordered.filter((n) => !n.parentKey).map((n) => n.key), source: 'obsidian', name: vault, report: [...(plan.report ?? []), ...report] }
}
