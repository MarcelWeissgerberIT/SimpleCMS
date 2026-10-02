/** URL helpers for embeds and bookmarks (no network access — everything is derived from the URL). */

export type EmbedProvider = 'youtube' | 'vimeo' | 'loom' | 'figma' | 'maps' | 'codepen' | 'web'

export const PROVIDER_LABEL: Record<EmbedProvider, string> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  loom: 'Loom',
  figma: 'Figma',
  maps: 'Google Maps',
  codepen: 'CodePen',
  web: 'Web',
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

/** Detect a known embeddable provider. Returns null for URLs we would only show generically. */
export function detectProvider(raw: string): EmbedProvider | null {
  const u = parseUrl(raw)
  if (!u) return null
  const h = u.hostname.replace(/^www\./, '')
  if (h === 'youtu.be' || h.endsWith('youtube.com') || h.endsWith('youtube-nocookie.com')) return 'youtube'
  if (h.endsWith('vimeo.com')) return 'vimeo'
  if (h.endsWith('loom.com')) return 'loom'
  if (h.endsWith('figma.com')) return 'figma'
  if ((h.startsWith('google.') || h.includes('.google.') || h === 'maps.app.goo.gl' || h.startsWith('maps.google.')) && (u.pathname.startsWith('/maps') || h.startsWith('maps.'))) return 'maps'
  if (h.endsWith('codepen.io')) return 'codepen'
  return null
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
      const query = q ?? (place ? decodeURIComponent(place.replace(/\+/g, ' ')) : at ? `${at[1]},${at[2]}` : '')
      return query ? `https://maps.google.com/maps?q=${encodeURIComponent(query)}&output=embed` : null
    }
    case 'codepen': {
      const i = path.indexOf('pen')
      if (i < 1) return null
      return `https://codepen.io/${path[0]}/embed/${path[i + 1]}?default-tab=result`
    }
    default:
      return u.protocol === 'https:' ? u.toString() : null
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
    case 'web':
      return 0.62
    default:
      return 0.5625
  }
}
