import { defineConfig, type Plugin, type ResolvedConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Runtime data the workspace fetches from public/ (icon picker, emoji picker). */
const PUBLIC_PRECACHE = [
  'app/',
  'favicon.svg',
  'manifest.webmanifest',
  'assets/icons/manifest.json',
  'vendor/emojibase-data/en/data.json',
  'vendor/emojibase-data/en/messages.json',
  'vendor/emojibase-data/de/data.json',
  'vendor/emojibase-data/de/messages.json',
]

/**
 * Offline service worker, build side: stamps public/sw.js (copied to the out dir) with
 *  - BUILD_ID: a hash of this build's files → a fresh cache name per deploy (old ones are pruned)
 *  - PRECACHE: every file the workspace can load (entry + all lazy chunks, their CSS and fonts),
 *    so views never opened online (calendar, chart, mermaid, import …) still work offline.
 * Landing-only chunks (Three.js intro, html2canvas …) are not reachable from app/index.html and stay out.
 */
function serviceWorkerPrecache(): Plugin {
  let config: ResolvedConfig
  let files: string[] = []
  let buildId = 'dev'
  return {
    name: 'one-sw-precache',
    apply: 'build',
    configResolved(c) {
      config = c
    },
    generateBundle(_options, bundle) {
      const appHtml = resolve(config.root, 'app/index.html')
      const chunks = new Map<string, (typeof bundle)[string]>(Object.entries(bundle))
      const entry = [...chunks.values()].find((c) => c.type === 'chunk' && c.isEntry && c.facadeModuleId && resolve(c.facadeModuleId) === appHtml)
      if (!entry || entry.type !== 'chunk') {
        this.warn('app entry not found — the service worker will not precache')
        return
      }
      const out = new Set<string>()
      const seen = new Set<string>()
      const visit = (fileName: string) => {
        if (seen.has(fileName)) return
        seen.add(fileName)
        const c = chunks.get(fileName)
        if (!c || c.type !== 'chunk') return
        out.add(c.fileName)
        const meta = (c as { viteMetadata?: { importedCss?: Set<string>; importedAssets?: Set<string> } }).viteMetadata
        meta?.importedCss?.forEach((f) => out.add(f))
        meta?.importedAssets?.forEach((f) => out.add(f))
        c.imports.forEach(visit)
        c.dynamicImports.forEach(visit)
      }
      visit(entry.fileName)
      // fonts are referenced from CSS (not tracked per chunk): the Latin subsets the UI uses
      for (const a of chunks.values()) {
        if (a.type === 'asset' && /\.woff2$/.test(a.fileName) && /latin/.test(a.fileName) && !/vietnamese|cyrillic|greek/.test(a.fileName)) out.add(a.fileName)
      }
      // legacy font formats (every browser we support takes woff2) and mermaid's optional ELK layout engine
      // (1.4 MB, only for `layout: elk`) stay out; they still get cached on first use
      const skip = /\.(ttf|woff)$|(^|\/)elk-[^/]*\.js$/
      files = [...PUBLIC_PRECACHE, ...[...out].filter((f) => !skip.test(f)).sort()]
      buildId = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12)
    },
    writeBundle(options) {
      const sw = resolve(options.dir ?? config.build.outDir, 'sw.js')
      if (!existsSync(sw) || !files.length) return
      const src = readFileSync(sw, 'utf8')
      const next = src.replace("const BUILD_ID = 'dev'", `const BUILD_ID = '${buildId}'`).replace('const PRECACHE = []', `const PRECACHE = ${JSON.stringify(files)}`)
      if (next === src) this.warn('sw.js placeholders not found — precache not stamped')
      writeFileSync(sw, next)
    },
  }
}

// BASE_PATH: "/" for getonecms.com (npm run build:pages); "/SimpleCMS/" when a fork serves it as a project page
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), serviceWorkerPrecache()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        app: fileURLToPath(new URL('./app/index.html', import.meta.url)),
      },
    },
  },
  server: {
    host: '127.0.0.1',
    // Team cloud against a local server (server/README.md): ONE_SERVER=http://127.0.0.1:8080 npm run dev
    // (start the server with PUBLIC_URL=<this dev origin> so magic links come back through Vite)
    ...(process.env.ONE_SERVER
      ? {
          proxy: {
            '/api': { target: process.env.ONE_SERVER, changeOrigin: false },
            '/collab': { target: process.env.ONE_SERVER.replace(/^http/, 'ws'), ws: true, changeOrigin: false },
          },
        }
      : {}),
  },
})
