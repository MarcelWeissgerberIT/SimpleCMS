/**
 * Frecency of page visits (shell/lib/frecency.ts) — pure, run in Node by the Playwright runner: counting
 * a visit, sessions and returns, decay, FREQUENT's ranking, pruning, and reading the stored form back
 * defensively (junk, prototype keys, caps).
 */
import { test, expect } from '@playwright/test'
import {
  bump,
  emptyVisits,
  HALF_LIFE_MS,
  KEEP_ENTRIES,
  MAX_ENTRIES,
  parseVisits,
  prune,
  rankFrequent,
  RETURN_MS,
  scoreAt,
  serializeVisits,
  SESSION_MS,
  type VisitMap,
} from '../../src/app/shell/lib/frecency'

const NOW = new Date(2026, 9, 8, 12, 0).getTime()
const MIN = 60_000

test.describe('frecency', () => {
  test('a first visit, the same session, a return, decay', () => {
    const first = bump(undefined, NOW)
    expect(first).toEqual({ s: 1, t: NOW, n: 1 })
    // inside the session: the same object (nothing to write)
    expect(bump(first, NOW + 5 * MIN)).toBe(first)
    // coming back after another page was counted: counts after RETURN_MS …
    expect(bump(first, NOW + RETURN_MS - 1, true)).toBe(first)
    const back = bump(first, NOW + RETURN_MS, true)
    expect(back.n).toBe(2)
    expect(back.s).toBeCloseTo(scoreAt(first, NOW + RETURN_MS) + 1, 6)
    // … and without one only once the session is over
    expect(bump(first, NOW + SESSION_MS - 1)).toBe(first)
    expect(bump(first, NOW + SESSION_MS).n).toBe(2)
    // half the score after 14 days
    expect(scoreAt({ s: 4, t: NOW, n: 3 }, NOW + HALF_LIFE_MS)).toBeCloseTo(2, 6)
    // a clock that went backwards: a new visit, no decay
    const odd = bump({ s: 2, t: NOW, n: 2 }, NOW - 10 * MIN)
    expect(odd).toEqual({ s: 3, t: NOW - 10 * MIN, n: 3 })
  })

  test('FREQUENT: two visits and a score of 1, highest first, then the latest', () => {
    const map: VisitMap = emptyVisits()
    map.once = { s: 1, t: NOW, n: 1 }
    map.faded = { s: 1.5, t: NOW - 3 * HALF_LIFE_MS, n: 4 }
    map.a = { s: 2, t: NOW - 1000, n: 2 }
    map.b = { s: 3, t: NOW - 5000, n: 3 }
    map.c = { s: 2, t: NOW - 10, n: 2 }
    expect(rankFrequent(map, NOW)).toEqual(['b', 'c', 'a'])
  })

  test('prune drops faded entries and keeps the best 250 of more than 300', () => {
    const map: VisitMap = emptyVisits()
    map.gone = { s: 1, t: NOW - 10 * HALF_LIFE_MS, n: 9 }
    map.kept = { s: 1, t: NOW, n: 1 }
    expect(Object.keys(prune(map, NOW))).toEqual(['kept'])
    const many: VisitMap = emptyVisits()
    for (let i = 0; i < MAX_ENTRIES + 20; i++) many[`p${i}`] = { s: 1 + i / 100, t: NOW, n: 2 }
    const kept = prune(many, NOW)
    expect(Object.keys(kept)).toHaveLength(KEEP_ENTRIES)
    expect(kept[`p${MAX_ENTRIES + 19}`]).toBeTruthy()
    expect(kept.p0).toBeUndefined()
  })

  test('the stored form round-trips; junk reads as nothing', () => {
    const map: VisitMap = emptyVisits()
    map['page-1'] = { s: 2.123456, t: NOW, n: 2 }
    map.page_2 = { s: 1, t: NOW - MIN, n: 1 }
    const raw = serializeVisits(map)
    expect(JSON.parse(raw)).toEqual({ v: 1, e: { 'page-1': [2.123, NOW, 2], page_2: [1, NOW - MIN, 1] } })
    expect({ ...parseVisits(raw, NOW) }).toEqual({ 'page-1': { s: 2.123, t: NOW, n: 2 }, page_2: { s: 1, t: NOW - MIN, n: 1 } })

    const one = (e: Record<string, unknown>) => Object.keys(parseVisits(JSON.stringify({ v: 1, e }), NOW))
    expect(parseVisits(null, NOW)).toEqual({})
    expect(parseVisits('not json', NOW)).toEqual({})
    expect(parseVisits(JSON.stringify({ v: 2, e: { a: [1, NOW, 1] } }), NOW)).toEqual({})
    expect(parseVisits(JSON.stringify({ v: 1, e: [] }), NOW)).toEqual({})
    expect(one({ '../x': [1, NOW, 1], ['a'.repeat(65)]: [1, NOW, 1], ok: [1, NOW, 1] })).toEqual(['ok'])
    expect(one({ nan: ['x', NOW, 1], neg: [-1, NOW, 1], huge: [1e5, NOW, 1], future: [1, NOW + 2 * 86_400_000, 1], frac: [1, NOW, 1.5], zero: [1, NOW, 0], short: [1, NOW] })).toEqual([])
    // prototype keys never get in (and the map has no prototype to reach)
    const proto = parseVisits('{"v":1,"e":{"__proto__":[1,1,1],"constructor":[1,1,1],"prototype":[1,1,1],"fine":[1,1,1]}}', NOW)
    expect(Object.keys(proto)).toEqual(['fine'])
    expect(Object.getPrototypeOf(proto)).toBeNull()
    expect(({} as Record<string, unknown>).s).toBeUndefined()
    // more than 400 stored entries: not ours
    const big: Record<string, unknown> = {}
    for (let i = 0; i < 401; i++) big[`p${i}`] = [1, NOW, 1]
    expect(one(big)).toEqual([])
  })
})
