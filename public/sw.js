/*
 * SimpleCMS One service worker — makes the app work offline after the first visit.
 *  - Install: precaches every file the workspace can load, lazy views included (the build
 *    stamps BUILD_ID and PRECACHE below, see vite.config.ts; in dev both stay empty).
 *  - Activate: drops the caches of older builds.
 *  - Navigations (HTML): network first, cached copy when offline (stored per path, without the query).
 *  - Hashed build assets (/assets/*-<hash>.*): cache first (immutable).
 *  - Other same-origin GETs (icons, covers, emoji data): stale-while-revalidate.
 *  - Cross-origin requests (Anthropic API, your webhooks) are never touched.
 * The page posts the list of resources it already loaded so the very first visit
 * (which the worker did not control yet) ends up in the cache too.
 */
const BUILD_ID = 'dev'
/** Scope-relative URLs (filled in by the build). */
const PRECACHE = []
const CACHE = 'one-' + BUILD_ID
const MATCH = { ignoreVary: true }

self.addEventListener('install', (event) => {
  self.skipWaiting()
  // one by one: a single failing file must not throw the rest away
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        Promise.allSettled(
          PRECACHE.map((path) => {
            const url = new URL(path, self.registration.scope).href
            return cache.match(url, MATCH).then((hit) => hit || cache.add(url))
          }),
        ),
      )
      .catch(() => {}),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith('one-') && key !== CACHE) await caches.delete(key)
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'cache-urls' || !Array.isArray(event.data.urls)) return
  // offline: nothing to fetch (and every attempt would only log an error)
  if (!self.navigator.onLine) return
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        event.data.urls
          .filter((u) => typeof u === 'string' && new URL(u).origin === self.location.origin)
          .map((u) => cache.match(u, MATCH).then((hit) => hit || cache.add(u)).catch(() => {})),
      ),
    ),
  )
})

const isHashedAsset = (url) => /\/assets\/.+-[A-Za-z0-9_-]{8,}\.(js|css|woff2?|png|webp|svg|jpg)$/.test(url.pathname)

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  // video streams use Range requests, and the Cache API cannot store partial responses
  if (req.headers.has('range') || /\.(mp4|webm|mov)$/i.test(url.pathname)) return
  // team cloud (served from the same origin): API answers and the live channel are never cached
  const rel = url.pathname.slice(new URL(self.registration.scope).pathname.length)
  if (rel.startsWith('api/') || rel === 'collab' || rel.startsWith('collab/')) return

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE)
        try {
          const res = await fetch(req)
          // one entry per page, keyed without the query: share-target URLs (?title=…&text=…&url=…)
          // must neither pile up in the cache nor keep what was shared on the device
          if (res.ok) cache.put(url.origin + url.pathname, res.clone())
          return res
        } catch {
          return (
            (await cache.match(req, { ignoreSearch: true, ignoreVary: true })) ||
            (await cache.match(new URL('./', req.url).href, MATCH)) ||
            Response.error()
          )
        }
      })(),
    )
    return
  }

  if (isHashedAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE)
        const hit = await cache.match(req, MATCH)
        if (hit) return hit
        const res = await fetch(req)
        if (res.ok) cache.put(req, res.clone())
        return res
      })(),
    )
    return
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      const hit = await cache.match(req, MATCH)
      const network = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone())
          return res
        })
        .catch(() => hit || Response.error())
      return hit || network
    })(),
  )
})
