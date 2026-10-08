/*
 * One — paint the boot screen in this device's theme and the workspace look it last saw, before anything
 * else runs (a classic script in <head>: the team server's CSP allows same-origin scripts, never inline ones).
 * Reads only localStorage `one.theme` and the per-device look cache `one.look` (lib/look/apply.ts) and takes
 * nothing but #rrggbb values from it. The app (main.tsx) applies the full look right after. Share and form
 * links (#/s/, #/f/) keep One's standard look.
 */
;(function () {
  try {
    var html = document.documentElement
    var pref = localStorage.getItem('one.theme')
    var dark = pref === 'dark' || (pref !== 'light' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches)
    html.setAttribute('data-theme', dark ? 'dark' : 'light')
    var hash = location.hash || ''
    if (hash.indexOf('#/s/') === 0 || hash.indexOf('#/f/') === 0) return
    var scope = 'local'
    var w = new URLSearchParams(location.search).get('w') || localStorage.getItem('one.cloud.active')
    if (w && /^[A-Za-z0-9_-]{8,64}$/.test(w)) scope = w
    var cache = JSON.parse(localStorage.getItem('one.look') || 'null')
    var entry = cache && cache.ws && cache.ws[scope]
    if (!entry || entry.standard || !entry.paint) return
    var paint = entry.paint[dark ? 'dark' : 'light']
    var hex = /^#[0-9a-f]{6}$/
    if (!paint || !hex.test(paint.bg) || !hex.test(paint.ink3) || !hex.test(paint.signal)) return
    html.style.setProperty('--boot-bg', paint.bg)
    html.style.setProperty('--boot-ink', paint.ink3)
    html.style.setProperty('--boot-led', paint.signal)
  } catch (e) {
    /* blocked storage or a broken cache: the standard boot screen */
  }
})()
