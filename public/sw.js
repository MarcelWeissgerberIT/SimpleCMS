/*
 * SimpleCMS One service worker — makes the app work offline after the first visit.
 *  - Navigations (HTML): network first, cached copy when offline.
 *  - Hashed build assets (/assets/*-<hash>.*): cache first (immutable).
 *  - Other same-origin GETs (icons, covers, emoji data): stale-while-revalidate.
 *  - Cross-origin requests (Anthropic API, your webhooks) are never touched.
 * The page posts the list of resources it already loaded so the very first visit
 * (which the worker did not control yet) ends up in the cache too.
 */
const CACHE = 'one-runtime-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key)
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'cache-urls' || !Array.isArray(event.data.urls)) return
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        event.data.urls
          .filter((u) => typeof u === 'string' && new URL(u).origin === self.location.origin)
          .map((u) => cache.match(u).then((hit) => hit || cache.add(u)).catch(() => {})),
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

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE)
        try {
          const res = await fetch(req)
          if (res.ok) cache.put(req, res.clone())
          return res
        } catch {
          return (await cache.match(req, { ignoreSearch: true })) || (await cache.match(new URL('./', req.url).href)) || Response.error()
        }
      })(),
    )
    return
  }

  if (isHashedAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE)
        const hit = await cache.match(req)
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
      const hit = await cache.match(req)
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
