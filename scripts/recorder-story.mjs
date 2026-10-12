#!/usr/bin/env node
/**
 * Writes tests/e2e/fixtures/recorder-story.json — the flight recorder's story (design §10.0, the mock story with
 * fictional names): one morning in "Nordlicht Handoff", Fri 9 Oct, span 06:55–08:10, now 08:05:40.
 *
 *   Du (the person)          33 Vorgänge: 14 typing folds 06:58–07:09:30 · 11 in 07:38:20–07:47 (cell NL-1408 at
 *                            07:44:12) · 8 in 07:56–08:02:10 (cell NL-1415 at 07:57:30)
 *   AI terminal               6: a batch of 5 at 07:12:20, an edit_page at 07:52:40
 *   Agent "Nordlicht-Spiegel" 52 Vorgänge of run 212 at 37 places (35 rows incl. 3 new, the report page — there since
 *                            the setup: renamed first, its report appended last —, the schema: option "Ready"
 *                            removed), 07:31:04–07:34:41, words +212 −40
 *   MCP "tessera-desk"        4: three pages to the trash 07:48:10–07:48:31, a move at 07:49:30
 *   Script "Tagesplan"        1: a page at 07:00:05
 *   Sync "Tessera" (folder)   7 pick-ups
 *
 * The specs play it through tests/e2e/helpers/recorderStory.mjs `playStoryPage` (real store actions under each step's
 * writer, page.clock at each step's time); scripts/changelog-shots.mjs and scripts/recorder-shots.mjs play the same.
 *
 *   node scripts/recorder-story.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../tests/e2e/fixtures/recorder-story.json')

/* ---------------- time ---------------- */

const DAY = '2026-10-09'
const TZ = '+02:00'
const sec = (hms) => {
  const [h, m, s = 0] = hms.split(':').map(Number)
  return h * 3600 + m * 60 + s
}
const hms = (n) => [Math.floor(n / 3600), Math.floor((n % 3600) / 60), n % 60].map((x) => String(x).padStart(2, '0')).join(':')

/* ---------------- content ---------------- */

const para = (id, text) => ({ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] })
const doc = (...blocks) => ({ type: 'doc', content: blocks })

const VOCAB = ['Nordlicht', 'Abgleich', 'Zeile', 'Stand', 'geprüft', 'verschoben', 'offen', 'erledigt', 'Übergabe', 'Lauf', 'Spalte', 'Status', 'Hinweis', 'bestätigt', 'neu', 'angelegt', 'Bericht', 'Spiegel', 'Eintrag', 'Quelle', 'Ziel', 'Wert', 'gleich', 'anders']
const words = (n, from = 0) => Array.from({ length: n }, (_, i) => VOCAB[(from + i) % VOCAB.length]).join(' ')

/* ---------------- the database ---------------- */

const DB = 'story-nordlicht'
const STAGE = 'story-stage'
const EST = 'story-est'
const O = { backlog: 'o-backlog', ready: 'o-ready', doing: 'o-doing', review: 'o-review', done: 'o-done' }
const options = [
  { id: O.backlog, name: 'Backlog', color: 'gray' },
  { id: O.ready, name: 'Ready', color: 'blue' },
  { id: O.doing, name: 'In Arbeit', color: 'yellow' },
  { id: O.review, name: 'Review', color: 'purple' },
  { id: O.done, name: 'Erledigt', color: 'green' },
]

// at 07:30: Backlog 6 · Ready 9 · In Arbeit 4 · Review 3 · Erledigt 12 = 34
const STAGES = {
  ready: [1402, 1404, 1408, 1411, 1413, 1415, 1418, 1421, 1424],
  backlog: [1400, 1406, 1416, 1422, 1426, 1430],
  doing: [1403, 1409, 1419, 1428],
  review: [1405, 1412, 1425],
}
const stageOf = (n) => Object.entries(STAGES).find(([, list]) => list.includes(n))?.[0] ?? 'done'
const NUMBERS = Array.from({ length: 34 }, (_, i) => 1398 + i)
const ref = (n) => `NL-${n}`
/** rows with a body: the agent cuts its second paragraph (10 words each → −40) */
const BODIES = [1401, 1405, 1410, 1420]
const KEEP = 'Nordlicht Übergabe geprüft und bestätigt heute'
const CUT = 'Offene Fragen zur Zuordnung bleiben bis zur nächsten Abstimmung bestehen'

const rows = NUMBERS.map((n) => ({
  ref: ref(n),
  title: ref(n),
  properties: { [STAGE]: O[stageOf(n)], [EST]: (n % 8) + 1 },
  content: BODIES.includes(n) ? doc(para(`b-keep-${n}`, KEEP), para(`b-cut-${n}`, CUT)) : null,
}))

/* ---------------- pages ---------------- */

const NOTES = 'story-notes'
const pages = [
  { id: NOTES, title: 'Tessera Notizen', content: doc(para('n1', 'Nordlicht Notizen')) },
  { id: 'story-old-1', title: 'Alte Notiz 1', content: doc(para('o1', 'Erledigt im September')) },
  { id: 'story-old-2', title: 'Alte Notiz 2', content: doc(para('o2', 'Erledigt im August')) },
  { id: 'story-old-3', title: 'Alte Notiz 3', content: doc(para('o3', 'Erledigt im Juli')) },
  { id: 'story-tessera', title: 'Tessera', content: null },
  { id: 'story-sync-1', parentId: 'story-tessera', title: 'Tessera · Abgleich 1', content: doc(para('s1', 'Abgleich')) },
  { id: 'story-sync-2', parentId: 'story-tessera', title: 'Tessera · Abgleich 2', content: doc(para('s2', 'Abgleich')) },
  { id: 'story-sync-3', parentId: 'story-tessera', title: 'Tessera · Abgleich 3', content: doc(para('s3', 'Abgleich')) },
  // the agent's report page: there before the run (the run renames it and appends its report under the heading)
  { id: 'story-report', title: 'Nordlicht-Spiegel · Bericht', content: doc(para('rh', 'Bericht')) },
]

/* ---------------- writers ---------------- */

const AGENT = 'nordlicht-spiegel'
const YOU_TYPING = { kind: 'editor', id: 'story' }
const YOU = { kind: 'you', via: 'ui' }

const steps = []
const step = (at, writer, calls, extra = {}) => steps.push({ at, writer, calls, ...extra })

// the notes page as the person (and later the terminal) leave it
let notes = { n1: 'Nordlicht Notizen', n2: null }
let typed = 0
const notesDoc = () => doc(para('n1', notes.n1), ...(notes.n2 ? [para('n2', notes.n2)] : []))
const type = (at) => {
  notes.n1 += ` ${VOCAB[typed++ % VOCAB.length]}`
  step(at, YOU_TYPING, [['setContent', NOTES, notesDoc(), 'editor:story']])
}

/* the person: 14 typing folds 06:58:00–07:09:30 */
for (let k = 0; k < 14; k++) type(hms(sec('06:58:00') + Math.round((k * 690) / 13)))

/* the script "Tagesplan" at 07:00:05: one page */
step('07:00:05', { kind: 'script', id: 'tagesplan', run: 'sr-0909' }, [['createPage', { id: 'story-tagesplan', title: 'Tagesplan 09.10.', content: doc(para('t1', 'Abgleich Nordlicht'), para('t2', 'Übergabe prüfen')) }]], { note: true, end: true })

/* sync "Tessera": 7 pick-ups */
const SYNC_AT = ['07:05:00', '07:05:40', '07:20:10', '07:35:00', '07:50:00', '07:50:40', '08:05:00']
SYNC_AT.forEach((at, i) => {
  const page = `story-sync-${(i % 3) + 1}`
  step(at, { kind: 'sync', source: 'folder', run: `pk-${i + 1}` }, [['setContent', page, doc(para(`s${(i % 3) + 1}`, `Abgleich ${i + 1}`)), 'file']], { note: { source: 'folder' }, end: true })
})

/* the AI terminal: a batch of 5 at 07:12:20 */
const TB1 = { kind: 'terminal', run: 'tb-0712' }
const term = [
  ['createPage', { id: 'story-term-1', title: 'Übergabe Fragen' }],
  ['createPage', { id: 'story-term-2', title: 'Übergabe Risiken' }],
  ['setContent', 'story-term-1', doc(para('q1', 'Welche Zeilen fehlen noch')), 'ai'],
  ['setContent', 'story-term-2', doc(para('r1', 'Abgleich kann sich verzögern')), 'ai'],
  ['updatePage', 'story-term-1', { title: 'Übergabe Fragen (offen)' }],
]
term.forEach((call, i) => step('07:12:20', { ...TB1, change: `c${i + 1}` }, [call], i === 0 ? { note: true } : i === term.length - 1 ? { end: true } : {}))

/* the agent's run 212: 52 Vorgänge 07:31:04–07:34:41 */
const run = []
const touched = NUMBERS.filter((n) => n !== 1399 && n !== 1427) // 32 existing rows
const NEXT = { backlog: O.doing, doing: O.review, review: O.done, done: O.review }
const READY_TO = { 1402: O.doing, 1404: O.backlog, 1408: O.backlog, 1411: O.doing, 1413: O.backlog, 1415: O.doing, 1418: O.backlog, 1421: O.doing, 1424: O.backlog }
run.push(['updatePage', 'story-report', { title: 'Nordlicht-Spiegel · Bericht 09.10.' }])
for (const n of touched) run.push(['setRowProperty', `$${ref(n)}`, STAGE, stageOf(n) === 'ready' ? READY_TO[n] : NEXT[stageOf(n)]])
run.push(['updateProperty', DB, STAGE, { options: options.filter((o) => o.id !== O.ready) }])
for (const n of [1432, 1433, 1434]) run.push(['createRow', DB, { title: ref(n), properties: { [STAGE]: O.backlog, [EST]: 2 } }])
for (const n of BODIES) run.push(['setContent', `$${ref(n)}`, doc(para(`b-keep-${n}`, KEEP)), 'ai'])
for (const n of [1398, 1400, 1403, 1406, 1409, 1412, 1416, 1419, 1422, 1425]) run.push(['setRowProperty', `$${ref(n)}`, EST, (n % 8) + 3])
const report = [0, 1, 2, 3].map((i) => para(`r${i + 1}`, words(53, i * 53)))
run.push(['setContent', 'story-report', doc(para('rh', 'Bericht'), ...report), 'ai'])
if (run.length !== 52) throw new Error(`run 212 has ${run.length} Vorgänge, not 52`)

/**
 * The AgentRun that review keeps for run 212 (R3 writes it through the agents' seam): every staged change but c34 —
 * the option removal has no ChangeKind, it stays a journal-only change id. Kinds as RunHistory renders them; `page`
 * = a page id or a `$NL-…` row ref (resolved when it is played).
 */
const KIND_OF = (call) => {
  const [name, target, a] = call
  if (name === 'updatePage') return { kind: 'rename', page: target }
  if (name === 'setRowProperty') return { kind: 'update_row', page: target, prop: a }
  if (name === 'createRow') return { kind: 'create_row', page: `$${call[2].title}` }
  if (name === 'setContent') return { kind: 'append', page: target }
  return null
}
const agentRun = {
  id: 'r212',
  seq: 212,
  changes: Object.fromEntries(run.map((call, i) => [`c${i + 1}`, KIND_OF(call)]).filter(([, v]) => v)),
}
if (Object.keys(agentRun.changes).length !== 51 || agentRun.changes.c34) throw new Error('run 212 holds 51 staged changes (c34 is journal-only)')
run.forEach((call, i) => {
  const at = hms(sec('07:31:04') + Math.round((i * (sec('07:34:41') - sec('07:31:04'))) / (run.length - 1)))
  step(at, { kind: 'agent', id: AGENT, run: 'r212', change: `c${i + 1}` }, [call], i === 0 ? { note: { seq: 212 } } : i === run.length - 1 ? { end: true } : {})
})

/* the person: 11 in 07:38:20–07:47 (the cell of NL-1408 at 07:44:12) */
for (let k = 0; k < 9; k++) type(hms(sec('07:38:20') + k * 55))
step('07:44:12', YOU, [['setRowProperty', '$NL-1408', STAGE, O.doing]])
type('07:47:00')

/* MCP "tessera-desk": three pages to the trash, then a move */
const MCP = (call, tool) => ({ kind: 'mcp', session: 'tessera-s1', call, tool })
const mcp = [
  ['07:48:10', 'm1', 'one_trash', ['trashPage', 'story-old-1']],
  ['07:48:20', 'm2', 'one_trash', ['trashPage', 'story-old-2']],
  ['07:48:31', 'm3', 'one_trash', ['trashPage', 'story-old-3']],
  ['07:49:30', 'm4', 'one_move_page', ['movePage', 'story-term-2', NOTES]],
]
for (const [at, call, tool, c] of mcp) step(at, MCP(call, tool), [c], { note: { tool, client: 'tessera-desk' }, end: true })

/* the AI terminal: edit_page at 07:52:40 */
notes.n2 = 'Terminal Ergänzung zu offenen Punkten'
step('07:52:40', { kind: 'terminal', run: 'tb-0752', change: 'c1' }, [['setContent', NOTES, notesDoc(), 'ai']], { note: true, end: true })

/* the person: 8 in 07:56–08:02:10 (the cell of NL-1415 at 07:57:30) */
for (const at of ['07:56:00', '07:56:55']) type(at)
step('07:57:30', YOU, [['setRowProperty', '$NL-1415', STAGE, O.backlog]])
for (const at of ['07:57:50', '07:58:45', '07:59:40', '08:00:35', '08:02:10']) type(at)

steps.sort((a, b) => sec(a.at) - sec(b.at))

/* ---------------- the file ---------------- */

const story = {
  about: 'Flight recorder story (fictional): one morning in "Nordlicht Handoff". Generated by scripts/recorder-story.mjs — edit that, then run it.',
  day: DAY,
  tz: TZ,
  setupAt: '06:00:00',
  span: ['06:55:00', '08:10:00'],
  now: '08:05:40',
  playhead: '07:30:00',
  bracket: ['07:30:00', '07:35:00'],
  database: {
    id: DB,
    title: 'Nordlicht Handoff',
    properties: [
      { id: STAGE, name: 'Stage', type: 'select', options },
      { id: EST, name: 'Schätzung', type: 'number' },
    ],
    board: { id: 'story-board', name: 'Board', groupBy: STAGE },
    rows,
  },
  pages,
  agent: { id: AGENT, name: 'Nordlicht-Spiegel' },
  script: { id: 'tagesplan', name: 'Tagesplan' },
  mcpClient: 'tessera-desk',
  steps,
  agentRun,
  expect: {
    lanes: { you: 33, terminal: 6, [`agent:${AGENT}`]: 52, 'mcp:tessera-desk': 4, 'script:tagesplan': 1, 'sync:folder': 7 },
    run212: { key: `agent:${AGENT}:r212`, ops: 52, from: '07:31:04', to: '07:34:41', places: { rows: 35, newRows: 3, pages: 1, newPages: 0, schema: 1, views: 0 }, words: [212, 40] },
    /** the eject of run 212 (R3): 35 of 37 back, the person's two rows held, the three new rows to the trash */
    eject: {
      back: 35,
      all: 37,
      held: ['NL-1408', 'NL-1415'],
      trash: ['NL-1432', 'NL-1433', 'NL-1434'],
      board: [7, 7, 5, 3, 12],
      optionBack: { prop: STAGE, id: O.ready, index: 1 },
      agent: { ejected: 49, held: ['c11', 'c18'] },
    },
  },
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${JSON.stringify(story, null, 1)}\n`)
console.log(`${OUT}: ${steps.length} steps`)
