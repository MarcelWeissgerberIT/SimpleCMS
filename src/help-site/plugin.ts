/**
 * Vite plugin: the public help pages at /help/ (English) and /help/de/ (German), prerendered from the
 * articles in src/app/help/articles at build time — plus the same pages live in the dev server.
 *
 * Emits help/index.html, help/<id>/index.html, help/de/… and two hashed files: help/help-<hash>.css (the
 * design tokens, the app's fonts and help-site.css) and help/help-<hash>.js (search + keycaps). All links
 * carry the Vite base, so the pages work on getonecms.com ("/") and on a project page ("/SimpleCMS/").
 *
 * "What's new" (src/app/help/changelog/{en,de}/*.md) becomes help/changelog/, help/de/changelog/ and the
 * Atom feed help/changelog.xml. A build FAILS when an entry has no twin in the other language or its
 * screenshot is missing from public/assets/shots/changelog/ (the dev server only warns); the pixel sizes
 * of the screenshots come from sizes.json next to them (written by scripts/changelog-shots.mjs). The id of
 * the newest entry is stamped into the app as import.meta.env.VITE_HELP_CHANGELOG_LATEST (the help LED).
 *
 * File access is injected (vite.config.ts passes node:fs) so this module stays free of Node types and is
 * type-checked with the app.
 */
import { buildLibrary, type HelpFile, type HelpLang, type HelpLibrary } from '../app/help/library.js'
import { buildChangelog, newestEntryId, CHANGELOG_IMAGE_DIR, CHANGELOG_PATH_ID, type ChangelogFile } from '../app/help/changelog/entries.js'
import { CHANGELOG_FEED, renderHelpSite, type SiteNews } from './render.js'

export interface HelpSiteIO {
  readText(path: string): string
  listDir(path: string): string[]
}

export interface HelpSiteOptions {
  /** project root (absolute) */
  root: string
  io: HelpSiteIO
  /** absolute origin for canonical / hreflang links (default https://getonecms.com) */
  origin?: string
  /** a short content hash (e.g. sha256 → hex) for cache-busting file names */
  hash: (text: string) => string
}

/* Minimal shapes of the Vite / Rollup hooks used here (no import from 'vite': keeps Node types out of the app's tsconfig). */
interface BundleFile {
  type: 'asset' | 'chunk'
  fileName: string
}
interface EmitContext {
  emitFile(file: { type: 'asset'; fileName: string; source: string }): string
  warn(message: string): void
}
interface CheckContext {
  warn(message: string): void
  error(message: string): never
}
interface Req {
  url?: string
}
interface Res {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body: string): void
}
interface DevServer {
  middlewares: { use(fn: (req: Req, res: Res, next: () => void) => void): void }
}

export interface HelpSitePlugin {
  name: string
  config(): { define: Record<string, string> }
  configResolved(config: { base: string; command?: string }): void
  buildStart(this: CheckContext): void
  configureServer(server: DevServer): void
  generateBundle(this: EmitContext, options: unknown, bundle: Record<string, BundleFile>): void
}

const FONTS = [
  // [family, weight range, stretch, bundle file pattern, package path for the dev server]
  { family: 'Archivo Variable', weight: '100 900', stretch: '62% 125%', style: 'normal', match: /archivo-latin-wdth-normal-[\w-]+\.woff2$/, dev: '@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2' },
  { family: 'JetBrains Mono Variable', weight: '100 800', stretch: 'normal', style: 'normal', match: /jetbrains-mono-latin-wght-normal-[\w-]+\.woff2$/, dev: '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2' },
]

export function helpSite({ root, io, origin = 'https://getonecms.com', hash }: HelpSiteOptions): HelpSitePlugin {
  let base = '/'
  let command = 'serve'
  const dir = (p: string) => `${root.replace(/\/$/, '')}/${p}`
  const list = (path: string): string[] => {
    try {
      return io.listDir(path)
    } catch {
      return []
    }
  }

  const library = (warn: (msg: string) => void) => {
    const files: HelpFile[] = []
    for (const lang of ['en', 'de'] as HelpLang[]) {
      const d = dir(`src/app/help/articles/${lang}`)
      for (const name of io.listDir(d).sort()) {
        if (name.endsWith('.md')) files.push({ lang, id: name.slice(0, -3), raw: io.readText(`${d}/${name}`) })
      }
    }
    return buildLibrary(files, warn)
  }

  /**
   * "What's new": entries of both languages, checked against their twins, the articles and the screenshots
   * in public/. `fail` gets what must stop a build (a missing twin or image), `warn` the rest.
   */
  const news = (lib: HelpLibrary, warn: (msg: string) => void, fail: (msg: string) => void): SiteNews => {
    const files: ChangelogFile[] = []
    for (const lang of ['en', 'de'] as HelpLang[]) {
      const d = dir(`src/app/help/changelog/${lang}`)
      for (const name of list(d).sort()) {
        if (name.endsWith('.md')) files.push({ lang, id: name.slice(0, -3), raw: io.readText(`${d}/${name}`) })
      }
    }
    const ids = new Set(lib.en.map((a) => a.id))
    if (ids.has(CHANGELOG_PATH_ID)) fail(`help: an article may not be called "${CHANGELOG_PATH_ID}" — that is the changelog's address`)
    const log = buildChangelog(files, warn, fail, ids)
    const shots = new Set(list(dir(`public/${CHANGELOG_IMAGE_DIR}`)))
    let sizes: Record<string, [number, number]> = {}
    try {
      const raw = JSON.parse(io.readText(dir(`public/${CHANGELOG_IMAGE_DIR}/sizes.json`))) as Record<string, [number, number]>
      for (const [name, wh] of Object.entries(raw)) if (Array.isArray(wh) && wh.length === 2) sizes[`${CHANGELOG_IMAGE_DIR}/${name}`] = [Number(wh[0]), Number(wh[1])]
    } catch {
      sizes = {}
    }
    for (const lang of ['en', 'de'] as HelpLang[]) {
      for (const e of log[lang]) {
        const name = e.image.slice(CHANGELOG_IMAGE_DIR.length + 1)
        if (!e.image) continue
        if (!shots.has(name)) fail(`changelog: ${lang}/${e.id}.md shows ${e.image}, which is not in public/${CHANGELOG_IMAGE_DIR}/`)
        else if (!sizes[e.image]) warn(`changelog: no size for ${e.image} in public/${CHANGELOG_IMAGE_DIR}/sizes.json — the page gets no width/height`)
      }
    }
    return { log, sizes }
  }

  /** tokens + fonts + the help site's own rules; `font(i)` = the URL of FONTS[i] as seen from the CSS file */
  const css = (font: (i: number) => string | null) => {
    const faces = FONTS.map((f, i) => {
      const url = font(i)
      return url
        ? `@font-face{font-family:'${f.family}';font-style:${f.style};font-display:swap;font-weight:${f.weight};font-stretch:${f.stretch};src:url(${url}) format('woff2-variations'),url(${url}) format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2190-2199,U+2212,U+2215,U+2318,U+2325,U+21E7,U+FEFF,U+FFFD}`
        : ''
    }).join('\n')
    return `${faces}\n${io.readText(dir('src/shared/tokens.css'))}\n${io.readText(dir('src/help-site/help-site.css'))}`
  }
  const script = () => io.readText(dir('src/help-site/help.js'))

  return {
    name: 'one-help-site',

    // the newest entry's id for the help LED (no content in the main bundle)
    config() {
      let latest = ''
      try {
        latest = newestEntryId(news(library(() => {}), () => {}, () => {}).log) ?? ''
      } catch {
        latest = ''
      }
      return { define: { 'import.meta.env.VITE_HELP_CHANGELOG_LATEST': JSON.stringify(latest) } }
    },

    configResolved(config) {
      base = config.base || '/'
      command = config.command ?? 'serve'
    },

    // a build stops on a changelog entry without its twin or its screenshot (CHANGELOG_DRAFT=1: the
    // screenshot may be missing — the build scripts/changelog-shots.mjs takes the new pictures from)
    buildStart() {
      if (command !== 'build') return
      const draft = !!(globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.CHANGELOG_DRAFT
      const problems: string[] = []
      news(library(() => {}), (m) => this.warn(m), (m) => (draft && /is not in public\//.test(m) ? this.warn(m) : problems.push(m)))
      if (problems.length) this.error(`help site: ${problems.length} changelog problem${problems.length === 1 ? '' : 's'}:\n  ${problems.join('\n  ')}`)
    },

    // dev: render on request (articles edited → reload shows them)
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0]
        const prefix = `${base}help`
        if (url !== prefix && !url.startsWith(`${prefix}/`)) return next()
        const send = (type: string, body: string, status = 200) => {
          res.statusCode = status
          res.setHeader('Content-Type', type)
          res.setHeader('Cache-Control', 'no-store')
          res.end(body)
        }
        try {
          const rel = url.slice(base.length) // "help/…"
          if (rel === 'help/help.css') return send('text/css; charset=utf-8', css((i) => `${base}node_modules/${FONTS[i].dev}`))
          if (rel === 'help/help.js') return send('text/javascript; charset=utf-8', script())
          const lib = library((m) => console.warn(m))
          const pages = renderHelpSite(lib, { base, origin, css: 'help/help.css', script: 'help/help.js' }, news(lib, (m) => console.warn(m), (m) => console.warn(m)))
          if (rel === CHANGELOG_FEED) {
            const feed = pages.find((p) => p.file === CHANGELOG_FEED)
            return feed ? send('application/atom+xml; charset=utf-8', feed.html) : next()
          }
          const want = rel.endsWith('/') ? `${rel}index.html` : rel.endsWith('.html') ? rel : `${rel}/index.html`
          const page = pages.find((p) => p.file === want)
          if (page) return send('text/html; charset=utf-8', page.html)
          return next()
        } catch (e) {
          return send('text/plain; charset=utf-8', `help pages failed: ${e instanceof Error ? e.stack : String(e)}`, 500)
        }
      })
    },

    generateBundle(_options, bundle) {
      const assets = Object.values(bundle).filter((f) => f.type === 'asset')
      // from help/help-<hash>.css up to the site root
      const fontUrl = (i: number) => {
        const hit = assets.find((a) => FONTS[i].match.test(a.fileName))
        return hit ? `../${hit.fileName}` : null
      }
      FONTS.forEach((f, i) => {
        if (!fontUrl(i)) this.warn(`help site: font ${f.family} not found in the bundle — falling back to system fonts`)
      })
      const cssText = css(fontUrl)
      const jsText = script()
      const cssFile = `help/help-${hash(cssText)}.css`
      const jsFile = `help/help-${hash(jsText)}.js`
      this.emitFile({ type: 'asset', fileName: cssFile, source: cssText })
      this.emitFile({ type: 'asset', fileName: jsFile, source: jsText })
      const lib = library((m) => this.warn(m))
      // buildStart has stopped the build on problems already: these warnings stay quiet
      const pages = renderHelpSite(lib, { base, origin, css: cssFile, script: jsFile }, news(lib, () => {}, () => {}))
      for (const p of pages) this.emitFile({ type: 'asset', fileName: p.file, source: p.html })
    },
  }
}
