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
.marks { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; justify-content: space-between; }
.marks span { flex: 1 1 320px; min-width: 0; }
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
.clone { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 10px 12px; margin: 0 0 10px; padding: 12px; border: 1px solid var(--rule-strong); border-left: 2px solid var(--signal); border-radius: 4px; background: var(--surface); }
.clone__keys { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; grid-column: 1 / -1; }
.clone .msg, .clone .add__err, .clone > .hint, .clone > .label { grid-column: 1 / -1; margin: 0; }
.clone__bar { height: 3px; background: var(--rule); grid-column: 1 / -1; }
.clone__bar > span { display: block; height: 100%; background: var(--signal); transition: width 260ms var(--ease); }
.projects { grid-column: 1 / -1; display: grid; gap: 6px; padding-top: 10px; border-top: 1px solid var(--rule); }
.projects__head { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 8px; align-items: center; }
.projects ul { max-height: 260px; margin: 0; padding: 0; overflow: auto; list-style: none; border: 1px solid var(--rule); border-radius: 2px; }
.proj { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 10px; width: 100%; padding: 7px 10px; border: 0; border-top: 1px solid var(--rule); background: transparent; color: var(--ink); text-align: left; cursor: pointer; font: inherit; }
.projects li:first-child .proj { border-top: 0; }
.proj:hover, .proj[aria-pressed='true'] { background: var(--hover); }
.proj[aria-pressed='true'] { box-shadow: inset 2px 0 0 var(--signal); }
.proj__path { overflow: hidden; font: 12.5px var(--mono); text-overflow: ellipsis; white-space: nowrap; }
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
.forge select { max-width: 320px; }
.wmcp { margin: 14px 0 0; max-width: 640px; }
.keys { display: flex; flex-wrap: wrap; gap: 4px; min-height: 20px; }
.kbd { display: inline-block; padding: 1px 6px; border: 1px solid var(--rule-strong); border-bottom-width: 2px; border-radius: 2px; background: var(--surface); color: var(--ink); font: 11px/1.5 var(--mono); }
.allowed { grid-column: 1 / -1; }
.rules { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
.rule { display: inline-flex; align-items: stretch; border: 1px solid var(--rule-strong); border-bottom-width: 2px; border-radius: 2px; background: var(--surface); }
.rule code { padding: 2px 7px; color: var(--ink); font: 11.5px/1.6 var(--mono); overflow-wrap: anywhere; }
.rule button { min-width: 28px; padding: 0 8px; border: 0; border-left: 1px solid var(--rule); background: transparent; color: var(--ink-2); font: 13px var(--sans); cursor: pointer; }
.rule button:hover { background: var(--hover); color: var(--signal-ink); }
.rule button:focus-visible { outline: 2px solid var(--signal); outline-offset: -2px; }
.hint { color: var(--ink-3); font-size: 12px; }
.warn { padding-left: 8px; border-left: 2px solid var(--signal); color: var(--signal-ink); font-size: 12px; }
.own { grid-column: 1 / -1; padding-top: 10px; border-top: 1px solid var(--rule); }
.own .sw { align-items: flex-start; }
.own .sw input { flex: none; margin-top: 2px; }
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
  .clone { grid-template-columns: minmax(0, 1fr); }
  .projects__head { grid-template-columns: minmax(0, 1fr) auto; }
  .projects__head .label { grid-column: 1 / -1; }
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
    ollamaTitle: 'Ollama Cloud · API',
    ollamaHint: 'Cloud model: selected source, prompts and tool results go to Ollama. The same One / Atlas harness applies. The key is saved privately on this computer, outside the One workspace. Ollama plan quotas apply; One cannot meter dollar limits for this tariff.',
    ollamaReady: 'Key saved · not yet verified with Ollama',
    ollamaEmpty: 'No API key configured',
    ollamaEnvironment: 'An environment key takes precedence. Remove OLLAMA_API_KEY and restart the worker to remove it.',
    ollamaKey: 'Ollama API key',
    ollamaKeep: 'Leave empty to keep the saved key',
    ollamaContext: 'Context budget (tokens)',
    ollamaModel: 'Cloud model name',
    ollamaModels: 'Browse Ollama cloud models (use the API name)',
    ollamaSave: 'Save Ollama Cloud settings',
    ollamaRemove: 'Remove saved Ollama key',
    ollamaSaved: 'Settings saved. No model request was made.',
    ollamaError: 'Ollama Cloud settings could not be saved.',
    ollamaTest: 'Test connection (cloud request)',
    ollamaTested: 'Cloud request succeeded with the saved key and model.',
    ollamaTestError: 'Cloud test failed. Check your saved key, model and Ollama quota.',
    miniTitle: 'MiniMax M3.1 Flash · API',
    miniHint: 'Cloud model: selected source, prompts and tool results are sent to MiniMax. The same One / Atlas tools and task memory apply. Save your own API key on this computer; it is never sent to the One workspace.',
    miniReady: 'Key saved · not yet verified with MiniMax',
    miniEmpty: 'No API key configured',
    miniEnvironment: 'An environment key takes precedence. Remove MINIMAX_API_KEY and restart the worker to revoke it.',
    miniKey: 'MiniMax API key',
    miniKeep: 'Leave empty to keep the saved key',
    miniContext: 'Context budget (tokens)',
    miniEffort: 'Thinking effort',
    miniSave: 'Save MiniMax settings',
    miniRemove: 'Remove saved MiniMax key',
    miniSaved: 'Settings saved. No model request was made.',
    miniError: 'MiniMax settings could not be saved.',
    miniSetup: 'Configure MiniMax',

    kicker: '§ ONE WORKER — {ws}',
    title: 'Pick the repositories One may work in',
    lead: 'Tick a repository and One can hand it coding tasks: Claude Code works on a branch in its own worktree, your checkout stays as it is. Paths and commands stay on this computer — One only learns the names.',
    loading: 'Looking for git repositories…',
    searching: 'Searching… {d} folders · {n} found',
    reading: 'Reading the repositories… {f} of {n}',
    noKey: 'This page needs its key. Open it at the address the worker printed in its terminal.',
    unbound: 'This worker is not bound to a workspace. Download it from One (Settings → Coding worker) — that file comes ready-paired.',
    noClaude: 'Claude Code was not found. Install it and sign in once (claude) — the worker looks for it again: this page within seconds, a stage when you press Retry in One. Installed where PATH does not reach? Set CLAUDE_BIN and restart the worker.',
    noClaudeWin: 'Claude Code was not found. Install it — its native installer (PowerShell: irm https://claude.ai/install.ps1 | iex; it needs Git for Windows) or npm i -g @anthropic-ai/claude-code — and sign in once (claude): the worker looks for it again, this page within seconds, a stage when you press Retry in One. A .cmd the worker cannot read is never started through cmd.exe: then set CLAUDE_BIN to claude.exe or Claude Code’s cli.js and restart the worker.',
    syncedicloud: 'In iCloud Drive: git waits for files that are only in the cloud. Faster: a clone outside it (~/one-repos).',
    syncedcloudStorage: 'In a synced cloud folder (~/Library/CloudStorage): files may be downloaded on demand and locked while they sync. Faster: a clone outside it.',
    syncedonedrive: 'In OneDrive: online-only files are downloaded first and files are locked while they sync, so git steps can stall. Faster: move the repo out of OneDrive (e.g. to C:\\code).',
    wthome: 'Its task worktrees stay out of it, in .one-worktrees in your home folder.',
    wtown: 'Its task worktrees stay out of it.',
    wtsynced: 'Its task worktrees lie in a synced folder too (worktreeDir in worker.json) — set one outside it.',
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
    testHint: 'Runs without a shell — && | > are plain words. A program inside the repository needs its path (./gradlew). Empty: no test stage.',
    testHintWin: 'Runs without a shell — && | > are plain words. A program inside the repository needs its path (.\\gradlew.bat); it is looked up in PATH only, never in the repository. Empty: no test stage.',
    analyzeLabel: 'Static analysis',
    analyzeHint: 'The Static analysis stage runs this (a linter, dotnet build, go vet …) — its findings go into the task page. Empty: none.',
    noTests: 'No test stage',
    push: 'Push branches',
    pr: 'Pull / merge requests (gh · glab)',
    forgeLabel: 'Host type',
    forgeAuto: 'Automatic — {kind}',
    forgeNone: 'not recognised',
    forgeGitlab: 'GitLab (also self-hosted)',
    forgeGithub: 'GitHub (also Enterprise)',
    forgeHint: 'Automatic reads the address: a host with “gitlab” or “github” in its name. A self-hosted GitLab or GitHub Enterprise under its own name: pick it here — then One links commits and branches, and the worker opens merge / pull requests with glab / gh.',
    limit: 'Cost limit per task (USD)',
    mcpLabel: 'Own MCP servers for Claude Code, local Ollama, Ollama Cloud and MiniMax',
    mcpHint: 'Names as “claude mcp list” shows them, e.g. kb — this repo\'s stages may use their tools (a knowledge base, a design system). Empty: only One\'s task tools.',
    allowedLabel: 'Allowed without asking',
    allowedHint: 'What Claude Code may do in this repo without asking you — added by “Always for this repo” in One (or by hand in worker.json). Remove one and press Save: One asks again next time.',
    allowedNone: 'Nothing yet — when you allow a command in One with “Always for this repo”, it shows here.',
    allowedRemove: 'Remove {rule}',
    allowedRemoved: '{n} removed — press Save',
    ownLabel: 'Use this repo’s own Claude Code settings (.claude/, .mcp.json, CLAUDE.md, local MCP servers)',
    ownMine: 'On for your own repositories. Off: Claude Code starts with your own settings only (--setting-sources user).',
    ownWhy: 'Off by default: {why}. Switch it on only for code you trust.',
    whycloned: 'cloned by the worker',
    whyimported: 'imported by the worker from a ZIP',
    whymarked: 'marked as code from elsewhere (a clone in ~/one-repos when the worker updated)',
    marks: 'This worker version marked {list} as code from elsewhere — an older worker cloned or imported {them}. Claude Code now runs on {them} without {their} own settings (.claude/, .mcp.json, CLAUDE.md); switch them on below for a repository you trust.',
    marksIt: 'it',
    marksThem: 'them',
    marksIts: 'its',
    marksTheir: 'their',
    marksOk: 'Got it',
    whycloneDir: 'in the clone folder',
    ownWarn: 'On: this repo’s hooks and helper commands (apiKeyHelper, its MCP servers) will run on this computer when a task starts.',
    mcpUser: 'Its own settings are off: only servers added with “claude mcp add -s user …” reach this repo.',
    clone: 'Clone from GitLab / GitHub…',
    cloneUrl: 'Clone address — on the project page under Clone (HTTPS or SSH)',
    cloneDir: 'Into the folder',
    cloneDirHint: 'A folder that is not synced (not iCloud, OneDrive or Dropbox) — git would wait for files from the cloud. Kept with Save & start.',
    cloneGo: 'Clone',
    cloning: 'Cloning {name}… {line}',
    cloned: 'Cloned {name} — ticked below. Save & start to hand it tasks.',
    cloneFailed: 'The clone failed: {e}',
    cloneAuth: 'git signs in with your SSH key or credential helper (glab auth login · gh auth setup-git) — the worker cannot type a password.',
    projects: 'Your projects',
    projectsLoading: 'Asking glab / gh for your projects…',
    projectsNone: 'Install glab (GitLab) or gh (GitHub) and sign in to pick from your projects here — or paste the address above.',
    filter: 'Filter',
    via: 'Clone via',
    zip: 'Import a ZIP…',
    zipLabel: 'A ZIP of source code',
    uploading: 'Uploading {name}…',
    importing: 'Unpacking {name}… {line}',
    imported: 'Imported {name} as a new repository (one commit, no remote) — ticked below. Save & start to hand it tasks.',
    importFailed: 'The import failed: {e}',
    pubTitle: 'Also create it on GitLab / GitHub — then Ship can push and open merge requests',
    pubHost: 'Where',
    pubOwner: 'Group / owner',
    pubOwnerHint: 'Empty: your own account. A GitLab group can be nested (acme/platform).',
    pubName: 'Project name',
    pubNameHint: 'Suggested from the code (package.json, pom.xml, README …) or the ZIP\'s name.',
    pubVis: 'Visibility',
    visPrivate: 'Private',
    visInternal: 'Internal',
    visPublic: 'Public',
    pubGo: 'Create & push',
    pubSkip: 'Not now',
    publishing: 'Creating {name}… {line}',
    published: 'Created {web} and pushed main — push and merge requests are on for this repository.',
    pubFailed: 'That did not work: {e}',
    noLimit: 'none',
    ticked: '{n} ticked',
    tickedOne: '1 ticked',
    save: 'Save & start',
    saving: 'Saving…',
    saved: 'Saved — One sees {n} repositories now.',
    savedOne: 'Saved — One sees 1 repository now.',
    savedNone: 'Saved — no repositories: this worker takes only document tasks without a repository (Business analysis, QA).',
    wmcpLabel: 'Default MCP servers · Claude Code / Ollama / Ollama Cloud / MiniMax',
    wmcpHint: 'Business analysis / QA tasks without a repo run here with these servers (names as “claude mcp list” shows them, e.g. kb) — added with “claude mcp add -s user …”: a server in the default local scope stays out. Ollama and MiniMax also use this list when the repository has no list of its own; personal JSON connections come from ~/.claude.json or ONE_CODER_MCP_CONFIG.',
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
    ollamaTitle: 'Ollama Cloud · API',
    ollamaHint: 'Cloud-Modell: Ausgewählter Quelltext, Prompts und Werkzeugergebnisse gehen an Ollama. Der One-/Atlas-Harness gilt auch hier. Der Key wird privat auf diesem Rechner gespeichert, außerhalb des One-Arbeitsbereichs. Es gelten Ollamas Tariflimits; One kann für diesen Tarif keine Dollargrenzen messen.',
    ollamaReady: 'Key gespeichert · noch nicht bei Ollama geprüft',
    ollamaEmpty: 'Kein API-Key hinterlegt',
    ollamaEnvironment: 'Ein Umgebungs-Key hat Vorrang. Zum Entfernen OLLAMA_API_KEY entfernen und den Worker neu starten.',
    ollamaKey: 'Ollama API-Key',
    ollamaKeep: 'Leer lassen, um den gespeicherten Key zu behalten',
    ollamaContext: 'Kontextbudget (Tokens)',
    ollamaModel: 'Name des Cloud-Modells',
    ollamaModels: 'Ollama-Cloud-Modelle ansehen (API-Namen verwenden)',
    ollamaSave: 'Ollama-Cloud-Einstellungen speichern',
    ollamaRemove: 'Gespeicherten Ollama-Key entfernen',
    ollamaSaved: 'Einstellungen gespeichert. Es wurde keine Modellanfrage gesendet.',
    ollamaError: 'Ollama-Cloud-Einstellungen konnten nicht gespeichert werden.',
    ollamaTest: 'Verbindung testen (Cloud-Anfrage)',
    ollamaTested: 'Cloud-Anfrage mit gespeichertem Key und Modell erfolgreich.',
    ollamaTestError: 'Cloud-Test fehlgeschlagen. Gespeicherten Key, Modell und Ollama-Kontingent prüfen.',
    miniTitle: 'MiniMax M3.1 Flash · API',
    miniHint: 'Cloud-Modell: Ausgewählter Quelltext, Prompts und Werkzeugergebnisse gehen an MiniMax. Die One-/Atlas-Werkzeuge und das Aufgabengedächtnis gelten auch hier. Deinen eigenen API-Key nur auf diesem Rechner speichern; er wird nicht an den One-Arbeitsbereich gesendet.',
    miniReady: 'Key gespeichert · noch nicht bei MiniMax geprüft',
    miniEmpty: 'Kein API-Key eingerichtet',
    miniEnvironment: 'Ein Umgebungs-Key hat Vorrang. Zum Widerrufen MINIMAX_API_KEY entfernen und den Worker neu starten.',
    miniKey: 'MiniMax API-Key',
    miniKeep: 'Leer lassen, um den gespeicherten Key zu behalten',
    miniContext: 'Kontextbudget (Tokens)',
    miniEffort: 'Denktiefe',
    miniSave: 'MiniMax-Einstellungen speichern',
    miniRemove: 'Gespeicherten MiniMax-Key entfernen',
    miniSaved: 'Einstellungen gespeichert. Keine Modellanfrage gesendet.',
    miniError: 'MiniMax-Einstellungen konnten nicht gespeichert werden.',
    miniSetup: 'MiniMax einrichten',

    kicker: '§ ONE WORKER — {ws}',
    title: 'Wähle die Repositories, in denen One arbeiten darf',
    lead: 'Hak ein Repository an, und One kann ihm Coding-Aufgaben geben: Claude Code arbeitet auf einem Branch in einem eigenen Worktree, dein Checkout bleibt, wie er ist. Pfade und Befehle bleiben auf diesem Rechner – One erfährt nur die Namen.',
    loading: 'Suche Git-Repositories…',
    searching: 'Suche läuft … {d} Ordner · {n} gefunden',
    reading: 'Lese die Repositories … {f} von {n}',
    noKey: 'Diese Seite braucht ihren Schlüssel. Öffne sie unter der Adresse, die der Worker in seinem Terminal zeigt.',
    unbound: 'Dieser Worker ist an keinen Arbeitsbereich gebunden. Lade ihn in One herunter (Einstellungen → Coding-Worker) – diese Datei ist schon gekoppelt.',
    noClaude: 'Claude Code wurde nicht gefunden. Installiere es und melde dich einmal an (claude) – der Worker sucht es erneut: diese Seite nach wenigen Sekunden, eine Stufe, wenn du in One „Erneut versuchen“ drückst. Liegt es außerhalb des PATH? Dann CLAUDE_BIN setzen und den Worker neu starten.',
    noClaudeWin: 'Claude Code wurde nicht gefunden. Installiere es – mit dem eigenen Installer (PowerShell: irm https://claude.ai/install.ps1 | iex; er braucht Git for Windows) oder npm i -g @anthropic-ai/claude-code – und melde dich einmal an (claude): Der Worker sucht es erneut, diese Seite nach wenigen Sekunden, eine Stufe, wenn du in One „Erneut versuchen“ drückst. Eine .cmd, die der Worker nicht lesen kann, startet er nie über cmd.exe: dann CLAUDE_BIN auf claude.exe oder die cli.js von Claude Code setzen und den Worker neu starten.',
    syncedicloud: 'In iCloud Drive: git wartet auf Dateien, die nur in der Cloud liegen. Schneller: ein Klon außerhalb (~/one-repos).',
    syncedcloudStorage: 'In einem synchronisierten Cloud-Ordner (~/Library/CloudStorage): Dateien werden erst bei Bedarf geladen und beim Synchronisieren gesperrt. Schneller: ein Klon außerhalb.',
    syncedonedrive: 'In OneDrive: reine Online-Dateien werden erst heruntergeladen und beim Synchronisieren gesperrt – git-Schritte können hängen. Schneller: das Repo aus OneDrive verschieben (z. B. nach C:\\code).',
    wthome: 'Die Worktrees seiner Aufgaben liegen außerhalb, in .one-worktrees in deinem Benutzerordner.',
    wtown: 'Die Worktrees seiner Aufgaben liegen außerhalb.',
    wtsynced: 'Auch die Worktrees seiner Aufgaben liegen in einem synchronisierten Ordner (worktreeDir in worker.json) – lege sie außerhalb an.',
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
    testHint: 'Läuft ohne Shell – && | > sind normale Wörter. Ein Programm im Repository braucht seinen Pfad (./gradlew). Leer: keine Test-Stufe.',
    testHintWin: 'Läuft ohne Shell – && | > sind normale Wörter. Ein Programm im Repository braucht seinen Pfad (.\\gradlew.bat); gesucht wird nur im PATH, nie im Repository. Leer: keine Test-Stufe.',
    analyzeLabel: 'Statische Analyse',
    analyzeHint: 'Die Stufe „Statische Analyse“ führt das aus (ein Linter, dotnet build, go vet …) – die Befunde kommen in die Aufgabenseite. Leer: keine.',
    noTests: 'Keine Test-Stufe',
    push: 'Branches pushen',
    pr: 'Pull / Merge Requests (gh · glab)',
    forgeLabel: 'Host-Art',
    forgeAuto: 'Automatisch – {kind}',
    forgeNone: 'nicht erkannt',
    forgeGitlab: 'GitLab (auch selbst betrieben)',
    forgeGithub: 'GitHub (auch Enterprise)',
    forgeHint: 'Automatisch liest die Adresse: ein Host mit „gitlab“ oder „github“ im Namen. Ein selbst betriebenes GitLab oder GitHub Enterprise unter eigenem Namen: hier wählen – dann verlinkt One Commits und Branches, und der Worker öffnet Merge / Pull Requests mit glab / gh.',
    limit: 'Kostengrenze pro Aufgabe (USD)',
    mcpLabel: 'Eigene MCP-Server für Claude Code und lokales Ollama',
    mcpHint: 'Namen wie in „claude mcp list“, z. B. kb – die Stufen dieses Repos dürfen ihre Tools nutzen (eine Wissensbasis, ein Designsystem). Leer: nur die Aufgaben-Tools von One.',
    allowedLabel: 'Ohne Nachfrage erlaubt',
    allowedHint: 'Was Claude Code in diesem Repo ohne Rückfrage darf – hinzugefügt mit „Für dieses Repo immer erlauben“ in One (oder von Hand in worker.json). Entferne eine Regel und drücke Speichern: One fragt beim nächsten Mal wieder.',
    allowedNone: 'Noch nichts – wenn du in One einen Befehl mit „Für dieses Repo immer erlauben“ freigibst, steht er hier.',
    allowedRemove: '{rule} entfernen',
    allowedRemoved: '{n} entfernt – Speichern drücken',
    ownLabel: 'Eigene Claude-Code-Einstellungen dieses Repos nutzen (.claude/, .mcp.json, CLAUDE.md, lokale MCP-Server)',
    ownMine: 'An für deine eigenen Repositories. Aus: Claude Code startet nur mit deinen eigenen Einstellungen (--setting-sources user).',
    ownWhy: 'Standardmäßig aus: {why}. Schalte es nur für Code ein, dem du vertraust.',
    whycloned: 'vom Worker geklont',
    whyimported: 'vom Worker aus einer ZIP importiert',
    whymarked: 'als fremder Code markiert (ein Klon in ~/one-repos beim Update des Workers)',
    marks: 'Diese Worker-Version hat {list} als fremden Code markiert – ein älterer Worker hat {them} geklont oder importiert. Claude Code läuft darauf jetzt ohne {their} eigenen Einstellungen (.claude/, .mcp.json, CLAUDE.md); schalte sie unten für ein Repository ein, dem du vertraust.',
    marksIt: 'es',
    marksThem: 'sie',
    marksIts: 'seine',
    marksTheir: 'ihre',
    marksOk: 'Verstanden',
    whycloneDir: 'im Klon-Ordner',
    ownWarn: 'An: Die Hooks und Hilfsbefehle dieses Repos (apiKeyHelper, seine MCP-Server) laufen auf diesem Rechner, wenn eine Aufgabe startet.',
    mcpUser: 'Seine eigenen Einstellungen sind aus: Nur Server, die mit „claude mcp add -s user …“ hinzugefügt wurden, erreichen dieses Repo.',
    clone: 'Von GitLab / GitHub klonen …',
    cloneUrl: 'Klon-Adresse – auf der Projektseite unter „Clone“ (HTTPS oder SSH)',
    cloneDir: 'In den Ordner',
    cloneDirHint: 'Ein Ordner, der nicht synchronisiert wird (kein iCloud, OneDrive oder Dropbox) – sonst wartet git auf Dateien aus der Cloud. Wird mit „Speichern & starten“ gemerkt.',
    cloneGo: 'Klonen',
    cloning: 'Klone {name} … {line}',
    cloned: '{name} geklont – unten angehakt. „Speichern & starten“, damit One ihm Aufgaben gibt.',
    cloneFailed: 'Das Klonen hat nicht geklappt: {e}',
    cloneAuth: 'git meldet sich mit deinem SSH-Schlüssel oder Credential-Helper an (glab auth login · gh auth setup-git) – der Worker kann kein Passwort eintippen.',
    projects: 'Deine Projekte',
    projectsLoading: 'Frage glab / gh nach deinen Projekten …',
    projectsNone: 'Installiere glab (GitLab) oder gh (GitHub) und melde dich an, um hier aus deinen Projekten zu wählen – oder füge die Adresse oben ein.',
    filter: 'Filter',
    via: 'Klonen über',
    zip: 'ZIP importieren …',
    zipLabel: 'Eine ZIP mit Quellcode',
    uploading: 'Lade {name} hoch …',
    importing: 'Entpacke {name} … {line}',
    imported: '{name} als neues Repository importiert (ein Commit, kein Remote) – unten angehakt. „Speichern & starten“, damit One ihm Aufgaben gibt.',
    importFailed: 'Der Import hat nicht geklappt: {e}',
    pubTitle: 'Auch auf GitLab / GitHub anlegen – dann kann Ausliefern pushen und Merge Requests öffnen',
    pubHost: 'Wo',
    pubOwner: 'Gruppe / Besitzer',
    pubOwnerHint: 'Leer: dein eigenes Konto. Eine GitLab-Gruppe darf verschachtelt sein (acme/platform).',
    pubName: 'Projektname',
    pubNameHint: 'Vorgeschlagen aus dem Code (package.json, pom.xml, README …) oder dem Namen der ZIP.',
    pubVis: 'Sichtbarkeit',
    visPrivate: 'Privat',
    visInternal: 'Intern',
    visPublic: 'Öffentlich',
    pubGo: 'Anlegen & pushen',
    pubSkip: 'Nicht jetzt',
    publishing: 'Lege {name} an … {line}',
    published: '{web} angelegt und main gepusht – Push und Merge Requests sind für dieses Repository an.',
    pubFailed: 'Das hat nicht geklappt: {e}',
    noLimit: 'keine',
    ticked: '{n} angehakt',
    tickedOne: '1 angehakt',
    save: 'Speichern & starten',
    saving: 'Speichere…',
    saved: 'Gespeichert – One sieht jetzt {n} Repositories.',
    savedOne: 'Gespeichert – One sieht jetzt 1 Repository.',
    savedNone: 'Gespeichert – keine Repositories: Dieser Worker nimmt nur Dokument-Aufgaben ohne Repository (Business-Analyse, QA).',
    wmcpLabel: 'Standard-MCP-Server · Claude Code / Ollama / Ollama Cloud / MiniMax',
    wmcpHint: 'Business-Analyse- / QA-Aufgaben ohne Repo laufen hier mit diesen Servern (Namen wie in „claude mcp list“, z. B. kb) – hinzugefügt mit „claude mcp add -s user …“: Ein Server im Standard-Bereich (local) bleibt draußen. Ollama und MiniMax nutzen diese Liste auch, wenn das Repository keine eigene hat; die persönlichen JSON-Verbindungen stehen in ~/.claude.json oder ONE_CODER_MCP_CONFIG.',
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
  // a synced folder's cost — and where the task worktrees really are (iCloud: the hint alone, as in the worker's log)
  function syncedHint(r) {
    return t('synced' + r.synced) + (r.worktrees && r.synced !== 'icloud' ? ' ' + t('wt' + r.worktrees) : '')
  }
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
  // the worker's splitArgs (config.ts): on Windows a backslash is a plain character — only \" inside "…" is a quote
  function windows() { return !!(state && state.worker && state.worker.os === 'windows') }
  function split(line) {
    var out = [], cur = '', has = false, q = null, win = windows()
    for (var i = 0; i < line.length; i++) {
      var c = line[i]
      if (q === "'") { if (c === "'") q = null; else cur += c }
      else if (q === '"') {
        if (c === '"') q = null
        else if (c === '\\' && (line[i + 1] === '"' || (!win && line[i + 1] === '\\'))) cur += line[++i]
        else cur += c
      } else if (c === '"' || c === "'") { q = c; has = true }
      else if (c === '\\' && !win && i + 1 < line.length) { cur += line[++i]; has = true }
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
  var cloneOpen = false
  var cloneUrl = ''
  var cloneDirText = null
  var ollamaKey = ''
  var ollamaContext = null
  var ollamaModel = null
  var ollamaSaving = false
  var ollamaMessage = ''
  var miniKey = ''
  var miniContext = null
  var miniEffort = null
  var miniSaving = false
  var miniMessage = ''
  var wmcpText = null
  var cloneErr = ''
  var cloneProto = 'https'
  var projects = null
  var projFilter = ''
  var handledClone = 0
  /** after an import: { path, name, host, owner, vis } for "Create it on GitLab / GitHub" */
  var publishFor = null

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
    if (!edits[r.path]) edits[r.path] = { ticked: r.ticked, name: r.name, base: r.base, test: r.testLine, push: r.push, pr: r.pr, forge: r.forge || 'auto', limit: r.maxUsdPerTask === null ? '' : String(r.maxUsdPerTask), mcp: r.mcp || '', analyze: r.analyzeLine || '', own: r.ownSettings, own0: r.ownSettings, allowed: (r.allowed || []).slice(), allowed0: (r.allowed || []).slice() }
    return edits[r.path]
  }

  var again = 0
  function adopt(next) {
    state = next
    // a clone finished: tick it like a folder added by hand
    var job = state.clone
    if (job && job.done && job.id !== handledClone) {
      handledClone = job.id
      delete edits[job.done]
      var r = state.repos.filter(function (x) { return x.path === job.done })[0]
      if (r) editOf(r).ticked = true
      cloneOpen = false
      cloneUrl = ''
      if (job.kind === 'publish') {
        if (r) { editOf(r).push = true; editOf(r).pr = 'gh' }
        publishFor = null
        note = { ok: true, text: t('published', { web: job.web || job.line }) }
      } else {
        note = { ok: true, text: t(job.kind === 'import' ? 'imported' : 'cloned', { name: job.name }) }
        if (job.kind === 'import' && (state.glab || state.gh)) publishFor = { path: job.done, name: job.suggest || job.name, host: state.glab ? 'gitlab' : 'github', owner: '', vis: 'private' }
      }
    }
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
      el('div', { className: 'repo__body' }, [el('div', { className: 'repo__name', text: r.name }), el('div', { className: 'repo__path', text: r.short, title: r.path }), facts].concat(r.synced ? [el('span', { className: 'warn', text: syncedHint(r) })] : [])),
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
    // the repo's own Claude Code settings: off for code from elsewhere (the reason shown), a warning while it is on
    // against that — or turned on here
    // a hidden hint is no description: aria-describedby names only the hints shown, and follows the switch
    function warnOn() { return e.own && (!!r.source || !e.own0) }
    function ownDesc() { return id + 'oh' + (warnOn() ? ' ' + id + 'ow' : '') }
    function mcpDesc() { return id + 'mh' + (e.own ? '' : ' ' + id + 'mu') }
    var ownWarn = el('span', { className: 'warn', id: id + 'ow', text: t('ownWarn'), hidden: !warnOn() })
    var mcpUser = el('span', { className: 'hint', id: id + 'mu', text: t('mcpUser'), hidden: e.own })
    var mcpInput = el('input', { type: 'text', id: id + 'm', value: e.mcp, placeholder: 'kb', spellcheck: 'false', autocomplete: 'off', 'aria-describedby': mcpDesc(), oninput: function (ev) { e.mcp = ev.target.value } })
    var own = el('div', { className: 'field field--wide own' }, [
      el('label', { className: 'sw' }, [el('input', { type: 'checkbox', role: 'switch', id: id + 'o', checked: e.own, 'aria-describedby': ownDesc(), onchange: function (ev) { e.own = ev.target.checked; ownWarn.hidden = !warnOn(); mcpUser.hidden = e.own; ev.target.setAttribute('aria-describedby', ownDesc()); mcpInput.setAttribute('aria-describedby', mcpDesc()) } }), t('ownLabel')]),
      el('span', { className: 'hint', id: id + 'oh', text: r.source ? t('ownWhy', { why: t('why' + r.source) }) : t('ownMine') }),
      ownWarn
    ])
    if (state.gh || state.glab) toggles.push(el('label', { className: 'sw' }, [el('input', { type: 'checkbox', role: 'switch', checked: e.pr === 'gh', onchange: function (ev) { e.pr = ev.target.checked ? 'gh' : 'none' } }), t('pr')]))
    // the host type (worker.json "forge"): only for a repo with a remote — "Automatic" names what its host's name says
    var forge = null
    if (r.remote) {
      var kind = r.forgeAuto === 'gitlab' ? 'GitLab' : r.forgeAuto === 'github' ? 'GitHub' : t('forgeNone')
      var sel = el('select', { id: id + 'f', 'aria-describedby': id + 'fh', onchange: function () { e.forge = sel.value } })
      ;[['auto', t('forgeAuto', { kind: kind })], ['gitlab', t('forgeGitlab')], ['github', t('forgeGithub')]].forEach(function (o) { sel.appendChild(el('option', { value: o[0], text: o[1] })) })
      sel.value = e.forge
      forge = el('div', { className: 'field field--wide forge' }, [
        el('label', { className: 'label', for: id + 'f', text: t('forgeLabel') }),
        sel,
        el('span', { className: 'hint', id: id + 'fh', text: t('forgeHint') })
      ])
    }
    // what Claude Code may do here without asking (worker.json allowedTools): each with its remove key — the page only
    // takes rules away; "Always for this repo" in One adds them (the worker writes them)
    var removed = e.allowed0.length - e.allowed.length
    var allowed = el('div', { className: 'field allowed', role: 'group', 'aria-labelledby': id + 'al' }, [
      el('span', { className: 'label', id: id + 'al', text: t('allowedLabel') }),
      e.allowed.length
        ? el('ul', { className: 'rules' }, e.allowed.map(function (rule, k) {
            return el('li', { className: 'rule' }, [
              el('code', { text: rule }),
              el('button', { type: 'button', id: id + 'x' + k, 'aria-label': t('allowedRemove', { rule: rule }), title: t('allowedRemove', { rule: rule }), text: '×', onclick: function () {
                e.allowed = e.allowed.filter(function (x, j) { return j !== k })
                render()
                // the key after it (or before) keeps the keyboard
                var next = $(id + 'x' + k) || $(id + 'x' + (k - 1)) || $(id + 'al')
                if (next && next.focus) next.focus()
              } })
            ])
          }))
        : el('span', { className: 'hint', text: t('allowedNone') }),
      el('span', { className: 'hint', text: removed > 0 ? t('allowedRemoved', { n: removed }) : t('allowedHint') })
    ])
    return el('div', { className: 'detail' }, [
      el('div', { className: 'field' }, [el('label', { className: 'label', for: id + 'n', text: t('nameLabel') }), el('input', { type: 'text', id: id + 'n', value: e.name, maxlength: 64, spellcheck: 'false', oninput: function (ev) { e.name = ev.target.value } })]),
      el('div', { className: 'field' }, [el('label', { className: 'label', for: id + 'b', text: t('baseLabel') }), base]),
      el('div', { className: 'field' }, [el('label', { className: 'label', for: id + 't', text: t('testLabel') }), el('input', { type: 'text', id: id + 't', value: e.test, spellcheck: 'false', autocomplete: 'off', oninput: function (ev) { e.test = ev.target.value; drawKeys() } }), keys, el('span', { className: 'hint', text: t(windows() ? 'testHintWin' : 'testHint') })]),
      el('div', { className: 'field' }, [el('label', { className: 'label', for: id + 'a', text: t('analyzeLabel') }), el('input', { type: 'text', id: id + 'a', value: e.analyze, spellcheck: 'false', autocomplete: 'off', oninput: function (ev) { e.analyze = ev.target.value } }), el('span', { className: 'hint', text: t('analyzeHint') })]),
      el('div', { className: 'field field--wide' }, [el('div', { className: 'toggles' }, toggles)]),
      forge,
      el('div', { className: 'field' }, [el('div', { className: 'limit' }, [el('label', { className: 'label', for: id + 'l', text: t('limit') }), el('input', { type: 'number', id: id + 'l', min: '0', step: '0.5', value: e.limit, placeholder: t('noLimit'), inputmode: 'decimal', oninput: function (ev) { e.limit = ev.target.value } })])]),
      el('div', { className: 'field field--wide' }, [el('label', { className: 'label', for: id + 'm', text: t('mcpLabel') }), mcpInput, el('span', { className: 'hint', id: id + 'mh', text: t('mcpHint') }), mcpUser]),
      allowed,
      own
    ])
  }

  function minimaxPanel() {
    var m = state.minimax || { configured: false, contextTokens: 131072, effort: 'high' }
    function save(remove) {
      var body = remove ? { remove: true } : { apiKey: miniKey, contextTokens: miniContext || m.contextTokens, effort: miniEffort || m.effort }
      miniSaving = true; miniMessage = ''; render()
      api('POST', 'minimax', body).then(function (next) {
        miniKey = ''; miniContext = null; miniEffort = null; miniSaving = false; miniMessage = t('miniSaved'); adopt(next)
      }, function (e) { miniSaving = false; miniMessage = e.message || t('miniError'); render() })
    }
    return el('section', { className: 'wmcp', 'data-testid': 'minimax-setup' }, [
      el('h2', { className: 'label', text: t('miniTitle') }),
      el('p', { className: 'hint', text: t('miniHint') }),
      el('p', { className: 'hint', text: m.error || t(m.configured ? 'miniReady' : 'miniEmpty') }),
      m.environment ? el('p', { className: 'hint', text: t('miniEnvironment') }) : null,
      el('div', { className: 'field' }, [
        el('label', { className: 'label', for: 'minimax-key', text: t('miniKey') }),
        el('input', { type: 'password', id: 'minimax-key', value: miniKey, autocomplete: 'new-password', spellcheck: 'false', placeholder: t('miniKeep'), disabled: miniSaving, oninput: function (e) { miniKey = e.target.value } })
      ]),
      el('div', { className: 'field' }, [
        el('label', { className: 'label', for: 'minimax-context', text: t('miniContext') }),
        el('select', { id: 'minimax-context', disabled: miniSaving, onchange: function (e) { miniContext = Number(e.target.value) } }, [65536, 131072, 262144, 1000000].map(function (n) { return el('option', { value: n, selected: n === (miniContext || m.contextTokens), text: n.toLocaleString(de ? 'de-DE' : 'en-US') }) }))
      ]),
      el('div', { className: 'field' }, [
        el('label', { className: 'label', for: 'minimax-effort', text: t('miniEffort') }),
        el('select', { id: 'minimax-effort', disabled: miniSaving, onchange: function (e) { miniEffort = e.target.value } }, ['low', 'medium', 'high', 'xhigh', 'max'].map(function (v) { return el('option', { value: v, selected: v === (miniEffort || m.effort), text: v }) }))
      ]),
      el('button', { type: 'button', className: 'btn', text: t('miniSave'), disabled: miniSaving, onclick: function () { save(false) } }),
      m.configured ? el('button', { type: 'button', className: 'btn btn--ghost', text: t('miniRemove'), disabled: miniSaving, onclick: function () { save(true) } }) : null,
      miniMessage ? el('p', { className: 'hint', role: 'status', text: miniMessage }) : null
    ])
  }

  function ollamaPanel() {
    var m = state.ollama || { configured: false, contextTokens: 131072, model: 'minimax-m3.1-flash' }
    function save(remove) {
      var body = remove ? { remove: true } : { apiKey: ollamaKey, contextTokens: ollamaContext || m.contextTokens, model: (ollamaModel || m.model).trim() }
      ollamaSaving = true; ollamaMessage = ''; render()
      api('POST', 'ollama', body).then(function (next) {
        ollamaKey = ''; ollamaContext = null; ollamaModel = null; ollamaSaving = false; ollamaMessage = t('ollamaSaved'); adopt(next)
      }, function (e) { ollamaSaving = false; ollamaMessage = e.message || t('ollamaError'); render() })
    }
    return el('section', { className: 'wmcp', 'data-testid': 'ollama-setup' }, [
      el('h2', { className: 'label', text: t('ollamaTitle') }),
      el('p', { className: 'hint', text: t('ollamaHint') }),
      el('p', { className: 'hint', text: m.error || t(m.configured ? 'ollamaReady' : 'ollamaEmpty') }),
      m.environment ? el('p', { className: 'hint', text: t('ollamaEnvironment') }) : null,
      el('div', { className: 'field' }, [
        el('label', { className: 'label', for: 'ollama-key', text: t('ollamaKey') }),
        el('input', { type: 'password', id: 'ollama-key', value: ollamaKey, autocomplete: 'new-password', spellcheck: 'false', placeholder: t('ollamaKeep'), disabled: ollamaSaving, oninput: function (e) { ollamaKey = e.target.value } })
      ]),
      el('div', { className: 'field' }, [
        el('label', { className: 'label', for: 'ollama-context', text: t('ollamaContext') }),
        el('select', { id: 'ollama-context', disabled: ollamaSaving, onchange: function (e) { ollamaContext = Number(e.target.value) } }, [65536, 131072, 262144, 1000000].map(function (n) { return el('option', { value: n, selected: n === (ollamaContext || m.contextTokens), text: n.toLocaleString(de ? 'de-DE' : 'en-US') }) }))
      ]),
      el('div', { className: 'field' }, [
        el('label', { className: 'label', for: 'ollama-model', text: t('ollamaModel') }),
        el('input', { type: 'text', id: 'ollama-model', value: ollamaModel === null ? m.model : ollamaModel, maxlength: 128, autocomplete: 'off', spellcheck: 'false', disabled: ollamaSaving, oninput: function (e) { ollamaModel = e.target.value } }),
        el('a', { href: 'https://ollama.com/search?c=cloud', target: '_blank', rel: 'noopener noreferrer', text: t('ollamaModels') })
      ]),
      el('button', { type: 'button', className: 'btn', text: t('ollamaSave'), disabled: ollamaSaving, onclick: function () { save(false) } }),
      m.configured ? el('button', { type: 'button', className: 'btn', text: t('ollamaTest'), disabled: ollamaSaving, onclick: function () {
        ollamaSaving = true; ollamaMessage = ''; render()
        api('POST', 'ollama-test', {}).then(function () { ollamaSaving = false; ollamaMessage = t('ollamaTested'); render() }, function () { ollamaSaving = false; ollamaMessage = t('ollamaTestError'); render() })
      } }) : null,
      m.configured ? el('button', { type: 'button', className: 'btn btn--ghost', text: t('ollamaRemove'), disabled: ollamaSaving, onclick: function () { save(true) } }) : null,
      ollamaMessage ? el('p', { className: 'hint', role: 'status', text: ollamaMessage }) : null
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
    if (state.live && state.live.claude && !state.live.claude.found) app.appendChild(el('p', { className: 'msg', text: t(windows() ? 'noClaudeWin' : 'noClaude') }))
    if (state.marked && state.marked.length) app.appendChild(marksNote(state.marked))
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
      el('button', { type: 'button', className: 'btn', id: 'add', 'aria-expanded': adding ? 'true' : 'false', onclick: function () { adding = !adding; addError = ''; render(); var i = $('addpath'); if (i) i.focus() }, text: t('add') }),
      el('button', { type: 'button', className: 'btn', id: 'clone', 'aria-expanded': cloneOpen ? 'true' : 'false', onclick: toggleClone, text: t('clone') }),
      el('button', { type: 'button', className: 'btn', id: 'zip', disabled: busy === 'zip' || !!(state.clone && state.clone.running), onclick: function () { $('zipfile').click() }, text: busy === 'zip' ? t('uploading', { name: '' }).replace(/\s+…$/, '…') : t('zip') }),
      el('input', { type: 'file', id: 'zipfile', accept: '.zip,application/zip', hidden: true, 'aria-label': t('zipLabel'), onchange: function (ev) { var f = ev.target.files && ev.target.files[0]; ev.target.value = ''; if (f) uploadZip(f) } })
    ]))
    if (cloneOpen) app.appendChild(clonePanel())
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
    if (publishFor) app.appendChild(publishPanel())
    var list = el('ul', { className: 'list', id: 'repos' })
    if (!state.repos.length) list.appendChild(el('li', { className: 'empty', text: state.scan && state.scan.running ? t('loading') : t('none') }))
    state.repos.forEach(function (r, i) { list.appendChild(row(r, i)) })
    app.appendChild(list)
    app.appendChild(el('div', { className: 'field field--wide wmcp' }, [
      el('label', { className: 'label', for: 'wmcp', text: t('wmcpLabel') }),
      el('input', { type: 'text', id: 'wmcp', value: wmcpText === null ? (state.mcpServers || []).join(', ') : wmcpText, placeholder: 'kb', spellcheck: 'false', autocomplete: 'off', oninput: function (ev) { wmcpText = ev.target.value } }),
      el('span', { className: 'hint', text: t('wmcpHint') })
    ]))
    app.appendChild(minimaxPanel())
    app.appendChild(ollamaPanel())
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

  // the one-time marking of an older worker's clones and imports, shown until the person took note
  function marksNote(names) {
    var one = names.length === 1
    var text = t('marks', { list: names.join(', '), them: t(one ? 'marksIt' : 'marksThem'), their: t(one ? 'marksIts' : 'marksTheir') })
    return el('div', { className: 'msg marks', id: 'marks' }, [
      el('span', { id: 'markstext', text: text }),
      el('button', { type: 'button', className: 'btn', id: 'marksok', 'aria-describedby': 'markstext', disabled: busy === 'marks', onclick: function () {
        busy = 'marks'
        api('POST', 'marks-seen').then(function (s) { busy = ''; adopt(s); var r = $('rescan'); if (r) r.focus() }, fail)
      }, text: t('marksOk') })
    ])
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

  function toggleClone() {
    cloneOpen = !cloneOpen
    cloneErr = ''
    render()
    if (!cloneOpen) return
    var i = $('cloneurl')
    if (i) i.focus()
    if (!projects) {
      projects = { loading: true }
      api('GET', 'projects').then(function (p) { projects = p; render() }, function () { projects = { projects: [], tools: {} }; render() })
    }
  }

  function uploadZip(file) {
    busy = 'zip'
    cloneOpen = true
    cloneErr = ''
    note = { ok: true, text: t('uploading', { name: file.name }) }
    render()
    var dir = cloneDirText === null ? state.cloneDir : cloneDirText
    fetch('/setup/api/import?name=' + encodeURIComponent(file.name) + '&dir=' + encodeURIComponent(dir), { method: 'POST', headers: { 'x-one-setup': token, 'content-type': 'application/zip' }, body: file, cache: 'no-store', credentials: 'omit' })
      .then(function (r) {
        return r.json().catch(function () { return {} }).then(function (j) {
          if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status)
          return j
        })
      })
      .then(function (s) { busy = ''; note = null; adopt(s); followClone() }, function (e) { busy = ''; note = null; cloneErr = t('importFailed', { e: e.message }); render() })
  }

  function startClone() {
    cloneErr = ''
    var dir = cloneDirText === null ? state.cloneDir : cloneDirText
    api('POST', 'clone', { url: cloneUrl, dir: dir }).then(function (s) { adopt(s); followClone() }, function (e) { cloneErr = e.message; render() })
  }

  function followClone() {
    setTimeout(function () {
      api('GET', 'state').then(function (s) {
        adopt(s)
        if (s.clone && s.clone.running) followClone()
        else if (s.clone && s.clone.done) { var node = document.querySelector('[data-path="' + CSS.escape(s.clone.done) + '"]'); if (node) node.scrollIntoView({ block: 'nearest' }) }
      }, function () { followClone() })
    }, 600)
  }

  function clonePanel() {
    var job = state.clone && state.clone.kind !== 'publish' && state.clone.id >= handledClone ? state.clone : null
    var running = !!(job && job.running)
    var url = el('input', { type: 'text', id: 'cloneurl', value: cloneUrl, placeholder: 'git@gitlab.com:group/project.git', spellcheck: 'false', autocomplete: 'off', oninput: function (ev) { cloneUrl = ev.target.value }, onkeydown: function (ev) { if (ev.key === 'Enter' && !running) startClone(); if (ev.key === 'Escape') { cloneOpen = false; render() } } })
    var dir = el('input', { type: 'text', id: 'clonedir', value: cloneDirText === null ? state.cloneDir : cloneDirText, spellcheck: 'false', autocomplete: 'off', oninput: function (ev) { cloneDirText = ev.target.value } })
    var kids = [
      el('div', { className: 'field' }, [el('label', { className: 'label', for: 'cloneurl', text: t('cloneUrl') }), url]),
      el('div', { className: 'field' }, [el('label', { className: 'label', for: 'clonedir', text: t('cloneDir') }), dir, el('span', { className: 'hint', text: t('cloneDirHint') })]),
      el('div', { className: 'clone__keys' }, [
        el('button', { type: 'button', className: 'btn btn--primary', id: 'clonego', disabled: running || !cloneUrl.trim(), onclick: startClone, text: t('cloneGo') }),
        el('button', { type: 'button', className: 'btn btn--ghost', onclick: function () { cloneOpen = false; render() }, text: t('cancel') })
      ])
    ]
    if (running) {
      // CSSOM, not a style attribute: the page's CSP allows no inline styles
      var fill = el('span')
      fill.style.width = (job.percent || 2) + '%'
      kids.push(el('div', { className: 'clone__bar', 'aria-hidden': 'true' }, [fill]))
      kids.push(el('p', { className: 'msg', role: 'status', id: 'clonestate', text: t(job.kind === 'import' ? 'importing' : 'cloning', { name: job.name, line: job.line }) }))
    } else if (job && job.error) kids.push(el('p', { className: 'add__err', role: 'alert', id: 'clonestate', text: t(job.kind === 'import' ? 'importFailed' : 'cloneFailed', { e: job.error }) }))
    if (cloneErr) kids.push(el('p', { className: 'add__err', role: 'alert', text: cloneErr }))
    kids.push(el('p', { className: 'hint', text: t('cloneAuth') }))
    kids.push(projectList())
    return el('div', { className: 'clone', id: 'clonebox' }, kids)
  }

  function projectList() {
    var box = el('div', { className: 'projects' })
    if (!projects || projects.loading) { box.appendChild(el('span', { className: 'hint', text: t('projectsLoading') })); return box }
    var all = projects.projects || []
    if (!all.length) { box.appendChild(el('span', { className: 'hint', text: t('projectsNone') })); return box }
    var proto = el('select', { 'aria-label': t('via'), onchange: function (ev) { cloneProto = ev.target.value; if (cloneUrl) { var hit = all.filter(function (p) { return p.https === cloneUrl || p.ssh === cloneUrl })[0]; if (hit) cloneUrl = hit[cloneProto] } render() } }, [el('option', { value: 'https', text: 'HTTPS' }), el('option', { value: 'ssh', text: 'SSH' })])
    proto.value = cloneProto
    var filter = el('input', { type: 'text', id: 'projfilter', value: projFilter, placeholder: t('filter'), 'aria-label': t('filter'), spellcheck: 'false', autocomplete: 'off', oninput: function (ev) { projFilter = ev.target.value; render(); var f = $('projfilter'); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length) } } })
    box.appendChild(el('div', { className: 'projects__head' }, [el('span', { className: 'label', text: t('projects') + ' · ' + all.length }), filter, proto]))
    var q = projFilter.trim().toLowerCase()
    var list = el('ul', { id: 'projects' })
    all.filter(function (p) { return !q || (p.path + ' ' + p.host).toLowerCase().indexOf(q) >= 0 }).slice(0, 60).forEach(function (p) {
      var url = p[cloneProto]
      list.appendChild(el('li', null, [el('button', { type: 'button', className: 'proj', 'aria-pressed': cloneUrl === url ? 'true' : 'false', onclick: function () { cloneUrl = url; render(); var g = $('clonego'); if (g) g.focus() } }, [
        el('span', { className: 'proj__path', text: p.path }),
        el('span', { className: 'label', text: ago(p.updated) }),
        el('span', { className: 'label', text: p.host })
      ])]))
    })
    box.appendChild(list)
    return box
  }

  function publishPanel() {
    var p = publishFor
    var job = state.clone && state.clone.kind === 'publish' && state.clone.id > handledClone ? state.clone : null
    var running = !!(job && job.running)
    var host = el('select', { id: 'pubhost', onchange: function (ev) { p.host = ev.target.value; if (p.host === 'github' && p.vis === 'internal') p.vis = 'private'; render() } })
    if (state.glab) host.appendChild(el('option', { value: 'gitlab', text: 'GitLab (glab)' }))
    if (state.gh) host.appendChild(el('option', { value: 'github', text: 'GitHub (gh)' }))
    host.value = p.host
    var vis = el('select', { id: 'pubvis', onchange: function (ev) { p.vis = ev.target.value } })
    vis.appendChild(el('option', { value: 'private', text: t('visPrivate') }))
    if (p.host === 'gitlab') vis.appendChild(el('option', { value: 'internal', text: t('visInternal') }))
    vis.appendChild(el('option', { value: 'public', text: t('visPublic') }))
    vis.value = p.vis
    var kids = [
      el('p', { className: 'label', text: t('pubTitle') }),
      el('div', { className: 'field' }, [el('label', { className: 'label', for: 'pubhost', text: t('pubHost') }), host]),
      el('div', { className: 'field' }, [el('label', { className: 'label', for: 'pubvis', text: t('pubVis') }), vis]),
      el('div', { className: 'field' }, [el('label', { className: 'label', for: 'pubowner', text: t('pubOwner') }), el('input', { type: 'text', id: 'pubowner', value: p.owner, spellcheck: 'false', autocomplete: 'off', oninput: function (ev) { p.owner = ev.target.value } }), el('span', { className: 'hint', text: t('pubOwnerHint') })]),
      el('div', { className: 'field' }, [el('label', { className: 'label', for: 'pubname', text: t('pubName') }), el('input', { type: 'text', id: 'pubname', value: p.name, maxlength: 100, spellcheck: 'false', autocomplete: 'off', oninput: function (ev) { p.name = ev.target.value } }), el('span', { className: 'hint', text: t('pubNameHint') })]),
      el('div', { className: 'clone__keys' }, [
        el('button', { type: 'button', className: 'btn btn--primary', id: 'pubgo', disabled: running, onclick: publish, text: t('pubGo') }),
        el('button', { type: 'button', className: 'btn btn--ghost', disabled: running, onclick: function () { publishFor = null; render() }, text: t('pubSkip') })
      ])
    ]
    if (running) kids.push(el('p', { className: 'msg', role: 'status', id: 'pubstate', text: t('publishing', { name: job.name, line: job.line }) }))
    else if (job && job.error) kids.push(el('p', { className: 'add__err', role: 'alert', id: 'pubstate', text: t('pubFailed', { e: job.error }) }))
    if (p.err) kids.push(el('p', { className: 'add__err', role: 'alert', text: p.err }))
    return el('div', { className: 'clone', id: 'publishbox' }, kids)
  }

  function publish() {
    var p = publishFor
    p.err = ''
    api('POST', 'publish', { path: p.path, host: p.host, owner: p.owner, name: p.name, visibility: p.vis }).then(function (s) { adopt(s); followClone() }, function (e) { p.err = e.message; render() })
  }

  function save() {
    var repos = state.repos.filter(function (r) { return editOf(r).ticked }).map(function (r) {
      var e = editOf(r)
      var limit = parseFloat(String(e.limit).replace(',', '.'))
      return { path: r.path, name: e.name.trim(), baseBranch: e.base, test: e.test, analyze: e.analyze, push: e.push, pr: e.pr, forge: e.forge, maxUsdPerTask: isFinite(limit) && limit > 0 ? limit : null, mcp: e.mcp, projectSettings: e.own, allowed: e.allowed, allowedWas: e.allowed0 }
    })
    busy = 'save'
    note = null
    render()
    var body = { repos: repos }
    if (wmcpText !== null) body.mcpServers = wmcpText
    api('POST', 'save', body).then(function (s) {
      busy = ''
      edits = {}
      wmcpText = null
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
