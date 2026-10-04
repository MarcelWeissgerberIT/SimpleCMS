/**
 * The bundled manual (lazy chunk): the article files of both languages, parsed once, plus search.
 * Loaded when the Help panel opens or the palette searches the help — never at boot.
 */
import { buildLibrary, type HelpFile, type HelpLang, type HelpLibrary } from './library'

const RAW = import.meta.glob('./articles/*/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

function files(): HelpFile[] {
  const out: HelpFile[] = []
  for (const [path, raw] of Object.entries(RAW)) {
    const m = /\/articles\/(en|de)\/([a-z0-9-]+)\.md$/.exec(path)
    if (m) out.push({ lang: m[1] as HelpLang, id: m[2], raw })
  }
  return out
}

export const LIBRARY: HelpLibrary = buildLibrary(files(), import.meta.env.DEV ? (msg) => console.warn(msg) : undefined)

export { searchHelp, type HelpHit } from './search'
