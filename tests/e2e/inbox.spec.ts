import type { Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, gotoPage, wsEval, uiEval, flush, reloadApp, createPage, editorOf, doc } from './fixtures'

/**
 * Inbox + reminders (features/inbox, shell/inbox). Playwright's clock drives time: every test
 * starts on Mon 5 Oct 2026, 09:00 (Europe/Berlin, see playwright.config.ts). main.tsx starts the
 * inbox at boot; the test hook (window.__oneInbox) can stop it, run a pass and read its data.
 */

const T0 = new Date('2026-10-05T09:00:00+02:00') // Monday
const at = (iso: string) => new Date(iso).getTime()
const DAY = 24 * 60 * 60_000

interface Hook {
  start: () => void
  stop: () => void
  isLeader: () => boolean
  run: (now?: number) => Promise<void>
  data: () => { items: Array<{ id: string; kind: string; pageId: string; read?: boolean; archived?: boolean }>; rem: Record<string, { seen: number; fired?: number }>; notify: boolean }
  reminders: () => Array<{ key: string; dueAt: number }>
  codes: {
    parse: (c: unknown) => { n: number; unit: string } | null
    dueAt: (iso: string, code: string) => number | null
    label: (code: string, timed: boolean) => string
    options: (timed: boolean, current?: string | null) => string[]
  }
}
type W = { __oneInbox: Hook }

const inbox = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as W).__oneInbox.data())) as ReturnType<Hook['data']>)
const stopInbox = (page: Page) => page.evaluate(() => (window as unknown as W).__oneInbox.stop())
/** Pages that existed when the app opened: the demo workspace seeds a reminder of its own. */
const seeded = new WeakMap<Page, Set<string>>()
async function open(page: Page, path?: string) {
  await openApp(page, path)
  seeded.set(page, new Set(await wsEval(page, (s) => Object.keys(s.pages))))
}
/** Reminder keys ("m:<pageId>:…" / "p:<rowId>:…") of the pages this test made. */
const seenKeys = async (page: Page) => Object.keys((await inbox(page)).rem).filter((k) => !seeded.get(page)?.has(k.split(':')[1]))

const dateMention = (id: string, reminder: string | null = null): JSONContent => ({ type: 'mention', attrs: { id, label: id, kind: 'date', reminder } })
const line = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content })
const text = (t: string): JSONContent => ({ type: 'text', text: t })

/** A page whose first line carries a date mention (optionally with a reminder). */
function datePage(page: Page, title: string, iso: string, reminder: string | null = null) {
  return createPage(page, { title, content: doc(line(text(`${title} on `), dateMention(iso, reminder), text(' — bring the numbers'))) })
}

const badge = (page: Page) => page.getByTestId('inbox-unread')
const reminderToasts = (page: Page) => page.locator('.toast', { hasText: /reminder/i })
const rows = (page: Page) => page.locator('#main .ibx-item')

test.describe('inbox & reminders', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install({ time: T0 })
  })

  test('date mention: set a reminder in the popover → toast, inbox item, unread badge', async ({ page }) => {
    await open(page)
    const id = await datePage(page, 'Standup', '2026-10-05')
    await gotoPage(page, id)

    const chip = editorOf(page).locator('.mention__date')
    await expect(chip).toHaveText('Today')
    await chip.click()
    const dialog = page.getByRole('dialog', { name: 'Change date or reminder' })
    await expect(dialog).toBeVisible()
    // all-day date: reminders count from 09:00
    await expect(dialog.getByLabel('Remind')).toHaveValue('')
    expect(await dialog.getByLabel('Remind').locator('option').allTextContents()).toEqual(['No reminder', 'On the day (09:00)', '1 day before (09:00)', '2 days before (09:00)', '1 week before (09:00)'])

    await dialog.getByRole('switch', { name: 'Include time' }).click()
    await dialog.getByLabel('Time', { exact: true }).fill('10:30')
    await dialog.getByLabel('Remind').selectOption({ label: '15 minutes before' })
    await expect(dialog.locator('.rmd__due')).toHaveText('Fires Mon 5 Oct, 10:15')
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toHaveCount(0)

    // stored on the node: datetime id + label + reminder code
    await expect
      .poll(() => wsEval(page, (s, id) => JSON.parse(JSON.stringify(s.pages[id].content.content[0].content[1].attrs)), id))
      .toMatchObject({ id: '2026-10-05T10:30', kind: 'date', reminder: '-15m', label: 'October 5, 2026, 10:30 AM' })
    await expect(chip).toHaveText('Today 10:30 AM')
    await expect(chip.locator('.mention__bell')).toBeVisible()
    // the scheduler knows it (seen before it is due)
    await expect.poll(() => seenKeys(page)).toContain(`m:${id}:2026-10-05T10:30:-15m`)
    await expect(badge(page)).toHaveCount(0)

    // 10:15 → it fires: toast with "Open", an unread item, the sidebar read-out
    await page.clock.fastForward('01:15:20')
    const toast = page.locator('.toast', { hasText: 'Reminder · Standup — Mon 5 Oct, 10:30' })
    await expect(toast).toBeVisible()
    await expect(badge(page)).toHaveText('01')
    expect((await inbox(page)).items).toEqual([expect.objectContaining({ id: `r:m:${id}:2026-10-05T10:30:-15m`, kind: 'reminder', pageId: id })])

    // the inbox lists it under Today, unread
    await page.getByRole('button', { name: 'Inbox, 1 unread' }).click()
    await expect(page).toHaveURL(/#\/inbox$/)
    await expect(page.locator('#main .ibx-title')).toHaveText('Inbox')
    await expect(page.locator('#main .ibx-group .ibx-group__head').first()).toContainText('Today')
    await expect(rows(page)).toHaveCount(1)
    const row = rows(page).first()
    await expect(row).toHaveAttribute('data-unread', 'true')
    await expect(row.locator('.ibx-item__kind')).toHaveText('Reminder')
    await expect(row.locator('.ibx-item__name')).toHaveText('Standup')
    await expect(row.locator('.ibx-item__line')).toHaveText('Standup on October 5, 2026, 10:30 AM — bring the numbers')
    await expect(row.locator('.ibx-item__meta')).toHaveText('Mon 5 Oct, 10:30 · 15 minutes before')

    // open: the page at the mention's block, the item read
    await row.locator('.ibx-item__open').click()
    await expect(page).toHaveURL(new RegExp(`#/p/${id}\\?b=`))
    await expect(badge(page)).toHaveCount(0)
    expect((await inbox(page)).items[0].read).toBe(true)

    // never twice
    await page.clock.fastForward('02:00:00')
    await page.waitForTimeout(300)
    expect((await inbox(page)).items).toHaveLength(1)
  })

  test('date property: "Remind" in the date editor rides along date changes and fires', async ({ page }) => {
    await open(page)
    const { dbId, rowId } = await wsEval(page, (s) => {
      const dbId = s.createDatabase({
        title: 'Launch tasks',
        properties: [
          { id: 'pName', name: 'Name', type: 'title' },
          { id: 'pDue', name: 'Due', type: 'date' },
        ],
      })
      const rowId = s.createRow(dbId, { title: 'Ship release', properties: { pDue: { start: '2026-10-07' } } })
      return { dbId, rowId }
    })
    await flush(page)
    await gotoPage(page, dbId)

    const cell = page.locator('#main section.db .dbt-row[role="row"]', { hasText: 'Ship release' }).locator('[role="gridcell"][data-type="date"]')
    await cell.click()
    const pop = page.locator('.db-date-pop')
    await expect(pop).toBeVisible()
    await pop.getByLabel('Remind').selectOption({ label: '1 day before (09:00)' })
    await expect(pop.locator('.rmd__due')).toHaveText('Fires Tue 6 Oct, 09:00')
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].properties.pDue, rowId)).toEqual({ start: '2026-10-07', reminder: '-1d' })

    // a new day keeps the reminder (and moves it)
    await pop.locator('.db-date-pop__day[aria-label*="October 8th"]').click()
    await expect.poll(() => wsEval(page, (s, id) => s.pages[id].properties.pDue, rowId)).toMatchObject({ start: '2026-10-08', reminder: '-1d' })
    await expect(pop.locator('.rmd__due')).toHaveText('Fires Wed 7 Oct, 09:00')
    await page.keyboard.press('Escape')
    await expect(pop).toBeHidden()
    await expect.poll(() => seenKeys(page)).toContain(`p:${rowId}:pDue:2026-10-08:-1d`)
    // the old one (7 Oct) was cancelled by the change
    const scheduled = await wsEval(page, () => (window as unknown as W).__oneInbox.reminders().map((r) => r.key))
    expect(scheduled.filter((k) => !seeded.get(page)?.has(k.split(':')[1]))).toEqual([`p:${rowId}:pDue:2026-10-08:-1d`])

    // Wed 7 Oct 09:00 → fires; "Open" shows the row in the peek
    await page.clock.fastForward(2 * DAY + 30_000)
    const toast = page.locator('.toast', { hasText: 'Reminder · Ship release — Thu 8 Oct' })
    await expect(toast).toBeVisible()
    await toast.getByRole('button', { name: 'Open' }).click()
    await expect.poll(() => uiEval(page, (s) => s.peekPageId)).toBe(rowId)
    await uiEval(page, (s) => s.closePeek())

    expect((await inbox(page)).items.map((i) => [i.kind, i.read])).toEqual([['reminder', true]])
  })

  test('mark read / unread, archive, mark all read — kept across reloads', async ({ page }) => {
    await open(page)
    const a = await datePage(page, 'Budget review', '2026-10-05T09:30', 'at')
    const b = await datePage(page, 'Dentist', '2026-10-05T09:40', 'at')
    const c = await datePage(page, 'Gym', '2026-10-05T09:50', 'at')
    await expect.poll(async () => (await seenKeys(page)).length).toBe(3)

    // one pass after an hour: three at once → one summary toast, three unread items
    await page.clock.fastForward('01:00:00')
    await expect(badge(page)).toHaveText('03')
    await expect(reminderToasts(page)).toHaveCount(1)
    await expect(reminderToasts(page)).toContainText('3 reminders came due while you were away')

    // "G" then "I" opens the inbox
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('g')
    await page.keyboard.press('i')
    await expect(page).toHaveURL(/#\/inbox$/)
    await expect(rows(page)).toHaveCount(3)
    // newest first
    await expect(rows(page).locator('.ibx-item__name')).toHaveText(['Gym', 'Dentist', 'Budget review'])

    const row = (title: string) => rows(page).filter({ has: page.locator('.ibx-item__name', { hasText: title }) })
    await row('Gym').hover()
    await row('Gym').getByRole('button', { name: 'Mark as read' }).click()
    await expect(row('Gym')).not.toHaveAttribute('data-unread')
    await expect(badge(page)).toHaveText('02')
    await row('Dentist').hover()
    await row('Dentist').getByRole('button', { name: 'Archive' }).click()
    await expect(rows(page)).toHaveCount(2)
    await expect(badge(page)).toHaveText('01')
    // keyboard on a focused row: U toggles read
    await row('Budget review').locator('.ibx-item__open').focus()
    await page.keyboard.press('u')
    await expect(badge(page)).toHaveCount(0)
    await page.keyboard.press('u')
    await expect(badge(page)).toHaveText('01')

    await reloadApp(page)
    await expect(badge(page)).toHaveText('01')
    await expect(rows(page)).toHaveCount(2)
    await expect(row('Gym')).not.toHaveAttribute('data-unread')
    await expect(row('Budget review')).toHaveAttribute('data-unread', 'true')
    await page.getByRole('tab', { name: /Archived/ }).click()
    await expect(rows(page).locator('.ibx-item__name')).toHaveText(['Dentist'])
    // back to the inbox from the archive
    await row('Dentist').hover()
    await row('Dentist').getByRole('button', { name: 'Back to inbox' }).click()
    await expect(rows(page)).toHaveCount(0)
    await page.getByRole('tab', { name: /^All/ }).click()
    await expect(rows(page)).toHaveCount(3)

    await page.getByRole('button', { name: 'Mark all read' }).click()
    await expect(badge(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Mark all read' })).toBeDisabled()
    await reloadApp(page)
    expect((await inbox(page)).items.map((i) => [i.pageId, !!i.read, !!i.archived]).sort()).toEqual([[a, true, false], [b, true, false], [c, true, false]].sort())
  })

  test('trashing the page or removing / changing the reminder cancels it', async ({ page }) => {
    await open(page)
    const trashed = await datePage(page, 'Trashed plan', '2026-10-05T10:00', 'at')
    const removed = await datePage(page, 'Removed reminder', '2026-10-05T10:00', '-15m')
    const changed = await datePage(page, 'Moved meeting', '2026-10-05T10:00', 'at')
    await expect.poll(async () => (await seenKeys(page)).length).toBe(3)

    await wsEval(page, (s, { trashed, removed, changed }) => {
      s.trashPage(trashed)
      const set = (id: string, attrs: Record<string, unknown>) => {
        const c = JSON.parse(JSON.stringify(s.pages[id].content))
        Object.assign(c.content[0].content[1].attrs, attrs)
        s.setContent(id, c, 'e2e')
      }
      set(removed, { reminder: null })
      set(changed, { id: '2026-10-06T10:00' })
    }, { trashed, removed, changed })
    await flush(page)

    // today 10:00 passes: nothing
    await page.clock.fastForward('02:00:00')
    await page.waitForTimeout(400)
    expect((await inbox(page)).items).toEqual([])
    await expect(reminderToasts(page)).toHaveCount(0)
    // the moved one fires on its new day
    await page.clock.fastForward(at('2026-10-06T10:00:30+02:00') - (await page.evaluate(() => Date.now())))
    await expect(page.locator('.toast', { hasText: 'Reminder · Moved meeting — Tue 6 Oct, 10:00' })).toBeVisible()
    expect((await inbox(page)).items.map((i) => i.pageId)).toEqual([changed])
  })

  test('missed while the app was closed: in the inbox once, with one summary toast', async ({ page }) => {
    await open(page)
    for (const [title, time] of [['Call the bank', '10:00'], ['Send invoice', '11:00'], ['Water plants', '12:00']])
      await datePage(page, title, `2026-10-05T${time}`, 'at')
    await expect.poll(async () => (await seenKeys(page)).length).toBe(3)

    // close the app (this tab stops scheduling), come back at 14:00
    await stopInbox(page)
    await page.clock.setSystemTime(at('2026-10-05T14:00:00+02:00'))
    await reloadApp(page)

    await expect(reminderToasts(page)).toHaveCount(1)
    await expect(reminderToasts(page)).toHaveText(/3 reminders came due while you were away/)
    await expect(badge(page)).toHaveText('03')
    await reminderToasts(page).getByRole('button', { name: 'Open inbox' }).click()
    await expect(page).toHaveURL(/#\/inbox$/)
    await expect(rows(page)).toHaveCount(3)

    // once: a second reload brings no new toast and no duplicates
    await reloadApp(page)
    await page.waitForTimeout(1600)
    await expect(reminderToasts(page)).toHaveCount(0)
    expect((await inbox(page)).items).toHaveLength(3)
  })

  test('a reminder set on a past moment is noted, not fired', async ({ page }) => {
    await open(page)
    const id = await datePage(page, 'Yesterday standup', '2026-10-04T10:00', 'at')
    await expect.poll(() => seenKeys(page)).toContain(`m:${id}:2026-10-04T10:00:at`)
    await page.clock.fastForward('00:02:00')
    await page.waitForTimeout(300)
    expect((await inbox(page)).items).toEqual([])
    await expect(reminderToasts(page)).toHaveCount(0)
  })

  test('reminder codes: parser, due times (DST), options, labels EN + DE', async ({ page }) => {
    await open(page)
    const r = await page.evaluate(() => {
      const c = (window as unknown as W).__oneInbox.codes
      return {
        parse: ['at', '-5m', '-2h', '-1d', '-1w', '-0m', 'nope', '-1x', '', null, '15m'].map((x) => c.parse(x)),
        due: [
          c.dueAt('2026-10-05', 'at'),
          c.dueAt('2026-10-05', '-1d'),
          c.dueAt('2026-10-05', '-1w'),
          c.dueAt('2026-10-05T14:30', 'at'),
          c.dueAt('2026-10-05T14:30', '-15m'),
          c.dueAt('2026-10-05T14:30', '-2h'),
          c.dueAt('2026-10-26T10:00', '-1d'),
          c.dueAt('garbage', 'at'),
          c.dueAt('2026-10-05', 'nope'),
        ],
        options: [c.options(true), c.options(false), c.options(false, '-15m')],
        labels: [c.label('at', true), c.label('-5m', true), c.label('-1h', true), c.label('-2h', true), c.label('-1d', true), c.label('-2d', true), c.label('-1w', true), c.label('at', false), c.label('-1d', false), c.label('-1w', false), c.label('nope', true)],
      }
    })
    expect(r.parse).toEqual([{ n: 0, unit: 'm' }, { n: 5, unit: 'm' }, { n: 2, unit: 'h' }, { n: 1, unit: 'd' }, { n: 1, unit: 'w' }, { n: 0, unit: 'm' }, null, null, null, null, null])
    expect(r.due).toEqual([
      at('2026-10-05T09:00:00+02:00'),
      at('2026-10-04T09:00:00+02:00'),
      at('2026-09-28T09:00:00+02:00'),
      at('2026-10-05T14:30:00+02:00'),
      at('2026-10-05T14:15:00+02:00'),
      at('2026-10-05T12:30:00+02:00'),
      // across the end of summer time (25 Oct): the same wall-clock time a day earlier
      at('2026-10-25T10:00:00+01:00'),
      null,
      null,
    ])
    expect(r.options).toEqual([
      ['at', '-5m', '-10m', '-15m', '-30m', '-1h', '-2h', '-1d', '-2d', '-1w'],
      ['at', '-1d', '-2d', '-1w'],
      ['at', '-1d', '-2d', '-1w', '-15m'],
    ])
    expect(r.labels).toEqual([
      'At time of event',
      '5 minutes before',
      '1 hour before',
      '2 hours before',
      '1 day before',
      '2 days before',
      '1 week before',
      'On the day (09:00)',
      '1 day before (09:00)',
      '1 week before (09:00)',
      'No reminder',
    ])

    // German
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    const de = await page.evaluate(() => {
      const c = (window as unknown as W).__oneInbox.codes
      return [c.label('at', true), c.label('-15m', true), c.label('-1h', true), c.label('-2d', true), c.label('at', false), c.label('-1w', false)]
    })
    expect(de).toEqual(['Zum Zeitpunkt', '15 Minuten vorher', '1 Stunde vorher', '2 Tage vorher', 'Am Tag (09:00)', '1 Woche vorher (09:00)'])

    // German UI: sidebar, view, popover
    await expect(page.locator('.sb-navrow', { hasText: 'Posteingang' })).toBeVisible()
    await page.evaluate(() => (window.location.hash = '#/inbox'))
    await expect(page.locator('#main .ibx-title')).toHaveText('Posteingang')
    await expect(page.getByRole('tab', { name: 'Erinnerungen' })).toBeVisible()
    await expect(page.locator('#main .ibx-empty__text')).toHaveText('Nichts Neues. Erinnerungen landen hier, sobald sie fällig sind.')
    const id = await datePage(page, 'Termin', '2026-10-07T08:00', '-1d')
    await gotoPage(page, id)
    await editorOf(page).locator('.mention__date').click()
    const dialog = page.getByRole('dialog', { name: 'Datum oder Erinnerung ändern' })
    await expect(dialog.getByLabel('Erinnern')).toHaveValue('-1d')
    await expect(dialog.getByLabel('Erinnern').locator('option:checked')).toHaveText('1 Tag vorher')
    await expect(dialog.locator('.rmd__due')).toHaveText('Erinnert Di. 6. Okt., 08:00')
  })

  test('settings: notifications ask only on the switch, stay on per device, and show in the background', async ({ page }) => {
    // headless Chromium reports notifications as denied — a stand-in Notification records what happens
    await page.addInitScript(() => {
      const log: unknown[] = []
      class FakeNotification {
        static get permission() {
          return sessionStorage.getItem('e2e.notify') ?? 'default'
        }
        static requestPermission() {
          log.push('request')
          sessionStorage.setItem('e2e.notify', 'granted')
          return Promise.resolve('granted')
        }
        onclick: (() => void) | null = null
        constructor(title: string, opts?: { body?: string; tag?: string }) {
          log.push(['show', title, opts?.body, opts?.tag])
        }
        close() {}
      }
      ;(window as unknown as { Notification: unknown }).Notification = FakeNotification
      ;(window as unknown as { __notifyLog: unknown[] }).__notifyLog = log
    })
    const notifyLog = () => page.evaluate(() => (window as unknown as { __notifyLog: unknown[] }).__notifyLog)
    await open(page, '/inbox')
    await page.getByRole('button', { name: 'Inbox settings' }).click()
    const dialog = page.getByRole('dialog', { name: 'Inbox settings' })
    await expect(dialog.locator('.ibx-set__state')).toHaveText('Not asked yet')
    const sw = dialog.getByRole('switch', { name: 'Browser notifications' })
    await expect(sw).toHaveAttribute('aria-checked', 'false')
    expect(await notifyLog()).toEqual([])
    await sw.click()
    await expect(sw).toHaveAttribute('aria-checked', 'true')
    await expect(dialog.locator('.ibx-set__state')).toHaveText('Allowed')
    expect(await notifyLog()).toEqual(['request'])
    await expect.poll(async () => (await inbox(page)).notify).toBe(true)

    await reloadApp(page)
    expect((await inbox(page)).notify).toBe(true)
    await page.getByRole('button', { name: 'Inbox settings' }).click()
    await expect(page.getByRole('dialog', { name: 'Inbox settings' }).getByRole('switch', { name: 'Browser notifications' })).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')

    // a reminder while the app is in the background → a notification (and the toast)
    const id = await datePage(page, 'Pay rent', '2026-10-05T09:30', 'at')
    await expect.poll(() => seenKeys(page)).toContain(`m:${id}:2026-10-05T09:30:at`)
    await page.evaluate(() => (document.hasFocus = () => false))
    await page.clock.fastForward(at('2026-10-05T09:30:20+02:00') - (await page.evaluate(() => Date.now())))
    await expect(page.locator('.toast', { hasText: 'Reminder · Pay rent' })).toBeVisible()
    await expect.poll(notifyLog).toEqual([['show', 'Pay rent', 'Reminder — Mon 5 Oct, 09:30', `r:m:${id}:2026-10-05T09:30:at`]])
  })
})

