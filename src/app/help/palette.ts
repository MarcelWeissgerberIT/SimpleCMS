/**
 * Help articles in the command palette (⌘K): the manual is loaded on the first search, then searched
 * like in the Help panel. Light module — the content chunk is imported on demand.
 */
import { useEffect, useMemo, useState } from 'react'
import type { Lang } from '@/shared/i18n'

type ContentModule = typeof import('./content')

let loaded: ContentModule | null = null
let loading: Promise<ContentModule> | null = null

/** The manual (lazy chunk), loaded once. */
export function loadHelpContent(): Promise<ContentModule> {
  if (loaded) return Promise.resolve(loaded)
  loading ??= import('./content')
    .then((m) => (loaded = m))
    .catch((e) => {
      loading = null
      throw e
    })
  return loading
}

export interface HelpPaletteHit {
  id: string
  title: string
  /** "03.2" */
  num: string
  section: string
}

/** The best help articles for a palette search (empty until the manual has loaded). */
export function useHelpHits(term: string, lang: Lang, limit = 4): HelpPaletteHit[] {
  const [mod, setMod] = useState<ContentModule | null>(loaded)
  const q = term.trim()
  useEffect(() => {
    if (mod || q.length < 2) return
    let live = true
    loadHelpContent()
      .then((m) => live && setMod(m))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [mod, q])
  return useMemo(
    () => {
      if (!mod || q.length < 2) return []
      const hits = mod.searchHelp(mod.LIBRARY, lang, q, limit)
      // the palette is for "what did they mean": only articles close to the best match
      const best = hits[0]?.score ?? 0
      return hits.filter((h) => h.score >= best * 0.4).map(({ article: a }) => ({ id: a.id, title: a.title, num: a.num, section: a.section }))
    },
    [mod, q, lang, limit],
  )
}
