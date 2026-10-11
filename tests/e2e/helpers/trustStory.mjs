/**
 * Per-field trust's fictional morning (plain JS: the agent-trust specs, scripts/trust-shots.mjs and
 * scripts/changelog-shots.mjs import the same code). It builds on preflightStory.mjs — the mirror database "Nordlicht
 * Übergabe" (key "Schlüssel", NL-201 …) and its agent "Nordlicht-Spiegel" — and adds the trust story's properties:
 * Klarheit (Klar · Offene Fragen · Blockiert · Woanders in Arbeit), Warum, Letzter Kommentar, Nicht mehr in der Quelle.
 * The comments wait on the records ANF-3104, ANF-3117 and ANF-3089 (made up; the look-ups that read them come with the
 * lessons). Everything goes through the app's own seams (window.__one, __onePreflight, __oneAgentTrust) — never a host.
 *
 * The morning (seedTrust): a run from 07:30 waiting for review — Klarheit "Offene Fragen → Klar" on four rows, Warum on
 * three, and three "→ Blockiert" already discarded as wrong (no Undo any more: the quiet row) — and this device's book:
 * Neuer Kommentar and Quellstatus 20 applied in a row, Klarheit 13 / 3 edited / 4 wrong, Warum often reworded,
 * Kommentare with three reasonless discards, Fällig too rare.
 */
import { STORY, inPage, seedMirror } from './preflightStory.mjs'

export { STORY, inPage }

export const TRUST_STORY = {
  agentId: 'ag-spiegel',
  runId: 'r-trust',
  clarity: 'Klarheit',
  options: ['Klar', 'Offene Fragen', 'Blockiert', 'Woanders in Arbeit'],
  why: 'Warum',
  lastComment: 'Letzter Kommentar',
  goneFromSource: 'Nicht mehr in der Quelle',
  records: ['ANF-3104', 'ANF-3117', 'ANF-3089'],
}

const MIN = 60_000
const DAY = 86_400_000

/** Wait for the app and the seams the story writes through. */
export async function waitTrust(page) {
  await page.waitForFunction(() => !!window.__one && !!window.__onePreflight && !!window.__oneAgentTrust && !document.getElementById('boot'), null, { timeout: 60_000 })
}

/** The mirror of preflightStory (20 rows) plus the trust story's properties; ids by role. */
export async function seedTrustMirror(page, { rows = 20 } = {}) {
  const m = await seedMirror(page, { rows })
  const extra = await inPage(
    page,
    (w, a) => {
      const s = w.__one.workspace.getState()
      const id = () => Math.random().toString(36).slice(2, 12)
      const colors = ['green', 'yellow', 'red', 'gray']
      const options = a.options.map((name, i) => ({ id: id(), name, color: colors[i] }))
      const clarity = s.addProperty(a.dbId, { type: 'select', name: a.clarity, options })
      const why = s.addProperty(a.dbId, { type: 'text', name: a.why })
      const lastComment = s.addProperty(a.dbId, { type: 'text', name: a.lastComment })
      const gone = s.addProperty(a.dbId, { type: 'checkbox', name: a.goneFromSource })
      const comments = ['Wartet auf ANF-3104.', 'Wartet auf ANF-3117, bitte bis Freitag gegenlesen.', 'Wartet auf ANF-3089.', 'Wert steht jetzt im Datenblatt.']
      let i = 0
      for (const row of Object.values(a.rows)) {
        s.setRowProperty(row, clarity, options[1].id)
        s.setRowProperty(row, lastComment, comments[i++ % comments.length])
      }
      return { props: { clarity, why, lastComment, gone }, options: Object.fromEntries(options.map((o) => [o.name, o.id])) }
    },
    { dbId: m.dbId, rows: m.rows, ...TRUST_STORY },
  )
  return { ...m, props: { ...m.props, ...extra.props }, options: extra.options }
}

/** The trust key of a property of the mirror. */
export const keyOf = (m, role) => `prop:${m.dbId}:${m.props[role]}`

/**
 * This morning's run (07:30, waiting): Klarheit "Offene Fragen → Klar" on NL-209 … NL-212 (c1–c4), Warum on NL-213 …
 * NL-215 (c5–c7), three "→ Blockiert" discarded as wrong (c8–c10). `id` / `startedAt` / `status` for further runs. Returns
 * the run.
 */
export async function seedTrustRun(page, m, { now = Date.now(), status = 'staged', id = TRUST_STORY.runId, startedAt: at = null } = {}) {
  const keys = Object.keys(m.rows)
  const row = (n) => m.rows[keys[n]]
  const clarity = (n, i, after, extra = {}) => ({
    id: `c${n}`,
    n,
    kind: 'update_row',
    status: 'pending',
    pageId: row(i),
    databaseId: m.dbId,
    title: keys[i],
    props: [{ propId: m.props.clarity, name: TRUST_STORY.clarity, type: 'select', before: 'Offene Fragen', after, intent: { kind: 'options', names: [after] } }],
    ...extra,
  })
  const why = (n, i, text) => ({
    id: `c${n}`,
    n,
    kind: 'update_row',
    status: 'pending',
    pageId: row(i),
    databaseId: m.dbId,
    title: keys[i],
    props: [{ propId: m.props.why, name: TRUST_STORY.why, type: 'text', before: '', after: text, intent: { kind: 'value', value: text } }],
  })
  const staged = [
    clarity(1, 8, 'Klar'),
    clarity(2, 9, 'Klar'),
    clarity(3, 10, 'Klar'),
    clarity(4, 11, 'Klar'),
    why(5, 12, 'Freigabe liegt vor, nichts offen.'),
    why(6, 13, 'Messwerte nachgereicht.'),
    why(7, 14, 'Prüfplan bestätigt.'),
    clarity(8, 15, 'Blockiert', { status: 'discarded', reason: 'wrong' }),
    clarity(9, 16, 'Blockiert', { status: 'discarded', reason: 'wrong' }),
    clarity(10, 17, 'Blockiert', { status: 'discarded', reason: 'wrong' }),
  ]
  const start = new Date(now)
  start.setHours(7, 30, 0, 0)
  const startedAt = at ?? (start.getTime() > now ? now - 22 * MIN : start.getTime())
  const run = {
    id,
    agentId: m.mirrorId,
    runner: 'browser',
    trigger: { type: 'schedule', detail: 'schedule 07:30' },
    startedAt,
    ...(status === 'running' ? {} : { endedAt: startedAt + 134_000 }),
    status,
    summary: '10 Einträge geprüft: 4 × Klarheit, 3 × Warum vorgeschlagen.',
    steps: [{ kind: 'tool', label: 'relay · list_items', state: 'ok' }],
    staged,
    usage: { input: 18_200, output: 1_400, cacheRead: 9_000, usd: 0.38 },
  }
  await page.evaluate((runs) => window.__onePreflight.seedRuns(runs), [run])
  return run
}

/** n verdicts of one kind, a day apart, the newest `end` ms before now (oldest first). */
const many = (n, v, end, x = {}) => Array.from({ length: n }, (_, i) => ({ v, at: end - (n - 1 - i) * DAY, ...x }))
/** A list in the order given, a day apart, the newest `end` ms before now. */
const seq = (list, end) => list.map((x, i) => ({ ...x, at: end - (list.length - 1 - i) * DAY }))

/** This device's verdict book for the mirror agent (replaces it). */
export async function seedTrustBook(page, m, { now = Date.now() } = {}) {
  const A = { v: 'accept' }
  const E = { v: 'edited' }
  const W = { v: 'discard', reason: 'wrong' }
  const S = { v: 'discard', single: true }
  const end = now - 2 * 60 * MIN
  const entries = {
    [keyOf(m, 'newComment')]: many(20, 'accept', end),
    [keyOf(m, 'srcStatus')]: many(20, 'accept', end - DAY),
    [keyOf(m, 'clarity')]: seq([A, A, A, A, A, A, A, E, A, A, W, A, A, E, A, A, E, A, A, W, W, W], end),
    [keyOf(m, 'why')]: seq([E, E, A, E, A, E, E, A, E, A, E, A, A, E, E, A, A, E, E, A], end),
    [keyOf(m, 'comments')]: seq([E, ...Array.from({ length: 12 }, () => A), S, A, S, A, S], end),
    [keyOf(m, 'due')]: many(2, 'accept', end - 20 * DAY),
  }
  return page.evaluate(({ id, entries }) => window.__oneAgentTrust.seed(id, { entries }), { id: m.mirrorId, entries })
}

/**
 * The whole morning: German UI, the mirror, this morning's run, the book; the page left on the agent's own page.
 * Returns the mirror (ids by role) and the run.
 */
export async function seedTrust(page, { lang = 'de', now = Date.now(), book = true, run = true } = {}) {
  await waitTrust(page)
  await inPage(page, (w, a) => w.__one.workspace.getState().updateSettings({ workspaceName: a.name, language: a.lang }), { name: STORY.workspace, lang })
  const m = await seedTrustMirror(page)
  const r = run ? await seedTrustRun(page, m, { now }) : null
  if (book) await seedTrustBook(page, m, { now })
  await page.evaluate((id) => (window.location.hash = `#/agents/${id}`), m.mirrorId)
  return { m, run: r }
}
