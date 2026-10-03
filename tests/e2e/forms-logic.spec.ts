/**
 * Forms 2.0: conditional logic, pages, presentations, the closing screen, the Responses tab,
 * and shared links (v2 codec with logic + pages; v1 links keep opening).
 * Webhooks are mocked with page.route — no request ever leaves the machine.
 */
import type { Page, Route } from '@playwright/test'
import { test, expect, openApp, gotoPage, wsEval } from './fixtures'

const HOOK = 'https://hooks.example.test/webhook/forms-logic'

const db = (page: Page) => page.locator('#main section.db').first()

type Row = { id: string; title: string; databaseId: string; trashed: boolean; properties: Record<string, unknown> }

/** An "Event signup" database: title + the questions the tests use (fixed ids). */
async function eventDb(page: Page): Promise<string> {
  return wsEval(page, (s) =>
    s.createDatabase({
      parentId: null,
      title: 'Event signup',
      properties: [
        { id: 'pname', name: 'Name', type: 'title' },
        {
          id: 'pattend',
          name: 'Attending',
          type: 'select',
          options: [
            { id: 'oyes', name: 'Yes', color: 'green' },
            { id: 'ono', name: 'No', color: 'red' },
          ],
        },
        { id: 'pguests', name: 'Guests', type: 'number' },
        {
          id: 'pdiet',
          name: 'Diet',
          type: 'multi_select',
          options: [
            { id: 'dveg', name: 'Veggie', color: 'green' },
            { id: 'dvegan', name: 'Vegan', color: 'yellow' },
            { id: 'dnone', name: 'Anything', color: 'gray' },
          ],
        },
        { id: 'prating', name: 'Rating', type: 'rating', ratingMax: 5 },
        { id: 'pcomments', name: 'Comments', type: 'text' },
      ],
    }),
  )
}

/** Add a Form view through the "+" view menu; returns its id. */
async function addFormView(page: Page, dbId: string): Promise<string> {
  await db(page).getByRole('button', { name: 'Add view' }).click()
  await page.getByRole('menuitem', { name: /^Form/ }).click()
  await expect(db(page)).toHaveAttribute('data-view', 'form')
  await expect(db(page).locator('.fb')).toBeVisible()
  return wsEval(page, (s, id) => s.databases[id].views.filter((v: { type: string }) => v.type === 'form').at(-1).id, dbId)
}

const formOf = (page: Page, a: { db: string; view: string }) =>
  wsEval(page, (s, a) => JSON.parse(JSON.stringify(s.databases[a.db].views.find((v: { id: string }) => v.id === a.view).form ?? {})), a)

const rowsOf = (page: Page, dbId: string) =>
  wsEval(page, (s, id) => JSON.parse(JSON.stringify((Object.values(s.pages) as Row[]).filter((p) => p.databaseId === id && !p.trashed))) as Row[], dbId)

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

/** The JSON inside a form link (raw deflate + base64url). */
async function payloadOf(page: Page, url: string): Promise<Record<string, any>> {
  const text = await page.evaluate(async (payload) => {
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    return new Response(stream).text()
  }, url.split('#/f/')[1])
  return JSON.parse(text)
}

test.describe('forms 2.0', () => {
  test('a 3-page form with conditions, built from the keyboard and filled in: hidden questions are skipped and never saved', async ({ page }) => {
    await openApp(page)
    const dbId = await eventDb(page)
    await gotoPage(page, dbId)
    const viewId = await addFormView(page, dbId)
    await wsEval(page, (s, a) => s.updateView(a.db, a.view, { visibleProperties: ['pattend', 'pguests', 'pdiet', 'prating', 'pcomments'] }), { db: dbId, view: viewId })
    const b = db(page).locator('.fb')
    const card = (name: string) => b.locator('.fb-qs > li', { has: page.locator('.fb-q__name', { hasText: new RegExp(`^${name}$`) }) })

    // required: Name and Guests (keyboard: focus the switch, Space)
    await b.getByRole('switch', { name: 'Required: Name' }).focus()
    await page.keyboard.press('Space')
    await b.getByRole('switch', { name: 'Required: Guests' }).focus()
    await page.keyboard.press('Space')

    // Guests: show only if Attending = Yes (the first condition defaults to the question before)
    await b.getByRole('button', { name: 'Show “Guests” only if … (add a condition)' }).focus()
    await page.keyboard.press('Enter')
    const guests = card('Guests')
    await expect(guests.getByRole('combobox', { name: 'Question of condition 1' })).toHaveValue('pattend')
    await expect(guests.getByRole('combobox', { name: 'Operator of condition 1' })).toHaveValue('is')
    await expect(guests.getByRole('combobox', { name: 'Value of condition 1' })).toHaveValue('oyes')
    await expect(guests.locator('.fb-q__if')).toHaveText('If Q02 = Yes')
    await expect(guests.locator('.fb-logic__req')).toHaveText('Required when shown')

    // Diet: the same, with the question picked explicitly
    await b.getByRole('button', { name: 'Show “Diet” only if … (add a condition)' }).press('Enter')
    const diet = card('Diet')
    await diet.getByRole('combobox', { name: 'Question of condition 1' }).selectOption('pattend')
    await diet.getByRole('combobox', { name: 'Value of condition 1' }).selectOption({ label: 'Yes' })
    await expect(diet.locator('.fb-q__if')).toHaveText('If Q02 = Yes')

    // Comments: only for a low rating (number condition)
    await b.getByRole('button', { name: 'Show “Comments” only if … (add a condition)' }).press('Enter')
    const comments = card('Comments')
    await comments.getByRole('combobox', { name: 'Question of condition 1' }).selectOption('prating')
    await comments.getByRole('combobox', { name: 'Operator of condition 1' }).selectOption('lt')
    await comments.getByRole('textbox', { name: 'Value of condition 1' }).fill('3')
    await comments.getByRole('textbox', { name: 'Value of condition 1' }).blur()
    await expect(comments.locator('.fb-q__if')).toHaveText('If Q05 < 3')
    await comments.getByRole('textbox', { name: 'Placeholder for Comments' }).fill('What should we change?')
    await comments.getByRole('textbox', { name: 'Placeholder for Comments' }).blur()

    // logic connectors are drawn in the gutter (Attending → Guests, Attending → Diet, Rating → Comments)
    await expect(b.locator('.fb-rails .fb-rail')).toHaveCount(3)

    // page breaks after Attending and after Diet; the new section title takes the focus
    await b.getByRole('button', { name: 'Insert a page break after “Attending”' }).press('Enter')
    await expect(b.getByRole('textbox', { name: 'Section title of page 02' })).toBeFocused()
    await page.keyboard.type('Details')
    await b.getByRole('button', { name: 'Insert a page break after “Diet”' }).press('Enter')
    await expect(b.getByRole('textbox', { name: 'Section title of page 03' })).toBeFocused()
    await page.keyboard.type('Feedback')
    await page.keyboard.press('Tab')
    await expect(b.locator('.fb-sec__count', { hasText: '3 pages' })).toBeVisible()

    // presentations: Attending as a list, Rating as a scale
    await card('Attending').getByRole('radiogroup', { name: 'Show “Attending” as' }).getByRole('radio', { name: 'List' }).press('Enter')
    await card('Rating').getByRole('radiogroup', { name: 'Show “Rating” as' }).getByRole('radio', { name: 'Scale 1–5' }).press('Enter')

    await expect
      .poll(async () => {
        const f = await formOf(page, { db: dbId, view: viewId })
        return { pages: (f.pages ?? []).map((p: { before: string; title?: string }) => [p.before, p.title ?? '']), q: f.questions }
      })
      .toMatchObject({
        pages: [
          ['pguests', 'Details'],
          ['prating', 'Feedback'],
        ],
        q: {
          pname: { required: true },
          pattend: { display: 'list' },
          pguests: { required: true, showIf: { op: 'and', conditions: [{ q: 'pattend', op: 'is', value: 'oyes' }] } },
          pdiet: { showIf: { conditions: [{ q: 'pattend', op: 'is', value: 'oyes' }] } },
          prating: { display: 'scale' },
          pcomments: { placeholder: 'What should we change?', showIf: { conditions: [{ q: 'prating', op: 'lt', value: 3 }] } },
        },
      })

    // ---- fill ----
    await db(page).getByRole('radio', { name: 'Fill' }).click()
    const form = db(page).locator('form.fm')
    const progress = form.locator('.fm-progress__label')
    // the count follows the answers: "Details" only counts once someone is attending
    await expect(progress).toHaveText('Page 01 / 02')
    await expect(form.locator('.fm-q')).toHaveCount(2)

    // Next checks the page: the name is required
    await form.getByRole('button', { name: 'Next' }).click()
    await expect(form.locator('.fm-q', { hasText: 'Name' }).locator('.fm-q__err')).toHaveText(/Please answer this question/)
    await expect(progress).toHaveText('Page 01 / 02')
    await form.locator('.fm-q', { hasText: 'Name' }).locator('input').fill('Ada')
    await form.locator('.fm-chips--list').getByText('Yes', { exact: true }).click()
    await expect(progress).toHaveText('Page 01 / 03')
    await form.getByRole('button', { name: 'Next' }).click()

    // page 2: section heading, Guests required while shown
    await expect(progress).toHaveText('Page 02 / 03')
    await expect(form.locator('.fm-section__title')).toHaveText('Details')
    await expect(form.locator('.fm-q')).toHaveCount(2)
    await form.getByRole('button', { name: 'Next' }).click()
    await expect(form.locator('.fm-q', { hasText: 'Guests' }).locator('.fm-q__err')).toBeVisible()
    await form.locator('.fm-q', { hasText: 'Guests' }).locator('input').fill('3')
    await form.locator('fieldset', { hasText: 'Diet' }).getByText('Veggie', { exact: true }).click()
    await form.getByRole('button', { name: 'Next' }).click()

    // page 3: the rating scale; Comments appears only for a low rating
    await expect(progress).toHaveText('Page 03 / 03')
    await expect(form.locator('.fm-section__title')).toHaveText('Feedback')
    const scale = form.locator('fieldset', { hasText: 'Rating' })
    await expect(scale.getByRole('radio')).toHaveCount(5)
    await scale.getByText('4', { exact: true }).click()
    await expect(form.locator('.fm-q', { hasText: 'Comments' })).toHaveCount(0)
    await scale.getByText('2', { exact: true }).click()
    const commentsQ = form.locator('.fm-q', { hasText: 'Comments' })
    await expect(commentsQ.locator('textarea')).toHaveAttribute('placeholder', 'What should we change?')
    await commentsQ.locator('textarea').fill('Too loud')
    await scale.getByText('4', { exact: true }).click()
    await expect(form.locator('.fm-q', { hasText: 'Comments' })).toHaveCount(0)

    // Back keeps every answer
    await form.getByRole('button', { name: 'Back' }).click()
    await expect(progress).toHaveText('Page 02 / 03')
    await expect(form.locator('.fm-q', { hasText: 'Guests' }).locator('input')).toHaveValue('3')
    await expect(form.locator('fieldset', { hasText: 'Diet' }).getByRole('checkbox', { name: 'Veggie' })).toBeChecked()
    await form.getByRole('button', { name: 'Back' }).click()
    await expect(progress).toHaveText('Page 01 / 03')
    await expect(form.locator('.fm-q', { hasText: 'Name' }).locator('input')).toHaveValue('Ada')

    // not attending: the whole "Details" page is skipped
    await form.locator('.fm-chips--list').getByText('No', { exact: true }).click()
    await expect(progress).toHaveText('Page 01 / 02')
    await form.getByRole('button', { name: 'Next' }).click()
    await expect(progress).toHaveText('Page 02 / 02')
    await expect(form.locator('.fm-section__title')).toHaveText('Feedback')
    // the last page submits (Guests is required, but hidden: no error)
    await form.getByRole('button', { name: 'Submit' }).click()
    await expect(db(page).locator('.fm--done')).toContainText('Response recorded')

    const rows = await rowsOf(page, dbId)
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row.title).toBe('Ada')
    expect(row.properties.pattend).toBe('ono')
    expect(row.properties.prating).toBe(4)
    // answered once, then hidden by the logic: never saved
    expect(row.properties.pguests).toBeUndefined()
    expect(row.properties.pdiet).toBeUndefined()
    expect(row.properties.pcomments).toBeUndefined()
  })

  test('presentations, the closing screen and the Responses tab (marker, counts, table view)', async ({ page }) => {
    await openApp(page)
    const dbId = await eventDb(page)
    await gotoPage(page, dbId)
    const viewId = await addFormView(page, dbId)
    await wsEval(
      page,
      (s, a) =>
        s.updateView(a.db, a.view, {
          visibleProperties: ['pattend', 'pguests', 'pdiet', 'prating'],
          form: {
            title: 'RSVP',
            questions: {
              pattend: { display: 'dropdown', placeholder: 'Pick one', required: true },
              pguests: { display: 'scale', scale: 10 },
              pdiet: { display: 'list' },
            },
            doneTitle: 'Thanks — see you there!',
            doneMessage: 'Doors open at 7.',
            redirectUrl: 'https://example.com/next',
            allowAnother: false,
          },
        }),
      { db: dbId, view: viewId },
    )

    // Responses before tracking: says why nothing is counted, offers to start
    const modes = db(page).getByRole('radiogroup', { name: 'Form mode' })
    await modes.getByRole('radio', { name: /^Responses/ }).click()
    const r = db(page).locator('.fr')
    await expect(r.locator('.fr-off')).toContainText('Not tracking')
    await r.getByRole('button', { name: 'Track responses' }).click()
    await expect(r.locator('.fr-track')).toContainText('Marked · Form = RSVP')
    const marker = (await formOf(page, { db: dbId, view: viewId })).marker as { propertyId: string; optionId: string }
    expect(marker.propertyId).toBeTruthy()
    const markerProp = await wsEval(page, (s, a) => JSON.parse(JSON.stringify(s.databases[a.db].properties.find((p: { id: string }) => p.id === a.id))), { db: dbId, id: marker.propertyId })
    expect(markerProp).toMatchObject({ name: 'Form', type: 'select', options: [{ id: marker.optionId, name: 'RSVP' }] })
    await expect(r.getByTestId('form-response-count')).toHaveText('00')
    // the marker is never a question
    await modes.getByRole('radio', { name: 'Build' }).click()
    await expect(db(page).locator('.fb-q__name', { hasText: /^Form$/ })).toHaveCount(0)
    await expect(db(page).locator('.fb-note--marker')).toContainText('Form')

    const respond = async (attend: string, guests: string, diets: string[]) => {
      // no "Submit another response": a fresh form needs a mode switch
      await modes.getByRole('radio', { name: 'Build' }).click()
      await modes.getByRole('radio', { name: 'Fill' }).click()
      const form = db(page).locator('form.fm')
      await form.locator('.fm-q').first().locator('input').fill(`Guest ${guests}`)
      // dropdown: a native select with the placeholder as its empty choice
      const select = form.getByRole('combobox', { name: /Attending/ })
      await expect(select.locator('option').first()).toHaveText('Pick one')
      await select.selectOption({ label: attend })
      // number as a 1–10 scale
      const scale = form.locator('fieldset', { hasText: 'Guests' })
      await expect(scale.getByRole('radio')).toHaveCount(10)
      await scale.getByText(guests, { exact: true }).click()
      // multi-select as a checkbox list
      for (const d of diets) await form.locator('.fm-chips--list').getByText(d, { exact: true }).click()
      await form.getByRole('button', { name: 'Submit' }).click()
      const done = db(page).locator('.fm--done')
      await expect(done.locator('.fm-done__title')).toHaveText('Thanks — see you there!')
      await expect(done).toContainText('Doors open at 7.')
      // in the workspace the redirect is a link (respondents of the shared link are sent on)
      await expect(done.getByRole('link', { name: 'Continue to example.com' })).toHaveAttribute('href', 'https://example.com/next')
      await expect(done.getByRole('button', { name: 'Submit another response' })).toHaveCount(0)
    }
    await respond('Yes', '2', ['Veggie', 'Vegan'])
    await respond('Yes', '4', ['Veggie'])
    // a row made elsewhere is not a response
    await wsEval(page, (s, id) => s.createRow(id, { title: 'Added by hand', properties: { pattend: 'ono' } }), dbId)

    const rows = await rowsOf(page, dbId)
    expect(rows.filter((x) => x.properties[marker.propertyId] === marker.optionId).map((x) => x.properties.pguests)).toEqual(expect.arrayContaining([2, 4]))

    await modes.getByRole('radio', { name: /^Responses/ }).click()
    await expect(modes.getByRole('radio', { name: 'Responses · 2' })).toBeVisible()
    await expect(r.getByTestId('form-response-count')).toHaveText('02')
    await expect(r.locator('.fr-readout').nth(1)).toContainText(/now|seconds? ago|minute/)
    const attendQ = r.locator('.fr-q', { hasText: 'Attending' })
    await expect(attendQ.locator('.fr-q__answered')).toHaveText('2 / 2 answered')
    await expect(attendQ.locator('.fr-bar', { hasText: 'Yes' }).locator('.fr-bar__count')).toHaveText('02 100%')
    await expect(attendQ.locator('.fr-bar', { hasText: 'No' }).locator('.fr-bar__count')).toHaveText('00 0%')
    const dietQ = r.locator('.fr-q', { hasText: 'Diet' })
    await expect(dietQ.locator('.fr-bar', { hasText: 'Veggie' }).locator('.fr-bar__count')).toHaveText('02 100%')
    await expect(dietQ.locator('.fr-bar', { hasText: 'Vegan' }).locator('.fr-bar__count')).toHaveText('01 50%')
    await expect(r.locator('.fr-q', { hasText: 'Guests' }).locator('.fr-q__stat')).toHaveText('Avg 3 / 10')
    await expect(r.locator('.fr-honest')).toContainText('responses made in this workspace')

    // open the responses as a table: a filtered table view, selected
    await r.getByRole('button', { name: 'Open as table' }).click()
    await expect(db(page)).toHaveAttribute('data-view', 'table')
    await expect(db(page).getByRole('tab', { selected: true })).toContainText('RSVP · responses')
    const body = db(page).locator('.dbt-body .dbt-row[role="row"]')
    await expect(body).toHaveCount(2)
    await expect(body.filter({ hasText: 'Added by hand' })).toHaveCount(0)
  })

  test('a shared link carries logic and pages (v2) and an old v1 link still opens', async ({ page, context, errors }) => {
    const bodies = await mockWebhook(page)
    await context.route('https://redirect.example.test/**', (route) => route.fulfill({ status: 200, headers: { 'content-type': 'text/html' }, body: '<!doctype html><title>Thanks</title><h1>Thanks page</h1>' }))
    await openApp(page)
    const dbId = await eventDb(page)
    await gotoPage(page, dbId)
    const viewId = await addFormView(page, dbId)
    await wsEval(
      page,
      (s, a) =>
        s.updateView(a.db, a.view, {
          visibleProperties: ['pattend', 'pguests', 'pdiet', 'prating', 'pcomments'],
          form: {
            title: 'Shared RSVP',
            webhookUrl: a.hook,
            questions: {
              pname: { required: true },
              pattend: { display: 'list', required: true },
              pguests: { required: true, display: 'scale', scale: 10, showIf: { op: 'and', conditions: [{ q: 'pattend', op: 'is', value: 'oyes' }] } },
              pdiet: { showIf: { op: 'or', conditions: [{ q: 'pattend', op: 'is', value: 'oyes' }, { q: 'pguests', op: 'gt', value: 5 }] } },
              pcomments: { display: 'short', placeholder: 'Say hi', showIf: { op: 'and', conditions: [{ q: 'prating', op: 'lt', value: 3 }] } },
            },
            pages: [
              { id: 'b1', before: 'pguests', title: 'Details', description: 'Only if you come.' },
              { id: 'b2', before: 'prating', title: 'Feedback' },
            ],
            doneTitle: 'Got it',
            redirectUrl: 'https://redirect.example.test/thanks',
          },
        }),
      { db: dbId, view: viewId, hook: HOOK },
    )
    await db(page).locator('.dbf-bar').getByRole('button', { name: 'Share form' }).click()
    const dialog = page.getByRole('dialog', { name: /Share this form/ })
    const url = await dialog.getByRole('textbox', { name: 'Form link' }).inputValue()
    expect(url).toMatch(/#\/f\/[\w-]+$/)
    // the link: v2, conditions by question / option INDEX — no workspace ids
    const p = await payloadOf(page, url)
    expect(p.v).toBe(2)
    expect(p.q[2]).toMatchObject({ name: 'Guests', d: 's', sc: 10, if: { c: [[1, 'is', 0]] }, pg: { t: 'Details', d: 'Only if you come.' } })
    expect(p.q[3]).toMatchObject({ name: 'Diet', if: { o: 1, c: [[1, 'is', 0], [2, 'gt', 5]] } })
    expect(p.q[4]).toMatchObject({ name: 'Rating', kind: 'rating', pg: { t: 'Feedback' } })
    expect(p.q[5]).toMatchObject({ name: 'Comments', kind: 'short', ph: 'Say hi', if: { c: [[4, 'lt', 3]] } })
    expect(p.end).toEqual({ t: 'Got it', url: 'https://redirect.example.test/thanks' })
    const raw = JSON.stringify(p)
    for (const id of ['pattend', 'oyes', 'pguests', dbId]) expect(raw).not.toContain(id)
    await page.keyboard.press('Escape')

    // a respondent: page 1, then the Details page (attending), hidden questions stay out of the JSON
    const form = await context.newPage()
    errors.watch(form)
    await form.goto(url)
    const f = form.locator('form.fm')
    const progress = f.locator('.fm-progress__label')
    await expect(progress).toHaveText('Page 01 / 02')
    await f.locator('.fm-q').first().locator('input').fill('Grace')
    await f.locator('.fm-chips--list').getByText('No', { exact: true }).click()
    await expect(progress).toHaveText('Page 01 / 02')
    await f.locator('.fm-chips--list').getByText('Yes', { exact: true }).click()
    await expect(progress).toHaveText('Page 01 / 03')
    await f.getByRole('button', { name: 'Next' }).click()
    await expect(f.locator('.fm-section__title')).toHaveText('Details')
    await expect(f.locator('.fm-section__desc')).toHaveText('Only if you come.')
    await f.locator('fieldset', { hasText: 'Guests' }).getByText('7', { exact: true }).click()
    await f.locator('fieldset', { hasText: 'Diet' }).getByText('Vegan', { exact: true }).click()
    await f.getByRole('button', { name: 'Next' }).click()
    await expect(progress).toHaveText('Page 03 / 03')
    await f.locator('fieldset', { hasText: 'Rating' }).locator('.fm-star').nth(4).click()
    await expect(f.locator('.fm-q', { hasText: 'Comments' })).toHaveCount(0)
    await f.getByRole('button', { name: 'Submit' }).click()
    await expect(form.locator('.fm--done .fm-done__title')).toHaveText('Got it')
    await expect(form.locator('.fm--done')).toContainText('Continuing to redirect.example.test')
    const sent = bodies.filter((x) => x.event === 'form_submitted')
    expect(sent).toHaveLength(1)
    expect(sent[0].answers).toEqual({ Name: 'Grace', Attending: 'Yes', Guests: 7, Diet: ['Vegan'], Rating: 5 })
    // then on to the redirect address
    await form.waitForURL('https://redirect.example.test/thanks')
    await form.close()

    // an OLD link (v1, as the previous version wrote it) opens and submits as before
    const v1 = { v: 1, title: 'Old intake', desc: 'From last year', submit: 'Send', hook: HOOK, q: [{ name: 'Name', kind: 'short', req: 1 }, { name: 'Color', kind: 'select', opts: [['Red', 'red'], ['Blue', 'blue']] }] }
    const encoded = await page.evaluate(async (json) => {
      const stream = new Blob([new TextEncoder().encode(json)]).stream().pipeThrough(new CompressionStream('deflate-raw'))
      const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
      let bin = ''
      for (const b of bytes) bin += String.fromCharCode(b)
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    }, JSON.stringify(v1))
    const old = await context.newPage()
    errors.watch(old)
    await old.goto(`${url.split('#/f/')[0]}#/f/${encoded}`)
    await expect(old.locator('.pf .fm-title')).toHaveText('Old intake')
    await expect(old.locator('.fm-progress')).toHaveCount(0)
    await old.getByRole('button', { name: 'Send' }).click()
    await expect(old.locator('.fm-q').first().locator('.fm-q__err')).toBeVisible()
    await old.locator('.fm-q').first().locator('input').fill('Linus')
    await old.locator('fieldset', { hasText: 'Color' }).getByText('Blue', { exact: true }).click()
    await old.getByRole('button', { name: 'Send' }).click()
    await expect(old.locator('.fm--done .fm-done__title')).toHaveText('Response recorded')
    await expect(old.getByRole('button', { name: 'Submit another response' })).toBeVisible()
    expect(bodies.filter((x) => x.event === 'form_submitted').at(-1)!.answers).toEqual({ Name: 'Linus', Color: 'Blue' })
    await old.close()
  })

  test('a plain form still shares as a v1 link', async ({ page }) => {
    await openApp(page)
    const dbId = await eventDb(page)
    await gotoPage(page, dbId)
    const viewId = await addFormView(page, dbId)
    await wsEval(page, (s, a) => s.updateView(a.db, a.view, { visibleProperties: ['pattend'], form: { title: 'Plain', webhookUrl: a.hook } }), { db: dbId, view: viewId, hook: HOOK })
    await db(page).locator('.dbf-bar').getByRole('button', { name: 'Share form' }).click()
    const url = await page.getByRole('dialog', { name: /Share this form/ }).getByRole('textbox', { name: 'Form link' }).inputValue()
    const p = await payloadOf(page, url)
    expect(p.v).toBe(1)
    expect(p).not.toHaveProperty('end')
  })
})
