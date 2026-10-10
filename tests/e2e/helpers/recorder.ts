/**
 * Flight recorder helpers for the e2e specs: wait for the recorder (boot starts it right after history), call
 * the seam `window.__oneRecorder`, run story steps under a writer, read what the journal recorded since a
 * moment and assert a lane. Test data is fictional (Nordlicht, Tessera).
 */
import { expect, type Page } from '@playwright/test'

type AnyRec = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** Wait until the recorder runs in this page (boot starts it; DEV / ?e2e install its seam). */
export async function startRecorder(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(window as unknown as { __oneRecorder?: unknown }).__oneRecorder)
}

/** Call a seam function: rec(page, 'ops') / rec(page, 'step', { … }). */
export async function rec<T = any>(page: Page, fn: string, ...args: unknown[]): Promise<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return page.evaluate(
    ({ fn, args }) => {
      const r = (window as unknown as { __oneRecorder: Record<string, (...a: unknown[]) => unknown> }).__oneRecorder
      return r[fn](...args) as never
    },
    { fn, args },
  ) as Promise<T>
}

/** A story step: store actions under a writer (each action one store update). */
export async function step<T = unknown[]>(page: Page, writer: AnyRec, calls: Array<[string, ...unknown[]]>, opts: { note?: AnyRec | true; end?: boolean } = {}): Promise<T> {
  return rec<T>(page, 'step', { writer, calls, ...opts })
}

/** Drain the queue and write everything (closing segments due). */
export const flushRec = (page: Page) => rec<void>(page, 'flush')

/** The journal's records of this scope. */
export const recOps = (page: Page, range?: AnyRec) => rec<AnyRec[]>(page, 'ops', range)
export const recEvents = (page: Page, range?: AnyRec) => rec<AnyRec[]>(page, 'events', range)
export const recSegments = (page: Page, range?: AnyRec) => rec<AnyRec[]>(page, 'segments', range)
export const recRuns = (page: Page) => rec<AnyRec[]>(page, 'runs')
export const recPins = (page: Page, scope?: string) => rec<{ metas: Array<{ id: string; meta: AnyRec }>; bodies: Array<{ key: string; content: AnyRec | null }> }>(page, 'pins', scope)

/** Segments of one place, oldest first. */
export async function segmentsOf(page: Page, place: string): Promise<AnyRec[]> {
  return (await recSegments(page)).filter((s) => s.p === place).sort((a, b) => a.from - b.from || (a.id < b.id ? -1 : 1))
}

/** Events of one place, oldest first. */
export async function eventsOf(page: Page, place: string): Promise<AnyRec[]> {
  return (await recEvents(page)).filter((e) => e.p === place).sort((a, b) => a.at - b.at)
}

/** Event kinds (K) and flags (F) — the journal's bitmasks. */
export const K = { CONTENT: 1, TITLE: 2, PROPS: 4, ICON: 8, COVER: 16, CREATE: 32, TRASH: 64, RESTORE: 128, DELETE: 256, MOVE: 512, TYPE: 1024, META: 2048, SCHEMA: 4096, VIEW: 8192, LOCK: 16384, COMMANDS: 32768, DBMETA: 65536 } as const
export const F = { NEW: 1, GONE: 2, COPY: 4, LAYOUT: 8, LATE: 16, BATCH: 32, STALE: 64, GAP: 128, ORDER: 256, UNDO: 512, PURGED: 1024 } as const

/** A fictional database "Nordlicht Handoff" with a Stage select, an estimate and four rows; ids back. */
export async function nordlichtDb(page: Page): Promise<{ db: string; stage: string; est: string; note: string; rows: string[]; ready: string; done: string; backlog: string }> {
  return page.evaluate(() => {
    const s = (window as unknown as { __one: { workspace: { getState: () => AnyRec } } }).__one.workspace.getState()
    const db = s.createDatabase({ title: 'Nordlicht Handoff' }) as string
    const stage = s.addProperty(db, { name: 'Stage', type: 'select', options: [
      { id: 'o-backlog', name: 'Backlog', color: 'gray' },
      { id: 'o-ready', name: 'Ready', color: 'blue' },
      { id: 'o-done', name: 'Erledigt', color: 'green' },
    ] }) as string
    const est = s.addProperty(db, { name: 'Schätzung', type: 'number' }) as string
    const note = s.addProperty(db, { name: 'Notiz', type: 'text' }) as string
    const g = () => (window as unknown as { __one: { workspace: { getState: () => AnyRec } } }).__one.workspace.getState()
    const rows = ['NL-1398', 'NL-1399', 'NL-1400', 'NL-1401'].map((title, i) => g().createRow(db, { title, properties: { [stage]: i % 2 ? 'o-ready' : 'o-backlog', [est]: i + 1, [note]: `Nordlicht ${i}` } }) as string)
    return { db, stage, est, note, rows, ready: 'o-ready', done: 'o-done', backlog: 'o-backlog' }
  })
}

/* ------------------------------------------------------------------ */
/* The lane sweep (recorder-writers.spec)                              */
/* ------------------------------------------------------------------ */

/** A moment on the tape: the ops written so far (their keys) — what comes after it is the row's. */
export interface RecMark {
  seen: string[]
}

/**
 * Mark the tape now: everything queued is written and every open segment closed first — so the row's first write
 * opens its own op (typing would otherwise fold into the person's open event of the setup).
 */
export async function markRec(page: Page): Promise<RecMark> {
  await rec(page, 'settle')
  return { seen: (await recOps(page)).map((o) => o.k as string) }
}

/** The ops written after `since` (the queue drained first), oldest first. */
export async function recorderOps(page: Page, since: RecMark): Promise<AnyRec[]> {
  await flushRec(page)
  const seen = new Set(since.seen)
  return (await recOps(page)).filter((o) => !seen.has(o.k)).sort((a, b) => a.at - b.at || (a.k < b.k ? -1 : 1))
}

const matches = (v: string | undefined, m: string | RegExp): boolean => (typeof m === 'string' ? v === m : !!v && m.test(v))

/**
 * Wait until an op on `lane` (and, given, with run key `run` / writer key `w`) was written after `since`; then
 * nothing written since then fell back to a guess (no `unknown` lane, the seam's `unknowns()` empty). Returns
 * the row's ops.
 */
export async function expectLane(page: Page, since: RecMark, lane: string | RegExp, run?: string | RegExp, w?: string | RegExp): Promise<AnyRec[]> {
  const hit = (o: AnyRec) => matches(o.l, lane) && (run === undefined || matches(o.r, run)) && (w === undefined || matches(o.w, w))
  let ops: AnyRec[] = []
  const until = Date.now() + 15_000
  for (;;) {
    ops = await recorderOps(page, since)
    if (ops.some(hit)) break
    if (Date.now() > until) {
      const state = { paused: await rec(page, 'paused'), stats: await rec(page, 'stats'), unknowns: await rec(page, 'unknowns') }
      throw new Error(`no op on lane ${lane}${run ? ` run ${run}` : ''}${w ? ` writer ${w}` : ''} — got ${JSON.stringify(ops.map((o) => [o.l, o.w, o.r ?? null]))} · ${JSON.stringify(state)}`)
    }
    await page.waitForTimeout(250)
  }
  expect(ops.filter((o) => o.l === 'unknown').map((o) => o.w), 'ops that fell back to unknown').toEqual([])
  expect(await rec(page, 'unknowns'), 'writes without a writer').toEqual([])
  return ops
}
