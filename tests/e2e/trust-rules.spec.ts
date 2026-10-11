/**
 * Per-field trust — the earn and revoke rules (features/agents/trust/rules.ts), pure: run in Node by the Playwright
 * runner (no browser). Every row of the verdict → segment table, FREIGEBBAR, the row note's order, the meter's label in
 * both languages, the spot-check cadence and what pruning a key's shard keeps. Test data is fictional.
 */
import { test, expect } from '@playwright/test'
import { TRUST, TRUST_LIMITS, isWrongish, lampOf, meterLabel, noteOf, pruneKey, readiness, sampleDue, segmentOf, type NoteInput, type Readiness } from '../../src/app/features/agents/trust/rules'
import { stableJson } from '../../src/app/features/agents/trust/stable'
import { messages } from '../../src/app/features/agents/trust/messages'
import type { Verdict } from '../../src/app/features/agents/trust/types'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 9, 13, 7, 52)
const KEY = 'prop:db-nl:klar'

let seq = 0
/** A verdict `ago` ms before NOW (later calls are newer when ago shrinks). */
function v(kind: Verdict['v'], ago: number, x: Partial<Verdict> = {}): Verdict {
  seq++
  return { id: `v${seq}`, key: KEY, v: kind, at: NOW - ago, run: 'run-1', change: `c${seq}`, ...x }
}
/** n verdicts of a kind, one minute apart, ending `end` ms before NOW. */
function many(n: number, kind: Verdict['v'], end = 0, x: Partial<Verdict> = {}): Verdict[] {
  return Array.from({ length: n }, (_, i) => v(kind, end + (n - i) * 60_000, x))
}

const tr = (lang: 'en' | 'de') => (key: string, vars?: Record<string, string | number>) => (messages[lang][key] ?? key).replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? String(vars[k]) : m))

test.describe('verdict → segment (every row)', () => {
  test('segments, run breaks and wrong-ish', () => {
    const rows: Array<[Partial<Verdict> & { v: Verdict['v'] }, string | null, boolean, boolean]> = [
      // verdict, segment, breaks the run, wrong for lessons
      [{ v: 'accept' }, 'g', false, false],
      [{ v: 'spot:ok' }, 's', false, false],
      [{ v: 'edited' }, 'e', true, false],
      [{ v: 'discard', reason: 'wrong' }, 'w', true, true],
      [{ v: 'discard', reason: 'notNow' }, null, false, false],
      [{ v: 'discard', reason: 'duplicate' }, null, false, false],
      [{ v: 'discard', reason: 'done' }, null, false, false],
      [{ v: 'discard', single: true }, null, false, false],
      [{ v: 'undone' }, 'u', true, false],
      [{ v: 'undone', reason: 'wrong' }, 'u', true, true],
      [{ v: 'spot:wrong' }, 'w', true, true],
    ]
    for (const [x, seg, breaks, wrong] of rows) {
      const one = v(x.v, 60_000, x)
      expect(segmentOf(one), JSON.stringify(x)).toBe(seg)
      expect(isWrongish(one), JSON.stringify(x)).toBe(wrong)
      // three greens, then the verdict: does the streak survive?
      const r = readiness([...many(3, 'accept', 120_000), one], undefined, NOW)
      expect(r.streak, JSON.stringify(x)).toBe(breaks ? 0 : seg === null ? 3 : 4)
    }
  })

  test('the meter pads with empty ticks, oldest left', () => {
    const r = readiness([v('accept', 3000), v('edited', 2000), v('discard', 1500, { reason: 'notNow' }), v('discard', 1000, { reason: 'wrong' })], undefined, NOW)
    expect(r.segs.join('')).toBe('x'.repeat(17) + 'gew')
    expect(r.segs).toHaveLength(TRUST.WINDOW)
    expect(r.counts).toEqual({ accept: 1, spot: 0, edited: 1, wrong: 1, undone: 0 })
  })
})

test.describe('FREIGEBBAR', () => {
  test('20 green in a row → ready', () => {
    const r = readiness(many(20, 'accept'), undefined, NOW)
    expect(r).toMatchObject({ streak: 20, green: 20, ready: true, earliest: null, unexplained: 0 })
    // spot checks that were right count as green
    expect(readiness([...many(18, 'accept', 600_000), ...many(2, 'spot:ok')], undefined, NOW).ready).toBe(true)
  })

  test('19 + one edited → not ready, streak 0', () => {
    const r = readiness([...many(19, 'accept', 600_000), v('edited', 1000)], undefined, NOW)
    expect(r.ready).toBe(false)
    expect(r.streak).toBe(0)
    expect(r.green).toBe(19)
  })

  test('undone 13 days ago → not ready until 14 days; 15 days ago → ready', () => {
    const r13 = readiness([v('undone', 13 * DAY), ...many(20, 'accept')], undefined, NOW)
    expect(r13.streak).toBe(20)
    expect(r13.ready).toBe(false)
    expect(r13.earliest).toBe(NOW - 13 * DAY + 14 * DAY)
    expect(r13.revokedAt).toBe(NOW - 13 * DAY)
    const r15 = readiness([v('undone', 15 * DAY), ...many(20, 'accept')], undefined, NOW)
    expect(r15.ready).toBe(true)
    expect(r15.earliest).toBeNull()
    // the head's lastRevoke counts though the book holds no undone entry (pruned, or written elsewhere)
    const head = readiness(many(20, 'accept'), NOW - 2 * DAY, NOW)
    expect(head.ready).toBe(false)
    expect(head.earliest).toBe(NOW + 12 * DAY)
    expect(readiness(many(20, 'accept'), NOW - 20 * DAY, NOW).ready).toBe(true)
  })

  test('single reasonless discards inside the run: 3 block, 2 do not', () => {
    const run = (singles: number) => {
      const greens = many(20, 'accept', 0)
      // singles between the first and the last green
      const between = Array.from({ length: singles }, (_, i) => v('discard', (10 - i) * 60_000 + 30_000, { single: true }))
      return readiness([...greens, ...between], undefined, NOW)
    }
    expect(run(2)).toMatchObject({ unexplained: 2, ready: true })
    expect(run(3)).toMatchObject({ unexplained: 3, ready: false })
    // singles before the run do not count
    const before = readiness([...many(5, 'discard', 30 * 60_000, { single: true }), ...many(20, 'accept')], undefined, NOW)
    expect(before).toMatchObject({ unexplained: 0, ready: true })
  })

  test('not now / duplicate / handled already keep the streak', () => {
    const list = [...many(10, 'accept', 600_000), v('discard', 500_000, { reason: 'notNow' }), v('discard', 400_000, { reason: 'duplicate' }), v('discard', 300_000, { reason: 'done' }), ...many(10, 'accept')]
    const r = readiness(list, undefined, NOW)
    expect(r).toMatchObject({ streak: 20, ready: true, unexplained: 0, total: 20 })
  })

  test('rare: fewer than 20 and fewer than 3 in the last 14 days', () => {
    expect(readiness([v('accept', 30 * DAY), v('accept', 20 * DAY), v('accept', DAY)], undefined, NOW)).toMatchObject({ total: 3, recent: 1, rare: true })
    expect(readiness([v('accept', 3 * DAY), v('accept', 2 * DAY), v('accept', DAY)], undefined, NOW)).toMatchObject({ total: 3, recent: 3, rare: false })
    expect(readiness(many(20, 'accept', 30 * DAY), undefined, NOW)).toMatchObject({ total: 20, recent: 0, rare: false })
  })

  test('lamps', () => {
    const ready = readiness(many(20, 'accept'), undefined, NOW)
    const not = readiness(many(3, 'accept'), undefined, NOW)
    expect(lampOf(ready, true, true, true)).toBe('direct')
    expect(lampOf(ready, true, false, true)).toBe('idle')
    expect(lampOf(ready, false, false, false)).toBe('never')
    expect(lampOf(ready, false, false, true)).toBe('ready')
    expect(lampOf(not, false, false, true)).toBe('review')
  })
})

test.describe('the row note (first rule that applies)', () => {
  const fmt = { date: (ms: number) => `D${Math.round((ms - NOW) / DAY)}`, time: (ms: number) => `T${Math.round((ms - NOW) / DAY)}` }
  const base = (r: Readiness, x: Partial<NoteInput> = {}): NoteInput => ({ r, granted: false, effective: false, entries: 20, now: NOW, fmt, ...x })
  const ready = readiness(many(20, 'accept'), undefined, NOW)

  test('rules 1–4: grants and revocations come first', () => {
    expect(noteOf(base(ready, { granted: true, effective: true, entries: 0 })).key).toBe('features.agents.trust.note.otherDevice')
    expect(noteOf(base(ready, { granted: true, effective: true, since: NOW - 2 * DAY }))).toEqual({ key: 'features.agents.trust.note.direct', vars: { date: 'D-2' } })
    expect(noteOf(base(ready, { granted: true, effective: true, since: NOW - 2 * DAY, spotOpen: 1 }))).toEqual({ key: 'features.agents.trust.note.directSpot.one', vars: { date: 'D-2', n: 1 } })
    expect(noteOf(base(ready, { granted: true, effective: false, why: 'x', revokedAt: NOW - DAY }))).toEqual({ key: 'features.agents.trust.note.idle', vars: { why: 'x' } })
    expect(noteOf(base(ready, { revokedAt: NOW - DAY, lesson: 3 }))).toEqual({ key: 'features.agents.trust.note.revoked', vars: { time: 'T-1', date: 'D13' } })
    // a revocation older than 14 days says nothing any more
    expect(noteOf(base(ready, { revokedAt: NOW - 15 * DAY })).key).toBe('features.agents.trust.note.ready')
  })

  test('rules 5–12 in order', () => {
    const blocked = readiness([v('undone', 3 * DAY), ...many(20, 'accept')], undefined, NOW)
    const singles = readiness([...many(10, 'accept', 600_000), ...many(3, 'discard', 300_000, { single: true }), ...many(8, 'accept')], undefined, NOW)
    const rare = readiness([v('accept', 30 * DAY), v('edited', 20 * DAY)], undefined, NOW)
    const edited = readiness([...many(10, 'edited', 600_000), ...many(10, 'accept')], undefined, NOW)
    const mixed = readiness([...many(10, 'accept', 600_000), v('discard', 500_000, { reason: 'wrong' }), v('edited', 400_000), ...many(10, 'accept')], undefined, NOW)
    const plain = readiness(many(15, 'accept'), undefined, NOW)
    expect(noteOf(base(ready, { lesson: 3 }))).toEqual({ key: 'features.agents.trust.note.lesson', vars: { n: 3 } })
    expect(noteOf(base(ready))).toEqual({ key: 'features.agents.trust.note.ready', vars: { streak: 20 } })
    expect(noteOf(base(blocked))).toEqual({ key: 'features.agents.trust.note.earliest.other', vars: { date: 'D-3', k: 0, until: 'D11' } })
    expect(noteOf(base(singles))).toEqual({ key: 'features.agents.trust.note.unexplained', vars: { n: 3 } })
    expect(noteOf(base(rare))).toEqual({ key: 'features.agents.trust.note.rare.other', vars: { total: 2 } })
    expect(noteOf(base(edited))).toEqual({ key: 'features.agents.trust.note.edited', vars: {} })
    expect(noteOf(base(mixed))).toEqual({ key: 'features.agents.trust.note.counts', vars: { w: 1, e: 1 } })
    expect(noteOf(base(plain))).toEqual({ key: 'features.agents.trust.note.more.other', vars: { k: 5 } })
    expect(noteOf(base(readiness([...many(1, 'edited', 3600_000), ...many(19, 'accept')], undefined, NOW))).key).toBe('features.agents.trust.note.counts')
  })

  test('every note key exists in both languages', () => {
    for (const lang of ['en', 'de'] as const)
      for (const key of ['otherDevice', 'direct', 'directSpot.one', 'directSpot.other', 'idle', 'revoked', 'lesson', 'ready', 'earliest.one', 'earliest.other', 'unexplained', 'rare.one', 'rare.other', 'edited', 'counts', 'more.one', 'more.other'])
        expect(messages[lang][`features.agents.trust.note.${key}`], `${lang} ${key}`).toBeTruthy()
  })
})

test.describe('the meter label', () => {
  test('EN + DE, zero counts left out', () => {
    const r = readiness([...many(15, 'accept', 600_000), ...many(4, 'edited', 300_000), v('discard', 1000, { reason: 'wrong' })], undefined, NOW)
    expect(meterLabel(r, tr('de'))).toBe('Letzte 20 Urteile: 15 übernommen, 4 bearbeitet, 1 falsch')
    expect(meterLabel(r, tr('en'))).toBe('Last 20 verdicts: 15 applied, 4 edited, 1 wrong')
    const mixed = readiness([...many(2, 'spot:ok', 600_000), v('undone', 3000), v('accept', 1000)], undefined, NOW)
    expect(meterLabel(mixed, tr('de'))).toBe('Letzte 20 Urteile: 1 übernommen, 2 Stichproben stimmen, 1 rückgängig, 16 noch ohne Urteil')
    expect(meterLabel(mixed, tr('en'))).toBe('Last 20 verdicts: 1 applied, 2 spot checks right, 1 undone, 16 without a verdict yet')
    expect(meterLabel(readiness([], undefined, NOW), tr('de'))).toBe('Letzte 20 Urteile: noch keine')
    expect(meterLabel(readiness([v('discard', 1000, { reason: 'notNow' })], undefined, NOW), tr('en'))).toBe('Last 20 verdicts: none yet')
  })
})

test.describe('spot checks and pruning', () => {
  test('every 10th direct change is sampled', () => {
    expect([1, 9, 10, 11, 19, 20, 30, 0, -10, 10.5].map(sampleDue)).toEqual([false, false, true, false, false, true, true, false, false, false])
  })

  test('30 not-now discards + 20 accepts: the 20 accepts stay, ready unchanged', () => {
    const list = [...many(30, 'discard', 0, { reason: 'notNow' }), ...many(20, 'accept', 0)].sort((a, b) => a.at - b.at)
    const before = readiness(list, undefined, NOW)
    const kept = pruneKey(list)
    expect(kept.length).toBeLessThanOrEqual(TRUST_LIMITS.perKey)
    expect(kept.filter((x) => x.v === 'accept')).toHaveLength(20)
    const after = readiness(kept, undefined, NOW)
    expect(after.ready).toBe(before.ready)
    expect(after.segs).toEqual(before.segs)
  })

  test('25 singles inside the window: still blocked after pruning', () => {
    const greens = many(20, 'accept', 0)
    const singles = Array.from({ length: 25 }, (_, i) => v('discard', 19 * 60_000 - i * 30_000 - 1000, { single: true }))
    const list = [...greens, ...singles].sort((a, b) => a.at - b.at)
    expect(readiness(list, undefined, NOW).ready).toBe(false)
    const kept = pruneKey(list)
    expect(kept.length).toBeLessThanOrEqual(TRUST_LIMITS.perKey)
    expect(kept.filter((x) => x.v === 'accept')).toHaveLength(20)
    expect(readiness(kept, undefined, NOW)).toMatchObject({ ready: false })
    expect(readiness(kept, undefined, NOW).unexplained).toBeGreaterThan(TRUST.UNEXPLAINED)
  })

  test('room left: older segments stay before entries without one', () => {
    const list = [...many(30, 'accept', 3 * DAY), ...many(15, 'discard', 2 * DAY, { reason: 'done' }), ...many(5, 'accept', 0)].sort((a, b) => a.at - b.at)
    const kept = pruneKey(list)
    expect(kept).toHaveLength(TRUST_LIMITS.perKey)
    expect(kept.filter((x) => x.v === 'accept')).toHaveLength(35)
    // the order of the shard stays oldest first
    expect(kept.map((x) => x.at)).toEqual([...kept.map((x) => x.at)].sort((a, b) => a - b))
  })
})

test.describe('stable JSON', () => {
  test('sorted keys, arrays in order, undefined left out', () => {
    expect(stableJson({ b: 1, a: [2, 1], c: undefined })).toBe(stableJson({ a: [2, 1], b: 1 }))
    expect(stableJson({ a: [1, 2] })).not.toBe(stableJson({ a: [2, 1] }))
    expect(stableJson({ start: '2026-10-13', reminder: null })).toBe('{"reminder":null,"start":"2026-10-13"}')
    expect(stableJson(undefined)).toBe('null')
    expect(stableJson('Klar')).toBe('"Klar"')
  })
})
