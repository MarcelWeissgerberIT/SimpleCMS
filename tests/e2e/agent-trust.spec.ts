/**
 * Per-field trust S1 (features/agents/trust): the run review's keys and what they write into this device's verdict
 * book — (a) the keys (caps on the focused proposal only, J / K, ↵ / A, 1 / F, 2–4, D / Del / ⌫, Enter on a key is its
 * own click) · (b) letters without a meaning · (c) bulk keys write nothing · (d) an Undo takes its verdict back ·
 * (e) "edited" only by the person and only within 10 minutes · (f) keys are inert where the buttons are · (g) focus
 * after a decision · (h) the aside plate · (i) touch · (j) the book: reload, other tabs, the local reset, orphans ·
 * (k) 390 / 1440, Paper / Carbon, XL · (l) no console errors (fixtures), no write without a writer · review follow-ups:
 * an Undo that keeps an edited field takes back the verdicts of the fields it put back; a cut body counts only once shown
 * whole; the Outbox's row patch and a button are not the person's edit; a bulk discard keeps no row Undo; rows name and
 * describe themselves, the live region stays put, the quiet row reads in words; the orange Apply keeps its focus ring;
 * the plate sticks only while it fits; clipped plate names get a title.
 * The story is fictional (tests/e2e/helpers/trustStory.mjs); nothing leaves the machine.
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval, waitForApp } from './fixtures'
import { keyOf, seedTrust, seedTrustBook, seedTrustRun, TRUST_STORY, type TrustMirror } from './helpers/trustStory.mjs'

type AnyRec = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const AGENT = TRUST_STORY.agentId
const RUN = TRUST_STORY.runId
const DAY = 86_400_000

const runEl = (page: Page, id = RUN) => page.locator('li.agx-run').filter({ has: page.locator(`[aria-controls="agx-run-${id}"]`) })
const review = (page: Page, id = RUN) => runEl(page, id).locator('.agx-review')
const row = (page: Page, n: number, id = RUN) => review(page, id).locator(`li.agent-change[data-n="${n}"]`)
const liveText = (page: Page, id = RUN) => review(page, id).locator('p[aria-live="polite"]')
const heading = (page: Page, id = RUN) => review(page, id).locator('.agx-review__title')
const plate = (page: Page) => page.getByTestId('agt-plate')

/** This device's book of the story's agent (IndexedDB, read again). */
const bookOf = (page: Page, id = AGENT): Promise<AnyRec> => page.evaluate((id) => (window as any).__oneAgentTrust.book(id), id) // eslint-disable-line @typescript-eslint/no-explicit-any
const verdictsOf = async (page: Page, key?: string): Promise<AnyRec[]> => {
  const b = await bookOf(page)
  return key ? (b.entries[key] ?? []) : Object.values(b.entries as Record<string, AnyRec[]>).flat()
}
const kinds = async (page: Page, key: string) => (await verdictsOf(page, key)).map((v) => (v.reason ? `${v.v}:${v.reason}` : v.single ? `${v.v}:single` : v.v))
const segsOf = async (page: Page, key: string): Promise<string[]> =>
  page.evaluate(async ({ id, key }) => {
    const t = (window as any).__oneAgentTrust // eslint-disable-line @typescript-eslint/no-explicit-any
    const b = await t.book(id)
    return t.rules.readiness(b.entries[key] ?? [], b.head.lastRevoke[key], Date.now()).segs
  }, { id: AGENT, key })
/** A staged change as stored (the run read again). */
const stored = (page: Page, change: string, run = RUN): Promise<AnyRec | null> =>
  page.evaluate(async ({ a, r, c }) => ((await (window as any).__oneAgents.loadRuns(a)) as AnyRec[]).find((x) => x.id === r)?.staged?.find((x: AnyRec) => x.id === c) ?? null, { a: AGENT, r: run, c: change }) // eslint-disable-line @typescript-eslint/no-explicit-any
const statusOf = async (page: Page, change: string, run = RUN) => (await stored(page, change, run))?.status ?? null
const unknowns = (page: Page) => page.evaluate(() => (window as any).__oneRecorder?.unknowns() ?? []) // eslint-disable-line @typescript-eslint/no-explicit-any
const flushWatch = (page: Page) => page.evaluate(() => (window as any).__oneAgentTrust.flushWatch()) // eslint-disable-line @typescript-eslint/no-explicit-any

/** The story's morning on the agent's own page: a run waiting with c1–c7 open; the book empty unless asked. */
async function morning(page: Page, opts: { lang?: 'de' | 'en'; book?: boolean } = {}): Promise<TrustMirror> {
  await page.addInitScript(() => localStorage.setItem('one.tour', '{"off":true}'))
  await page.context().route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort())
  await openApp(page)
  const { m } = await seedTrust(page, { lang: opts.lang ?? 'de', book: opts.book ?? false })
  await expect(row(page, 1)).toBeVisible()
  await expect(plate(page)).toBeVisible()
  return m
}

/** Leave the agent's page and come back (runs seeded meanwhile are read again). */
async function revisit(page: Page) {
  await page.evaluate(() => (window.location.hash = '#/agents'))
  await expect(page.locator('.agx-dhead')).toHaveCount(0)
  await page.evaluate((id) => (window.location.hash = `#/agents/${id}`), AGENT)
  await expect(page.locator('.agx-dhead')).toBeVisible()
}

test.describe('per-field trust — the run review (S1)', () => {
  test('(a) keys: caps only on the focused proposal; J N ↓ K ↑ move; ↵ / A apply, 1 / F wrong, 2–4 reasons without a segment, D / Entf / ⌫ reasonless; Enter on Verwerfen discards', async ({ page }) => {
    const m = await morning(page)
    const clarity = keyOf(m, 'clarity')
    const why = keyOf(m, 'why')
    // no row holds the focus: no caps, no reasons row, no orange key
    await expect(review(page).locator('.agt-cap:visible')).toHaveCount(0)
    await expect(review(page).locator('[data-testid="agt-reasons"]:visible')).toHaveCount(0)
    await row(page, 1).focus()
    await expect(row(page, 1).locator('.agt-cap:visible')).toHaveCount(2)
    await expect(row(page, 1).getByTestId('agt-reasons')).toBeVisible()
    await expect(row(page, 1).getByTestId('agt-reasons')).toContainText('Verwerfen mit Grund')
    await expect(row(page, 1).getByRole('button', { name: 'Falsch #1' })).toHaveAttribute('aria-keyshortcuts', '1 F')
    await expect(row(page, 2).locator('.agt-cap:visible')).toHaveCount(0)
    const bg = (n: number) => row(page, n).locator('.agt-apply').evaluate((el) => getComputedStyle(el).backgroundColor)
    const signal = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--signal').trim())
    expect(await bg(1)).not.toBe(await bg(2))
    expect(signal).not.toBe('')
    // the head: open by field and the J K hint
    await expect(review(page).getByTestId('agx-review-fields')).toHaveText('Klarheit 4 · Warum 3')
    await expect(review(page).getByTestId('agx-review-counts')).toContainText('7×')
    await expect(row(page, 1)).toHaveAttribute('aria-keyshortcuts', /Enter A Delete D 1 F 2 3 4 J K/)

    // J / N / ↓ forward, K / ↑ back
    for (const [key, n] of [['j', 2], ['n', 3], ['ArrowDown', 4], ['k', 3], ['ArrowUp', 2]] as const) {
      await page.keyboard.press(key)
      await expect(row(page, n)).toBeFocused()
    }
    // ↵ on the row and A apply: one accept per field, focus on the next open proposal
    await page.keyboard.press('Enter')
    await expect.poll(() => statusOf(page, 'c2')).toBe('applied')
    await expect(row(page, 3)).toBeFocused()
    await expect(liveText(page)).toHaveText('Übernommen · #2')
    await page.keyboard.press('a')
    await expect.poll(() => statusOf(page, 'c3')).toBe('applied')
    await expect.poll(() => kinds(page, clarity)).toEqual(['accept', 'accept'])
    expect((await verdictsOf(page, clarity)).map((v) => v.change)).toEqual(['c2', 'c3'])
    // 1 → wrong (the row keeps its Undo, one line); F (German) → wrong
    await expect(row(page, 4)).toBeFocused()
    await page.keyboard.press('1')
    await expect.poll(() => statusOf(page, 'c4')).toBe('discarded')
    expect((await stored(page, 'c4'))?.reason).toBe('wrong')
    await expect(row(page, 4).getByTestId('agx-discarded')).toHaveText('Verworfen · falsch')
    await expect(row(page, 4).getByRole('button', { name: 'Rückgängig #4' })).toBeVisible()
    await expect(row(page, 4).locator('[data-part]')).toHaveCount(0)
    await expect(liveText(page)).toHaveText('Verworfen · falsch · #4')
    await expect(row(page, 5)).toBeFocused()
    await page.keyboard.press('f')
    await expect.poll(() => kinds(page, why)).toEqual(['discard:wrong'])
    // 2 / 3 / 4: a reason, no segment, the run unchanged
    const whySegs = await segsOf(page, why)
    await expect(row(page, 6)).toBeFocused()
    await page.keyboard.press('2')
    await expect(row(page, 7)).toBeFocused()
    await page.keyboard.press('3')
    await expect.poll(() => kinds(page, why)).toEqual(['discard:wrong', 'discard:notNow', 'discard:duplicate'])
    expect(await segsOf(page, why)).toEqual(whySegs)
    const claritySegs = await segsOf(page, clarity)
    // wrapped to the first open one
    await expect(row(page, 1)).toBeFocused()
    await page.keyboard.press('4')
    await expect.poll(() => kinds(page, clarity)).toEqual(['accept', 'accept', 'discard:wrong', 'discard:done'])
    expect(await segsOf(page, clarity)).toEqual(claritySegs)
    // none open: the heading
    await expect(heading(page)).toBeFocused()

    // D / Entf / ⌫: reasonless (single); Z takes each back
    await row(page, 7).focus()
    await page.keyboard.press('z')
    await expect.poll(() => statusOf(page, 'c7')).toBe('pending')
    await expect(row(page, 7)).toBeFocused()
    await expect.poll(() => kinds(page, why)).toEqual(['discard:wrong', 'discard:notNow'])
    for (const key of ['d', 'Delete', 'Backspace']) {
      // the row shows what is stored before the next key (a key acts on what the row shows)
      await expect(row(page, 7)).toHaveAttribute('data-status', 'pending')
      await page.keyboard.press(key)
      await expect.poll(() => statusOf(page, 'c7')).toBe('discarded')
      await expect.poll(() => kinds(page, why)).toEqual(['discard:wrong', 'discard:notNow', 'discard:single'])
      expect((await stored(page, 'c7'))?.reason).toBeUndefined()
      await expect(row(page, 7)).toHaveAttribute('data-status', 'discarded')
      // focus moved on by itself (none open: the heading) before the row is focused again
      await expect(heading(page)).toBeFocused()
      await row(page, 7).focus()
      await page.keyboard.press('z')
      await expect.poll(() => statusOf(page, 'c7')).toBe('pending')
      await expect.poll(() => kinds(page, why)).toEqual(['discard:wrong', 'discard:notNow'])
    }
    await expect(row(page, 7)).toHaveAttribute('data-status', 'pending')
    // Enter on the Verwerfen key is that key's own click: a discard, never an apply
    await row(page, 7).getByRole('button', { name: 'Verwerfen #7' }).focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => statusOf(page, 'c7')).toBe('discarded')
    await expect.poll(() => kinds(page, why)).toEqual(['discard:wrong', 'discard:notNow', 'discard:single'])
    // (l) every write had its writer
    expect(await unknowns(page)).toEqual([])
  })

  test('(b) English: H and E on a focused proposal change nothing; F means nothing in English; W discards as wrong', async ({ page }) => {
    const m = await morning(page, { lang: 'en' })
    await expect(row(page, 1).getByRole('button', { name: 'Apply #1' })).toBeVisible()
    await row(page, 1).focus()
    await expect(row(page, 1).getByRole('button', { name: 'Wrong #1' })).toHaveAttribute('aria-keyshortcuts', '1 W')
    for (const key of ['h', 'e', 'f']) await page.keyboard.press(key)
    await page.waitForTimeout(400)
    expect(await statusOf(page, 'c1')).toBe('pending')
    expect(await verdictsOf(page)).toEqual([])
    await expect(row(page, 1)).toBeFocused()
    await page.keyboard.press('w')
    await expect.poll(() => kinds(page, keyOf(m, 'clarity'))).toEqual(['discard:wrong'])
    await expect(row(page, 1).getByTestId('agx-discarded')).toHaveText('Discarded · wrong')
  })

  test('(c) bulk keys write nothing: one row applied → 1 verdict; Alle übernehmen, then Alle verwerfen of a newer run → still 1', async ({ page }) => {
    const m = await morning(page)
    await row(page, 1).focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => verdictsOf(page)).toHaveLength(1)
    await review(page).getByRole('button', { name: 'Alle übernehmen' }).click()
    await expect.poll(() => statusOf(page, 'c7')).toBe('applied')
    await seedTrustRun(page, m, { id: 'r-trust-2', startedAt: Date.now() - 60_000 })
    await revisit(page)
    await expect(row(page, 1, 'r-trust-2')).toBeVisible()
    await review(page, 'r-trust-2').getByRole('button', { name: 'Alle verwerfen' }).click()
    await expect.poll(() => statusOf(page, 'c1', 'r-trust-2')).toBe('discarded')
    await page.waitForTimeout(300)
    expect(await verdictsOf(page)).toHaveLength(1)
  })

  test('(d) an Undo takes its verdict back: Z and the row’s Rückgängig on an applied row; F → “Verworfen · falsch · Rückgängig” → Z: open again, no verdict, no reason', async ({ page }) => {
    const m = await morning(page)
    const clarity = keyOf(m, 'clarity')
    await row(page, 2).focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => kinds(page, clarity)).toEqual(['accept'])
    await expect(row(page, 3)).toBeFocused()
    await row(page, 2).focus()
    await expect(row(page, 2).locator('.agent-change__undo .agt-cap')).toBeVisible()
    await page.keyboard.press('z')
    await expect.poll(() => statusOf(page, 'c2')).toBe('pending')
    await expect.poll(() => verdictsOf(page)).toEqual([])
    await expect(row(page, 2)).toBeFocused()
    await expect(liveText(page)).toHaveText('Rückgängig · #2')
    // the row's own key
    await row(page, 2).getByRole('button', { name: 'Übernehmen #2' }).click()
    await expect.poll(() => kinds(page, clarity)).toEqual(['accept'])
    await row(page, 2).getByRole('button', { name: 'Rückgängig #2' }).click()
    await expect.poll(() => statusOf(page, 'c2')).toBe('pending')
    await expect.poll(() => verdictsOf(page)).toEqual([])
    // a discard with a reason, undone in its row
    await row(page, 3).focus()
    await page.keyboard.press('f')
    await expect(row(page, 3).getByTestId('agx-discarded')).toHaveText('Verworfen · falsch')
    await expect.poll(() => kinds(page, clarity)).toEqual(['discard:wrong'])
    await expect(row(page, 4)).toBeFocused()
    await row(page, 3).focus()
    await page.keyboard.press('z')
    await expect.poll(() => statusOf(page, 'c3')).toBe('pending')
    await expect.poll(() => verdictsOf(page)).toEqual([])
    expect((await stored(page, 'c3'))?.reason).toBeUndefined()
    expect(await unknowns(page)).toEqual([])
  })

  test('(e) edited: only the person’s own change within 10 minutes — an automation’s write keeps the accept, the person’s turns it to edited, after 10 minutes it stays', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-13T07:52:00+02:00') })
    const m = await morning(page)
    const clarity = keyOf(m, 'clarity')
    const why = keyOf(m, 'why')
    const keys = Object.keys(m.rows)
    const rowA = m.rows[keys[8]]
    const rowB = m.rows[keys[12]]
    await row(page, 1).focus()
    await page.keyboard.press('Enter')
    await expect(row(page, 2)).toBeFocused()
    await row(page, 5).focus()
    await page.keyboard.press('a')
    await expect.poll(() => kinds(page, clarity)).toEqual(['accept'])
    await expect.poll(() => kinds(page, why)).toEqual(['accept'])
    // an automation changes A: not the person
    await page.evaluate(
      (a) => (window as any).__oneRecorder.step({ writer: { kind: 'automation', db: a.db, id: 'auto-nl', run: 'a1' }, calls: [['setRowProperty', a.row, a.prop, a.opt]] }), // eslint-disable-line @typescript-eslint/no-explicit-any
      { db: m.dbId, row: rowA, prop: m.props.clarity, opt: m.options['Blockiert'] },
    )
    expect(await flushWatch(page)).toBe(2)
    expect(await kinds(page, clarity)).toEqual(['accept'])
    // the person rewords B (the test hook writes as the person)
    await wsEval(page, (s, a) => s.setRowProperty(a.row, a.prop, 'Anders gesagt: alles freigegeben.'), { row: rowB, prop: m.props.why })
    expect(await flushWatch(page)).toBe(1)
    expect(await kinds(page, why)).toEqual(['edited'])
    // ten minutes later the person's change of A is just a change
    await page.clock.fastForward('10:30')
    expect(await flushWatch(page)).toBe(0)
    await wsEval(page, (s, a) => s.setRowProperty(a.row, a.prop, a.opt), { row: rowA, prop: m.props.clarity, opt: m.options['Woanders in Arbeit'] })
    await flushWatch(page)
    expect(await kinds(page, clarity)).toEqual(['accept'])
    expect(await unknowns(page)).toEqual([])
  })

  test('(f) keys act only where the buttons would: read only, a run still going, “needs #1” — inert, said why, nothing written', async ({ page }) => {
    const m = await morning(page)
    // read only (the cloud's flag)
    await page.evaluate(() => (window as any).__one.cloud.useCloud.setState({ readOnly: true })) // eslint-disable-line @typescript-eslint/no-explicit-any
    await expect(row(page, 1).getByRole('button', { name: 'Übernehmen #1' })).toBeDisabled()
    await row(page, 1).focus()
    for (const key of ['a', 'Enter', 'd', '1']) {
      await page.keyboard.press(key)
      await expect(liveText(page)).toHaveText('Nur lesen')
    }
    await page.waitForTimeout(300)
    expect(await statusOf(page, 'c1')).toBe('pending')
    expect(await verdictsOf(page)).toEqual([])
    await page.evaluate(() => (window as any).__one.cloud.useCloud.setState({ readOnly: false })) // eslint-disable-line @typescript-eslint/no-explicit-any

    // a run still going
    await seedTrustRun(page, m, { id: 'r-going', status: 'running', startedAt: Date.now() - 30_000 })
    await revisit(page)
    await expect(row(page, 1, 'r-going')).toBeVisible()
    await row(page, 1, 'r-going').focus()
    for (const key of ['a', 'Enter', 'd', '1']) {
      await page.keyboard.press(key)
      await expect(liveText(page, 'r-going')).toHaveText('Der Lauf läuft noch')
    }
    expect(await statusOf(page, 'c1', 'r-going')).toBe('pending')

    // a proposal that needs another one first: A / ↵ inert
    await page.evaluate(
      (a) =>
        (window as any).__onePreflight.seedRuns([ // eslint-disable-line @typescript-eslint/no-explicit-any
          {
            id: 'r-needs',
            agentId: a.agent,
            runner: 'browser',
            trigger: { type: 'manual' },
            startedAt: Date.now() - 10_000,
            endedAt: Date.now() - 5_000,
            status: 'staged',
            summary: '',
            steps: [],
            staged: [
              { id: 'n1', n: 1, kind: 'create_row', status: 'pending', pageId: 'staged-row-1', databaseId: a.db, title: 'NL-240' },
              { id: 'n2', n: 2, kind: 'update_row', status: 'pending', pageId: 'staged-row-1', databaseId: a.db, dependsOn: 'n1', title: 'NL-240', props: [{ propId: a.why, name: 'Warum', type: 'text', before: '', after: 'Neu angelegt.', intent: { kind: 'value', value: 'Neu angelegt.' } }] },
            ],
          },
        ]),
      { agent: AGENT, db: m.dbId, why: m.props.why },
    )
    await revisit(page)
    await expect(row(page, 2, 'r-needs')).toBeVisible()
    await row(page, 2, 'r-needs').focus()
    for (const key of ['a', 'Enter']) {
      await page.keyboard.press(key)
      await expect(liveText(page, 'r-needs')).toHaveText('Braucht erst #1')
    }
    await page.waitForTimeout(300)
    expect(await statusOf(page, 'n2', 'r-needs')).toBe('pending')
    expect(await verdictsOf(page)).toEqual([])
  })

  test('(g) focus: after ↵ the next open proposal’s row (wrapping), the heading after the last; after Z that row', async ({ page }) => {
    await morning(page)
    await row(page, 6).focus()
    const order = [7, 1, 2, 3, 4, 5]
    for (const n of order) {
      await page.keyboard.press('Enter')
      await expect(row(page, n)).toBeFocused()
    }
    await page.keyboard.press('Enter')
    await expect(heading(page)).toBeFocused()
    await row(page, 3).focus()
    await page.keyboard.press('z')
    await expect.poll(() => statusOf(page, 'c3')).toBe('pending')
    await expect(row(page, 3)).toBeFocused()
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false)
  })
})

test.describe('per-field trust — the aside plate (S1)', () => {
  test('(h) meters with their labels and counts, the notes, every lamp PRÜFUNG, ≤ 4 databases then “+1 Datenbank”, ≤ 12 rows then “+ n weitere”, NIE DIREKT names the hand-only and key properties', async ({ page }) => {
    const m = await morning(page, { book: true })
    // four more databases the agent worked on yesterday: the mirror (newest) and 3 of them make the plate
    await page.evaluate(
      async (a) => {
        const w = window as any // eslint-disable-line @typescript-eslint/no-explicit-any
        const s = w.__one.workspace.getState()
        const staged = []
        for (const [i, name] of ['Tessera Werk', 'Lieferliste', 'Prüfplan', 'Messreihe'].entries()) {
          const db = s.createDatabase({ title: name })
          const prop = s.addProperty(db, { type: 'text', name: `Notiz ${i + 1}` })
          const rowId = s.createRow(db, { title: `${name} 1` })
          staged.push({ id: `d${i + 1}`, n: i + 1, kind: 'update_row', status: 'pending', pageId: rowId, databaseId: db, title: name, props: [{ propId: prop, name: `Notiz ${i + 1}`, type: 'text', before: '', after: 'x', intent: { kind: 'value', value: 'x' } }] })
        }
        await w.__onePreflight.seedRuns([{ id: 'r-dbs', agentId: a.agent, runner: 'browser', trigger: { type: 'manual' }, startedAt: Date.now() - a.day, endedAt: Date.now() - a.day + 60_000, status: 'staged', summary: '', steps: [], staged }])
      },
      { agent: AGENT, day: DAY },
    )
    await revisit(page)
    const r = (role: string) => plate(page).locator(`[data-key="${keyOf(m, role)}"]`)
    await expect(r('clarity').getByRole('img')).toHaveAttribute('aria-label', 'Letzte 20 Urteile: 13 übernommen, 3 bearbeitet, 4 falsch')
    await expect(r('clarity').locator('.agt-row__cnt')).toHaveText('13/20')
    await expect(r('clarity').locator('.agt-row__note')).toHaveText('4 × falsch · 3 × bearbeitet')
    await expect(r('clarity').locator('.m-w')).toHaveCount(4)
    await expect(r('clarity').locator('.m-e')).toHaveCount(3)
    await expect(r('newComment').locator('.agt-row__cnt')).toHaveText('20/20')
    await expect(r('newComment').locator('.agt-row__note')).toHaveText('20 in Folge · der Schalter kippt nie von selbst')
    await expect(r('newComment')).toHaveAttribute('data-lamp', 'ready')
    await expect(r('newComment').locator('.agt-lamp')).toHaveText('Prüfung')
    await expect(r('comments').getByRole('img')).toHaveAttribute('aria-label', 'Letzte 20 Urteile: 14 übernommen, 1 bearbeitet, 5 noch ohne Urteil')
    await expect(r('comments').locator('.m-x')).toHaveCount(5)
    await expect(r('comments').locator('.agt-row__note')).toHaveText('3 × ohne Grund verworfen — mit 1 (oder F) sagst du, dass es falsch war')
    await expect(r('why').locator('.agt-row__note')).toHaveText('Oft von dir umformuliert')
    await expect(r('due').locator('.agt-row__note')).toHaveText('2 Urteile · zu selten')
    // every lamp reads PRÜFUNG in S1 (nothing can be granted yet)
    expect(new Set(await plate(page).locator('.agt-lamp').allTextContents())).toEqual(new Set(['Prüfung']))
    // DIREKT → FREIGEBBAR → most green first
    const first = await plate(page).locator('.agt-row').first().getAttribute('data-key')
    expect([keyOf(m, 'newComment'), keyOf(m, 'srcStatus')]).toContain(first)
    // ≤ 12 rows, then "+ 2 weitere"; 4 of the 5 databases, "+1 Datenbank"
    await expect(plate(page).locator('.agt-row')).toHaveCount(12)
    const more = plate(page).getByRole('button', { name: /^\+ \d+ weitere$/ })
    await expect(more).toHaveAttribute('aria-expanded', 'false')
    const hidden = Number(/\d+/.exec((await more.textContent()) ?? '')?.[0])
    expect(hidden).toBeGreaterThan(1)
    await more.click()
    await expect(plate(page).locator('.agt-row')).toHaveCount(12 + hidden)
    await expect(plate(page).getByRole('button', { name: 'Weniger' })).toHaveAttribute('aria-expanded', 'true')
    await expect(plate(page).locator('.agt-group__title')).toHaveText(['Nordlicht Übergabe', 'Tessera Werk', 'Lieferliste', 'Prüfplan'])
    await expect(plate(page)).toContainText('+1 Datenbank')
    // never direct: only by hand (the profile says so) and the key
    await expect(plate(page).getByTestId('agt-never')).toContainText('Mein Status: nur von Hand, so steht es im Integrationsprofil · Schlüssel: Schlüssel')
    await expect(plate(page).getByTestId('agt-always')).toContainText('Seitentext, neue Seiten')
    await expect(plate(page).locator('.agt-legend li')).toHaveCount(6)
    await expect(plate(page)).toContainText('Freigebbar nach 20 unveränderten Übernahmen in Folge')
  })

  test('the plate without a verdict on this device says how verdicts come', async ({ page }) => {
    await morning(page)
    await expect(plate(page).getByTestId('agt-plate-empty')).toHaveText('Noch keine Urteile auf diesem Gerät — sie entstehen, wenn du Vorschläge einzeln übernimmst oder verwirfst.')
    await row(page, 1).focus()
    await page.keyboard.press('Enter')
    await expect(plate(page).getByTestId('agt-plate-empty')).toHaveCount(0)
    await expect(plate(page).locator('.agt-row').first()).toBeVisible()
  })
})

test.describe('per-field trust — touch (S1)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('(i) “Verwerfen ▾” opens four 44 px reasons and “Ohne Grund”; no key caps, no reasons row', async ({ page }) => {
    const m = await morning(page)
    await expect(review(page).locator('.agt-cap')).toHaveCount(0)
    await expect(review(page).getByTestId('agt-reasons')).toHaveCount(0)
    await expect(review(page).locator('.agx-review__hint')).toHaveCount(0)
    const open = row(page, 1).getByRole('button', { name: '#1 verwerfen …' })
    await expect(open).toHaveAttribute('aria-expanded', 'false')
    // the reader touches the column first: until then the page undoes scrolls nobody asked for (useColumnScroll)
    await page.locator('.agx-title').tap()
    await open.tap()
    await expect(open).toHaveAttribute('aria-expanded', 'true')
    const group = row(page, 1).getByTestId('agt-touch')
    await expect(group).toBeVisible()
    await expect(group).toContainText('Verwerfen, weil …')
    await expect(group).toContainText('Nur „Falsch“ zählt gegen ihn.')
    const keys = group.locator('.agt-touch__key')
    await expect(keys).toHaveText(['Falsch', 'Nicht jetzt', 'Doppelt', 'Schon erledigt'])
    for (const box of await keys.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) expect(box).toBeGreaterThanOrEqual(44)
    expect((await group.getByRole('button', { name: 'Ohne Grund' }).boundingBox())!.height).toBeGreaterThanOrEqual(44)
    // a tap that just opened something: wait before tapping into it
    await page.waitForTimeout(500)
    await group.getByRole('button', { name: 'Falsch #1' }).tap()
    await expect.poll(() => kinds(page, keyOf(m, 'clarity'))).toEqual(['discard:wrong'])
    await expect(row(page, 1).getByTestId('agx-discarded')).toHaveText('Verworfen · falsch')
    // the only way back from a reason tapped by mistake is 44 px tall too
    const undoKey = row(page, 1).getByRole('button', { name: 'Rückgängig #1' })
    await expect(undoKey).toBeVisible()
    expect((await undoKey.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    // nothing wider than the phone
    expect(await page.evaluate(() => (document.querySelector('#main') as HTMLElement).scrollWidth - (document.querySelector('#main') as HTMLElement).clientWidth)).toBeLessThanOrEqual(0)
  })
})

test.describe('per-field trust — the book (S1)', () => {
  test('(j) a reload keeps it; another tab sees a verdict; orphans: an old one goes at the next start, a young one stays; the local reset removes every trust key', async ({ page, context, errors }) => {
    const m = await morning(page)
    // another tab on the same agent page
    const other = await context.newPage()
    errors.watch(other)
    await other.goto(`app/?e2e#/agents/${AGENT}`)
    await waitForApp(other)
    await expect(other.getByTestId('agt-plate-empty')).toBeVisible()
    await row(page, 1).focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => kinds(page, keyOf(m, 'clarity'))).toEqual(['accept'])
    await expect(other.getByTestId('agt-plate-empty')).toHaveCount(0)
    await expect(other.getByTestId('agt-plate').locator(`[data-key="${keyOf(m, 'clarity')}"] .agt-row__cnt`)).toHaveText('1/20')
    await other.close()

    // orphans of this scope: one untouched for 40 days, one written yesterday (their agents are gone)
    await page.evaluate(async (day) => {
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open('one-agents')
        r.onsuccess = () => res(r.result)
        r.onerror = () => rej(r.error)
      })
      const tx = db.transaction('runs', 'readwrite')
      const head = (at: number) => ({ v: 1, keys: { 'row:nl-db': at }, lastRevoke: {}, revoked: {}, granted: {}, direct: {}, at })
      const os = tx.objectStore('runs')
      os.put(head(Date.now() - 40 * day), 'trust|local:local|ag-gone')
      os.put([{ id: 'v1', key: 'row:nl-db', v: 'accept', at: Date.now() - 40 * day, run: 'r', change: 'c' }], 'trust|local:local|ag-gone|e|row:nl-db')
      os.put(head(Date.now() - day), 'trust|local:local|ag-young')
      await new Promise((res) => (tx.oncomplete = res))
      db.close()
    }, DAY)
    await page.reload()
    await waitForApp(page)
    await expect(row(page, 1)).toBeVisible()
    await expect.poll(() => kinds(page, keyOf(m, 'clarity'))).toEqual(['accept'])
    await expect.poll(async () => ((await page.evaluate(() => (window as any).__oneAgentTrust.keys())) as string[]).filter((k) => k.includes('ag-gone'))).toEqual([]) // eslint-disable-line @typescript-eslint/no-explicit-any
    const keys = (await page.evaluate(() => (window as any).__oneAgentTrust.keys())) as string[] // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(keys).toContain('trust|local:local|ag-young')
    expect(keys.some((k) => k.startsWith(`trust|local:local|${AGENT}`))).toBe(true)

    // the local reset (Workspace settings → Danger: erase) takes the agents' store and every book with it
    await page.evaluate(() => localStorage.setItem('one.resetPending', '1'))
    await page.reload()
    await waitForApp(page)
    await page.waitForFunction(() => !!(window as any).__oneAgentTrust) // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(await page.evaluate(() => (window as any).__oneAgentTrust.keys())).toEqual([]) // eslint-disable-line @typescript-eslint/no-explicit-any
  })

  test('(k) 390 and 1440, Paper and Carbon, XL: no sideways scroll; the plate beside the runs when wide, after them on a phone', async ({ page }) => {
    await morning(page, { book: true })
    const geometry = () =>
      page.evaluate(() => {
        const main = document.querySelector('#main') as HTMLElement
        const runs = document.querySelector('.agx-runsec')!.getBoundingClientRect()
        const p = document.querySelector('.agt-plate')!.getBoundingClientRect()
        return { over: main.scrollWidth - main.clientWidth, doc: document.documentElement.scrollWidth - window.innerWidth, beside: p.left >= runs.right - 1, below: p.top >= runs.bottom - 1 }
      })
    for (const xl of [false, true]) {
      if (xl) {
        await page.evaluate(() => localStorage.setItem('one.textScale', '4'))
        await page.reload()
        await waitForApp(page)
      }
      for (const theme of ['light', 'dark'] as const) {
        await wsEval(page, (s, theme) => s.updateSettings({ theme }), theme)
        for (const [w, h] of [[1440, 900], [390, 844]]) {
          await page.setViewportSize({ width: w, height: h })
          await expect(plate(page)).toBeVisible()
          await page.waitForTimeout(150)
          const g = await geometry()
          expect(g.over, `${w} ${theme} xl=${xl}`).toBeLessThanOrEqual(0)
          expect(g.doc, `${w} ${theme} xl=${xl}`).toBeLessThanOrEqual(0)
          if (w === 390) expect(g.below, `${w} ${theme} xl=${xl}`).toBe(true)
          else if (!xl) expect(g.beside, `${w} ${theme}`).toBe(true)
        }
      }
    }
    expect(await unknowns(page)).toEqual([])
  })
})

/** Seed one more run of the story's agent with these proposals, then come back to the agent's page. */
async function extraRun(page: Page, id: string, staged: AnyRec[], runner: 'browser' | 'server' = 'browser') {
  await page.evaluate(
    (a) => (window as any).__onePreflight.seedRuns([{ id: a.id, agentId: a.agent, runner: a.runner, trigger: { type: 'manual' }, startedAt: Date.now() - 5_000, endedAt: Date.now() - 2_000, status: 'staged', summary: '', steps: [], staged: a.staged }]), // eslint-disable-line @typescript-eslint/no-explicit-any
    { id, agent: AGENT, staged, runner },
  )
  await revisit(page)
  await expect(row(page, 1, id)).toBeVisible()
}

/** A body of `n` lines (the preview shows 10). */
const lines = (n: number) => Array.from({ length: n }, (_, i) => `Zeile ${i + 1} der Übergabe an Tessera.`).join('\n')

test.describe('per-field trust — review follow-ups (S1)', () => {
  test('an Undo that keeps a field you edited takes back the verdicts of the fields it put back; the edited one stays', async ({ page }) => {
    const m = await morning(page)
    const clarity = keyOf(m, 'clarity')
    const why = keyOf(m, 'why')
    const target = m.rows[Object.keys(m.rows)[3]]
    await extraRun(page, 'r-two', [
      {
        id: 'u1',
        n: 1,
        kind: 'update_row',
        status: 'pending',
        pageId: target,
        databaseId: m.dbId,
        title: 'Zwei Felder',
        props: [
          { propId: m.props.clarity, name: 'Klarheit', type: 'select', before: 'Offene Fragen', after: 'Klar', intent: { kind: 'options', names: ['Klar'] } },
          { propId: m.props.why, name: 'Warum', type: 'text', before: '', after: 'Alles geklärt.', intent: { kind: 'value', value: 'Alles geklärt.' } },
        ],
      },
    ])
    await row(page, 1, 'r-two').focus()
    await page.keyboard.press('a')
    await expect.poll(() => statusOf(page, 'u1', 'r-two')).toBe('applied')
    await expect.poll(async () => [...(await kinds(page, clarity)), ...(await kinds(page, why))]).toEqual(['accept', 'accept'])
    // the person rewords Warum: edited
    await wsEval(page, (s, a) => s.setRowProperty(a.row, a.prop, 'Anders gesagt.'), { row: target, prop: m.props.why })
    await flushWatch(page)
    expect(await kinds(page, why)).toEqual(['edited'])
    // Z: Klarheit goes back, Warum stays (the change is kept) — Klarheit's verdict goes with it, Warum's stays
    await row(page, 1, 'r-two').focus()
    await page.keyboard.press('z')
    await expect.poll(() => wsEval(page, (s, a) => s.pages[a.row].properties[a.prop], { row: target, prop: m.props.clarity })).toBe(m.options['Offene Fragen'])
    expect(await statusOf(page, 'u1', 'r-two')).toBe('applied')
    await expect.poll(() => kinds(page, clarity)).toEqual([])
    expect(await kinds(page, why)).toEqual(['edited'])
    expect(await wsEval(page, (s, a) => s.pages[a.row].properties[a.prop], { row: target, prop: m.props.why })).toBe('Anders gesagt.')
    expect(await unknowns(page)).toEqual([])
  })

  test('a body the preview cuts counts only once shown whole: A on it writes no verdict; “5 weitere Zeilen zeigen”, then A writes one; the review’s own call without it writes none', async ({ page }) => {
    const m = await morning(page)
    const rowKey = `row:${m.dbId}`
    const body = (i: number) => ({ id: `w${i}`, n: i, kind: 'create_row', status: 'pending', pageId: `staged-wide-${i}`, databaseId: m.dbId, title: `NL-26${i}`, markdown: lines(15) })
    await extraRun(page, 'r-wide', [body(1), body(2), body(3)])
    const r1 = row(page, 1, 'r-wide')
    await expect(r1.locator('.agent-preview__more')).toHaveText('5 weitere Zeilen zeigen')
    await r1.focus()
    await page.keyboard.press('a')
    await expect.poll(() => statusOf(page, 'w1', 'r-wide')).toBe('applied')
    await page.waitForTimeout(300)
    expect(await verdictsOf(page, rowKey)).toEqual([])
    // shown whole first: a verdict
    const r2 = row(page, 2, 'r-wide')
    await r2.locator('.agent-preview__more').click()
    await expect(r2.locator('.agent-preview__more')).toHaveText('Weniger zeigen')
    await expect(r2.locator('.agent-preview')).toContainText('Zeile 15 der Übergabe')
    await r2.focus()
    await page.keyboard.press('a')
    await expect.poll(() => kinds(page, rowKey)).toEqual(['accept'])
    // Preflight's path (judged, never shown whole): none
    await page.evaluate(async (a) => {
      const w = window as any // eslint-disable-line @typescript-eslint/no-explicit-any
      const run = ((await w.__oneAgents.loadRuns(a.agent)) as AnyRec[]).find((r) => r.id === 'r-wide')
      await w.__oneAgents.applyRun(run, ['w3'], { row: true, judged: true })
    }, { agent: AGENT })
    await expect.poll(() => statusOf(page, 'w3', 'r-wide')).toBe('applied')
    expect(await kinds(page, rowKey)).toEqual(['accept'])
  })

  test('edited is the person’s own edit only: the Outbox’s row patch after “Mark as sent” and a button keep the accept', async ({ page }) => {
    const m = await morning(page)
    const clarity = keyOf(m, 'clarity')
    const rowA = m.rows[Object.keys(m.rows)[8]]
    await row(page, 1).focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => kinds(page, clarity)).toEqual(['accept'])
    for (const via of ['outbox', 'button', 'command'] as const) {
      const value = via === 'outbox' ? m.options['Blockiert'] : via === 'button' ? m.options['Woanders in Arbeit'] : m.options['Offene Fragen']
      await page.evaluate((a) => (window as any).__oneRecorder.step({ writer: { kind: 'you', via: a.via }, calls: [['setRowProperty', a.row, a.prop, a.value]] }), { via, row: rowA, prop: m.props.clarity, value }) // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(await flushWatch(page), via).toBe(1)
      expect(await kinds(page, clarity), via).toEqual(['accept'])
    }
    // the person's own edit still counts (a value other than the one applied)
    await wsEval(page, (s, a) => s.setRowProperty(a.row, a.prop, a.opt), { row: rowA, prop: m.props.clarity, opt: m.options['Blockiert'] })
    expect(await flushWatch(page)).toBe(0)
    expect(await kinds(page, clarity)).toEqual(['edited'])
    expect(await unknowns(page)).toEqual([])
  })

  test('a bulk discard (Preflight’s X) keeps no Undo in the rows: they show what was discarded; its own Undo still puts them back; a row’s discard keeps its Undo', async ({ page }) => {
    await morning(page)
    await page.evaluate(async (a) => {
      const w = window as any // eslint-disable-line @typescript-eslint/no-explicit-any
      const run = ((await w.__oneAgents.loadRuns(a.agent)) as AnyRec[]).find((r) => r.id === a.run)
      const out = await w.__oneAgents.discardRun(run, ['c1', 'c2', 'c3'], { undo: true })
      w.__bulkUndo = out.undo
    }, { agent: AGENT, run: RUN })
    await expect.poll(() => statusOf(page, 'c3')).toBe('discarded')
    for (const n of [1, 2, 3]) {
      await expect(row(page, n)).toHaveAttribute('data-status', 'discarded')
      await expect(row(page, n).getByRole('button', { name: `Rückgängig #${n}` })).toHaveCount(0)
      await expect(row(page, n).locator('[data-part="props"]')).toBeVisible()
    }
    expect(await page.evaluate(() => (window as any).__bulkUndo())).toBe(true) // eslint-disable-line @typescript-eslint/no-explicit-any
    await expect.poll(() => statusOf(page, 'c2')).toBe('pending')
    // one row's discard (the run review, a Preflight card): its Undo in its row
    await page.evaluate(async (a) => {
      const w = window as any // eslint-disable-line @typescript-eslint/no-explicit-any
      const run = ((await w.__oneAgents.loadRuns(a.agent)) as AnyRec[]).find((r) => r.id === a.run)
      await w.__oneAgents.discardRun(run, ['c4'], { undo: true, row: true })
    }, { agent: AGENT, run: RUN })
    await expect(row(page, 4).getByRole('button', { name: 'Rückgängig #4' })).toBeVisible()
  })

  test('a focused row is named by number, kind and title and described by its change and keys; the live region stays one node; the quiet row reads in words', async ({ page }) => {
    const m = await morning(page)
    const keys = Object.keys(m.rows)
    const title = await wsEval(page, (s, id) => s.pages[id].title as string, m.rows[keys[9]])
    await expect(row(page, 2)).toHaveAccessibleName(new RegExp(`^#2 Zeile ändern ${title}$`, 'i'))
    await expect(row(page, 2)).toHaveAccessibleDescription(/^Klarheit\s*Offene Fragen\s*Klar\s*Tasten auf einem Vorschlag/)
    // decided: its state comes first
    await row(page, 2).focus()
    await page.keyboard.press('1')
    await expect(row(page, 2).getByTestId('agx-discarded')).toHaveText('Verworfen · falsch')
    await expect(row(page, 2)).toHaveAccessibleName(new RegExp(`^#2 Zeile ändern ${title}$`, 'i'))
    await expect(row(page, 2)).toHaveAccessibleDescription(/^Verworfen · falsch\s*Tasten auf einem Vorschlag/)
    // the live region is the same node across announcements
    await liveText(page).evaluate((el) => ((el as any).__kept = true)) // eslint-disable-line @typescript-eslint/no-explicit-any
    await row(page, 3).focus()
    await page.keyboard.press('a')
    await expect(liveText(page)).toHaveText('Übernommen · #3')
    await expect(row(page, 4)).toBeFocused()
    await page.keyboard.press('a')
    await expect(liveText(page)).toHaveText('Übernommen · #4')
    expect(await liveText(page).evaluate((el) => (el as any).__kept === true)).toBe(true) // eslint-disable-line @typescript-eslint/no-explicit-any
    await expect(liveText(page)).toHaveAttribute('aria-atomic', 'true')
    // the quiet row: no label on a static item — its words are in it
    const quiet = review(page).getByTestId('agx-quiet')
    await expect(quiet).not.toHaveAttribute('aria-label', /.*/)
    await expect(quiet.locator('.visually-hidden')).toHaveText(`3 als falsch verworfen (${keys[15]}, ${keys[16]}, ${keys[17]}): Klarheit auf Blockiert`)
  })

  test('the orange Apply holding the keyboard focus keeps its focus ring', async ({ page }) => {
    await morning(page)
    await row(page, 1).focus()
    await page.keyboard.press('Tab')
    const apply = row(page, 1).locator('.agt-apply')
    await expect(apply).toBeFocused()
    const shadow = await apply.evaluate((el) => getComputedStyle(el).boxShadow)
    // the ring (surface + signal) and the key's own inset lip
    expect(shadow).toMatch(/0px 0px 0px 4px/)
    expect(shadow).toContain('inset')
  })

  test('the plate beside the runs sticks only while all of it fits the window; a clipped field name tells itself on hover', async ({ page }) => {
    const m = await morning(page)
    // empty book: a short plate sticks
    await expect(plate(page)).toHaveAttribute('data-fits', 'true')
    expect(await plate(page).evaluate((el) => getComputedStyle(el).position)).toBe('sticky')
    // the story's book: taller than the window at 1440 × 900 — it scrolls with the page, its legend reachable
    await page.setViewportSize({ width: 1440, height: 640 })
    await seedTrustBook(page, m)
    await expect(plate(page).locator('.agt-row').first()).toBeVisible()
    await expect(plate(page)).not.toHaveAttribute('data-fits', /.*/)
    expect(await plate(page).evaluate((el) => getComputedStyle(el).position)).not.toBe('sticky')
    // a long field name is cut: hovering it shows the whole name
    await wsEval(page, (s, a) => s.updateProperty(a.db, a.prop, { name: 'Neuer Kommentar seit dem letzten Abgleich mit Tessera' }), { db: m.dbId, prop: m.props.newComment })
    const name = plate(page).locator(`[data-key="${keyOf(m, 'newComment')}"] .agt-row__name b`)
    await expect(name).toHaveText('Neuer Kommentar seit dem letzten Abgleich mit Tessera')
    await name.hover()
    await expect(name).toHaveAttribute('title', 'Neuer Kommentar seit dem letzten Abgleich mit Tessera')
  })
})

/* ------------------------------------------------------------------ task blocks (train 3: P2 × per-field trust) */

/** The task blocks of a page's stored content: [itemId, title]. */
const tasksOn = (page: Page, id: string): Promise<Array<[string, string]>> =>
  wsEval(page, (s, id) => {
    const out: Array<[string, string]> = []
    const text = (n: AnyRec): string => n.text ?? (n.content ?? []).map(text).join('')
    const walk = (n: AnyRec) => {
      if (n.type === 'workItem') out.push([n.attrs?.itemId, text(n.content?.[0] ?? {})])
      for (const c of n.content ?? []) walk(c)
    }
    if (s.pages[id]?.content) walk(s.pages[id].content)
    return out
  }, id)
const blockTypes = (page: Page, id: string): Promise<string[]> =>
  wsEval(page, (s, id) => ((s.pages[id]?.content?.content ?? []) as AnyRec[]).map((n) => n.type as string), id)

const NEW_TASK = 'wi_trusttsk01'
const leaseFact = (itemId: string) => ({ itemId, handle: null, tag: 'new', title: 'Renew the lease', status: 'todo', due: null, reminder: null, people: [], blockedBy: [], related: [] })
/** An append holding one `[!TODO]` quote; `items`: staged here (it makes the task) — without: a proposal stored before P2. */
const leaseAppend = (id: string, pageId: string, items: boolean) => ({
  id,
  n: 1,
  kind: 'append',
  status: 'pending',
  pageId,
  markdown: '> [!TODO] Renew the lease',
  ...(items ? { items: { ids: [NEW_TASK], handles: {}, facts: [leaseFact(NEW_TASK)], warnings: [], holds: [] } } : {}),
})

test.describe('per-field trust — task blocks (P2)', () => {
  test('text that makes a task counts like any text: A writes the task and one append verdict; Z takes the task and the verdict back', async ({ page }) => {
    const m = await morning(page, { lang: 'en' })
    const host = m.rows[Object.keys(m.rows)[3]]
    const key = `append:${m.dbId}`
    await extraRun(page, 'r-task', [leaseAppend('t1', host, true)])
    const r1 = row(page, 1, 'r-task')
    // drawn as the task apply writes
    await expect(r1.locator('[data-md-task]')).toHaveCount(1)
    await expect(r1).toHaveAccessibleDescription(/^Task · New\b.*Renew the lease/)
    await r1.focus()
    await page.keyboard.press('a')
    await expect.poll(() => statusOf(page, 't1', 'r-task')).toBe('applied')
    await expect.poll(() => kinds(page, key)).toEqual(['accept'])
    expect((await verdictsOf(page, key)).map((v) => v.change)).toEqual(['t1'])
    await expect.poll(() => tasksOn(page, host)).toEqual([[NEW_TASK, 'Renew the lease']])
    // Z in its row: the task goes, the verdict with it
    await r1.focus()
    await page.keyboard.press('z')
    await expect.poll(() => statusOf(page, 't1', 'r-task')).toBe('pending')
    await expect.poll(() => verdictsOf(page)).toEqual([])
    await expect.poll(() => tasksOn(page, host)).toEqual([])
    expect(await unknowns(page)).toEqual([])
  })

  test('a quote that apply writes as a quote reads as one: a proposal stored before P2 and a server run’s show no task rows; A on the older one writes a quote and its verdict', async ({ page }) => {
    const m = await morning(page, { lang: 'en' })
    const host = m.rows[Object.keys(m.rows)[5]]
    const key = `append:${m.dbId}`
    // a server run's proposal: staged ids or not, it creates no task here
    await extraRun(page, 'r-srv', [leaseAppend('s1', host, true)], 'server')
    const s1 = row(page, 1, 'r-srv')
    await expect(s1.locator('.agent-preview blockquote')).toContainText('[!TODO] Renew the lease')
    await expect(s1.locator('[data-md-task]')).toHaveCount(0)
    // a browser proposal stored before P2 (no staged ids)
    await extraRun(page, 'r-old', [leaseAppend('o1', host, false)])
    const o1 = row(page, 1, 'r-old')
    await expect(o1.locator('.agent-preview blockquote')).toContainText('[!TODO] Renew the lease')
    await expect(o1.locator('[data-md-task]')).toHaveCount(0)
    await o1.focus()
    await page.keyboard.press('a')
    await expect.poll(() => statusOf(page, 'o1', 'r-old')).toBe('applied')
    await expect.poll(() => blockTypes(page, host)).toContain('blockquote')
    expect(await tasksOn(page, host)).toEqual([])
    // the verdict is about what was shown and written: a quote
    await expect.poll(() => kinds(page, key)).toEqual(['accept'])
  })

  test('a change to a task’s fields: its row is described by the change and why it waits; 1 discards it as wrong and writes no verdict', async ({ page }) => {
    const m = await morning(page, { lang: 'en' })
    const host = m.rows[Object.keys(m.rows)[4]]
    const W = 'wi_trusttsk02'
    const none = { status: 'todo', due: null, reminder: null, people: [], blockedBy: [], related: [] }
    const facts = { itemId: W, handle: null, tag: 'changed', title: 'Rotate keys', status: 'done', due: null, reminder: null, people: [{ id: 'person-alex', name: 'Alex' }], blockedBy: [], related: [], before: none }
    await extraRun(page, 'r-item', [{ id: 'w1', n: 1, kind: 'workItem', status: 'pending', pageId: host, title: 'Rotate keys', workItem: { itemId: W, patch: { status: 'done' }, before: null, facts, holds: ['names'] } }])
    const r1 = row(page, 1, 'r-item')
    await expect(r1).toHaveAccessibleName(/^#1 Task\b.*Rotate keys/)
    // what it changes and why it waits come before the keys
    await expect(r1).toHaveAccessibleDescription(/^Waits for your review · Names a person.*Rotate keys.*Open\s*Done.*Alex.*Keys on a proposal/)
    await r1.focus()
    await page.keyboard.press('1')
    await expect.poll(() => statusOf(page, 'w1', 'r-item')).toBe('discarded')
    expect((await stored(page, 'w1', 'r-item'))?.reason).toBe('wrong')
    await expect(r1.getByTestId('agx-discarded')).toHaveText('Discarded · wrong')
    await page.waitForTimeout(300)
    // a task's fields write no trust key in S1 (keysOfChange): no verdict
    expect(await verdictsOf(page)).toEqual([])
    expect(await unknowns(page)).toEqual([])
  })
})
