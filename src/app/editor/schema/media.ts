/**
 * Video + audio blocks (schema only — the React views live in ../views/MediaBlockViews.tsx).
 *
 *   video  attrs: src, name, caption, width (px | null), align ('left' | 'center' | 'right')
 *   audio  attrs: src, name, caption
 *
 * `src` is a local file ("onefile:<id>", IndexedDB) or an http(s) URL of a media file.
 * Static HTML: <figure data-type="video|audio"><video|audio controls preload="metadata">; a
 * local file keeps its ref in data-src (exports swap in the real file). Never autoplay.
 * Markdown: an HTML tag on its own line — <video src="…" controls title="caption"></video> —
 * which GitHub / Obsidian render as a player and which imports back into the block.
 */
import { Extension, Node, mergeAttributes, type MarkdownToken } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

export type MediaKind = 'video' | 'audio'
export const MEDIA_KINDS: readonly MediaKind[] = ['video', 'audio']

/** Local media files above this size are refused (IndexedDB holds them in one piece). */
export const MEDIA_MAX_BYTES = 200 * 1024 * 1024

const VIDEO_EXT = /\.(mp4|m4v|webm|mov|ogv|mkv)$/i
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba)$/i

/** Video or audio by MIME type, else by file extension (null for anything else). */
export function mediaKindOf(file: { type?: string | null; name?: string | null }): MediaKind | null {
  const type = (file.type ?? '').toLowerCase()
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('audio/')) return 'audio'
  const name = file.name ?? ''
  if (VIDEO_EXT.test(name)) return 'video'
  if (AUDIO_EXT.test(name)) return 'audio'
  return null
}

/** A direct link to a media file (by its path's extension), or null. */
export function mediaKindOfUrl(raw: string): MediaKind | null {
  try {
    const u = new URL(raw.trim())
    return /^https?:$/.test(u.protocol) ? mediaKindOf({ name: u.pathname }) : null
  } catch {
    return null
  }
}

/** Sources a media block plays: local files and http(s) URLs — never data:, blob:, javascript: … */
export function safeMediaSrc(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (/^onefile:[\w-]+$/.test(s)) return s
  if (!/^https?:\/\/[^\s"'<>]+$/i.test(s)) return null
  try {
    return new URL(s).href
  } catch {
    return null
  }
}

/** File name shown for a linked media file: the URL's last path segment, else its host. */
export function mediaNameFromUrl(raw: string): string {
  try {
    const u = new URL(raw)
    const last = u.pathname.split('/').filter(Boolean).pop() ?? ''
    let name = last
    try {
      name = decodeURIComponent(last)
    } catch {
      /* keep the raw segment */
    }
    return name || u.hostname
  } catch {
    return ''
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** The <video>/<audio> element of a figure (or the element itself). */
function mediaEl(el: HTMLElement): HTMLElement | null {
  return el.matches('video, audio') ? el : el.querySelector<HTMLElement>('video, audio')
}

function srcFromDom(el: HTMLElement): string | null {
  const m = mediaEl(el)
  if (!m) return null
  const raw = m.getAttribute('data-src') ?? m.getAttribute('src') ?? m.querySelector('source[src]')?.getAttribute('src') ?? ''
  return safeMediaSrc(raw)
}

function captionFromDom(el: HTMLElement): string {
  return el.getAttribute('data-caption') ?? el.querySelector(':scope > figcaption')?.textContent ?? mediaEl(el)?.getAttribute('title') ?? ''
}

function nameFromDom(el: HTMLElement): string {
  const own = el.getAttribute('data-name') ?? mediaEl(el)?.getAttribute('data-name')
  if (own) return own
  const src = srcFromDom(el)
  return src && !src.startsWith('onefile:') ? mediaNameFromUrl(src) : ''
}

/* ------------------------------------------------------------------ */
/* Markdown: an HTML tag on its own line                               */
/* ------------------------------------------------------------------ */

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const unescAttr = (s: string) =>
  s.replace(/&(quot|amp|lt|gt|#39|apos);/g, (_m, e: string) => ({ quot: '"', amp: '&', lt: '<', gt: '>', '#39': "'", apos: "'" })[e] ?? _m)

function attrsOf(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) out[m[1].toLowerCase()] = unescAttr(m[2] ?? m[3] ?? m[4] ?? '')
  return out
}

function mediaTokenizer(kind: MediaKind) {
  // <video …></video>, <video …/> or <video …><source src="…"></video> on a line of its own
  const re = new RegExp(`^<${kind}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${kind}\\s*>)[ \\t]*(?:\\n|$)`, 'i')
  return {
    name: kind,
    level: 'block' as const,
    start: (src: string) => src.search(new RegExp(`<${kind}\\b`, 'i')),
    tokenize(src: string) {
      const m = re.exec(src)
      if (!m) return undefined
      const a = attrsOf(m[1])
      const inner = m[2] ?? ''
      const source = /<source\b([^>]*)>/i.exec(inner)
      const src0 = a.src || (source ? attrsOf(source[1]).src : '') || ''
      return { type: kind, raw: m[0], src: src0, title: a.title ?? '', name: a['data-name'] ?? '', width: a.width ?? '' } as MarkdownToken
    },
  }
}

function mediaMarkdown(kind: MediaKind, attrs: Record<string, unknown>): string {
  const src = str(attrs.src).trim()
  // local refs ("onefile:…") are kept: the Markdown exports rewrite them into relative file paths
  if (!/^(onefile:[\w-]+|https?:\/\/\S+)$/i.test(src)) return ''
  const name = str(attrs.name)
  const caption = str(attrs.caption)
  const width = kind === 'video' && Number(attrs.width) > 0 ? Math.round(Number(attrs.width)) : 0
  const parts = [`src="${escAttr(src)}"`, 'controls']
  if (width) parts.push(`width="${width}"`)
  if (caption) parts.push(`title="${escAttr(caption.replace(/\s+/g, ' '))}"`)
  if (name && (src.startsWith('onefile:') || mediaNameFromUrl(src) !== name)) parts.push(`data-name="${escAttr(name)}"`)
  return `<${kind} ${parts.join(' ')}></${kind}>`
}

/* ------------------------------------------------------------------ */
/* Nodes                                                               */
/* ------------------------------------------------------------------ */

/** Attributes the node writes into its markup by hand (renderHTML below). */
const own = () => ({})

function baseAttributes() {
  return {
    src: { default: null, parseHTML: srcFromDom, renderHTML: own },
    name: { default: '', parseHTML: nameFromDom, renderHTML: own },
    caption: { default: '', parseHTML: captionFromDom, renderHTML: own },
  }
}

function mediaElement(kind: MediaKind, rawSrc: unknown, extra: Record<string, string> = {}) {
  const src = safeMediaSrc(rawSrc)
  // the browser can't fetch "onefile:" — the ref stays in data-src for the exports
  const source = src ? (src.startsWith('onefile:') ? { 'data-src': src } : { src }) : {}
  return [kind, { controls: '', preload: 'metadata', ...(kind === 'video' ? { playsinline: '' } : {}), ...extra, ...source }] as const
}

export const Video = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      ...baseAttributes(),
      width: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const w = Number(el.getAttribute('data-width') ?? mediaEl(el)?.getAttribute('width'))
          return w > 0 ? Math.round(w) : null
        },
        renderHTML: own,
      },
      align: {
        default: 'center',
        parseHTML: (el: HTMLElement) => {
          const a = el.getAttribute('data-align')
          return a === 'left' || a === 'right' ? a : 'center'
        },
        renderHTML: own,
      },
    }
  },
  parseHTML() {
    // a bare <video> (pasted from a web page) only when it has a source we can play
    return [{ tag: 'figure[data-type="video"]' }, { tag: 'video', getAttrs: (el: HTMLElement) => (srcFromDom(el) ? null : false) }]
  },
  renderHTML({ node, HTMLAttributes }) {
    const { name, caption, width, align } = node.attrs as { name: string; caption: string; width: number | null; align: string }
    const fig: Record<string, string> = { 'data-type': 'video', class: 'media-block media-block--video', 'data-align': align === 'left' || align === 'right' ? align : 'center' }
    if (name) fig['data-name'] = name
    if (width) {
      fig['data-width'] = String(width)
      fig.style = `width:${width}px;max-width:100%`
    }
    const video = mediaElement('video', node.attrs.src, caption ? { title: caption } : {})
    return ['figure', mergeAttributes(HTMLAttributes, fig), video, ...(caption ? [['figcaption', {}, caption] as const] : [])]
  },
  renderText({ node }) {
    return str(node.attrs.caption) || str(node.attrs.name)
  },
  markdownTokenizer: mediaTokenizer('video'),
  parseMarkdown(token, h) {
    const src = safeMediaSrc(token.src)
    const width = Number(token.width) > 0 ? Math.round(Number(token.width)) : null
    return h.createNode('video', { src, name: str(token.name) || (src && !src.startsWith('onefile:') ? mediaNameFromUrl(src) : ''), caption: str(token.title), width })
  },
  renderMarkdown(node) {
    return mediaMarkdown('video', node.attrs ?? {})
  },
})

export const Audio = Node.create({
  name: 'audio',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return baseAttributes()
  },
  parseHTML() {
    return [{ tag: 'figure[data-type="audio"]' }, { tag: 'audio', getAttrs: (el: HTMLElement) => (srcFromDom(el) ? null : false) }]
  },
  renderHTML({ node, HTMLAttributes }) {
    const { name, caption } = node.attrs as { name: string; caption: string }
    const fig: Record<string, string> = { 'data-type': 'audio', class: 'media-block media-block--audio' }
    if (name) fig['data-name'] = name
    const audio = mediaElement('audio', node.attrs.src, caption ? { title: caption } : {})
    return ['figure', mergeAttributes(HTMLAttributes, fig), audio, ...(caption ? [['figcaption', {}, caption] as const] : [])]
  },
  renderText({ node }) {
    return str(node.attrs.caption) || str(node.attrs.name)
  },
  markdownTokenizer: mediaTokenizer('audio'),
  parseMarkdown(token, h) {
    const src = safeMediaSrc(token.src)
    return h.createNode('audio', { src, name: str(token.name) || (src && !src.startsWith('onefile:') ? mediaNameFromUrl(src) : ''), caption: str(token.title) })
  },
  renderMarkdown(node) {
    return mediaMarkdown('audio', node.attrs ?? {})
  },
})

/* ------------------------------------------------------------------ */
/* Keys on a selected media block                                      */
/* ------------------------------------------------------------------ */

function selectedMedia(view: EditorView): { pos: number; dom: HTMLElement } | null {
  const sel = view.state.selection
  if (!(sel instanceof NodeSelection) || !MEDIA_KINDS.includes(sel.node.type.name as MediaKind)) return null
  const dom = view.nodeDOM(sel.from) as HTMLElement | null
  return dom ? { pos: sel.from, dom } : null
}

/**
 * A selected video / audio block: Space plays / pauses it, Tab moves into its toolbar
 * (inside the toolbar Tab walks the buttons, Escape returns to the block).
 */
export const MediaKeys = Extension.create({
  name: 'mediaKeys',
  // before BlockSelection (1050), which swallows character keys on a selected block
  priority: 1060,
  addKeyboardShortcuts() {
    const view = () => this.editor.view
    return {
      Space: () => {
        const hit = selectedMedia(view())
        const el = hit?.dom.querySelector<HTMLMediaElement>('video, audio')
        if (!el || !el.currentSrc) return !!hit
        if (el.paused) void el.play().catch(() => {})
        else el.pause()
        return true
      },
      Tab: () => {
        const hit = selectedMedia(view())
        const first = hit?.dom.querySelector<HTMLElement>('[data-media-tools] button, [data-media-tools] a[href]')
        if (!first) return false
        first.focus()
        return true
      },
    }
  },
})
