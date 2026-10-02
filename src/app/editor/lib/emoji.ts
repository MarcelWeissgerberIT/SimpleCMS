/** Lazy emoji shortcode data (GitHub-style shortcodes from @tiptap/extension-emoji). */
export interface EmojiEntry {
  emoji: string
  name: string
  shortcodes: string[]
  tags: string[]
}

let cache: EmojiEntry[] | null = null
let pending: Promise<EmojiEntry[]> | null = null

export function loadEmojis(): Promise<EmojiEntry[]> {
  if (cache) return Promise.resolve(cache)
  pending ??= import('@tiptap/extension-emoji').then((m) => {
    cache = m.emojis
      .filter((e) => !!e.emoji && !/^regional_indicator/.test(e.name) && (e.version ?? 0) <= 13.1)
      .map((e) => ({ emoji: e.emoji!, name: e.name, shortcodes: e.shortcodes, tags: e.tags }))
    return cache
  })
  return pending
}

export function emojisLoaded(): EmojiEntry[] | null {
  return cache
}

export function findEmoji(code: string): EmojiEntry | undefined {
  const c = code.toLowerCase()
  return cache?.find((e) => e.shortcodes.includes(c) || e.name === c)
}

export function searchEmojis(list: EmojiEntry[], query: string, limit = 24): EmojiEntry[] {
  const q = query.toLowerCase().replace(/^:/, '')
  if (!q) return list.slice(0, limit)
  const starts: EmojiEntry[] = []
  const contains: EmojiEntry[] = []
  const tagged: EmojiEntry[] = []
  for (const e of list) {
    if (e.shortcodes.some((s) => s.startsWith(q))) starts.push(e)
    else if (e.shortcodes.some((s) => s.includes(q))) contains.push(e)
    else if (e.tags.some((tg) => tg.startsWith(q))) tagged.push(e)
    if (starts.length >= limit) break
  }
  return [...starts, ...contains, ...tagged].slice(0, limit)
}
