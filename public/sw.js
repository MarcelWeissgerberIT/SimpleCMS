/*
 * SimpleCMS One service worker — makes the app work offline after the first visit.
 *  - Install: precaches every file the workspace can load, lazy views included (the build
 *    stamps BUILD_ID and PRECACHE below, see vite.config.ts; in dev both stay empty).
 *  - Activate: drops the caches of older builds, except the one before (a tab still running it can
 *    load its lazy views after a deploy took its files off the server).
 *  - Navigations (HTML): network first, cached copy when offline (stored per path, without the query).
 *  - Hashed build assets (/assets/*-<hash>.*): cache first (immutable).
 *  - Other same-origin GETs (icons, covers, emoji data): stale-while-revalidate.
 *  - Cross-origin requests (Anthropic API, your webhooks) are never touched.
 *  - Share target (manifest share_target, POST multipart to app/?share-target): the shared files
 *    + title / text / url go into IndexedDB `one-share` (never the workspace), then a redirect to
 *    app/#/clip?share=<id> — the app shows what arrived and saves it only when asked (shell/capture).
 * The page posts the list of resources it already loaded so the very first visit
 * (which the worker did not control yet) ends up in the cache too.
 */
const BUILD_ID = 'dev'
/** Scope-relative URLs (filled in by the build). */
const PRECACHE = []
const CACHE = 'one-' + BUILD_ID
/** the build caches kept, oldest first (the current one and the one before) */
const META = 'one-meta'
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
      let keep = [CACHE]
      try {
        const meta = await caches.open(META)
        const res = await meta.match('builds')
        const seen = res ? await res.json() : []
        keep = [...(Array.isArray(seen) ? seen : []).filter((k) => typeof k === 'string' && k !== CACHE), CACHE].slice(-2)
        await meta.put('builds', new Response(JSON.stringify(keep), { headers: { 'content-type': 'application/json' } }))
      } catch {
        // no record: keep only this build
      }
      for (const key of await caches.keys()) if (key.startsWith('one-') && key !== META && !keep.includes(key)) await caches.delete(key)
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

/* ------------------------------------------------------------------ */
/* Share target: files from other apps                                 */
/* ------------------------------------------------------------------ */

const SHARE_DB = 'one-share'
const SHARE_STORE = 'shares'
const SHARE_FILE_MAX = 25 * 1024 * 1024
const SHARE_TOTAL_MAX = 50 * 1024 * 1024
const SHARE_FILES_MAX = 20
/** a share nobody picked up is dropped after a day */
const SHARE_KEEP_MS = 24 * 3600_000

/** The same database idb-keyval's createStore('one-share', 'shares') opens in the page (out-of-line keys). */
function openShares() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SHARE_DB)
    req.onupgradeneeded = () => req.result.createObjectStore(SHARE_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function storeShare(entry) {
  return openShares().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(SHARE_STORE, 'readwrite')
        const store = tx.objectStore(SHARE_STORE)
        // shares older than a day were never picked up: gone
        const cursor = store.openCursor()
        cursor.onsuccess = () => {
          const c = cursor.result
          if (!c) return
          if (!c.value || typeof c.value.at !== 'number' || c.value.at < Date.now() - SHARE_KEEP_MS) c.delete()
          c.continue()
        }
        store.put(entry, entry.id)
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = tx.onabort = () => {
          db.close()
          reject(tx.error)
        }
      }),
  )
}

const field = (form, key, max) => {
  const v = form.get(key)
  return typeof v === 'string' ? v.slice(0, max) : ''
}

/** What arrived: texts (cut), files within the limits (≤ 25 MB each, ≤ 50 MB together), the rest listed as skipped. */
async function readShare(req) {
  const form = await req.formData()
  const files = []
  const skipped = []
  let total = 0
  for (const f of form.getAll('files')) {
    if (!(f instanceof File) || (!f.size && !f.name)) continue
    const name = (f.name || 'file').slice(0, 200)
    if (f.size > SHARE_FILE_MAX) skipped.push({ name, size: f.size, reason: 'size' })
    else if (total + f.size > SHARE_TOTAL_MAX || files.length >= SHARE_FILES_MAX) skipped.push({ name, size: f.size, reason: 'total' })
    else {
      total += f.size
      files.push({ name, type: f.type || '', size: f.size, blob: f })
    }
  }
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  return { v: 1, id, at: Date.now(), title: field(form, 'title', 400), text: field(form, 'text', 20_000), url: field(form, 'url', 4_000), files, skipped }
}

/** POST app/?share-target → store, then 303 to app/#/clip?share=<id> (other query parameters stay, e.g. ?e2e). */
async function receiveShare(req) {
  const url = new URL(req.url)
  url.searchParams.delete('share-target')
  const app = `${url.origin}${url.pathname}${url.search}`
  try {
    const entry = await readShare(req)
    await storeShare(entry)
    return Response.redirect(`${app}#/clip?share=${entry.id}`, 303)
  } catch {
    return Response.redirect(`${app}#/clip?share=failed`, 303)
  }
}

const isShareTarget = (req, url) => req.method === 'POST' && url.searchParams.has('share-target') && url.pathname === new URL('app/', self.registration.scope).pathname

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (isShareTarget(req, url)) {
    event.respondWith(receiveShare(req))
    return
  }
  if (req.method !== 'GET') return
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
        // this build's files, or the build before's (a tab still running it)
        const hit = (await cache.match(req, MATCH)) || (await caches.match(req, MATCH))
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
