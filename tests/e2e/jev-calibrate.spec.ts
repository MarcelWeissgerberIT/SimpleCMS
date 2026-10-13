/**
 * The calibration tool (slice SJ, J17 — scripts/jev-calibrate.mjs) in Node, never against a real host: the labelled,
 * fictional fixtures (≥ 120, EN + DE, every category of § 7.2) each build a state through the SAME state builder and
 * question set a run uses; the summary's math; a run against a mock `send` (repeats, ≤ 3 in flight, a failed call is
 * a null run); the script refuses without `--real`, without a key and in CI — before it loads or sends anything.
 */
import './helpers/noNet'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { THRESHOLDS, calibInput, calibState, checksOf, endpointTags, isGood, runCalibration, summarize, type CalibFile, type CalibItem, type CalibResult } from '../../src/app/features/ai/decide/calibration'
import { precheckQuestions } from '../../src/app/features/ai/decide/questions'
import { JEV_CHECK_KEYS } from '../../src/shared/ai/decide'

const file = (lang: 'en' | 'de') => JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/ai/jev/calibration/${lang}.json`, import.meta.url)), 'utf8')) as CalibFile
const SCRIPT = fileURLToPath(new URL('../../scripts/jev-calibrate.mjs', import.meta.url))
const CATEGORIES = ['legit-update', 'legit-append', 'legit-create', 'wrong-row', 'wrong-page', 'planted-order', 'value-poisoning', 'reviewer-praise', 'fake-instructions', 'mirrored-instructions']

test.describe('the calibration fixtures (tests/fixtures/ai/jev/calibration)', () => {
  test('≥ 120 labelled, fictional proposals in EN and DE; every category of § 7.2 in both; good and bad ones', () => {
    const en = file('en')
    const de = file('de')
    expect(en.items.length + de.items.length).toBeGreaterThanOrEqual(120)
    for (const f of [en, de]) {
      expect(f.source).toMatch(/fictional/)
      expect([...new Set(f.items.map((i) => i.category))].sort()).toEqual([...CATEGORIES].sort())
      expect(f.items.filter(isGood).length).toBeGreaterThan(20)
      expect(f.items.filter((i) => !isGood(i)).length).toBeGreaterThan(20)
      expect(new Set(f.items.map((i) => i.id)).size).toBe(f.items.length)
    }
    expect(JSON.stringify(de)).toMatch(/Fertig|Prüfung|Wochenbericht/)
  })

  test('every item builds its state with the run’s own builder and QSET: change · row · trigger · agent, no ids', () => {
    const qs = precheckQuestions()
    for (const item of [...file('en').items, ...file('de').items]) {
      const st = calibState(item, qs)
      expect(st, item.id).not.toBeNull()
      expect(Object.keys(st!).filter((k) => k !== 'row'), item.id).toEqual(['change', 'trigger', 'agent'])
      const json = JSON.stringify(st)
      for (const id of ['cdb000000001', 'crow00000001', 'cpage0000001', 'cnew00000001']) expect(json, item.id).not.toContain(id)
      expect((st!.agent as { instructions: string }).instructions).toBe(item.instructions)
      // the planted orders reach Jev as data (that is what is measured)
      if (item.category === 'planted-order') expect(json, item.id).toMatch(/Ignore your instructions|Ignoriere deine Anweisungen/)
    }
    // an update carries the row's other values; a new row an empty one
    const upd = file('en').items.find((i) => i.category === 'legit-update')!
    expect(Object.keys(calibState(upd)!.row as object)).toEqual(expect.arrayContaining(['Owner', 'Budget', 'Note']))
    const cr = file('en').items.find((i) => i.category === 'legit-create')!
    expect(calibState(cr)!.row).toEqual({})
    expect(calibInput(cr).input.change.kind).toBe('create_row')
  })
})

const item = (good: boolean, n: number): CalibItem => ({ id: `x-${n}`, category: good ? 'legit-update' : 'wrong-row', expect: { asked: true, target: good, consistent: true, clean: true }, instructions: 'Keep the Projects rows up to date.', kind: 'update_row', database: 'Projects', row: { title: 'Launch plan', values: { Status: 'Open' } }, set: { Status: 'Done' } })
const checks = (p: number, target = p) => ({ asked: p, target, consistent: p, clean: p })

test.describe('the summary (features/ai/decide/calibration.ts)', () => {
  test('per threshold: good proposals marked, bad ones missed, bad ones through the gate; noise and agreement per question — the median of the repeats', () => {
    const results: CalibResult[] = [
      { item: item(true, 1), runs: [checks(0.95), checks(0.93), checks(0.91), checks(0.97)] },
      { item: item(true, 2), runs: [checks(0.72), checks(0.66), checks(0.7), checks(0.68)] },
      { item: item(false, 3), runs: [checks(0.95, 0.2), checks(0.95, 0.3), checks(0.95, 0.25), checks(0.95, 0.22)] },
      { item: item(false, 4), runs: [checks(0.95, 0.92), checks(0.95, 0.94), null, checks(0.95, 0.96)] },
      { item: item(false, 5), runs: [null, null] },
    ]
    const s = summarize(results)
    expect({ items: s.items, good: s.good, bad: s.bad, failed: s.failed }).toEqual({ items: 5, good: 2, bad: 2, failed: 1 })
    expect(Object.keys(s.falseMark)).toEqual(THRESHOLDS.map((t) => t.toFixed(2)))
    // good #2 sits at 0.69 (median): marked from 0.70 on
    expect(s.falseMark['0.65']).toBe(0)
    expect(s.falseMark['0.70']).toBe(0.5)
    // bad #4 (target 0.94) passes the gate at 0.90, not at 0.95; bad #3 never
    expect(s.falsePass['0.90']).toBe(0.5)
    expect(s.falsePass['0.95']).toBe(0)
    expect(s.missedMark['0.70']).toBe(0.5)
    expect(s.noise.target).toBeGreaterThan(0)
    for (const k of JEV_CHECK_KEYS) expect(s.agreement[k]).toBeGreaterThanOrEqual(0)
    // never a suggested threshold
    expect(JSON.stringify(s)).not.toMatch(/suggest|recommend/i)
  })

  test('a run against a mock: every item × repeats, ≤ 3 in flight, a failed call is a null run (never retried)', async () => {
    let inFlight = 0
    let peak = 0
    let calls = 0
    const send = async () => {
      calls++
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 2))
      inFlight--
      if (calls === 5) throw new Error('HTTP 503')
      return { answers: Object.fromEntries(JEV_CHECK_KEYS.map((k) => [k, { type: 'noul' as const, p: 0.9 }])) }
    }
    const items = file('de').items.slice(0, 6)
    const res = await runCalibration(items, send, { repeats: 4 })
    expect(calls).toBe(24)
    expect(peak).toBeLessThanOrEqual(3)
    expect(res.flatMap((r) => r.runs).filter((x) => x === null)).toHaveLength(1)
    expect(checksOf({ answers: { asked: { type: 'noul', p: 0.4 } } })).toBeNull()
    expect(endpointTags({ data: { endpoints: [{ tag: 'typesafe' }, { tag: 7 }] } })).toEqual(['typesafe'])
  })
})

test.describe('the script refuses before anything is loaded or sent', () => {
  const run = (argv: string[], env: Record<string, string | undefined>) => spawnSync(process.execPath, [SCRIPT, ...argv], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', timeout: 20_000 })
  test('without --real, without a key, in CI → exit 2 and "nothing was sent" (control: the message names what is missing)', () => {
    const noReal = run([], { OPENROUTER_API_KEY: 'sk-or-v1-e2e-calibration-0000000000000000000000000000' })
    expect(noReal.status).toBe(2)
    expect(noReal.stderr).toMatch(/add --real .* nothing was sent/)
    const noKey = run(['--real'], {})
    expect(noKey.status).toBe(2)
    expect(noKey.stderr).toMatch(/OPENROUTER_API_KEY .* nothing was sent/)
    const ci = run(['--real'], { CI: '1', OPENROUTER_API_KEY: 'sk-or-v1-e2e-calibration-0000000000000000000000000000' })
    expect(ci.status).toBe(2)
    expect(ci.stderr).toMatch(/never runs in CI/)
  })

  test('--check loads the app’s own code (Vite) and builds every state — nothing sent, also in CI', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--check'], { env: { PATH: process.env.PATH, CI: '1' }, encoding: 'utf8', timeout: 90_000, cwd: fileURLToPath(new URL('../..', import.meta.url)) })
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toMatch(/(\d+) of \1 states built — nothing was sent/)
  })
})
