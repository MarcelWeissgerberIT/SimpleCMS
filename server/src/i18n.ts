export type Lang = 'en' | 'de'

/** Explicit choice (the app's language setting) wins over the browser's Accept-Language. */
export function pickLang(explicit: string | null | undefined, acceptLanguage: string | null | undefined): Lang {
  if (explicit === 'de' || explicit === 'en') return explicit
  const ranked = (acceptLanguage ?? '')
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';')
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
      return { tag: tag.toLowerCase(), q: q ? Number(q.slice(2)) || 0 : 1 }
    })
    .filter((x) => x.tag)
    .sort((a, b) => b.q - a.q)
  for (const { tag } of ranked) {
    if (tag === 'de' || tag.startsWith('de-')) return 'de'
    if (tag === 'en' || tag.startsWith('en-')) return 'en'
  }
  return 'en'
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string)

/** The name of a person's own workspace, created at their first sign-in: "Ada’s space" / "Bereich von Ada". */
export function personalSpaceName(lang: Lang, who: string): string {
  const name = who.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 80)
  return lang === 'de' ? `Bereich von ${name}` : `${name}’s space`
}
