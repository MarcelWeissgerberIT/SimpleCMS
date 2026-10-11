/**
 * Preflight (Vorflug-Check) — the pure parts, run in Node by the Playwright runner (no browser):
 *  - `classifyChange` (store/rowChange.ts, re-exported by store/rowIndex.ts): what one page change means for the shared
 *    row index — membership · values · content · nothing;
 *  - `gridNext` (ui/roving.ts): the plate's 2-D arrow keys at 4 and 2 columns;
 *  - `checkLamps` (store/integrations.ts, the read release of profile lamps): shapes, thresholds, the `read` rule (M3),
 *    a bad lamp left out and the profile kept, export / same;
 *  - the lamps' pure core (features/preflight/lamps.ts, day.ts, prefs.ts — T-P1-1): levels, the "new" rule and its chip,
 *    the ids hash, the Preflight day around 07:00 and over a daylight-saving switch, working days, the panel's order and
 *    cap, the lamp test's budget, the prefs sanitizer, the plate mode table, the optimistic overlay;
 *  - the static guards (T-P1-6): no Claude client, no Outbox import, no store write action in Preflight; other areas'
 *    actions only from queue/calls.ts; the Outbox's lamp imports only Preflight's registry.
 * Every page and value is fictional.
 */
import { test, expect } from '@playwright/test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyChange } from '../../src/app/store/rowChange'
import { gridNext } from '../../src/app/ui/roving'
import { checkIntegration, checkProfileLamps, exportIntegration, sameIntegration, type IntegrationIssue } from '../../src/app/store/integrations'
import type { Page } from '../../src/app/store/types'
import { buildView, chipOf, fmtCount, idsHash, levelOf, makeAck, mcCount, newOf, overlay, panelLamps, planMode, testSchedule, type LampMeta, type ModeInput } from '../../src/app/features/preflight/lamps'
import { nextOpenAt, preflightDay, workingDaysBetween } from '../../src/app/features/preflight/day'
import { sanitizeLast, sanitizePrefs, sanitizeToday } from '../../src/app/features/preflight/prefs'
import type { LampView } from '../../src/app/features/preflight/types'
import { supersedePlan } from '../../src/app/features/agents/supersede'
import type { AgentRun } from '../../src/app/features/agents/types'
import type { StagedChange } from '../../src/app/features/ai/agent/types'

const page = (over: Partial<Page> = {}): Page => ({
  id: 'r1',
  kind: 'page',
  title: 'Exportfilter',
  icon: null,
  cover: null,
  parentId: 'db1',
  databaseId: 'db1',
  properties: { p1: 'Offen' },
  content: null,
  contentRev: 0,
  contentOrigin: null,
  favorite: false,
  trashed: false,
  trashedAt: null,
  createdAt: 1,
  updatedAt: 1,
  order: 0,
  settings: {} as Page['settings'],
  ...over,
})

test.describe('row index — classifyChange', () => {
  test('the same object, or nothing on either side, is no change', () => {
    const p = page()
    expect(classifyChange(p, p)).toBeNull()
    expect(classifyChange(undefined, undefined)).toBeNull()
  })

  test('added and removed pages are membership changes', () => {
    expect(classifyChange(page(), undefined)).toBe('membership')
    expect(classifyChange(undefined, page())).toBe('membership')
    // a plain page too (the tree changed: the inbox lamp reads `structure`)
    expect(classifyChange(page({ databaseId: null, parentId: null }), undefined)).toBe('membership')
  })

  test('database, trash and parent moves are membership changes', () => {
    const p = page()
    expect(classifyChange({ ...p, databaseId: 'db2', parentId: 'db2' }, p)).toBe('membership')
    expect(classifyChange({ ...p, databaseId: null, parentId: 'x', properties: {} }, p)).toBe('membership')
    expect(classifyChange({ ...p, trashed: true, trashedAt: 5 }, p)).toBe('membership')
    expect(classifyChange(p, { ...p, trashed: true, trashedAt: 5 })).toBe('membership')
    expect(classifyChange({ ...p, parentId: 'other' }, p)).toBe('membership')
    // membership wins over a value change in the same write
    expect(classifyChange({ ...p, trashed: true, title: 'Neu' }, p)).toBe('membership')
  })

  test('title and property values are value changes', () => {
    const p = page()
    expect(classifyChange({ ...p, title: 'Zertifikat-Warnung' }, p)).toBe('values')
    expect(classifyChange({ ...p, properties: { p1: 'Erledigt' } }, p)).toBe('values')
    // a new properties object counts even with the same values (compared by reference, like the store's writes)
    expect(classifyChange({ ...p, properties: { ...p.properties } }, p)).toBe('values')
  })

  test('anything else on another object is a content change', () => {
    const p = page()
    expect(classifyChange({ ...p, content: { type: 'doc', content: [] }, contentRev: 1 }, p)).toBe('content')
    expect(classifyChange({ ...p, comments: [] }, p)).toBe('content')
    expect(classifyChange({ ...p, updatedAt: 9 }, p)).toBe('content')
    expect(classifyChange({ ...p, icon: { type: 'emoji', value: 'x' } }, p)).toBe('content')
  })

  test('null and absent fields compare alike', () => {
    const p = page({ databaseId: null, parentId: null })
    const absent = { ...p } as Partial<Page>
    delete absent.databaseId
    delete absent.parentId
    expect(classifyChange(absent as Page, p)).toBe('content')
  })
})

test.describe('plate keys — gridNext', () => {
  test('4 columns, 10 caps (rows 0–3 · 4–7 · 8–9)', () => {
    expect(gridNext(0, 'ArrowRight', 4, 10)).toBe(1)
    expect(gridNext(3, 'ArrowRight', 4, 10)).toBe(4) // reading order: on to the next row
    expect(gridNext(9, 'ArrowRight', 4, 10)).toBe(9) // the last cap stays
    expect(gridNext(4, 'ArrowLeft', 4, 10)).toBe(3)
    expect(gridNext(0, 'ArrowLeft', 4, 10)).toBe(0)
    expect(gridNext(1, 'ArrowDown', 4, 10)).toBe(5)
    expect(gridNext(5, 'ArrowDown', 4, 10)).toBe(9)
    expect(gridNext(6, 'ArrowDown', 4, 10)).toBe(6) // no cap below → stays
    expect(gridNext(7, 'ArrowDown', 4, 10)).toBe(7)
    expect(gridNext(9, 'ArrowDown', 4, 10)).toBe(9) // last row
    expect(gridNext(9, 'ArrowUp', 4, 10)).toBe(5)
    expect(gridNext(2, 'ArrowUp', 4, 10)).toBe(2) // first row stays
    expect(gridNext(6, 'Home', 4, 10)).toBe(0)
    expect(gridNext(2, 'End', 4, 10)).toBe(9)
  })

  test('2 columns, 5 caps (rows 0–1 · 2–3 · 4)', () => {
    expect(gridNext(0, 'ArrowDown', 2, 5)).toBe(2)
    expect(gridNext(2, 'ArrowDown', 2, 5)).toBe(4)
    expect(gridNext(3, 'ArrowDown', 2, 5)).toBe(3) // no cap below → stays
    expect(gridNext(4, 'ArrowUp', 2, 5)).toBe(2)
    expect(gridNext(1, 'ArrowRight', 2, 5)).toBe(2)
    expect(gridNext(4, 'ArrowRight', 2, 5)).toBe(4)
    expect(gridNext(2, 'ArrowLeft', 2, 5)).toBe(1)
  })

  test('nothing focused, odd column counts, other keys', () => {
    expect(gridNext(-1, 'ArrowDown', 4, 10)).toBe(0)
    expect(gridNext(-1, 'End', 4, 10)).toBe(9)
    expect(gridNext(3, 'ArrowDown', 0, 5)).toBe(4) // a bad column count reads as one column
    expect(gridNext(0, 'ArrowDown', 1, 1)).toBe(0)
    expect(gridNext(0, 'Enter', 4, 10)).toBeNull()
    expect(gridNext(0, ' ', 4, 10)).toBeNull()
    expect(gridNext(0, 'ArrowDown', 4, 0)).toBeNull()
  })
})

test.describe('profile lamps — checkLamps (read release)', () => {
  const waiting = { id: 'waiting', label: { en: 'Waiting on me', de: 'Wartet auf mich' }, where: [{ role: 'waiting', equals: true }], read: { role: 'waiting', value: false } }
  const comments = { id: 'comments', label: 'New comments', short: 'Comments', second: 'Tessera', view: { en: 'New comments', de: 'Neue Kommentare' }, amber: 3, red: 10, flash: false, master: false, after: 'gate' }
  const check = (lamps: unknown, recipeIds: string[] = ['mirror']) => {
    const issues: IntegrationIssue[] = []
    const out = checkProfileLamps(lamps, recipeIds, (i) => issues.push(i))
    return { out, codes: issues.map((i) => `${i.path.join('.')}:${i.code}`) }
  }

  test('valid lamps are kept as given', () => {
    const r = check([waiting, comments])
    expect(r.codes).toEqual([])
    expect(r.out).toEqual([waiting, comments])
    expect(check([{ id: 'mine', label: 'Mein Status', where: [{ role: 'myStatus', equals: 'Offen' }], read: { role: 'myStatus', value: 'In Arbeit' }, amber: null, red: 1 }]).out).toHaveLength(1)
  })

  test('exactly one of view / where', () => {
    expect(check([{ ...waiting, view: 'All' }])).toEqual({ out: [], codes: ['lamps.0:lampSource'] })
    const { where: _w, ...neither } = waiting
    expect(check([neither])).toEqual({ out: [], codes: ['lamps.0:lampSource'] })
  })

  test('read: only newComment / waiting → false or myStatus → an option name — never a source field (M3)', () => {
    for (const read of [{ role: 'comments', value: 0 }, { role: 'lastCommentAt', value: null }, { role: 'srcStatus', value: 'Done' }, { role: 'changedAt', value: null }, { role: 'waiting', value: true }, { role: 'newComment', value: null }, { role: 'myStatus', value: false }, { role: 'myStatus', value: '  ' }]) {
      const r = check([{ ...waiting, read }])
      expect(r.out, JSON.stringify(read)).toEqual([])
      expect(r.codes, JSON.stringify(read)).toEqual(['lamps.0.read:lampRead'])
    }
    expect(check([{ ...waiting, read: { role: 'newComment', value: false } }]).out).toHaveLength(1)
  })

  test('thresholds: whole numbers 1–9,999, red above amber, not both null', () => {
    expect(check([{ ...waiting, amber: null, red: null }])).toEqual({ out: [], codes: ['lamps.0:lampThresholds'] })
    expect(check([{ ...waiting, amber: 3, red: 3 }])).toEqual({ out: [], codes: ['lamps.0.red:lampOrder'] })
    expect(check([{ ...waiting, amber: 0 }]).codes).toEqual(['lamps.0.amber:range'])
    expect(check([{ ...waiting, amber: 1.5 }]).out).toEqual([])
    expect(check([{ ...waiting, red: 10_000 }]).out).toEqual([])
    expect(check([{ ...waiting, amber: '2' }]).out).toEqual([])
    // the defaults (amber 1, no red) need no keys; red alone with amber null is fine
    expect(check([{ ...waiting, amber: null, red: 1 }]).out[0]).toMatchObject({ amber: null, red: 1 })
  })

  test('ids, duplicates, texts, unknown keys, recipes, the list limit', () => {
    expect(check([{ ...waiting, id: 'Waiting' }]).out).toEqual([])
    expect(check([{ ...waiting, id: '1st' }]).out).toEqual([])
    expect(check([waiting, { ...comments, id: 'waiting' }])).toEqual({ out: [waiting], codes: ['lamps.1.id:duplicate'] })
    // a long label is clamped (≤ 16), as every text of a profile is
    const long = check([{ ...waiting, label: 'Neue Kommentare im Ticket' }])
    expect(long.codes).toEqual(['lamps.0.label:tooLong'])
    expect(long.out[0]?.label).toBe('Neue Kommentare ')
    // an unknown key is reported and left out of the copy
    const extra = check([{ ...waiting, colour: 'red' }])
    expect(extra.codes).toEqual(['lamps.0.colour:unknownKey'])
    expect(extra.out).toEqual([waiting])
    expect(check([{ ...waiting, recipe: 'other' }])).toEqual({ out: [], codes: ['lamps.0.recipe:lampRecipe'] })
    expect(check([{ ...waiting, recipe: 'tickets' }], ['tickets']).out).toHaveLength(1)
    // more than four: the first four are checked
    const five = check([1, 2, 3, 4, 5].map((n) => ({ ...waiting, id: `l${n}` })))
    expect(five.codes).toEqual(['lamps:tooMany'])
    expect(five.out.map((l) => l.id)).toEqual(['l1', 'l2', 'l3', 'l4'])
    // more than four conditions: the lamp is left out (fewer ANDed conditions would count more rows)
    expect(check([{ ...waiting, where: [1, 2, 3, 4, 5].map(() => ({ role: 'waiting', equals: true })) }]).out).toEqual([])
    expect(check([{ ...waiting, where: [{ role: 'waiting' }] }]).out).toEqual([])
    expect(check([{ ...waiting, where: [{ role: 'not a role', equals: true }] }]).out).toEqual([])
    expect(check([{ ...waiting, where: [] }]).out).toEqual([])
    expect(check([{ ...waiting, after: 'Not An Id' }]).out).toEqual([])
  })

  test('the profile keeps its lamps (a bad one left out, the profile stays); export and same include them', () => {
    const raw = { schema: 'one.integration/1', id: 'tessera', name: 'Tessera', match: { name: 'relay' }, unlocks: ['keys'], lamps: [waiting, { ...comments, amber: null, red: null }] }
    const p = checkIntegration(raw)!
    expect(p).not.toBeNull()
    expect(p.lamps).toEqual([waiting])
    expect(exportIntegration(p).lamps).toEqual([waiting])
    expect(sameIntegration(p, { ...p, lamps: [{ ...waiting, amber: 2 }] } as typeof p)).toBe(false)
    expect(sameIntegration(p, checkIntegration(JSON.parse(JSON.stringify(raw))))).toBe(true)
    // "lamps" is a known key now: the editor does not call it unknown
    const issues: IntegrationIssue[] = []
    checkIntegration({ ...raw, lamps: [waiting] }, (i) => issues.push(i))
    expect(issues.filter((i) => i.code === 'unknownKey')).toEqual([])
    // no lamps: no key in the copy
    expect('lamps' in checkIntegration({ ...raw, lamps: [] })!).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* Preflight's pure core (T-P1-1)                                      */
/* ------------------------------------------------------------------ */

const ids = (n: number, prefix = 'run:r1#c') => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`)

test.describe('lamps — levels, new, chip, hash', () => {
  test('levelOf: off → grey, nothing → dark, forced level wins, thresholds, below the threshold → dark', () => {
    const t = { amber: 1, red: 15 }
    expect(levelOf({ state: 'off', count: 5 }, t)).toBe('grey')
    expect(levelOf({ state: 'ok', count: 0 }, t)).toBe('dark')
    expect(levelOf({ state: 'ok', count: 0, level: 'red' }, t)).toBe('dark')
    expect(levelOf({ state: 'ok', count: 1 }, t)).toBe('amber')
    expect(levelOf({ state: 'ok', count: 14 }, t)).toBe('amber')
    expect(levelOf({ state: 'ok', count: 15 }, t)).toBe('red')
    expect(levelOf({ state: 'ok', count: 1, level: 'red' }, t)).toBe('red')
    // a forced amber wins over the red threshold (a token whose check failed for another reason)
    expect(levelOf({ state: 'ok', count: 1, level: 'amber' }, { amber: null, red: 1 })).toBe('amber')
    expect(levelOf({ state: 'ok', count: 2 }, { amber: 3, red: null })).toBe('dark')
    expect(levelOf(null, t)).toBe('dark')
  })

  test('new: no ack → all new ("new"); the same count with another id is new; fewer ids are never new', () => {
    const a = makeAck(ids(3), 3, 1000)
    expect(newOf(ids(3), 3, undefined)).toEqual({ k: 3, none: true })
    expect(chipOf('amber', 3, true)).toBe('new')
    expect(newOf(ids(3), 3, a)).toEqual({ k: 0, none: false })
    // c3 went, c4 came: the count is the same, one id is new
    expect(newOf(['run:r1#c1', 'run:r1#c2', 'run:r1#c4'], 3, a)).toEqual({ k: 1, none: false })
    expect(chipOf('amber', 1, false)).toBe('new')
    expect(newOf(ids(5), 5, a).k).toBe(2)
    expect(chipOf('red', 2, false)).toBe('plus')
    // 10 → 8: nothing new
    expect(newOf(ids(2), 2, a).k).toBe(0)
    expect(chipOf('amber', 0, false)).toBeNull()
    // dark and grey lamps carry no chip
    expect(chipOf('dark', 3, false)).toBeNull()
    expect(chipOf('grey', 3, true)).toBeNull()
  })

  test('past 300 ids the count stands in', () => {
    const many = ids(400)
    const a = makeAck(many, 400, 1)
    expect(a.set.length).toBe(300)
    expect(newOf(many, 400, a).k).toBe(0)
    expect(newOf(many, 410, a).k).toBe(10)
    const shifted = [...ids(5, 'run:r2#c'), ...many]
    expect(newOf(shifted, 405, a).k).toBe(5 + 5)
  })

  test('idsHash is stable whatever the order, and changes with the set', () => {
    expect(idsHash(['a', 'b', 'c'])).toBe(idsHash(['c', 'a', 'b']))
    expect(idsHash(['a', 'b'])).not.toBe(idsHash(['a', 'c']))
    expect(idsHash([])).toMatch(/^[0-9a-f]{8}$/)
    expect(makeAck(['a', 'b'], 2, 1).h).toBe(idsHash(['b', 'a']))
  })

  test('fmtCount: two digits, 99+', () => {
    expect(fmtCount(0)).toBe('00')
    expect(fmtCount(8)).toBe('08')
    expect(fmtCount(99)).toBe('99')
    expect(fmtCount(100)).toBe('99+')
  })
})

const meta = (id: string, over: Partial<LampMeta> = {}): LampMeta => ({ id, order: 10, legend: id, short: id, rule: '', thresholds: { amber: 1, red: null }, flash: true, master: true, hasQueue: false, hasOpen: true, hasFix: false, ...over })

test.describe('lamps — views, MASTER CAUTION, the panel', () => {
  test('buildView + mcCount: new lamps that count for Master Caution', () => {
    const a = buildView(meta('proposals', { thresholds: { amber: 1, red: 15 } }), { state: 'ok', count: 3, ids: ids(3) }, undefined, 2, 5)
    expect(a).toMatchObject({ level: 'amber', isNew: true, chip: 'new', newCount: 3, count: 3 })
    const b = buildView(meta('gate'), { state: 'ok', count: 2, ids: ids(2) }, makeAck(ids(2), 2, 1), 1, 5)
    expect(b).toMatchObject({ level: 'amber', isNew: false, chip: null })
    const c = buildView(meta('c:x', { master: false }), { state: 'ok', count: 1, ids: ['x'] }, undefined, 1, 5)
    const g = buildView(meta('sync'), { state: 'off', count: 0, ids: [], why: 'features.preflight.grey.off' }, undefined, 1, 5)
    expect(g).toMatchObject({ level: 'grey', isNew: false, why: 'features.preflight.grey.off' })
    expect(mcCount([a, b, c, g])).toBe(1)
  })

  test('panelLamps: order, `after`, hidden, the cap of 16 and the overflow', () => {
    const lamps = [
      { id: 'inbox', order: 80 },
      { id: 'proposals', order: 10 },
      { id: 'gate', order: 30 },
      { id: 'p:tessera:waiting', order: 900, after: 'proposals' },
      { id: 'p:tessera:comments', order: 901, after: 'proposals' },
      { id: 'c:late', order: 5, after: 'nowhere' },
    ]
    expect(panelLamps(lamps).shown).toEqual(['proposals', 'p:tessera:waiting', 'p:tessera:comments', 'gate', 'inbox', 'c:late'])
    expect(panelLamps(lamps, { hidden: new Set(['gate']) }).shown).toEqual(['proposals', 'p:tessera:waiting', 'p:tessera:comments', 'inbox', 'c:late'])
    const twenty = Array.from({ length: 20 }, (_, i) => ({ id: `l${String(i).padStart(2, '0')}`, order: i }))
    const p = panelLamps(twenty)
    expect(p.shown.length).toBe(16)
    expect(p.overflow).toEqual(['l16', 'l17', 'l18', 'l19'])
  })

  test('the lamp test stays inside 260 ms for 1 … 16 lit caps', () => {
    for (let n = 0; n <= 16; n++) {
      const s = testSchedule(n)
      expect(s.end, `n = ${n}`).toBeLessThanOrEqual(260)
      expect(s.on).toBe(120)
      if (n > 1) expect(s.relitAt(n - 1) + s.fade).toBeCloseTo(s.end, 6)
    }
    expect(testSchedule(5).stagger).toBeCloseTo(12.5, 6)
    expect(testSchedule(2).stagger).toBe(20)
  })

  test('overlay: a card acted on leaves its lamp at once; an Undo brings it back; dark below the threshold', () => {
    const v = buildView(meta('inbox', { thresholds: { amber: 1, red: 3 } }), { state: 'ok', count: 3, ids: ['i1', 'i2', 'i3'] }, undefined, 1, 1)
    const has = (_l: string, id: string) => ['i1', 'i2', 'i3'].includes(id)
    expect(v.level).toBe('red')
    const down = overlay([v], [{ lamp: 'inbox', id: 'i1' }], [], has)[0]
    expect(down).toMatchObject({ count: 2, level: 'amber' })
    const gone = overlay([v], ['i1', 'i2', 'i3'].map((id) => ({ lamp: 'inbox', id })), [], has)[0]
    expect(gone).toMatchObject({ count: 0, level: 'dark', isNew: false, chip: null })
    const back = overlay([v], [], [{ lamp: 'inbox', id: 'i9' }], has)[0]
    expect(back.count).toBe(4)
    expect(overlay([v], [], [], has)[0]).toBe(v)
  })
})

test.describe('the Preflight day', () => {
  const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min).getTime()

  test('before the set time the day is still yesterday', () => {
    expect(preflightDay(at(2026, 10, 9, 6, 30), '07:00')).toBe('2026-10-08')
    expect(preflightDay(at(2026, 10, 9, 7, 0), '07:00')).toBe('2026-10-09')
    expect(preflightDay(at(2026, 10, 9, 23, 59), '07:00')).toBe('2026-10-09')
    expect(preflightDay(at(2026, 10, 1, 0, 30), '07:00')).toBe('2026-09-30')
    expect(preflightDay(at(2026, 10, 9, 0, 0), '00:00')).toBe('2026-10-09')
    // a bad time falls back to 07:00
    expect(preflightDay(at(2026, 10, 9, 6, 59), 'soon')).toBe('2026-10-08')
    expect(nextOpenAt(at(2026, 10, 9, 6, 0), '07:00')).toBe(at(2026, 10, 9, 7, 0))
    expect(nextOpenAt(at(2026, 10, 9, 8, 0), '07:00')).toBe(at(2026, 10, 10, 7, 0))
  })

  test('a daylight-saving switch moves nothing (Europe/Berlin)', () => {
    const tz = process.env.TZ
    process.env.TZ = 'Europe/Berlin'
    try {
      // the night the clocks go back (25 Oct 2026, 03:00 → 02:00) and forward (29 Mar 2026, 02:00 → 03:00)
      expect(preflightDay(new Date('2026-10-25T05:30:00Z').getTime(), '07:00')).toBe('2026-10-24') // 06:30 CET
      expect(preflightDay(new Date('2026-10-25T06:00:00Z').getTime(), '07:00')).toBe('2026-10-25') // 07:00 CET
      expect(preflightDay(new Date('2026-03-29T04:59:00Z').getTime(), '07:00')).toBe('2026-03-28') // 06:59 CEST
      expect(preflightDay(new Date('2026-03-29T05:00:00Z').getTime(), '07:00')).toBe('2026-03-29') // 07:00 CEST
      expect(nextOpenAt(new Date('2026-10-24T20:00:00Z').getTime(), '07:00')).toBe(new Date('2026-10-25T06:00:00Z').getTime())
    } finally {
      if (tz === undefined) delete process.env.TZ
      else process.env.TZ = tz
    }
  })

  test('working days between two moments', () => {
    // Fri 9 Oct 2026 → Mon 12 Oct: one working day (Monday)
    expect(workingDaysBetween(at(2026, 10, 9, 8), at(2026, 10, 12, 8))).toBe(1)
    expect(workingDaysBetween(at(2026, 10, 5, 8), at(2026, 10, 9, 8))).toBe(4)
    expect(workingDaysBetween(at(2026, 10, 10, 8), at(2026, 10, 11, 8))).toBe(0)
    expect(workingDaysBetween(at(2026, 10, 9, 8), at(2026, 10, 9, 20))).toBe(0)
    expect(workingDaysBetween(at(2026, 10, 9, 8), at(2026, 10, 1, 8))).toBe(0)
  })
})

test.describe('records — the sanitizers', () => {
  test('prefs: defaults, bad fields fall back', () => {
    expect(sanitizePrefs(null)).toEqual({ on: true, at: '07:00', hold: true, test: true })
    expect(sanitizePrefs({ on: false, at: '06:15', hold: false, test: false, extra: 1 })).toEqual({ on: false, at: '06:15', hold: false, test: false })
    expect(sanitizePrefs({ on: 'no', at: '25:00', hold: 1, test: null })).toEqual({ on: true, at: '07:00', hold: true, test: true })
    expect(sanitizePrefs([])).toEqual({ on: true, at: '07:00', hold: true, test: true })
  })

  test('today: another day reads as a fresh one; last: ids and levels only', () => {
    expect(sanitizeToday({ day: '2026-10-08', held: true, shown: true, base: ['gate'] }, '2026-10-09')).toEqual({ day: '2026-10-09', base: [] })
    expect(sanitizeToday({ day: '2026-10-09', held: true, shown: true, test: 'ran', base: ['gate', 3] }, '2026-10-09')).toEqual({ day: '2026-10-09', held: true, shown: true, test: 'ran', base: ['gate'] })
    expect(sanitizeToday({ day: '2026-10-09', test: 'maybe' }, '2026-10-09')).toEqual({ day: '2026-10-09', base: [] })
    expect(sanitizeLast({ at: 5, lamps: [['gate', 'amber'], ['sync', 'grey'], ['x', 'blue'], ['y']] })).toEqual({ at: 5, lamps: [['gate', 'amber'], ['sync', 'grey']] })
    expect(sanitizeLast({ lamps: [] })).toBeNull()
  })
})

test.describe('the plate mode (§5.6)', () => {
  const today = { day: '2026-10-09', base: [] as string[] }
  const base: ModeInput = { on: true, ready: true, lit: 2, newIds: ['gate'], queueOpen: false, unfolded: false, today, last: null }

  test('off; before the first count from the last count', () => {
    expect(planMode({ ...base, on: false }).mode).toBe('off')
    expect(planMode({ ...base, ready: false, last: { at: 1, lamps: [['gate', 'amber']] } })).toEqual({ mode: 'full', effect: null })
    expect(planMode({ ...base, ready: false, last: { at: 1, lamps: [['gate', 'dark']] } }).mode).toBe('strip')
    expect(planMode({ ...base, ready: false, last: null }).mode).toBe('strip')
    expect(planMode({ ...base, ready: false, last: { at: 1, lamps: [['gate', 'red']] }, today: { ...today, shown: true } }).mode).toBe('strip')
  })

  test('nothing lit → strip; the day’s first render with lamps lit → full, remembered', () => {
    expect(planMode({ ...base, lit: 0, newIds: [] }).mode).toBe('strip')
    expect(planMode({ ...base, lit: 0, unfolded: true }).mode).toBe('strip')
    expect(planMode(base)).toEqual({ mode: 'full', effect: { shown: true, base: ['gate'], unfold: true } })
  })

  test('folded: an acknowledgement never unfolds; a lamp new outside the base does; a queue / unfold → full', () => {
    const shown = { ...today, shown: true as const, base: ['gate', 'token'] }
    expect(planMode({ ...base, today: shown, newIds: ['gate', 'token'] })).toEqual({ mode: 'strip', effect: null })
    expect(planMode({ ...base, today: shown, newIds: ['gate'] })).toEqual({ mode: 'strip', effect: null })
    expect(planMode({ ...base, today: shown, newIds: [] })).toEqual({ mode: 'strip', effect: null })
    expect(planMode({ ...base, today: shown, newIds: ['gate', 'inbox'] })).toEqual({ mode: 'full', effect: { unfold: true, base: ['gate', 'token', 'inbox'] } })
    expect(planMode({ ...base, today: shown, queueOpen: true }).mode).toBe('full')
    expect(planMode({ ...base, today: shown, unfolded: true, newIds: [] })).toEqual({ mode: 'full', effect: null })
  })

  test('views survive JSON (the seam hands them to tests)', () => {
    const v: LampView = buildView(meta('gate'), { state: 'ok', count: 1, ids: ['t'] }, undefined, 0, 0)
    expect(JSON.parse(JSON.stringify(v))).toEqual(v)
  })
})

/* ------------------------------------------------------------------ */
/* Static guards (T-P1-6)                                              */
/* ------------------------------------------------------------------ */

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const APP = join(ROOT, 'src/app')
const PF = join(APP, 'features/preflight')

function filesUnder(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...filesUnder(p))
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

/** The module specifiers a file imports (static imports, re-exports, dynamic imports). */
function importsOf(file: string): string[] {
  const src = readFileSync(file, 'utf8')
  const out: string[] = []
  for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g)) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

/** The names a file imports from a specifier matching `re`. */
function namesFrom(file: string, re: RegExp): string[] {
  const src = readFileSync(file, 'utf8')
  const out: string[] = []
  for (const m of src.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    if (!re.test(m[2])) continue
    for (const part of m[1].split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()
      if (name) out.push(name)
    }
  }
  return out
}

/** The other areas' action functions only queue/calls.ts may import (§4 of the design). */
const ACTIONS = ['applyRun', 'discardRun', 'undoChange', 'applyStaged', 'undoStagedBatch', 'discardStaged', 'undiscardStaged', 'saveProposal', 'undoProposal', 'dismissProposal', 'saveRunMemory', 'restoreRun', 'removeRun', 'applyTaskAction', 'confirmTaskVersion', 'markRead', 'archiveItems', 'openInboxItem', 'resolveMissing', 'resumeFolder', 'signIn', 'syncNow', 'runAgentNow', 'openAutofillPanel']

test.describe('agents — supersedePlan (pure, T-P2-9)', () => {
  const upd = (id: string, row: string, props: string[], x: Partial<StagedChange> = {}): StagedChange => ({ id, n: Number(id.slice(1)), kind: 'update_row', status: 'pending', pageId: row, databaseId: 'db', props: props.map((p) => ({ propId: p, name: p, type: 'text', before: '', after: 'x' })), ...x }) as StagedChange
  const run = (id: string, at: number, staged: StagedChange[], x: Partial<AgentRun> = {}): AgentRun => ({ id, agentId: 'ag', runner: 'browser', trigger: { type: 'manual' }, startedAt: at, status: 'staged', summary: '', steps: [], staged, ...x })
  const rowOf = (r: AgentRun, id: string) => r.rowIds?.[id] ?? id
  const none = () => false
  const ids = (plan: ReturnType<typeof supersedePlan>) => plan.map((s) => `${s.runId}#${s.changeId}>${s.by.runId}#${s.by.changeId}`).sort()

  test('the newest wins: A ⊂ B ⊂ C marks A and B by C; order of the list does not matter', () => {
    const runs = [run('A', 1, [upd('c1', 'p', ['x'])]), run('C', 3, [upd('c1', 'p', ['x', 'y', 'z'])]), run('B', 2, [upd('c1', 'p', ['x', 'y'])])]
    expect(ids(supersedePlan(runs, rowOf, none))).toEqual(['A#c1>C#c1', 'B#c1>C#c1'])
    expect(supersedePlan(runs, rowOf, none).find((s) => s.runId === 'A')).toMatchObject({ at: 1, by: { at: 3 } })
  })

  test('nothing is swallowed: more fields, other rows, proposals of one run, decided ones', () => {
    expect(supersedePlan([run('N', 2, [upd('c1', 'p', ['x'])]), run('O', 1, [upd('c1', 'p', ['x', 'y'])])], rowOf, none)).toEqual([])
    expect(supersedePlan([run('N', 2, [upd('c1', 'q', ['x'])]), run('O', 1, [upd('c1', 'p', ['x'])])], rowOf, none)).toEqual([])
    expect(supersedePlan([run('N', 2, [upd('c1', 'p', ['x']), upd('c2', 'p', ['x'])])], rowOf, none)).toEqual([])
    for (const status of ['applied', 'discarded', 'superseded', 'applying'] as const) {
      expect(supersedePlan([run('N', 2, [upd('c1', 'p', ['x'])]), run('O', 1, [upd('c1', 'p', ['x'], { status })])], rowOf, none), status).toEqual([])
      expect(supersedePlan([run('N', 2, [upd('c1', 'p', ['x'], { status })]), run('O', 1, [upd('c1', 'p', ['x'])])], rowOf, none), `newer ${status}`).toEqual([])
    }
    // a failed proposal is still open
    expect(ids(supersedePlan([run('N', 2, [upd('c1', 'p', ['x'], { status: 'failed' })]), run('O', 1, [upd('c1', 'p', ['x'], { status: 'failed' })])], rowOf, none))).toEqual(['O#c1>N#c1'])
  })

  test('only update_row of browser runs waiting for review, of the same agent; not opened, not built on', () => {
    const newer = run('N', 2, [upd('c1', 'p', ['x'])])
    expect(supersedePlan([newer, run('O', 1, [upd('c1', 'p', ['x'])], { runner: 'server' })], rowOf, none)).toEqual([])
    expect(supersedePlan([newer, run('O', 1, [upd('c1', 'p', ['x'])], { status: 'ok' })], rowOf, none)).toEqual([])
    expect(supersedePlan([newer, run('O', 1, [upd('c1', 'p', ['x'])], { agentId: 'other' })], rowOf, none)).toEqual([])
    expect(supersedePlan([newer, run('O', 1, [{ ...upd('c1', 'p', ['x']), kind: 'append' }])], rowOf, none)).toEqual([])
    expect(supersedePlan([newer, run('O', 1, [upd('c1', 'p', ['x'])])], rowOf, (r, c) => r === 'O' && c === 'c1')).toEqual([])
    const built = run('O', 1, [upd('c1', 'p', ['x']), { id: 'c2', n: 2, kind: 'append', status: 'pending', pageId: 'p', dependsOn: 'c1' } as StagedChange])
    expect(supersedePlan([newer, built], rowOf, none)).toEqual([])
    // a discarded proposal building on it does not count
    const gone = run('O', 1, [upd('c1', 'p', ['x']), { id: 'c2', n: 2, kind: 'append', status: 'discarded', pageId: 'p', dependsOn: 'c1' } as StagedChange])
    expect(ids(supersedePlan([newer, gone], rowOf, none))).toEqual(['O#c1>N#c1'])
  })

  test('the same row through the run’s row ids (a staged row that was created)', () => {
    const newer = run('N', 2, [upd('c1', 'real', ['x'])])
    const older = run('O', 1, [upd('c1', 'staged-1', ['x'])], { rowIds: { 'staged-1': 'real' } })
    expect(ids(supersedePlan([newer, older], rowOf, none))).toEqual(['O#c1>N#c1'])
  })
})

test.describe('static guards (T-P1-6)', () => {
  const pf = filesUnder(PF)
  const rel = (f: string) => relative(ROOT, f)

  test('the lamps never import the Claude client (Preflight, coding/waiting.ts, agents/health.ts)', () => {
    expect(pf.length).toBeGreaterThan(20)
    for (const f of [...pf, join(APP, 'features/coding/waiting.ts'), join(APP, 'features/agents/health.ts')]) {
      for (const spec of importsOf(f)) expect(/(^|\/)ai\/client$|^\.\/client$/.test(spec) && !f.includes('/features/ai/'), `${rel(f)} imports ${spec}`).toBe(false)
    }
  })

  test('Preflight never imports the Outbox; the Outbox’s lamp imports only Preflight’s registry', () => {
    for (const f of pf) for (const spec of importsOf(f)) expect(/(^|\/)outbox(\/|$)/.test(spec), `${rel(f)} imports ${spec}`).toBe(false)
    const lamp = join(APP, 'features/outbox/lamp.ts')
    const fromPreflight = importsOf(lamp).filter((s) => s.includes('preflight'))
    expect(fromPreflight).toEqual(['../preflight/registry'])
  })

  test('no store write action in Preflight', () => {
    for (const f of pf) {
      const src = readFileSync(f, 'utf8')
      // the workspace store is read only (useWorkspace, its getState()); zustand setState is on Preflight's own stores
      expect(src.match(/useWorkspace\.getState\(\)\.(?!settings\b|pages\b|databases\b|agents\b|epoch\b)\w+\(/g) ?? [], rel(f)).toEqual([])
      expect(src.match(/useWorkspace\.setState/g) ?? [], rel(f)).toEqual([])
      for (const name of namesFrom(f, /store\/store$/)) expect(['useWorkspace', 'pageChanges'], `${rel(f)} imports ${name} from store/store`).toContain(name)
    }
  })

  test('other areas’ actions are imported only by queue/calls.ts', () => {
    const calls = join(PF, 'queue/calls.ts')
    for (const f of pf) {
      if (f === calls) continue
      const names = namesFrom(f, /^\.\.?\//).filter((n) => ACTIONS.includes(n))
      expect(names, rel(f)).toEqual([])
    }
    expect(namesFrom(calls, /./).filter((n) => ACTIONS.includes(n))).toEqual(['resumeFolder'])
  })
})
