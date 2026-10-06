/**
 * one-worker — the setup page's static files (served by setup.ts under a strict CSP: own script and style
 * only, no CDN, no inline code). INSTRUMENT look like One: warm paper / carbon (prefers-color-scheme), black
 * ink, one signal orange, mono micro-labels, hairlines, 2 px radii. English or German by the browser's
 * language. Everything a repo says (names, paths, branches) is set as text, never as HTML.
 *
 * The script reads the key from the address fragment (#k=…) and sends it as the X-One-Setup header.
 */

export const SETUP_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="referrer" content="no-referrer">
<title>One worker · setup</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="/setup/app.css">
<script src="/setup/app.js" defer></script>
</head>
<body>
<div class="wrap">
<header class="top">
<span class="label top__kicker" id="kicker">§ ONE WORKER</span>
<span class="state" role="status"><span class="led" id="led" data-s="off"></span><span class="label" id="state">…</span></span>
</header>
<main id="app"><p class="lead">…</p></main>
</div>
<footer class="bar" id="bar" hidden></footer>
</body>
</html>
`

export const SETUP_CSS = String.raw`:root {
  --bg: #f2f0ea; --surface: #faf9f5; --surface-2: #eae7df; --ink: #121210; --ink-2: #55524b; --ink-3: #67635b;
  --faint: #8d897f; --rule: rgba(18, 18, 16, 0.1); --rule-strong: rgba(18, 18, 16, 0.2); --signal: #ff4f00;
  --signal-hover: #e84700; --signal-ink: #b83800; --on-signal: #121210; --wash: rgba(255, 79, 0, 0.1);
  --ok: #2f9e44; --off: #b8b3a8; --hover: rgba(18, 18, 16, 0.055);
  --sans: 'Archivo', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace;
  --ease: cubic-bezier(0.2, 0.8, 0.2, 1);
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111110; --surface: #181816; --surface-2: #151513; --ink: #ece9e2; --ink-2: #a9a59c; --ink-3: #8f8b83;
    --faint: #6f6b63; --rule: rgba(236, 233, 226, 0.09); --rule-strong: rgba(236, 233, 226, 0.18); --signal: #ff5c1a;
    --signal-hover: #ff7036; --signal-ink: #ff7a3d; --wash: rgba(255, 92, 26, 0.12); --off: #4a4740;
    --hover: rgba(236, 233, 226, 0.06);
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
html { background: var(--bg); }
body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.5 var(--sans); -webkit-font-smoothing: antialiased; caret-color: var(--signal); }
::selection { background: var(--wash); }
.wrap { max-width: 960px; margin: 0 auto; padding: 22px 24px 120px; }
.label { font: 500 10.5px/1.4 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-2); }
.top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; padding-bottom: 10px; border-bottom: 1px solid var(--ink); }
.top__kicker { color: var(--ink); }
.state { display: inline-flex; align-items: center; gap: 7px; min-width: 0; padding: 3px 8px; border: 1px solid var(--rule-strong); border-radius: 2px; background: var(--surface); }
.state .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.led { flex: none; width: 7px; height: 7px; border-radius: 999px; background: var(--off); box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15); }
.led[data-s='ok'] { background: var(--ok); }
.led[data-s='on'] { background: var(--signal); }
h1 { margin: 26px 0 0; font-size: clamp(24px, 4vw, 34px); font-weight: 800; font-stretch: 125%; letter-spacing: -0.02em; line-height: 1.08; }
.lead { max-width: 66ch; margin: 10px 0 0; color: var(--ink-2); }
.msg { margin: 14px 0 0; padding: 9px 12px; border-left: 2px solid var(--signal); background: var(--surface-2); color: var(--ink-2); font-size: 13px; }
.msg--ok { border-left-color: var(--ok); }
.tools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 22px 0 8px; }
.tools__meta { flex: 1 1 auto; min-width: 180px; }
.btn { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border: 1px solid var(--rule-strong); border-radius: 2px; background: var(--surface); color: var(--ink); font: 500 13px/1 var(--sans); cursor: pointer; transition: background 90ms var(--ease), transform 90ms var(--ease); }
.btn:hover { background: var(--surface-2); }
.btn:active { transform: translateY(1px); }
.btn:disabled { color: var(--faint); cursor: default; transform: none; }
.btn--primary { border-color: var(--signal); background: var(--signal); color: var(--on-signal); font-weight: 650; }
.btn--primary:hover { border-color: var(--signal-hover); background: var(--signal-hover); }
.btn--ghost { border-color: transparent; background: transparent; }
:focus-visible { outline: 2px solid var(--signal); outline-offset: 2px; }
.add { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 8px; margin: 0 0 10px; padding: 10px; border: 1px solid var(--rule-strong); border-radius: 4px; background: var(--surface); }
.add .label { grid-column: 1 / -1; }
.add__err { grid-column: 1 / -1; margin: 0; color: var(--signal-ink); font-size: 12.5px; }
input[type='text'], input[type='number'], select { width: 100%; height: 30px; padding: 0 8px; border: 1px solid var(--rule-strong); border-radius: 2px; background: var(--bg); color: var(--ink); font: 13px var(--mono); }
input[type='text']:focus, input[type='number']:focus, select:focus { border-color: var(--signal); outline: none; }
.list { margin: 0; padding: 0; list-style: none; border: 1px solid var(--rule-strong); border-radius: 4px; background: var(--surface); }
.repo { border-top: 1px solid var(--rule); }
.repo:first-child { border-top: 0; }
.repo[data-on] { box-shadow: inset 2px 0 0 var(--signal); }
.repo__body { min-width: 0; }
.repo__main { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; gap: 2px 12px; align-items: start; padding: 11px 14px 11px 12px; cursor: pointer; }
.repo__main:hover { background: var(--hover); }
.check { appearance: none; -webkit-appearance: none; display: grid; place-content: center; width: 16px; height: 16px; margin: 2px 0 0; border: 1.5px solid var(--ink-2); border-radius: 2px; background: var(--surface); cursor: pointer; }
.check::after { content: ''; width: 8px; height: 4px; margin-top: -2px; border: 2px solid var(--on-signal); border-top: 0; border-right: 0; transform: rotate(-45deg) scale(0); transition: transform 90ms var(--ease); }
.check:checked { border-color: var(--signal); background: var(--signal); }
.check:checked::after { transform: rotate(-45deg) scale(1); }
.repo__name { overflow: hidden; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.repo__path { overflow: hidden; color: var(--ink-2); font: 12px var(--mono); text-overflow: ellipsis; white-space: nowrap; }
.repo__facts { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 5px; }
.repo__facts .label { color: var(--ink-3); }
.repo__facts b { color: var(--ink); font-weight: 500; }
.repo__side { display: grid; justify-items: end; gap: 4px; text-align: right; }
.dirty { display: inline-flex; align-items: center; gap: 6px; }
.detail { display: grid; grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.2fr) minmax(0, 1.6fr); gap: 12px 14px; margin: 0 14px 0 46px; padding: 2px 0 14px; }
.field { display: grid; gap: 4px; align-content: start; min-width: 0; }
.field--wide { grid-column: span 2; }
.keys { display: flex; flex-wrap: wrap; gap: 4px; min-height: 20px; }
.kbd { display: inline-block; padding: 1px 6px; border: 1px solid var(--rule-strong); border-bottom-width: 2px; border-radius: 2px; background: var(--surface); color: var(--ink); font: 11px/1.5 var(--mono); }
.hint { color: var(--ink-3); font-size: 12px; }
.toggles { display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: center; }
.sw { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
.sw input { appearance: none; -webkit-appearance: none; position: relative; width: 28px; height: 16px; margin: 0; border: 1px solid var(--faint); border-radius: 999px; background: var(--surface-2); cursor: pointer; transition: background 90ms var(--ease); }
.sw input::after { content: ''; position: absolute; top: 2px; left: 2px; width: 10px; height: 10px; border-radius: 999px; background: var(--ink-2); transition: transform 90ms var(--ease); }
.sw input:checked { border-color: var(--signal); background: var(--signal); }
.sw input:checked::after { background: var(--on-signal); transform: translateX(12px); }
.limit { display: grid; grid-template-columns: auto 90px; gap: 6px; align-items: center; }
.empty { padding: 22px 14px; color: var(--ink-2); }
.panel { margin: 26px 0 0; border: 1px solid var(--rule-strong); border-radius: 4px; background: var(--surface); }
.panel__head { display: flex; justify-content: space-between; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--rule); background: var(--surface-2); border-radius: 4px 4px 0 0; }
.ro { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 0; }
.ro > div { min-width: 0; padding: 9px 12px; border-left: 1px solid var(--rule); }
.ro > div:first-child { border-left: 0; }
.ro dd { margin: 3px 0 0; overflow: hidden; font: 12.5px var(--mono); text-overflow: ellipsis; }
.log { max-height: 220px; margin: 0; padding: 10px 12px; overflow: auto; border-top: 1px solid var(--rule); color: var(--ink-2); font: 11.5px/1.6 var(--mono); white-space: pre-wrap; word-break: break-word; }
.bar { position: fixed; right: 0; bottom: 0; left: 0; z-index: 10; border-top: 1px solid var(--ink); background: var(--surface); }
.bar__in { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; max-width: 960px; margin: 0 auto; padding: 10px 24px; }
.bar__note { min-width: 0; }
.bar__note .label { display: block; }
.bar__file { color: var(--ink-3); font: 11.5px var(--mono); }
.saved { color: var(--ok); }
@media (max-width: 720px) {
  .wrap { padding: 16px 16px 140px; }
  .repo__main { grid-template-columns: 22px minmax(0, 1fr); }
  .repo__side { grid-column: 2; justify-items: start; text-align: left; grid-auto-flow: column; justify-content: start; gap: 12px; }
  .detail { grid-template-columns: minmax(0, 1fr); margin: 0 14px 0 46px; }
  .field--wide { grid-column: auto; }
  .ro { grid-template-columns: minmax(0, 1fr); }
  .ro > div { border-left: 0; border-top: 1px solid var(--rule); }
  .ro > div:first-child { border-top: 0; }
  .bar__in { padding: 10px 16px; }
  .add { grid-template-columns: minmax(0, 1fr) auto; }
}
@media (max-width: 420px) {
  .detail { margin-left: 14px; }
}
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; }
}
`

export const SETUP_JS = String.raw`(function () {
  'use strict'
  var token = (/[#&]k=([A-Za-z0-9_-]{43})/.exec(location.hash) || [])[1] || ''
  var de = /^de\b/i.test(navigator.language || '')
  var EN = {
    kicker: '§ ONE WORKER — {ws}',
    title: 'Pick the repositories One may work in',
    lead: 'Tick a repository and One can hand it coding tasks: Claude Code works on a branch in its own worktree, your checkout stays as it is. Paths and commands stay on this computer — One only learns the names.',
    loading: 'Looking for git repositories…',
    searching: 'Searching… {d} folders · {n} found',
    reading: 'Reading the repositories… {f} of {n}',
    noKey: 'This page needs its key. Open it at the address the worker printed in its terminal.',
    unbound: 'This worker is not bound to a workspace. Download it from One (Settings → Coding worker) — that file comes ready-paired.',
    noClaude: 'Claude Code was not found. Install it, sign in once (claude), then restart the worker.',
    found: 'Found {n} repositories in {s} s',
    foundOne: 'Found 1 repository in {s} s',
    capTime: 'stopped after {s} s — add a folder if one is missing',
    capCount: 'showing the first {n}',
    capDirs: 'stopped after many folders — add a folder if one is missing',
    blocked: 'macOS did not let the worker look into {list} — a permission dialog may be waiting (allow it, then Rescan), or add the folder.',
    rescan: 'Rescan',
    scanning: 'Scanning…',
    add: 'Add a folder…',
    addLabel: 'The folder of a git repository (~/… or a full path)',
    addGo: 'Add',
    pick: 'Choose a folder…',
    picking: 'A folder dialog opened on your computer — it may be behind this window.',
    noPicker: 'This computer has no folder dialog the worker can open — type the folder instead.',
    cancel: 'Cancel',
    none: 'No git repositories found below your home folder. Add a folder.',
    branch: 'Branch',
    base: 'Base',
    noRemote: 'no remote',
    clean: 'Clean',
    changed: '{n} changed',
    unknown: '—',
    nameLabel: 'Name in One',
    baseLabel: 'Base branch',
    testLabel: 'Test command',
    testHint: 'Runs without a shell — && | > are plain words. Empty: no test stage.',
    noTests: 'No test stage',
    push: 'Push branches',
    pr: 'Pull requests (gh)',
    limit: 'Cost limit per task (USD)',
    noLimit: 'none',
    ticked: '{n} ticked',
    tickedOne: '1 ticked',
    save: 'Save & start',
    saving: 'Saving…',
    saved: 'Saved — One sees {n} repositories now.',
    savedOne: 'Saved — One sees 1 repository now.',
    savedNone: 'Saved — no repositories: One hands this worker no tasks.',
    writes: 'writes {file}',
    status: '§ STATUS',
    one: 'One',
    oneOn: 'Connected · {ws}',
    oneOff: 'Not connected — open One → Settings → Coding worker',
    claude: 'Claude Code',
    claudeOff: 'not found',
    running: 'Running',
    idle: 'Idle',
    log: 'Log',
    stateOn: 'Connected to One',
    stateOff: 'Waiting for One',
    stateBusy: '{n} running',
    failed: 'That did not work: {e}'
  }
  var DE = {
    kicker: '§ ONE WORKER — {ws}',
    title: 'Wähle die Repositories, in denen One arbeiten darf',
    lead: 'Hak ein Repository an, und One kann ihm Coding-Aufgaben geben: Claude Code arbeitet auf einem Branch in einem eigenen Worktree, dein Checkout bleibt, wie er ist. Pfade und Befehle bleiben auf diesem Rechner – One erfährt nur die Namen.',
    loading: 'Suche Git-Repositories…',
    searching: 'Suche läuft … {d} Ordner · {n} gefunden',
    reading: 'Lese die Repositories … {f} von {n}',
    noKey: 'Diese Seite braucht ihren Schlüssel. Öffne sie unter der Adresse, die der Worker in seinem Terminal zeigt.',
    unbound: 'Dieser Worker ist an keinen Arbeitsbereich gebunden. Lade ihn in One herunter (Einstellungen → Coding-Worker) – diese Datei ist schon gekoppelt.',
    noClaude: 'Claude Code wurde nicht gefunden. Installiere es, melde dich einmal an (claude) und starte den Worker neu.',
    found: '{n} Repositories gefunden in {s} s',
    foundOne: '1 Repository gefunden in {s} s',
    capTime: 'nach {s} s angehalten – füge einen Ordner hinzu, falls eines fehlt',
    capCount: 'die ersten {n}',
    capDirs: 'nach sehr vielen Ordnern angehalten – füge einen Ordner hinzu, falls eines fehlt',
    blocked: 'macOS hat dem Worker den Blick in {list} nicht erlaubt – vielleicht wartet ein Erlaubnis-Dialog (erlauben, dann Neu suchen), oder füge den Ordner hinzu.',
    rescan: 'Neu suchen',
    scanning: 'Suche…',
    add: 'Ordner hinzufügen…',
    addLabel: 'Der Ordner eines Git-Repositorys (~/… oder ein vollständiger Pfad)',
    addGo: 'Hinzufügen',
    pick: 'Ordner wählen …',
    picking: 'Auf deinem Computer ist ein Ordner-Dialog aufgegangen – er liegt vielleicht hinter diesem Fenster.',
    noPicker: 'Auf diesem Computer kann der Worker keinen Ordner-Dialog öffnen – gib den Ordner stattdessen ein.',
    cancel: 'Abbrechen',
    none: 'Unter deinem Home-Ordner wurden keine Git-Repositories gefunden. Füge einen Ordner hinzu.',
    branch: 'Branch',
    base: 'Basis',
    noRemote: 'kein Remote',
    clean: 'Sauber',
    changed: '{n} geändert',
    unknown: '—',
    nameLabel: 'Name in One',
    baseLabel: 'Basis-Branch',
    testLabel: 'Testbefehl',
    testHint: 'Läuft ohne Shell – && | > sind normale Wörter. Leer: keine Test-Stufe.',
    noTests: 'Keine Test-Stufe',
    push: 'Branches pushen',
    pr: 'Pull Requests (gh)',
    limit: 'Kostengrenze pro Aufgabe (USD)',
    noLimit: 'keine',
    ticked: '{n} angehakt',
    tickedOne: '1 angehakt',
    save: 'Speichern & starten',
    saving: 'Speichere…',
    saved: 'Gespeichert – One sieht jetzt {n} Repositories.',
    savedOne: 'Gespeichert – One sieht jetzt 1 Repository.',
    savedNone: 'Gespeichert – keine Repositories: One gibt diesem Worker keine Aufgaben.',
    writes: 'schreibt {file}',
    status: '§ STATUS',
    one: 'One',
    oneOn: 'Verbunden · {ws}',
    oneOff: 'Nicht verbunden – öffne One → Einstellungen → Coding-Worker',
    claude: 'Claude Code',
    claudeOff: 'nicht gefunden',
    running: 'Läuft',
    idle: 'Bereit',
    log: 'Log',
    stateOn: 'Mit One verbunden',
    stateOff: 'Warte auf One',
    stateBusy: '{n} läuft',
    failed: 'Das hat nicht geklappt: {e}'
  }
  var L = de ? DE : EN
  document.documentElement.lang = de ? 'de' : 'en'
  function t(key, vars) {
    var s = L[key] || EN[key] || key
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split('{' + k + '}').join(String(vars[k])) })
    return s
  }
  function el(tag, props, kids) {
    var node = document.createElement(tag)
    if (props) Object.keys(props).forEach(function (k) {
      var v = props[k]
      if (v === null || v === undefined || v === false) return
      if (k === 'text') node.textContent = v
      else if (k === 'className') node.className = v
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v)
      else if (k === 'value') node.value = v
      else if (k === 'checked') node.checked = !!v
      else node.setAttribute(k, v === true ? '' : String(v))
    })
    ;(kids || []).forEach(function (c) { if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c) })
    return node
  }
  function $(id) { return document.getElementById(id) }

  function api(method, op, body) {
    var headers = { 'x-one-setup': token }
    if (method === 'POST') headers['content-type'] = 'application/json'
    return fetch('/setup/api/' + op, { method: method, headers: headers, body: method === 'POST' ? JSON.stringify(body || {}) : undefined, cache: 'no-store', credentials: 'omit' }).then(function (r) {
      return r.json().catch(function () { return {} }).then(function (j) {
        if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status)
        return j
      })
    })
  }

  /* -------------------------------------------------- argv like the worker splits it */
  function split(line) {
    var out = [], cur = '', has = false, q = null
    for (var i = 0; i < line.length; i++) {
      var c = line[i]
      if (q === "'") { if (c === "'") q = null; else cur += c }
      else if (q === '"') {
        if (c === '"') q = null
        else if (c === '\\' && (line[i + 1] === '"' || line[i + 1] === '\\')) cur += line[++i]
        else cur += c
      } else if (c === '"' || c === "'") { q = c; has = true }
      else if (c === '\\' && i + 1 < line.length) { cur += line[++i]; has = true }
      else if (/\s/.test(c)) { if (has || cur) out.push(cur); cur = ''; has = false }
      else { cur += c; has = true }
    }
    if (has || cur) out.push(cur)
    return out
  }

  var state = null
  var edits = {}
  var adding = false
  var addError = ''
  var busy = ''
  var note = null

  function ago(ms) {
    if (!ms) return t('unknown')
    var rtf = new Intl.RelativeTimeFormat(de ? 'de' : 'en', { numeric: 'auto' })
    var s = (ms - Date.now()) / 1000
    var steps = [[60, 'second'], [3600, 'minute', 60], [86400, 'hour', 3600], [604800, 'day', 86400], [2629800, 'week', 604800], [31557600, 'month', 2629800], [Infinity, 'year', 31557600]]
    for (var i = 0; i < steps.length; i++) {
      if (Math.abs(s) < steps[i][0]) return rtf.format(Math.round(s / (steps[i][2] || 1)), steps[i][1])
    }
    return ''
  }

  function editOf(r) {
    if (!edits[r.path]) edits[r.path] = { ticked: r.ticked, name: r.name, base: r.base, test: r.testLine, push: r.push, pr: r.pr, limit: r.maxUsdPerTask === null ? '' : String(r.maxUsdPerTask) }
    return edits[r.path]
  }

  var again = 0
  function adopt(next) {
    state = next
    // while the search runs, ask again every second (the list grows as repos are found)
    clearTimeout(again)
    if (state.scan && state.scan.running) again = setTimeout(function () { api('GET', 'state').then(adopt, function () {}) }, 1000)
    var ws = state.workspace && state.workspace.name
    $('kicker').textContent = ws ? t('kicker', { ws: ws }) : '§ ONE WORKER'
    document.title = (ws ? ws + ' · ' : '') + 'One worker'
    render()
    live(state.live)
  }

  function tickedCount() {
    return state.repos.filter(function (r) { return editOf(r).ticked }).length
  }

  function row(r, i) {
    var e = editOf(r)
    var li = el('li', { className: 'repo', 'data-on': e.ticked || null, 'data-path': r.path })
    var box = el('input', { type: 'checkbox', className: 'check', id: 'c' + i, checked: e.ticked, 'aria-label': r.name, onchange: function () { e.ticked = box.checked; note = null; render() } })
    var facts = el('div', { className: 'repo__facts' }, [
      el('span', { className: 'label' }, [t('branch') + ' ', el('b', { text: r.branch || t('unknown') })]),
      el('span', { className: 'label' }, [t('base') + ' ', el('b', { text: r.base })]),
      el('span', { className: 'label', text: r.host || t('noRemote') }),
      el('span', { className: 'label', text: r.test ? r.test.join(' ') : t('noTests') })
    ])
    var dirty = r.dirty === null ? el('span', { className: 'label dirty' }, [el('span', { className: 'led', 'data-s': 'off' }), t('unknown')])
      : r.dirty ? el('span', { className: 'label dirty' }, [el('span', { className: 'led', 'data-s': 'on' }), t('changed', { n: r.dirty })])
      : el('span', { className: 'label dirty' }, [el('span', { className: 'led', 'data-s': 'ok' }), t('clean')])
    var main = el('div', { className: 'repo__main', onclick: function (ev) { if (ev.target !== box) { box.checked = !box.checked; box.dispatchEvent(new Event('change')) } } }, [
      box,
      el('div', { className: 'repo__body' }, [el('div', { className: 'repo__name', text: r.name }), el('div', { className: 'repo__path', text: r.short, title: r.path }), facts]),
      el('div', { className: 'repo__side' }, [dirty, el('span', { className: 'label', text: ago(r.lastCommit) })])
    ])
    li.appendChild(main)
    if (e.ticked) li.appendChild(detail(r, e, i))
    return li
  }

  function detail(r, e, i) {
    var id = 'r' + i
    var keys = el('div', { className: 'keys' })
    function drawKeys() {
      keys.textContent = ''
      var argv = split(e.test)
      if (!argv.length) keys.appendChild(el('span', { className: 'hint', text: t('noTests') }))
      argv.forEach(function (a) { keys.appendChild(el('span', { className: 'kbd', text: a })) })
    }
    drawKeys()
    var base = el('select', { id: id + 'b', onchange: function () { e.base = base.value } })
    var branches = r.branches.indexOf(e.base) >= 0 ? r.branches : [e.base].concat(r.branches)
    branches.forEach(function (b) { base.appendChild(el('option', { value: b, text: b })) })
    base.value = e.base
    var toggles = [el('label', { className: 'sw' }, [el('input', { type: 'checkbox', role: 'switch', checked: e.push, onchange: function (ev) { e.push = ev.target.checked } }), t('push')])]
    if (state.gh) toggles.push(el('label', { className: 'sw' }, [el('input', { type: 'checkbox', role: 'switch', checked: e.pr === 'gh', onchange: function (ev) { e.pr = ev.target.checked ? 'gh' : 'none' } }), t('pr')]))
    return el('div', { className: 'detail' }, [
      el('div', { className: 'field' }, [el('label', { className: 'label', for: id + 'n', text: t('nameLabel') }), el('input', { type: 'text', id: id + 'n', value: e.name, maxlength: 64, spellcheck: 'false', oninput: function (ev) { e.name = ev.target.value } })]),
      el('div', { className: 'field' }, [el('label', { className: 'label', for: id + 'b', text: t('baseLabel') }), base]),
      el('div', { className: 'field' }, [el('label', { className: 'label', for: id + 't', text: t('testLabel') }), el('input', { type: 'text', id: id + 't', value: e.test, spellcheck: 'false', autocomplete: 'off', oninput: function (ev) { e.test = ev.target.value; drawKeys() } }), keys, el('span', { className: 'hint', text: t('testHint') })]),
      el('div', { className: 'field field--wide' }, [el('div', { className: 'toggles' }, toggles)]),
      el('div', { className: 'field' }, [el('div', { className: 'limit' }, [el('label', { className: 'label', for: id + 'l', text: t('limit') }), el('input', { type: 'number', id: id + 'l', min: '0', step: '0.5', value: e.limit, placeholder: t('noLimit'), inputmode: 'decimal', oninput: function (ev) { e.limit = ev.target.value } })])])
    ])
  }

  function render() {
    var app = $('app')
    var focus = document.activeElement && document.activeElement.id
    app.textContent = ''
    app.appendChild(el('h1', { text: t('title') }))
    app.appendChild(el('p', { className: 'lead', text: t('lead') }))
    if (!state) {
      app.appendChild(el('p', { className: 'msg', text: token ? t('loading') : t('noKey') }))
      return
    }
    if (!state.workspace.id) app.appendChild(el('p', { className: 'msg', text: t('unbound') }))
    if (state.live && state.live.claude && !state.live.claude.found) app.appendChild(el('p', { className: 'msg', text: t('noClaude') }))
    var sc = state.scan
    var meta = ''
    if (sc && sc.running) {
      var pr = sc.progress || { dirs: 0, found: 0, facts: 0, phase: 'search' }
      meta = pr.phase === 'facts' ? t('reading', { f: pr.facts, n: pr.found }) : t('searching', { d: pr.dirs, n: pr.found })
    } else if (sc) {
      var secs = (sc.ms / 1000).toFixed(1)
      var n = state.repos.length
      meta = n === 1 ? t('foundOne', { s: secs }) : t('found', { n: n, s: secs })
      if (sc.capped === 'time') meta += ' · ' + t('capTime', { s: Math.round(sc.ms / 1000) })
      if (sc.capped === 'count') meta += ' · ' + t('capCount', { n: n })
      if (sc.capped === 'dirs') meta += ' · ' + t('capDirs')
      if (sc.blocked && sc.blocked.length) app.appendChild(el('p', { className: 'msg', text: t('blocked', { list: sc.blocked.slice(0, 4).join(', ') }) }))
    }
    app.appendChild(el('div', { className: 'tools' }, [
      el('span', { className: 'label tools__meta', text: meta }),
      el('button', { type: 'button', className: 'btn', id: 'rescan', disabled: !!busy, onclick: rescan, text: busy === 'scan' ? t('scanning') : t('rescan') }),
      el('button', { type: 'button', className: 'btn', id: 'pick', disabled: busy === 'pick', onclick: pickFolder, text: t('pick') }),
      el('button', { type: 'button', className: 'btn', id: 'add', 'aria-expanded': adding ? 'true' : 'false', onclick: function () { adding = !adding; addError = ''; render(); var i = $('addpath'); if (i) i.focus() }, text: t('add') })
    ]))
    if (adding) {
      var input = el('input', { type: 'text', id: 'addpath', placeholder: '~/code/my-app', spellcheck: 'false', autocomplete: 'off', onkeydown: function (ev) { if (ev.key === 'Enter') addFolder(input.value); if (ev.key === 'Escape') { adding = false; render() } } })
      app.appendChild(el('div', { className: 'add' }, [
        el('label', { className: 'label', for: 'addpath', text: t('addLabel') }),
        input,
        el('button', { type: 'button', className: 'btn', onclick: function () { addFolder(input.value) }, text: t('addGo') }),
        el('button', { type: 'button', className: 'btn btn--ghost', onclick: function () { adding = false; render() }, text: t('cancel') }),
        addError ? el('p', { className: 'add__err', role: 'alert', text: addError }) : null
      ]))
    }
    var list = el('ul', { className: 'list', id: 'repos' })
    if (!state.repos.length) list.appendChild(el('li', { className: 'empty', text: state.scan && state.scan.running ? t('loading') : t('none') }))
    state.repos.forEach(function (r, i) { list.appendChild(row(r, i)) })
    app.appendChild(list)
    app.appendChild(statusPanel())
    var bar = $('bar')
    bar.hidden = false
    bar.textContent = ''
    var c = tickedCount()
    bar.appendChild(el('div', { className: 'bar__in' }, [
      el('div', { className: 'bar__note' }, [
        el('span', { className: 'label' + (note && note.ok ? ' saved' : ''), id: 'note', role: 'status', text: note ? note.text : c === 1 ? t('tickedOne') : t('ticked', { n: c }) }),
        el('span', { className: 'bar__file', text: t('writes', { file: state.worker.config }) })
      ]),
      el('button', { type: 'button', className: 'btn btn--primary', id: 'save', disabled: !!busy, onclick: save, text: busy === 'save' ? t('saving') : t('save') })
    ]))
    if (focus && $(focus)) $(focus).focus()
    live(lastLive)
  }

  function statusPanel() {
    return el('section', { className: 'panel', 'aria-label': t('status') }, [
      el('div', { className: 'panel__head' }, [el('span', { className: 'label', text: t('status') }), el('span', { className: 'label', text: state.worker.name + ' · ' + state.worker.version })]),
      el('dl', { className: 'ro' }, [
        el('div', null, [el('dt', { className: 'label', text: t('one') }), el('dd', { id: 'st-one', text: '—' })]),
        el('div', null, [el('dt', { className: 'label', text: t('claude') }), el('dd', { id: 'st-claude', text: '—' })]),
        el('div', null, [el('dt', { className: 'label', text: t('running') }), el('dd', { id: 'st-run', text: '—' })])
      ]),
      el('pre', { className: 'log', id: 'st-log', 'aria-label': t('log') })
    ])
  }

  var lastLive = null
  function live(l) {
    if (!l) return
    lastLive = l
    var on = !!l.connected
    $('led').setAttribute('data-s', on ? (l.busy.length ? 'on' : 'ok') : 'off')
    $('state').textContent = on ? (l.busy.length ? t('stateOn') + ' · ' + t('stateBusy', { n: l.busy.length }) : t('stateOn')) : t('stateOff')
    var one = $('st-one'), cl = $('st-claude'), run = $('st-run'), log = $('st-log')
    if (one) one.textContent = on ? t('oneOn', { ws: l.connected.name }) : t('oneOff')
    if (cl) cl.textContent = l.claude.found ? (l.claude.version || 'ok') : t('claudeOff')
    if (run) run.textContent = l.busy.length ? l.busy.map(function (b) { return b.title + ' · ' + b.repo + ' · ' + b.stage }).join('\n') : t('idle')
    if (log) {
      var stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 4
      log.textContent = l.log.join('\n')
      if (stick) log.scrollTop = log.scrollHeight
    }
  }

  function fail(e) {
    note = { ok: false, text: t('failed', { e: e.message }) }
    busy = ''
    render()
  }

  function rescan() {
    busy = 'scan'
    render()
    api('POST', 'scan').then(function (s) { busy = ''; adopt(s) }, fail)
    // the answer comes when the search is done — show its progress meanwhile
    var tick = function () {
      if (busy !== 'scan') return
      api('GET', 'state').then(function (s) { if (busy === 'scan') { state = s; render(); setTimeout(tick, 1000) } }, function () {})
    }
    setTimeout(tick, 600)
  }

  function pickFolder() {
    busy = 'pick'
    note = { ok: true, text: t('picking') }
    render()
    api('POST', 'pick', {}).then(function (res) {
      busy = ''
      note = null
      if (res.none) { adding = true; addError = t('noPicker'); render(); var i = $('addpath'); if (i) i.focus(); return }
      if (res.cancelled) { render(); return }
      adopted(res)
    }, function (e) {
      busy = ''
      note = null
      adding = true
      addError = e.message
      render()
    })
  }

  /** A folder was added (typed or picked): tick it and show it. */
  function adopted(res) {
    adding = false
    addError = ''
    delete edits[res.added]
    adopt(res.state)
    var r = state.repos.filter(function (x) { return x.path === res.added })[0]
    if (r) { editOf(r).ticked = true; render() }
    var node = document.querySelector('[data-path="' + CSS.escape(res.added) + '"]')
    if (node) node.scrollIntoView({ block: 'nearest' })
  }

  function addFolder(path) {
    api('POST', 'add', { path: path }).then(adopted, function (e) { addError = e.message; render(); var i = $('addpath'); if (i) { i.value = path; i.focus() } })
  }

  function save() {
    var repos = state.repos.filter(function (r) { return editOf(r).ticked }).map(function (r) {
      var e = editOf(r)
      var limit = parseFloat(String(e.limit).replace(',', '.'))
      return { path: r.path, name: e.name.trim(), baseBranch: e.base, test: e.test, push: e.push, pr: e.pr, maxUsdPerTask: isFinite(limit) && limit > 0 ? limit : null }
    })
    busy = 'save'
    note = null
    render()
    api('POST', 'save', { repos: repos }).then(function (s) {
      busy = ''
      edits = {}
      var n = s.repos.filter(function (r) { return r.ticked }).length
      note = { ok: true, text: n === 0 ? t('savedNone') : n === 1 ? t('savedOne') : t('saved', { n: n }) }
      adopt(s)
    }, fail)
  }

  function poll() {
    if (!token || !state) return
    api('GET', 'status').then(function (s) { live(s.live) }, function () {})
  }

  render()
  if (token) api('GET', 'state').then(adopt, fail)
  setInterval(poll, 2000)
})()
`
