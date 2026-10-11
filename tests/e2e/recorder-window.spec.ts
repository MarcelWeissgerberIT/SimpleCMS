/**
 * Flight recorder — reading a window (R2): the story's run 212 read through the plate (meters, held note, held
 * diamonds), the read dialog (groups, picked place, value diff and word diff in ink, foreign changes marked), the keys
 * (↵ on the tape, a focused flag, a tick's popover), partial windows and their extend key, a lost tail, the incident
 * report (titles, counts, schema names — never values or text), and the guarantee that reading writes nothing. Test
 * data is fictional (Nordlicht, Tessera, the story: tests/e2e/fixtures/recorder-story.json).
 */
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { test, expect, openApp, flush } from './fixtures'
import { playStory, rec, startRecorder, storyTime, type Story } from './helpers/recorder'

const story = JSON.parse(readFileSync(new URL('./fixtures/recorder-story.json', import.meta.url), 'utf8')) as Story
const AGENT = `agent:${story.agent.id}`
const RUN = story.expect.run212.key

/** The app at the story's morning, the tape holding only the story. */
async function bootStory(page: Page): Promise<Record<string, string>> {
  await page.clock.install({ time: storyTime(story, story.setupAt) })
  await openApp(page)
  await startRecorder(page)
  await flush(page)
  await rec(page, 'wipe')
  return playStory(page, story)
}

const window212 = () => ({ lane: AGENT, run: RUN, a: storyTime(story, story.bracket[0]), b: storyTime(story, story.bracket[1]) })

test.describe('flight recorder — reading a window', () => {
  test('readWindow (seam): run 212 = 52 · 37 · +212 −40 · 35 (3 new) · 1 · 1; NL-1408 and NL-1415 held (you, 07:44 / 07:57)', async ({ page }) => {
    test.setTimeout(120_000)
    const ids = await bootStory(page)
    const r = await rec(page, 'readWindow', window212())
    expect(r.meters).toEqual({ ops: 52, places: { all: 37, rows: 35, newRows: 3, pages: 1, schema: 1, views: 0 }, words: [212, 40] })
    expect(r.held.map((h: { p: string }) => h.p).sort()).toEqual([`p:${ids['NL-1408']}`, `p:${ids['NL-1415']}`].sort())
    const by = Object.fromEntries(r.held.map((h: { p: string; by: unknown; at: number }) => [h.p, { by: h.by, at: h.at }]))
    expect(by[`p:${ids['NL-1408']}`]).toEqual({ by: [{ lane: 'you', at: storyTime(story, '07:44:12') }], at: storyTime(story, '07:44:12') })
    expect(by[`p:${ids['NL-1415']}`]).toEqual({ by: [{ lane: 'you', at: storyTime(story, '07:57:30') }], at: storyTime(story, '07:57:30') })
    expect(r.marks.map((m: { label: string }) => m.label).sort()).toEqual(['NL-1408', 'NL-1415'])
    expect(r.outcomes).toEqual({ back: 32, trash: 3, held: 2 })
    expect(r.groups).toEqual([
      { kind: 'schema', n: 1 },
      { kind: 'pages', n: 1 },
      { kind: 'rows', n: 32 },
      { kind: 'newRows', n: 3 },
    ])
    expect(r.partial).toEqual([])
    expect(r.incomplete).toBe(false)
    expect(await rec(page, 'unknowns')).toEqual([])
  })
})
