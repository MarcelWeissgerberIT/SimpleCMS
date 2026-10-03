import type { Page } from '@playwright/test'
import { test, expect, openApp, gotoPage, wsEval, uiEval, flush, reloadApp } from './fixtures'

/**
 * Recurring database templates (template.repeat) + the scheduler (features/templates/recurring).
 * Playwright's clock drives time: the suite starts on Mon 5 Oct 2026, 07:50 (Europe/Berlin,
 * see playwright.config.ts). The clock is installed per context, so a second tab shares it.
 *
 * The scheduler is started through the test hook (window.__oneRecurring.start()) — idempotent,
 * so this keeps working once main.tsx starts it at boot.
 */

const T0 = new Date('2026-10-05T07:50:00+02:00') // Monday
const at = (iso: string) => new Date(iso).getTime()
const DAY = 24 * 60 * 60_000

interface Hook {
  start: () => void
  stop: () => void
  isLeader: () => boolean
  run: (now?: number) => Array<{ rows: Array<{ id: string; title: string }>; skipped: number }>
}
const startScheduler = (page: Page) => page.evaluate(() => void (window as unknown as { __oneRecurring: Hook }).__oneRecurring.start())
const stopScheduler = (page: Page) => page.evaluate(() => void (window as unknown as { __oneRecurring: Hook }).__oneRecurring.stop())
const isLeader = (page: Page) => page.evaluate(() => (window as unknown as { __oneRecurring: Hook }).__oneRecurring.isLeader())
const runHere = (page: Page) => page.evaluate(() => (window as unknown as { __oneRecurring: Hook }).__oneRecurring.run().map((n) => n.rows.length))

interface RepeatInput {
  freq: 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'interval'
  days?: number[]
  time: string
  start: string
  title?: string
  dateProperty?: string | null
  lastRunAt?: number
}

/** A "Meetings" database with a "Weekly sync" template (optionally repeating). Returns its id. */
async function createMeetings(page: Page, repeat?: RepeatInput): Promise<string> {
  const id = await wsEval(
    page,
    (s, repeat) => {
      // the demo workspace repeats a template of its own — switch it off so only this one runs
      for (const d of Object.values(s.databases) as Array<{ id: string; templates?: Array<Record<string, unknown>> }>) {
        if (d.templates?.some((t) => t.repeat)) s.updateDatabase(d.id, { templates: d.templates.map(({ repeat: _r, ...t }) => t) })
      }
      const dbId = s.createDatabase({
        title: 'Meetings',
        properties: [
          { id: 'mName', name: 'Name', type: 'title' },
          { id: 'mDate', name: 'Date', type: 'date' },
          { id: 'mType', name: 'Type', type: 'select', options: [{ id: 'oSync', name: 'Sync', color: 'orange' }] },
        ],
      })
      s.updateDatabase(dbId, {
        templates: [
          {
            id: 'tWeekly',
            name: 'Weekly sync',
            icon: null,
            content: { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Agenda for {{date}}' }] }] },
            properties: { mType: 'oSync' },
            ...(repeat ? { repeat } : {}),
          },
        ],
      })
      return dbId
    },
    repeat ?? null,
  )
  await flush(page)
  return id
}

interface Row {
  id: string
  title: string
  trashed: boolean
  date: string | null
  type: string | null
  plain: string
}

async function rowsOf(page: Page, dbId: string): Promise<Row[]> {
  return wsEval(
    page,
    (s, dbId) =>
      (Object.values(s.pages) as Array<Record<string, any>>)
        .filter((p) => p.databaseId === dbId)
        .map((p) => ({ id: p.id, title: p.title, trashed: p.trashed, date: p.properties.mDate?.start ?? null, type: p.properties.mType ?? null, plain: p.plain ?? '' }))
        .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')),
    dbId,
  )
}
const titles = async (page: Page, dbId: string) => (await rowsOf(page, dbId)).map((r) => r.title)
const repeatOf = (page: Page, dbId: string) => wsEval(page, (s, dbId) => JSON.parse(JSON.stringify(s.databases[dbId].templates[0].repeat ?? null)), dbId)

const templateRow = (page: Page) => page.locator('.db-tplmenu__row', { hasText: 'Weekly sync' })
async function openTemplateList(page: Page) {
  await page.locator('#main .db-newbtn__more').click()
  await expect(page.locator('.db-tplmenu')).toBeVisible()
}
async function closeTemplateList(page: Page) {
  await page.keyboard.press('Escape')
  await expect(page.locator('.db-tplmenu')).toHaveCount(0)
}
async function editTemplate(page: Page) {
  await openTemplateList(page)
  await templateRow(page).getByRole('button', { name: 'Edit', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  return dialog
}

test.describe('recurring templates', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: T0 })
  })

  test('weekly repeat: next-run label, one row per occurrence, never twice', async ({ page }) => {
    await openApp(page)
    await startScheduler(page)
    const dbId = await createMeetings(page)
    await gotoPage(page, dbId)

    // --- set it up in the template editor: weekly (today = Monday) + Thursday, 08:00
    const dialog = await editTemplate(page)
    await dialog.getByRole('switch', { name: 'Repeat this template' }).click()
    await expect(dialog.getByRole('button', { name: 'Monday' })).toHaveAttribute('aria-pressed', 'true')
    await dialog.getByRole('button', { name: 'Thursday' }).click()
    await expect(dialog.getByRole('button', { name: 'Thursday' })).toHaveAttribute('aria-pressed', 'true')
    await expect(dialog.getByLabel('At', { exact: true })).toHaveValue('08:00')
    await expect(dialog.getByTestId('repeat-title-preview')).toHaveText('→ Weekly sync — Mon 5 Oct')
    const readout = dialog.locator('.rpt__foot .rpt-next')
    await expect(readout.locator('.rpt-next__text')).toHaveText('Next · Mon 5 Oct, 08:00')
    await expect(readout.locator('.rpt-next__then')).toHaveText('Then · Thu 8 Oct · Mon 12 Oct')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toHaveCount(0)

    const saved = await repeatOf(page, dbId)
    expect(saved).toMatchObject({ freq: 'weekly', days: [1, 4], time: '08:00', start: '2026-10-05', dateProperty: 'mDate' })
    expect(saved.lastRunAt).toBeGreaterThanOrEqual(T0.getTime())

    // --- the template list shows the next run (mono label + LED)
    await openTemplateList(page)
    await expect(templateRow(page).locator('.rpt-next')).toHaveAttribute('data-state', 'on')
    await expect(templateRow(page).locator('.rpt-next__text')).toHaveText('Next · Mon 5 Oct, 08:00')
    await expect(templateRow(page).locator('.led--on')).toBeVisible()
    await closeTemplateList(page)
    expect(await rowsOf(page, dbId)).toHaveLength(0)

    // --- past 08:00: exactly one row, title + date + presets + content variables
    await page.clock.fastForward('15:00')
    await expect.poll(() => titles(page, dbId)).toEqual(['Weekly sync — Mon 5 Oct'])
    const [row] = await rowsOf(page, dbId)
    expect(row).toMatchObject({ date: '2026-10-05', type: 'oSync', trashed: false })
    expect(row.plain).toContain('Agenda for Mon 5 Oct')
    const toast = page.locator('.toast', { hasText: 'Weekly sync — Mon 5 Oct created' })
    await expect(toast).toBeVisible()
    await toast.getByRole('button', { name: 'Open' }).click()
    await expect.poll(() => uiEval(page, (s) => s.peekPageId)).toBe(row.id)
    await uiEval(page, (s) => s.closePeek())

    await openTemplateList(page)
    await expect(templateRow(page).locator('.rpt-next__text')).toHaveText('Next · Thu 8 Oct, 08:00')
    await closeTemplateList(page)

    // --- reload and let it run again: no duplicate
    await reloadApp(page)
    await startScheduler(page)
    await page.clock.fastForward('05:00')
    await page.waitForTimeout(300)
    expect(await titles(page, dbId)).toEqual(['Weekly sync — Mon 5 Oct'])

    // --- the id is the guard: trashed + lastRunAt rolled back (a stale device) → still not created again
    await wsEval(
      page,
      (s, { dbId, rowId, t0 }) => {
        s.trashPage(rowId)
        const tpl = s.databases[dbId].templates[0]
        s.updateDatabase(dbId, { templates: [{ ...tpl, repeat: { ...tpl.repeat, lastRunAt: t0 } }] })
      },
      { dbId, rowId: row.id, t0: T0.getTime() },
    )
    expect(await runHere(page)).toEqual([])
    expect(await rowsOf(page, dbId)).toEqual([expect.objectContaining({ id: row.id, trashed: true })])

    // --- Thursday 08:00 → the next occurrence
    await page.clock.fastForward(3 * DAY)
    await expect.poll(async () => (await rowsOf(page, dbId)).filter((r) => !r.trashed).map((r) => [r.title, r.date])).toEqual([['Weekly sync — Thu 8 Oct', '2026-10-08']])
  })

  test('two tabs at the due time still create one row', async ({ page, errors }) => {
    await openApp(page)
    const dbId = await createMeetings(page, { freq: 'daily', time: '08:00', start: '2026-10-05', dateProperty: 'mDate', lastRunAt: T0.getTime() })
    const page2 = await page.context().newPage()
    errors.watch(page2)
    await openApp(page2)
    await startScheduler(page)
    await startScheduler(page2)
    // exactly one tab leads (Web Locks); the other waits in line
    await expect.poll(async () => [await isLeader(page), await isLeader(page2)].filter(Boolean).length).toBe(1)

    await page.clock.fastForward('15:00')
    await expect.poll(() => titles(page, dbId)).toEqual(['Weekly sync — Mon 5 Oct'])
    await expect.poll(() => titles(page2, dbId)).toEqual(['Weekly sync — Mon 5 Oct'])

    // without leadership, both tabs create the same occurrence independently: same id → still one row
    await stopScheduler(page)
    await stopScheduler(page2)
    await page.clock.setSystemTime(at('2026-10-06T08:01:00+02:00'))
    const created = await Promise.all([runHere(page), runHere(page2)])
    expect(created).toEqual([[1], [1]])
    await flush(page)
    await flush(page2)
    await reloadApp(page2)
    const expected = ['Weekly sync — Mon 5 Oct', 'Weekly sync — Tue 6 Oct']
    await expect.poll(() => titles(page2, dbId)).toEqual(expected)
    await expect.poll(() => titles(page, dbId)).toEqual(expected)
    await page2.close()
  })

  test('missed occurrences: catch-up creates the 3 most recent and reports the skipped ones', async ({ page }) => {
    await openApp(page)
    const dbId = await createMeetings(page, { freq: 'daily', time: '08:00', start: '2026-10-05', title: 'Standup {{date}}', dateProperty: 'mDate', lastRunAt: T0.getTime() })

    // the app is closed for a week: Mon 5 … Mon 12 Oct 08:00 = 8 missed occurrences
    // (main.tsx runs the scheduler at boot — stop it, or this tab catches up before the reload)
    await stopScheduler(page)
    await page.clock.setSystemTime(at('2026-10-12T09:00:00+02:00'))
    await reloadApp(page)
    await startScheduler(page)

    await expect.poll(() => titles(page, dbId)).toEqual(['Standup Sat 10 Oct', 'Standup Sun 11 Oct', 'Standup Mon 12 Oct'])
    expect((await rowsOf(page, dbId)).map((r) => r.date)).toEqual(['2026-10-10', '2026-10-11', '2026-10-12'])
    await expect(page.locator('.toast', { hasText: '3 rows from “Weekly sync” created · 5 older missed runs skipped' })).toBeVisible()
    expect((await repeatOf(page, dbId)).lastRunAt).toBeGreaterThanOrEqual(at('2026-10-12T09:00:00+02:00'))

    // caught up: nothing more until tomorrow
    await page.clock.fastForward('10:00')
    await page.waitForTimeout(300)
    expect(await rowsOf(page, dbId)).toHaveLength(3)
  })

  test('turning repeat off stops it', async ({ page }) => {
    await openApp(page)
    await startScheduler(page)
    const dbId = await createMeetings(page, { freq: 'weekly', days: [1], time: '08:00', start: '2026-10-05', dateProperty: 'mDate', lastRunAt: T0.getTime() })
    await gotoPage(page, dbId)
    await openTemplateList(page)
    await expect(templateRow(page).locator('.rpt-next__text')).toHaveText('Next · Mon 5 Oct, 08:00')
    await closeTemplateList(page)

    const dialog = await editTemplate(page)
    const sw = dialog.getByRole('switch', { name: 'Repeat this template' })
    await expect(sw).toHaveAttribute('aria-checked', 'true')
    // the frequency menu opens above the editor and changes the preview
    await dialog.getByRole('button', { name: 'Repeats' }).click()
    await page.getByRole('menuitem', { name: 'Daily' }).click()
    await expect(dialog.locator('.rpt__foot .rpt-next__then')).toHaveText('Then · Tue 6 Oct · Wed 7 Oct')
    await expect(dialog.getByRole('button', { name: 'Monday' })).toHaveCount(0)
    await sw.click()
    await expect(dialog.locator('.rpt__grid')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toHaveCount(0)
    expect(await repeatOf(page, dbId)).toBeNull()

    await openTemplateList(page)
    await expect(templateRow(page)).toBeVisible()
    await expect(templateRow(page).locator('.rpt-next')).toHaveCount(0)
    await closeTemplateList(page)

    await page.clock.fastForward(8 * DAY)
    await page.waitForTimeout(300)
    expect(await runHere(page)).toEqual([])
    expect(await rowsOf(page, dbId)).toHaveLength(0)
  })
})
