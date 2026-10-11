/**
 * Flight recorder — the eject (R3). The planner on the story's run 212 (tests/e2e/fixtures/recorder-story.json):
 * what goes back, what is held and why, new rows to the trash, the option the run removed coming back — read through
 * the seam (`__oneRecorder.planEject`, counts and outcomes only). Test data is fictional (Nordlicht, Tessera).
 */
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { test, expect, openApp, flush, wsEval } from './fixtures'
import { playStory, rec, startRecorder, storyTime, type Story } from './helpers/recorder'

const story = JSON.parse(readFileSync(new URL('./fixtures/recorder-story.json', import.meta.url), 'utf8')) as Story
const AGENT = `agent:${story.agent.id}`
const RUN = story.expect.run212.key

async function bootStory(page: Page): Promise<Record<string, string>> {
  await page.clock.install({ time: storyTime(story, story.setupAt) })
  await openApp(page)
  await startRecorder(page)
  await flush(page)
  await rec(page, 'wipe')
  return playStory(page, story)
}

const window212 = () => ({ lane: AGENT, run: RUN, a: storyTime(story, story.bracket[0]), b: storyTime(story, story.bracket[1]) })

interface PlannedPlace {
  p: string
  pk: string
  outcome: string
  reason: string | null
  back: string[]
  held: Array<{ part: string; reason: string }>
}

test.describe('flight recorder — the eject', () => {
  test('planEject (seam): run 212 → 35 / 37 back, NL-1408 + NL-1415 held, NL-1432–1434 to the trash, "Ready" comes back', async ({ page }) => {
    test.setTimeout(120_000)
    const ids = await bootStory(page)
    const r = await rec<{ counts: Record<string, number>; places: PlannedPlace[]; heldBy: unknown[] }>(page, 'planEject', window212())
    const e = story.expect.eject
    expect(r.counts).toMatchObject({ all: e.all, back: e.back, held: e.held.length, partial: 0, already: 0 })
    // rows the run created have their ids from the store (by title)
    const titled = await wsEval(page, (s, titles) => Object.fromEntries(titles.map((t) => [t, Object.values(s.pages).find((x) => x.title === t)?.id ?? ''])), e.trash)
    const by = (ref: string) => r.places.find((x) => x.p === `p:${ids[ref] ?? titled[ref]}`)!
    for (const ref of e.held) expect(by(ref), ref).toMatchObject({ outcome: 'held', reason: 'changed' })
    for (const ref of e.trash) expect(by(ref)?.outcome, ref).toBe('trash')
    expect(r.heldBy).toEqual(['you'])
    // the schema: the removed option back (with its order)
    const schema = r.places.find((x) => x.pk === 'schema')!
    expect(schema.outcome).toBe('back')
    expect(schema.back).toContain(`o:${e.optionBack.prop}/${e.optionBack.id}`)
    // the report page: its title and the appended paragraphs go, block by block
    const report = r.places.find((x) => x.pk === 'page')!
    expect(report).toMatchObject({ outcome: 'back' })
    expect(report.back).toEqual(expect.arrayContaining(['t', 'c']))
    // planning wrote nothing a writer frame did not name
    expect(await rec(page, 'unknowns')).toEqual([])
  })

  test('the plan of 37 places < 300 ms (performance mark; the story at real time: a page clock hides marks)', async ({ page }) => {
    test.setTimeout(150_000)
    const realTime = new Proxy(page, { get: (p, k) => (k === 'clock' ? { setFixedTime: async () => undefined } : typeof (p as never)[k] === 'function' ? ((p as never)[k] as (...a: unknown[]) => unknown).bind(p) : (p as never)[k]) })
    await openApp(page)
    await startRecorder(page)
    await flush(page)
    await rec(page, 'wipe')
    await playStory(realTime, story)
    const now = await page.evaluate(() => Date.now())
    const sel = { lane: AGENT, run: RUN, a: now - 3600_000, b: now + 60_000 }
    // twice: the first read warms the digest key and the pin store
    for (let i = 0; i < 2; i++) expect((await rec<{ counts: { all: number } }>(page, 'planEject', sel)).counts.all).toBe(story.expect.eject.all)
    const ms = await page.evaluate(() => performance.getEntriesByName('rec-plan').map((e) => e.duration))
    expect(ms.length).toBe(2)
    expect(Math.min(...ms)).toBeLessThan(300)
  })
})
