/**
 * Claude's text and what it may carry into a page (claudeDoc, every caller — MCP, the AI terminal, agents, scripts'
 * Claude, the AI menu):
 *
 *  - raw HTML: only the tags the file form itself writes (docToFileMarkdown — toggles' details / summary with a
 *    heading inside, br, video / audio of this workspace's files, the tabs / breadcrumb comments). Any other tag stays
 *    text: `<div data-type="database-block">`, a button with actions, a spreadsheet … never become blocks by HTML.
 *  - `data:` sources (image, video, audio, file blocks): never kept and never decoded (nothing is saved while a call is
 *    only planned) — a line of text in their place.
 *  - `onefile:` refs: kept only when the file is this workspace's (its stamp, lib/files.ts StoredFile.ws, when this tab
 *    knows it — `loadFileStamps` reads it first; an unstamped legacy file falls back to the next check), a live page of
 *    this workspace outside the templates that the caller may read references it already, and it is not private while
 *    the target is shared (team: a private upload, or a file only private pages use — a shared write would publish
 *    it). Else the ref becomes text. MCP refuses the private case outright (`privateScopeRefusal`, `private_scope`).
 */
import type { JSONContent } from '@tiptap/core'
import { useWorkspace } from '../../store/store'
import { inTemplate, isEffectivelyTrashed } from '../../store/selectors'
import type { ID, Page } from '../../store/types'
import { FILE_PREFIX, fileWorkspace, knownFileStamp } from '../../lib/files'
import { isPrivateFile } from '../../cloud'

/* ------------------------------------------------------------------ */
/* Raw HTML                                                            */
/* ------------------------------------------------------------------ */

/** The tags docToFileMarkdown writes (claudeFiles.spec derives them by a round trip over every node type). */
const FILE_FORM_TAGS = new Set(['details', 'summary', 'h1', 'h2', 'h3', 'br', 'video', 'audio', 'source'])
const MEDIA_TAGS = new Set(['video', 'audio', 'source'])
const TAG = /<\/?\s*([a-zA-Z][\w-]*)([^>]*)>/g
const SRC = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi

/**
 * May this raw HTML (one token of Claude's Markdown) become nodes? Only the file form's own tags; video / audio only
 * with `onefile:` sources. Comments build nothing. Anything else → false (it stays text).
 */
export function claudeHtml(html: string): boolean {
  const rest = html.replace(/<!--[\s\S]*?-->/g, '')
  if (/<[!?]/.test(rest)) return false
  for (const m of rest.matchAll(TAG)) {
    const name = m[1]!.toLowerCase()
    if (!FILE_FORM_TAGS.has(name)) return false
    if (MEDIA_TAGS.has(name)) {
      for (const s of (m[2] ?? '').matchAll(SRC)) if (!/^onefile:[\w-]+$/.test((s[1] ?? s[2] ?? s[3] ?? '').trim())) return false
    } else if (/\bon[a-z]+\s*=|\bstyle\s*=|\bdata-/i.test(m[2] ?? '')) return false
  }
  return true
}

/* ------------------------------------------------------------------ */
/* Files                                                               */
/* ------------------------------------------------------------------ */

const REF = /onefile:([A-Za-z0-9_-]{1,64})/g

/** The `onefile:` refs in a value (a doc, a page's cover, properties, Markdown). */
export function fileRefsIn(value: unknown, into = new Set<string>()): Set<string> {
  let text = ''
  try {
    text = typeof value === 'string' ? value : (JSON.stringify(value) ?? '')
  } catch {
    return into
  }
  if (!text.includes(FILE_PREFIX)) return into
  for (const m of text.matchAll(REF)) into.add(`${FILE_PREFIX}${m[1]}`)
  return into
}

/** Where a workspace's pages use a file: on any page, on a shared (non-private) one. */
interface Use {
  shared: boolean
}

let indexMemo: { pages: Record<ID, Page>; uses: Map<string, Use> } | null = null

/** Every file the live, non-template pages reference (content, cover, properties) — memoised per store state. */
function fileUses(visible: ((id: ID) => boolean) | null): Map<string, Use> {
  const { pages } = useWorkspace.getState()
  if (!visible && indexMemo?.pages === pages) return indexMemo.uses
  const uses = new Map<string, Use>()
  for (const p of Object.values(pages)) {
    if (p.trashed || (visible && !visible(p.id))) continue
    const refs = new Set<string>()
    fileRefsIn(p.content, refs)
    fileRefsIn(p.cover, refs)
    fileRefsIn(p.properties, refs)
    fileRefsIn(p.localization, refs)
    if (!refs.size || isEffectivelyTrashed(pages, p.id) || inTemplate(pages, p.id)) continue
    for (const r of refs) {
      const u = uses.get(r) ?? { shared: false }
      if (!p.private) u.shared = true
      uses.set(r, u)
    }
  }
  if (!visible) indexMemo = { pages, uses }
  return uses
}

export type FileDrop = 'workspace' | 'unreachable' | 'private'

export interface FileRules {
  /** the target page is private (team) — undefined: not known, no scope check */
  private?: boolean
  /** the pages the caller may read (a custom agent's scope); null / absent: every live page */
  visible?: ((id: ID) => boolean) | null
}

/** Why a ref may not go into the target (null: it may). */
export function fileDrop(ref: string, rules: FileRules = {}): FileDrop | null {
  const stamp = knownFileStamp(ref)
  const here = fileWorkspace()
  if (stamp && here && stamp !== here) return 'workspace'
  const use = fileUses(rules.visible ?? null).get(ref)
  if (!use) return 'unreachable'
  if (rules.private === false && (isPrivateFile(ref) || !use.shared)) return 'private'
  return null
}

/** The refs of a Markdown text (or doc) that are private while the target is shared — MCP refuses them. */
export function privateRefsFor(value: unknown, targetPrivate: boolean, visible: ((id: ID) => boolean) | null = null): string[] {
  if (targetPrivate) return []
  return [...fileRefsIn(value)].filter((r) => fileDrop(r, { private: false, visible }) === 'private')
}

/** The MCP refusal for private files into a shared page (spec § 3.3: the person moves such a file by hand). */
export function privateScopeRefusal(refs: string[], target: string): string {
  return `private_scope: ${refs.slice(0, 5).join(', ')}${refs.length > 5 ? ` (+${refs.length - 5})` : ''}: a private file cannot go into ${target}, which the whole workspace sees. Nothing was changed. Leave the file out, or ask the person to move it by hand.`
}

const DATA = /^\s*data:/i
const FILE_BLOCKS = new Set(['image', 'video', 'audio', 'fileBlock'])

const textLine = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] })

export interface FileReport {
  /** refs turned into text, with why */
  dropped: Array<{ ref: string; why: FileDrop }>
  /** data: sources turned into text */
  inline: number
}

/**
 * The document with every `data:` source and every ref that may not go into the target as text (see the header).
 * `mcp`: the text of a removed inline image names the tool that attaches files.
 */
export function withCheckedFiles(doc: JSONContent, rules: FileRules & { mcp?: boolean } = {}): { doc: JSONContent; report: FileReport } {
  const report: FileReport = { dropped: [], inline: 0 }
  const json = (() => {
    try {
      return JSON.stringify(doc)
    } catch {
      return ''
    }
  })()
  if (!json.includes(FILE_PREFIX) && !/"data:/i.test(json)) return { doc, report }
  const verdict = new Map<string, FileDrop | null>()
  const why = (ref: string) => {
    if (!verdict.has(ref)) verdict.set(ref, fileDrop(ref, rules))
    return verdict.get(ref)!
  }
  const fixMarks = (n: JSONContent): JSONContent => {
    if (!n.marks?.length) return n
    const marks = n.marks.filter((m) => {
      if (m.type !== 'link') return true
      const href = String(m.attrs?.href ?? '').trim()
      if (DATA.test(href)) return false
      if (!href.startsWith(FILE_PREFIX)) return true
      const w = why(href)
      if (w) report.dropped.push({ ref: href, why: w })
      return !w
    })
    return marks.length === n.marks.length ? n : { ...n, marks }
  }
  const fix = (n: JSONContent): JSONContent[] => {
    if (n.type && FILE_BLOCKS.has(n.type)) {
      const src = String(n.attrs?.src ?? '').trim()
      if (DATA.test(src)) {
        report.inline++
        // MCP: the tool that attaches a file arrives with T-b (one_attach_file); until then the line names no tool
        return [textLine(rules.mcp ? '[inline image removed — add the picture in One]' : '[inline image removed]')]
      }
      if (src.startsWith(FILE_PREFIX)) {
        const w = why(src)
        if (w) {
          report.dropped.push({ ref: src, why: w })
          return [textLine(`[${src} — not available here]`)]
        }
      }
    }
    const self = fixMarks(n)
    if (!self.content) return [self]
    const kids = self.content.flatMap(fix)
    return kids.length === self.content.length && kids.every((k, i) => k === self.content![i]) ? [self] : [{ ...self, content: kids }]
  }
  const [out] = fix(doc)
  return { doc: out ?? doc, report }
}
