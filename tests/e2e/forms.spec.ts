/**
 * Form view (build → fill → row), shared form links (answers → webhook) and the calendar .ics export.
 * Webhooks are mocked with page.route — no request ever leaves the machine.
 */
import { readFileSync } from 'node:fs'
import type { Page, Route } from '@playwright/test'
import { test, expect, openApp, gotoPage, pageIdByTitle, wsEval, flush } from './fixtures'

const HOOK = 'https://hooks.example.test/webhook/form-e2e'

const db = (page: Page) => page.locator('#main section.db').first()

/** Projects database: id + the ids of the properties the tests use. */
async function projectsInfo(page: Page) {
  const id = await pageIdByTitle(page, 'Projects')
  const props = await wsEval(
    page,
    (s, id) => {
      const d = s.databases[id]
      const byName = (n: string) => d.properties.find((p: { name: string }) => p.name === n)
      const prio = byName('Priority')
      const status = byName('Status')
      return {
        title: d.properties.find((p: { type: string }) => p.type === 'title').id as string,
        prio: prio.id as string,
        high: prio.options.find((o: { name: string }) => o.name === 'High').id as string,
        status: status.id as string,
        timeline: byName('Timeline').id as string,
      }
    },
    id,
  )
  return { id, ...props }
}

/** Add a Form view through the "+" view menu; returns its id. */
async function addFormView(page: Page, dbId: string): Promise<string> {
  await db(page).getByRole('button', { name: 'Add view' }).click()
  await page.getByRole('menuitem', { name: /^Form/ }).click()
  await expect(db(page)).toHaveAttribute('data-view', 'form')
  await expect(db(page).locator('.fb')).toBeVisible()
  return wsEval(page, (s, id) => s.databases[id].views.find((v: { type: string }) => v.type === 'form').id, dbId)
}

/** CORS-friendly webhook mock; returns the captured request bodies. */
async function mockWebhook(page: Page): Promise<Array<Record<string, any>>> {
  const bodies: Array<Record<string, any>> = []
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' }
  await page.context().route('https://hooks.example.test/**', (route: Route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    bodies.push(JSON.parse(req.postData() ?? '{}'))
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: '{"ok":true}' })
  })
  return bodies
}

test.describe('form view', () => {
  test('build a form on Projects, fill it in → the row exists; required answers block an empty submit', async ({ page }) => {
    await openApp(page)
    const P = await projectsInfo(page)
    await gotoPage(page, P.id)
    const viewId = await addFormView(page, P.id)

    // builder: every fillable property is a question, computed ones are not offered
    const cards = db(page).locator('.fb-qs .fb-q')
    await expect(cards.first()).toContainText('Project')
    await expect(db(page).locator('.fb-qs')).not.toContainText('Days left')
    await expect(db(page).locator('.fb-note')).toContainText('Days left')
    // the title question becomes required, Timeline gets help text
    await db(page).getByRole('switch', { name: 'Required: Project' }).click()
    await db(page).getByRole('textbox', { name: 'Help text for Timeline' }).fill('When should it start?')
    await db(page).getByRole('textbox', { name: 'Help text for Timeline' }).blur()
    await expect
      .poll(() => wsEval(page, (s, a) => JSON.parse(JSON.stringify(s.databases[a.db].views.find((v: { id: string }) => v.id === a.view).form.questions ?? {})), { db: P.id, view: viewId }))
      .toMatchObject({ [P.title]: { required: true }, [P.timeline]: { help: 'When should it start?' } })

    // fill mode
    await db(page).getByRole('radio', { name: 'Fill' }).click()
    const form = db(page).locator('form.fm')
    await expect(form).toBeVisible()
    await expect(form.getByText('When should it start?')).toBeVisible()
    const rowsBefore = await wsEval(page, (s, id) => (Object.values(s.pages) as Array<{ databaseId: string; trashed: boolean }>).filter((p) => p.databaseId === id && !p.trashed).length, P.id)

    // empty submit: blocked, the required question says so and gets focus
    await form.getByRole('button', { name: 'Submit' }).click()
    const title = form.locator('.fm-q').first()
    await expect(title.locator('.fm-q__err')).toHaveText(/Please answer this question/)
    await expect(title.locator('input')).toBeFocused()
    await expect(title.locator('input')).toHaveAttribute('aria-invalid', 'true')
    await expect(form.locator('.fm-foot__status')).toContainText('1 answer needs attention')
    expect(await wsEval(page, (s, id) => (Object.values(s.pages) as Array<{ databaseId: string; trashed: boolean }>).filter((p) => p.databaseId === id && !p.trashed).length, P.id)).toBe(rowsBefore)

    // a malformed answer is caught too (the Priority select is optional, a number is not a number)
    await title.locator('input').fill('Form-made project')
    await form.locator('.fm-q', { hasText: 'Budget' }).locator('input').fill('lots')
    await form.getByRole('button', { name: 'Submit' }).click()
    await expect(form.locator('.fm-q', { hasText: 'Budget' }).locator('.fm-q__err')).toHaveText(/Enter a number/)
    await form.locator('.fm-q', { hasText: 'Budget' }).locator('input').fill('2500')

    // answer: title + a select + a date
    await form.locator('fieldset', { hasText: 'Priority' }).getByText('High', { exact: true }).click()
    await form.locator('.fm-q', { hasText: 'Timeline' }).locator('input[type="date"]').fill('2026-11-02')
    await form.getByRole('button', { name: 'Submit' }).click()
    await expect(db(page).locator('.fm--done')).toContainText('Response recorded')

    const row = await wsEval(
      page,
      (s, id) => {
        const p = (Object.values(s.pages) as Array<Record<string, any>>).find((x) => x.databaseId === id && x.title === 'Form-made project' && !x.trashed)
        return p ? JSON.parse(JSON.stringify({ id: p.id, props: p.properties })) : null
      },
      P.id,
    )
    expect(row).not.toBeNull()
    expect(row!.props[P.prio]).toBe(P.high)
    expect(row!.props[P.timeline]).toEqual({ start: '2026-11-02' })
    expect(Object.values(row!.props)).toContain(2500)

    // "Submit another response" starts over with an empty form
    await db(page).getByRole('button', { name: 'Submit another response' }).click()
    await expect(form.locator('.fm-q').first().locator('input')).toHaveValue('')
  })

  test('share a form: the link opens a standalone form whose answers are POSTed to the webhook', async ({ page, context, errors }) => {
    const bodies = await mockWebhook(page)
    await openApp(page)
    const P = await projectsInfo(page)
    await gotoPage(page, P.id)
    const viewId = await addFormView(page, P.id)
    await wsEval(page, (s, a) => s.updateView(a.db, a.view, { form: { title: 'Project intake', submitLabel: 'Send pitch', questions: { [a.title]: { required: true } } } }), { db: P.id, view: viewId, title: P.title })

    // without a webhook the share dialog explains why one is needed and offers no link
    await db(page).locator('.dbf-bar').getByRole('button', { name: 'Share form' }).click()
    const dialog = page.getByRole('dialog', { name: /Share this form/ })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.fshare__need')).toContainText('A webhook is required')
    await expect(dialog.getByRole('button', { name: 'Copy link' })).toBeDisabled()

    // connect the webhook, send a test
    await dialog.getByRole('textbox', { name: 'Send responses to a webhook' }).fill(HOOK)
    await dialog.getByRole('button', { name: 'Send test' }).click()
    await expect(dialog.locator('.fb-hook__status')).toContainText('Test delivered')
    expect(bodies.at(-1)).toMatchObject({ event: 'form_test', test: true, form: { title: 'Project intake' }, source: 'simplecms-one' })
    await expect.poll(() => wsEval(page, (s, a) => s.databases[a.db].views.find((v: { id: string }) => v.id === a.view).form.webhookUrl, { db: P.id, view: viewId })).toBe(HOOK)

    // the link: the form schema only — no workspace data
    await expect(dialog.getByRole('button', { name: 'Copy link' })).toBeEnabled()
    const url = await dialog.getByRole('textbox', { name: 'Form link' }).inputValue()
    expect(url).toMatch(/\/app\/#\/f\/[A-Za-z0-9_-]+$/)
    const decoded = await page.evaluate(async (payload) => {
      const b64 = payload.replace(/-/g, '+').replace(/_/g, '/')
      const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      return new Response(stream).text()
    }, url.split('#/f/')[1])
    expect(decoded).toContain('Project intake')
    expect(decoded).toContain(HOOK)
    expect(decoded).not.toContain(P.id)
    expect(decoded).not.toContain(P.high)
    expect(decoded).not.toContain('Website relaunch')
    await page.keyboard.press('Escape')

    // a respondent opens the link
    const form = await context.newPage()
    errors.watch(form)
    await form.goto(url)
    await expect(form.locator('.pf .fm-title')).toHaveText('Project intake')
    await expect(form.getByText('Form via SimpleCMS One')).toBeVisible()
    await expect(form.locator('.pf__dest')).toContainText('hooks.example.test')

    // required validation on the public page too
    await form.getByRole('button', { name: 'Send pitch' }).click()
    await expect(form.locator('.fm-q').first().locator('.fm-q__err')).toBeVisible()
    expect(bodies.filter((b) => b.event === 'form_submitted')).toHaveLength(0)

    await form.locator('.fm-q').first().locator('input').fill('Pitch from the link')
    await form.locator('fieldset', { hasText: 'Status' }).getByText('Review', { exact: true }).click()
    await form.locator('fieldset', { hasText: 'Tags' }).getByText('Web', { exact: true }).click()
    await form.locator('fieldset', { hasText: 'Tags' }).getByText('Ops', { exact: true }).click()
    await form.locator('.fm-q', { hasText: 'Timeline' }).locator('input[type="date"]').fill('2026-12-01')
    await form.locator('.fm-q', { hasText: 'Owner' }).locator('input').fill('Ada')
    await form.getByRole('button', { name: 'Send pitch' }).click()
    await expect(form.getByRole('status')).toContainText('Response recorded')

    const sent = bodies.filter((b) => b.event === 'form_submitted')
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      event: 'form_submitted',
      form: { title: 'Project intake' },
      source: 'simplecms-one',
      answers: { Project: 'Pitch from the link', Status: 'Review', Tags: ['Web', 'Ops'], Timeline: '2026-12-01', Owner: 'Ada', Priority: null },
    })
    expect(Number.isNaN(Date.parse(sent[0].submittedAt))).toBe(false)
    // the answers went to the webhook only: no row was created anywhere, no workspace data on the page
    await flush(page)
    expect(await wsEval(page, (s) => (Object.values(s.pages) as Array<{ title: string }>).some((p) => p.title === 'Pitch from the link'))).toBe(false)
    expect(await form.evaluate(() => document.body.innerText.includes('Website relaunch'))).toBe(false)
    await form.close()
  })

  test('a webhook without CORS headers still gets the answers (no-cors text/plain fallback)', async ({ page, context, errors }) => {
    // A receiver without CORS support makes the JSON request fail with a network-level TypeError
    // (Playwright answers preflights of routed requests itself, so the failure is simulated by
    // aborting the JSON attempt). The browser logs that failure before the fallback succeeds.
    errors.allow(/CORS policy|Failed to fetch|ERR_FAILED/)
    const got: Array<{ type: string; body: string }> = []
    await context.route('https://nocors.example.test/**', (route) => {
      const req = route.request()
      const type = req.headers()['content-type'] ?? ''
      if (req.method() === 'OPTIONS' || type.includes('application/json')) return route.abort('failed')
      got.push({ type, body: req.postData() ?? '' })
      return route.fulfill({ status: 200, body: 'ok' })
    })
    await openApp(page)
    const P = await projectsInfo(page)
    await gotoPage(page, P.id)
    const viewId = await addFormView(page, P.id)
    await wsEval(page, (s, a) => s.updateView(a.db, a.view, { form: { title: 'No-CORS intake', webhookUrl: 'https://nocors.example.test/hook' } }), { db: P.id, view: viewId })
    await db(page).locator('.dbf-bar').getByRole('button', { name: 'Share form' }).click()
    const url = await page.getByRole('dialog', { name: /Share this form/ }).getByRole('textbox', { name: 'Form link' }).inputValue()

    const form = await context.newPage()
    errors.watch(form)
    await form.goto(url)
    await form.locator('.fm-q').first().locator('input').fill('Sent without CORS')
    await form.getByRole('button', { name: 'Submit' }).click()
    await expect(form.locator('.fm--done')).toContainText('Response recorded')
    expect(got).toHaveLength(1)
    expect(got[0].type).toContain('text/plain')
    expect(JSON.parse(got[0].body)).toMatchObject({ event: 'form_submitted', form: { title: 'No-CORS intake' }, answers: { Project: 'Sent without CORS' } })
    await form.close()
  })

  test('a damaged form link shows an error page', async ({ page }) => {
    await page.goto('app/?e2e#/f/not-a-real-payload')
    await expect(page.getByRole('alert')).toContainText('This form link does not work')
    await expect(page.getByRole('alert')).toContainText('DAMAGED')
  })
})

test.describe('calendar export', () => {
  test('export .ics from the calendar view: VCALENDAR, CRLF, escaping, folding, filters', async ({ page }, testInfo) => {
    await openApp(page)
    const P = await projectsInfo(page)
    // a row whose title needs escaping and folding (> 75 octets, multi-byte characters)
    const long = 'Überprüfung; Budget, Zeitplan \\ Risiken — ein sehr langer Titel für den Kalenderexport'
    await wsEval(page, (s, a) => s.createRow(a.db, { title: a.long, properties: { [a.timeline]: { start: '2026-10-20T14:30', includeTime: true } } }), { db: P.id, long, timeline: P.timeline })
    // the calendar view hides "Brand refresh" through a filter
    await wsEval(
      page,
      (s, a) => {
        const v = s.databases[a.db].views.find((x: { type: string }) => x.type === 'calendar')
        s.updateView(a.db, v.id, { filter: { id: 'f', op: 'and', items: [{ id: 'r', propertyId: a.title, operator: 'is_not', value: 'Brand refresh' }] } })
      },
      { db: P.id, title: P.title },
    )
    await flush(page)
    await gotoPage(page, P.id)
    await db(page).getByRole('tab').filter({ hasText: 'Calendar' }).click()
    await expect(db(page)).toHaveAttribute('data-view', 'calendar')

    await db(page).getByRole('toolbar', { name: 'Database toolbar' }).getByRole('button', { name: 'More' }).click()
    const download = page.waitForEvent('download')
    await page.getByRole('menuitem', { name: /Export \.ics/ }).click()
    const file = await download
    expect(file.suggestedFilename()).toBe('Projects.ics')
    const path = testInfo.outputPath('projects.ics')
    await file.saveAs(path)
    const ics = readFileSync(path, 'utf8')

    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics).toContain('VERSION:2.0\r\n')
    // CRLF everywhere: no bare LF
    expect(ics.replace(/\r\n/g, '')).not.toContain('\n')
    // every physical line ≤ 75 octets
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75)
    const unfolded = ics.replace(/\r\n /g, '')

    expect(unfolded).toContain('SUMMARY:Website relaunch\r\n')
    expect((unfolded.match(/BEGIN:VEVENT/g) ?? []).length).toBe(8) // 8 seeded + 1 new − 1 filtered out
    expect(unfolded).not.toContain('SUMMARY:Brand refresh')
    expect(unfolded).toContain('SUMMARY:Überprüfung\\; Budget\\, Zeitplan \\\\ Risiken — ein sehr langer Titel für den Kalenderexport\r\n')

    // all-day range: DTEND is exclusive (the day after the last day); UID stable per row; URL to the row
    const site = await wsEval(
      page,
      (s, a) => {
        const r = (Object.values(s.pages) as Array<Record<string, any>>).find((p) => p.databaseId === a.db && p.title === 'Website relaunch')!
        return { id: r.id, ...r.properties[a.timeline] }
      },
      { db: P.id, timeline: P.timeline },
    )
    const stamp = (iso: string, add = 0) => {
      const d = new Date(`${iso}T00:00:00`)
      d.setDate(d.getDate() + add)
      return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    }
    const event = unfolded.split('BEGIN:VEVENT').find((e) => e.includes('SUMMARY:Website relaunch'))!
    expect(event).toContain(`UID:${site.id}@simplecms-one\r\n`)
    expect(event).toContain(`DTSTART;VALUE=DATE:${stamp(site.start)}\r\n`)
    expect(event).toContain(`DTEND;VALUE=DATE:${stamp(site.end, 1)}\r\n`)
    expect(event).toMatch(new RegExp(`URL:http://[^\\r]+/SimpleCMS/app/#/p/${site.id}\\r\\n`))
    expect(event).toMatch(/DTSTAMP:\d{8}T\d{6}Z\r\n/)
    // timed event in UTC (14:30 Berlin, CEST → 12:30Z), one hour long
    const timed = unfolded.split('BEGIN:VEVENT').find((e) => e.includes('SUMMARY:Überprüfung'))!
    expect(timed).toContain('DTSTART:20261020T123000Z\r\n')
    expect(timed).toContain('DTEND:20261020T133000Z\r\n')
  })
})
