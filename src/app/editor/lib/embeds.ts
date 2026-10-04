/** URL helpers for embeds and bookmarks (no network access — everything is derived from the URL). */

export type EmbedProvider =
  | 'youtube'
  | 'vimeo'
  | 'loom'
  | 'figma'
  | 'maps'
  | 'codepen'
  | 'gdocs'
  | 'gsheets'
  | 'gslides'
  | 'gforms'
  | 'gdrive'
  | 'miro'
  | 'excalidraw'
  | 'gist'
  | 'spotify'
  | 'soundcloud'
  | 'typeform'
  | 'calendly'
  | 'airtable'
  | 'codesandbox'
  | 'replit'
  | 'twitter'
  | 'pdf'
  | 'web'

export const PROVIDER_LABEL: Record<EmbedProvider, string> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  loom: 'Loom',
  figma: 'Figma',
  maps: 'Google Maps',
  codepen: 'CodePen',
  gdocs: 'Google Docs',
  gsheets: 'Google Sheets',
  gslides: 'Google Slides',
  gforms: 'Google Forms',
  gdrive: 'Google Drive',
  miro: 'Miro',
  excalidraw: 'Excalidraw',
  gist: 'GitHub Gist',
  spotify: 'Spotify',
  soundcloud: 'SoundCloud',
  typeform: 'Typeform',
  calendly: 'Calendly',
  airtable: 'Airtable',
  codesandbox: 'CodeSandbox',
  replit: 'Replit',
  twitter: 'X',
  pdf: 'PDF',
  web: 'Web',
}

/** decodeURIComponent that never throws: URLs keep invalid escapes ("50%off"), shown as-is then. */
export function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

export function parseUrl(raw: string): URL | null {
  const s = raw.trim()
  if (!s) return null
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`)
  } catch {
    return null
  }
}

/**
 * A link target that is safe to put into an href: http(s) / mailto, in-app "#/…" links and
 * (optionally) local file refs. Everything else (javascript:, data:, vbscript: …) → null.
 */
export function safeHref(raw: string | null | undefined, opts: { files?: boolean } = {}): string | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  if (s.startsWith('#')) return s
  if (opts.files && /^onefile:[\w-]+$/.test(s)) return s
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^(https?|mailto):/i.test(s)) return null
  const u = parseUrl(s)
  return u && /^(https?|mailto):$/.test(u.protocol) ? u.toString() : null
}

/** http(s) only — for bookmarks and embeds. */
export function webUrl(raw: string): URL | null {
  const u = parseUrl(raw)
  return u && /^https?:$/.test(u.protocol) && /\./.test(u.hostname) ? u : null
}

export function isUrl(raw: string): boolean {
  const s = raw.trim()
  if (!s || /\s/.test(s)) return false
  if (!/^https?:\/\//i.test(s) && !/^www\./i.test(s)) return false
  const u = parseUrl(s)
  return !!u && /\./.test(u.hostname)
}

export function domainOf(raw: string): string {
  return parseUrl(raw)?.hostname.replace(/^www\./, '') ?? raw
}

/** A link straight to a PDF file (by its path), http(s) only. */
export function isPdfUrl(raw: string): boolean {
  const u = parseUrl(raw)
  return !!u && /^https?:$/.test(u.protocol) && /\.pdf$/i.test(u.pathname)
}

/** File name of a linked file: the URL's last path segment (decoded), else its domain. */
export function fileNameOfUrl(raw: string): string {
  const u = parseUrl(raw)
  const last = u?.pathname.split('/').filter(Boolean).pop()
  return last ? safeDecode(last) : domainOf(raw)
}

/** Detect a known embeddable provider. Returns null for URLs we would only show generically. */
export function detectProvider(raw: string): EmbedProvider | null {
  const u = parseUrl(raw)
  if (!u) return null
  const h = u.hostname.replace(/^www\./, '').toLowerCase()
  const is = (d: string) => h === d || h.endsWith(`.${d}`)
  const path = u.pathname
  if (h === 'youtu.be' || h.endsWith('youtube.com') || h.endsWith('youtube-nocookie.com')) return 'youtube'
  if (h.endsWith('vimeo.com')) return 'vimeo'
  if (h.endsWith('loom.com')) return 'loom'
  if (h.endsWith('figma.com')) return 'figma'
  if ((h.startsWith('google.') || h.includes('.google.') || h === 'maps.app.goo.gl' || h.startsWith('maps.google.')) && (u.pathname.startsWith('/maps') || h.startsWith('maps.'))) return 'maps'
  if (h.endsWith('codepen.io')) return 'codepen'
  if (h === 'docs.google.com') {
    if (path.startsWith('/document/')) return 'gdocs'
    if (path.startsWith('/spreadsheets/')) return 'gsheets'
    if (path.startsWith('/presentation/')) return 'gslides'
    if (path.startsWith('/forms/')) return 'gforms'
  }
  if (h === 'drive.google.com') return 'gdrive'
  if (is('miro.com') && /^\/app\/(board|live-embed)\//.test(path)) return 'miro'
  if (is('excalidraw.com')) return 'excalidraw'
  if (h === 'gist.github.com') return 'gist'
  if (h === 'open.spotify.com') return 'spotify'
  if (is('soundcloud.com')) return 'soundcloud'
  if (is('typeform.com') && path.includes('/to/')) return 'typeform'
  if (is('calendly.com')) return 'calendly'
  if (is('airtable.com')) return 'airtable'
  if (is('codesandbox.io')) return 'codesandbox'
  if (is('replit.com') || is('repl.it')) return 'replit'
  if ((is('twitter.com') || is('x.com')) && /\/status(es)?\/\d+/.test(path)) return 'twitter'
  if (isPdfUrl(raw)) return 'pdf'
  return null
}

/** Segment after `key` in a path (`/document/d/<id>/edit` → id), skipping a Google account switch (`/u/0`). */
function after(path: string[], key: string): string | undefined {
  const i = path.indexOf(key)
  return i >= 0 ? path[i + 1] : undefined
}

/** A path segment (already URL-encoded by URL) as is when it is plain — ids like "uXjVO1Qe4Vk=", "@user" — else encoded. */
const enc = (seg: string) => (/^[\w.~=@%-]+$/.test(seg) ? seg : encodeURIComponent(seg))

/** Google Docs / Sheets / Slides / Forms: a published ("/d/e/<id>") or shared ("/d/<id>") file. */
function googleDocSrc(kind: 'document' | 'spreadsheets' | 'presentation' | 'forms', path: string[]): string | null {
  const id = after(path, 'd')
  if (!id) return null
  const base = `https://docs.google.com/${kind}/d`
  if (id === 'e') {
    const pub = after(path, 'e')
    if (!pub) return null
    if (kind === 'document') return `${base}/e/${enc(pub)}/pub?embedded=true`
    if (kind === 'spreadsheets') return `${base}/e/${enc(pub)}/pubhtml?widget=true&headers=false`
    if (kind === 'presentation') return `${base}/e/${enc(pub)}/embed?start=false&loop=false`
    return `${base}/e/${enc(pub)}/viewform?embedded=true`
  }
  if (kind === 'presentation') return `${base}/${enc(id)}/embed?start=false&loop=false`
  if (kind === 'forms') return `${base}/${enc(id)}/viewform?embedded=true`
  return `${base}/${enc(id)}/preview`
}

/**
 * Provider an embed block shows: the stored one, unless that is the generic 'web' (or missing) and the URL
 * is known by now (older blocks stored 'web' before a provider existed).
 */
export function providerOf(url: string, stored?: string | null): EmbedProvider {
  const own = stored && stored in PROVIDER_LABEL ? (stored as EmbedProvider) : null
  return (own && own !== 'web' ? own : detectProvider(url)) ?? 'web'
}

/** Turn a share URL into an embeddable iframe src. */
export function embedSrc(raw: string, provider?: string | null): string | null {
  const u = parseUrl(raw)
  if (!u || !/^https?:$/.test(u.protocol)) return null
  const p = (provider as EmbedProvider) || detectProvider(raw) || 'web'
  const path = u.pathname.split('/').filter(Boolean)
  switch (p) {
    case 'youtube': {
      let id = u.searchParams.get('v')
      if (u.hostname === 'youtu.be') id = path[0]
      if (!id && (path[0] === 'shorts' || path[0] === 'embed' || path[0] === 'live')) id = path[1]
      if (!id) return null
      const t = u.searchParams.get('t')
      return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}${t ? `?start=${parseInt(t, 10) || 0}` : ''}`
    }
    case 'vimeo': {
      const id = path.find((s) => /^\d+$/.test(s))
      return id ? `https://player.vimeo.com/video/${id}` : null
    }
    case 'loom': {
      const i = path.indexOf('share')
      const id = i >= 0 ? path[i + 1] : path[path.length - 1]
      return id ? `https://www.loom.com/embed/${encodeURIComponent(id)}` : null
    }
    case 'figma':
      return `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(u.toString())}`
    case 'maps': {
      if (u.pathname.startsWith('/maps/embed')) return u.toString()
      const q = u.searchParams.get('q')
      const place = u.pathname.match(/\/maps\/place\/([^/]+)/)?.[1]
      const at = u.pathname.match(/@(-?[\d.]+),(-?[\d.]+)/)
      const query = q ?? (place ? safeDecode(place.replace(/\+/g, ' ')) : at ? `${at[1]},${at[2]}` : '')
      return query ? `https://maps.google.com/maps?q=${encodeURIComponent(query)}&output=embed` : null
    }
    case 'codepen': {
      const i = path.indexOf('pen')
      if (i < 1) return null
      return `https://codepen.io/${path[0]}/embed/${path[i + 1]}?default-tab=result`
    }
    case 'gdocs':
      return googleDocSrc('document', path)
    case 'gsheets':
      return googleDocSrc('spreadsheets', path)
    case 'gslides':
      return googleDocSrc('presentation', path)
    case 'gforms':
      return googleDocSrc('forms', path)
    case 'gdrive': {
      const file = after(path, 'd') ?? (path[0] === 'open' || path[0] === 'uc' ? (u.searchParams.get('id') ?? '').replace(/[^\w-]/g, '') || null : null)
      if (path[0] === 'file' && file) return `https://drive.google.com/file/d/${enc(file)}/preview`
      const folder = after(path, 'folders')
      if (folder) return `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(safeDecode(folder))}#list`
      if (path[0] === 'embeddedfolderview' && u.searchParams.get('id')) return `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(u.searchParams.get('id')!)}#list`
      return file ? `https://drive.google.com/file/d/${enc(file)}/preview` : null
    }
    case 'miro': {
      const id = after(path, 'board') ?? after(path, 'live-embed')
      return id ? `https://miro.com/app/live-embed/${enc(id)}/` : null
    }
    case 'excalidraw':
      // the drawing lives in the hash (#json=… / #room=…) or a read-only link — the URL is the embed
      return u.protocol === 'https:' ? u.toString() : null
    case 'gist': {
      const ids = path.map((s) => s.replace(/\.(js|pibb|json)$/i, ''))
      const id = ids.length >= 2 ? `${ids[0]}/${ids[1]}` : ids[0]
      return id && /^[\w-]+(\/[\da-f]+)?$/i.test(id) ? `https://gist.github.com/${id}.pibb` : null
    }
    case 'spotify': {
      const parts = path[0] === 'embed' ? path.slice(1) : path.filter((s) => !/^intl-/i.test(s))
      const [type, id] = parts
      return type && id && /^(track|album|playlist|episode|show|artist)$/.test(type) ? `https://open.spotify.com/embed/${type}/${enc(id)}` : null
    }
    case 'soundcloud': {
      if (u.hostname === 'w.soundcloud.com') return u.searchParams.get('url') ? u.toString() : null
      if (!path.length) return null
      const track = `https://soundcloud.com/${path.map(enc).join('/')}`
      return `https://w.soundcloud.com/player/?url=${encodeURIComponent(track)}&auto_play=false&hide_related=true&show_comments=false&show_teaser=false&visual=false`
    }
    case 'typeform': {
      const id = after(path, 'to')
      return id ? `https://${u.hostname}/to/${enc(id)}` : null
    }
    case 'calendly':
      return path.length ? `https://calendly.com/${path.map(enc).join('/')}?embed_type=Inline&hide_gdpr_banner=1` : null
    case 'airtable': {
      // only shared views / forms ("shr…") are public; app ids are kept for the link to work
      const app = path.find((s) => /^app\w+$/.test(s))
      const shr = path.find((s) => /^shr\w+$/.test(s))
      return shr ? `https://airtable.com/embed/${app ? `${app}/` : ''}${shr}` : null
    }
    case 'codesandbox': {
      if (path[0] === 'embed' && path[1]) return u.toString()
      if (path[0] === 's' && path[1]) return `https://codesandbox.io/embed/${enc(path[1])}`
      if (path[0] === 'p' && path.length >= 3) return `https://codesandbox.io/p/${path.slice(1).map(enc).join('/')}?embed=1`
      return null
    }
    case 'replit': {
      if (!path[0]?.startsWith('@') || !path[1]) return null
      return `https://replit.com/${enc(path[0])}/${enc(path[1])}?embed=true`
    }
    case 'twitter': {
      const id = path[path.findIndex((s) => s === 'status' || s === 'statuses') + 1]
      // the post renders inside its own frame — no script of X ever runs in this page
      return id && /^\d+$/.test(id) ? `https://platform.twitter.com/embed/Tweet.html?id=${id}&dnt=true` : null
    }
    case 'pdf':
      return isPdfUrl(raw) ? u.toString() : null
    default:
      return u.protocol === 'https:' ? u.toString() : null
  }
}

/** Frame size of an embed: an aspect ratio (height / width) or a fixed height in px (players, widgets). */
export type EmbedFrame = { ratio: number; height?: undefined } | { height: number; ratio?: undefined }

export function embedFrame(provider?: string | null, url = ''): EmbedFrame {
  const path = parseUrl(url)?.pathname ?? ''
  switch (provider) {
    case 'spotify':
      return { height: /\/(track|episode)\//.test(path) ? 152 : 352 }
    case 'soundcloud':
      return { height: /\/sets\//.test(path) || /%2Fsets%2F/i.test(url) ? 450 : 166 }
    case 'twitter':
      return { height: 560 }
    case 'calendly':
      return { height: 700 }
    case 'typeform':
      return { height: 520 }
    case 'gforms':
      return { height: 640 }
    case 'airtable':
      return { height: 533 }
    case 'gist':
      return { height: 360 }
    default:
      return { ratio: embedRatio(provider) }
  }
}

/** Aspect ratio (height / width) used for the embed frame. */
export function embedRatio(provider?: string | null): number {
  switch (provider) {
    case 'figma':
      return 0.62
    case 'maps':
      return 0.5
    case 'codepen':
      return 0.6
    case 'gdocs':
    case 'gdrive':
      return 0.75
    case 'gsheets':
    case 'excalidraw':
    case 'codesandbox':
    case 'replit':
      return 0.62
    case 'gslides':
      return 0.5925
    case 'pdf':
      return 1.1
    case 'web':
      return 0.62
    default:
      return 0.5625
  }
}
