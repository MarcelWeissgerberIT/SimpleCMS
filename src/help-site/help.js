/*
 * The public help pages' only script (no framework): platform keycaps (⌘ on a Mac), "/" to search, and the
 * search of the index page over the articles embedded as JSON (#help-data). Mirrors the app's help search
 * in small: every word is looked up in title, keywords, summary and text; more words matched rank higher.
 */
;(function () {
  'use strict'
  var mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
  if (mac) {
    var MAC = { Mod: '⌘', Alt: '⌥', Shift: '⇧' }
    document.querySelectorAll('kbd[data-keys]').forEach(function (k) {
      k.textContent = k.getAttribute('data-keys').split('+').map(function (p) { return MAC[p] || p }).join('')
    })
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
    var t = e.target
    if (t && t.closest && t.closest('input, textarea, [contenteditable]')) return
    var input = document.querySelector('[data-search] input')
    if (!input) return
    e.preventDefault()
    input.focus()
  })

  var dataEl = document.getElementById('help-data')
  var form = document.querySelector('[data-search]')
  var results = document.getElementById('results')
  var chapters = document.querySelector('[data-chapters]')
  if (!dataEl || !form || !results || !chapters) return
  var input = form.querySelector('input')
  var list = results.querySelector('[data-list]')
  var count = results.querySelector('[data-count]')
  var items = JSON.parse(dataEl.textContent || '[]')

  var fold = function (s) {
    return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  }
  var STOP = ' a an the to of in on for with and or how do does i can my is it what why where when you your be this that from at by as are not if der die das den dem des ein eine einen und oder wie kann ich mein meine ist es was warum wo wann du dein zu von mit im auf fur an am bei aus nicht kein '
  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] })
  }
  var index = items.map(function (it) {
    return { it: it, title: fold(it.t), keys: fold(it.k), sum: fold(it.m), text: fold(it.x) }
  })
  var startsWord = function (hay, w) {
    var i = hay.indexOf(w)
    while (i >= 0) {
      if (i === 0 || !/[a-z0-9ß]/.test(hay[i - 1])) return true
      i = hay.indexOf(w, i + 1)
    }
    return false
  }
  var mark = function (text, words) {
    var hay = fold(text)
    var out = ''
    var pos = 0
    var hits = []
    words.forEach(function (w) {
      for (var i = hay.indexOf(w), n = 0; i >= 0 && n < 20; i = hay.indexOf(w, i + w.length), n++) hits.push([i, i + w.length])
    })
    hits.sort(function (a, b) { return a[0] - b[0] })
    hits.forEach(function (h) {
      if (h[0] < pos) return
      out += esc(text.slice(pos, h[0])) + '<mark>' + esc(text.slice(h[0], h[1])) + '</mark>'
      pos = h[1]
    })
    return out + esc(text.slice(pos))
  }
  var snippet = function (text, words) {
    var hay = fold(text)
    var at = -1
    words.forEach(function (w) {
      var i = hay.indexOf(w)
      if (i >= 0 && (at < 0 || i < at)) at = i
    })
    if (at < 0) return ''
    var from = Math.max(0, at - 50)
    var to = Math.min(text.length, at + 130)
    return (from > 0 ? '…' : '') + mark(text.slice(from, to), words) + (to < text.length ? '…' : '')
  }

  var search = function (q) {
    var all = (fold(q).match(/[a-z0-9ß]+/g) || []).filter(function (w) { return w.length > 1 })
    var words = all.filter(function (w) { return STOP.indexOf(' ' + w + ' ') < 0 })
    if (!words.length) words = all
    if (!words.length) return null
    var hits = []
    index.forEach(function (e) {
      var total = 0
      var matched = 0
      words.forEach(function (w) {
        var s = Math.max(startsWord(e.title, w) ? 12 : e.title.indexOf(w) >= 0 ? 8 : 0, startsWord(e.keys, w) ? 7 : e.keys.indexOf(w) >= 0 ? 5 : 0, e.sum.indexOf(w) >= 0 ? 4 : 0, e.text.indexOf(w) >= 0 ? 2 : 0)
        if (s) matched++
        total += s
      })
      if (total) hits.push({ e: e, score: total * (0.4 + 0.6 * Math.pow(matched / words.length, 2)) })
    })
    hits.sort(function (a, b) { return b.score - a.score })
    return { words: words, hits: hits.slice(0, 30) }
  }

  var base = form.getAttribute('action') || ''
  var run = function () {
    var q = input.value.trim()
    var r = q ? search(q) : null
    try {
      var url = new URL(window.location.href)
      if (q) url.searchParams.set('q', q)
      else url.searchParams.delete('q')
      history.replaceState(null, '', url.pathname + url.search + url.hash)
    } catch (err) {}
    if (!r) {
      results.hidden = true
      chapters.hidden = false
      return
    }
    results.hidden = false
    chapters.hidden = true
    var n = r.hits.length
    count.textContent = n ? (n === 1 ? count.getAttribute('data-one') : count.getAttribute('data-other').replace('{count}', String(n))) : count.getAttribute('data-none')
    list.innerHTML = r.hits
      .map(function (h) {
        var it = h.e.it
        return (
          '<li><a class="row" href="' + esc(base + it.i + '/') + '"><span class="row-num">' + esc(it.n) + '</span><span class="row-main"><span class="lbl">' + esc(it.s) + '</span><span class="row-title">' + mark(it.t, r.words) + '</span><span class="row-snip">' + snippet(it.x, r.words) + '</span></span><span class="row-go" aria-hidden="true">→</span></a></li>'
        )
      })
      .join('')
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault()
    run()
    var first = list.querySelector('a')
    if (first && input.value.trim()) first.focus()
  })
  input.addEventListener('input', run)
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && input.value) {
      input.value = ''
      run()
    }
  })
  var initial = new URLSearchParams(window.location.search).get('q')
  if (initial) {
    input.value = initial
    run()
  }
})()
