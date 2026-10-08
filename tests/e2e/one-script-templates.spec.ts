/**
 * One Script — the template gallery and the editor's completion in the browser.
 *  - every template: created from the gallery on the seeded workspace and on one with the mail databases →
 *    no syntax error → its dry run (or live query) succeeds; mail templates say what they need without them
 *  - three templates run for real: overdue → a report page, the duplicate finder (trash after OK, Undo-able),
 *    mails that need a reply → tasks (no duplicates on the second run) — mocked mail data, nothing leaves
 *  - the gallery: categories, search, ⌘K "New script from template…", German
 *  - completion: members after "." on a database / rows / a row / a page, properties inside where / set,
 *    option values after `Status = `, @ chips, snippets with tab stops, Ctrl+Space, Esc / Enter, F1, 390 px tap
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval, MOD } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** Every template of the gallery (src/app/features/script/templates/catalog.ts). */
const TEMPLATE_IDS = ['overdue', 'week', 'raise', 'assign', 'shift', 'repeat', 'progress', 'query', 'replies', 'followup', 'mail', 'companies', 'counts', 'review', 'table', 'dupes', 'titles', 'archive', 'summarise', 'update']
const MAIL_ONLY = ['replies', 'followup', 'companies']

const day = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** A task database "Tasks": Name · Status (To do / Doing / Done) · Due · Owner — and its rows. */
async function makeTasks(page: Page, rows: Array<[string, 'todo' | 'doing' | 'done', number | null]>): Promise<{ dbId: string; ids: string[] }> {
  return wsEval(
    page,
    (s, a) => {
      const dbId = s.createDatabase({
        title: 'Tasks',
        parentId: null,
        properties: [
          { id: 't_name', name: 'Name', type: 'title' },
          {
            id: 't_status',
            name: 'Status',
            type: 'status',
            options: [
              { id: 'todo', name: 'To do', color: 'gray', group: 'todo' },
              { id: 'doing', name: 'Doing', color: 'blue', group: 'in_progress' },
              { id: 'done', name: 'Done', color: 'green', group: 'done' },
            ],
          },
          { id: 't_due', name: 'Due', type: 'date' },
          { id: 't_owner', name: 'Owner', type: 'person' },
        ],
      })
      // created one after another (the duplicate finder keeps the oldest)
      const ids = a.rows.map(([title, st]: [string, string], i: number) => s.createRow(dbId, { title, properties: { t_status: st, ...(a.days[i] === null ? {} : { t_due: { start: a.days[i] } }) } }))
      return { dbId, ids }
    },
    { rows, days: rows.map(([, , due]) => (due === null ? null : day(due))) },
  )
}

/** The Gmail sync's databases with mocked mails: Mails (Settings → Mail), Contacts, Companies. */
async function makeMailDbs(page: Page): Promise<{ mails: string; ids: string[] }> {
  return wsEval(
    page,
    (s, d) => {
      const mails = s.createDatabase({
        title: 'Mails',
        parentId: null,
        properties: [
          { id: 'm_subject', name: 'Subject', type: 'title' },
          { id: 'm_from', name: 'From', type: 'text' },
          { id: 'm_date', name: 'Date', type: 'date' },
          { id: 'm_link', name: 'Gmail link', type: 'url' },
          { id: 'm_unread', name: 'Unread', type: 'checkbox' },
          { id: 'm_reply', name: 'Needs reply', type: 'checkbox' },
        ],
      })
      const contacts = s.createDatabase({ title: 'Contacts', parentId: null, properties: [{ id: 'c_name', name: 'Name', type: 'title' }, { id: 'c_mail', name: 'E-mail', type: 'text' }] })
      const companies = s.createDatabase({ title: 'Companies', parentId: null, properties: [{ id: 'co_name', name: 'Name', type: 'title' }, { id: 'co_dom', name: 'Domains', type: 'text' }] })
      s.updateDatabase(contacts, { system: 'mail-contacts' })
      s.updateDatabase(companies, { system: 'mail-companies' })
      s.addProperty(mails, { id: 'm_contact', type: 'relation', name: 'Contact', relationDatabaseId: contacts })
      s.addProperty(contacts, { id: 'm_contact.2way', type: 'relation', name: 'Mails', relationDatabaseId: mails })
      s.addProperty(mails, { id: 'm_company', type: 'relation', name: 'Company', relationDatabaseId: companies })
      s.addProperty(companies, { id: 'm_company.2way', type: 'relation', name: 'Mails', relationDatabaseId: mails })
      s.addProperty(contacts, { id: 'c_last', type: 'rollup', name: 'Last mail', rollup: { relationPropertyId: 'm_contact.2way', targetPropertyId: 'm_date', fn: 'latest_date' } })
      const ada = s.createRow(contacts, { title: 'Ada Lovelace', properties: { c_mail: 'ada@acme.example' } })
      const bob = s.createRow(contacts, { title: 'Bob Builder', properties: { c_mail: 'bob@globex.example' } })
      const acme = s.createRow(companies, { title: 'Acme', properties: { co_dom: 'acme.example' } })
      const globex = s.createRow(companies, { title: 'Globex', properties: { co_dom: 'globex.example' } })
      const rows: Array<[string, string, string, boolean, string, string]> = [
        ['Offer for Q4', 'Ada Lovelace <ada@acme.example>', d.old, true, ada, acme],
        ['Invoice 17', 'Bob Builder <bob@globex.example>', d.recent, true, bob, globex],
        ['Newsletter', 'news@globex.example', d.recent, false, bob, globex],
      ]
      const ids = rows.map(([title, from, date, reply, contact, company], i) =>
        s.createRow(mails, { title, properties: { m_from: from, m_date: { start: date }, m_link: `https://mail.google.com/mail/u/0/#all/m${i + 1}`, m_reply: reply, m_unread: reply, m_contact: [contact], m_company: [company] } }),
      )
      const back = (row: string, prop: string, list: string[]) => s.setRowProperty(row, prop, list)
      back(ada, 'm_contact.2way', [ids[0]])
      back(bob, 'm_contact.2way', [ids[1], ids[2]])
      back(acme, 'm_company.2way', [ids[0]])
      back(globex, 'm_company.2way', [ids[1], ids[2]])
      s.updateSettings({ mail: { ...(s.settings.mail ?? {}), databaseId: mails, props: { subject: 'm_subject', from: 'm_from', date: 'm_date', link: 'm_link', unread: 'm_unread', needsReply: 'm_reply', contact: 'm_contact', company: 'm_company' } } as never })
      return { mails, ids }
    },
    { old: day(-40), recent: day(0) },
  )
}

async function openGallery(page: Page): Promise<void> {
  await page.evaluate(() => (window.location.hash = '#/scripts'))
  await page.getByTestId('sc-new-template').click()
  await expect(page.getByTestId('sc-gallery')).toBeVisible()
}

async function useTemplate(page: Page, id: string): Promise<void> {
  await openGallery(page)
  await page.locator(`[data-template="${id}"]`).getByTestId('sc-tpl-use').click()
  await expect(page.locator('.sc-code__input')).toBeVisible()
  await expect(page.getByTestId('sc-gallery')).toHaveCount(0)
}

const consoleStatus = (page: Page) => page.evaluate(() => document.querySelector('[data-testid="sc-console"]')?.getAttribute('data-status') ?? null)

/** Click Dry run / Run and answer whatever the script asks with the first choice, until it is done. */
async function runIt(page: Page, mode: 'dry' | 'run', answer?: (dialog: import('@playwright/test').Locator) => Promise<boolean>): Promise<string> {
  await page.getByTestId(mode === 'dry' ? 'sc-dry' : 'sc-run').click()
  for (let i = 0; i < 120; i++) {
    const dlg = page.locator('.sc-dlg')
    if (await dlg.isVisible().catch(() => false)) {
      if (!(answer && (await answer(dlg)))) {
        const choice = dlg.locator('.sc-choose__item').first()
        if (await choice.count()) await choice.click()
        else await dlg.locator('.btn--primary').first().click()
      }
      await page.waitForTimeout(100)
      continue
    }
    // a script that opens a page (create.page(…).open()) leaves the editor
    if (await page.evaluate(() => !window.location.hash.startsWith('#/scripts/'))) return 'left'
    const st = await consoleStatus(page)
    if (st && st !== 'running') return st
    await page.waitForTimeout(100)
  }
  throw new Error('the run did not finish')
}

/** A template from the gallery: no syntax error, and its dry run (a query: its live result) succeeds. */
async function checkTemplate(page: Page, id: string): Promise<void> {
  await useTemplate(page, id)
  await expect(page.locator('.sc-code .ca__row[data-mark="error"]'), `${id}: syntax`).toHaveCount(0)
  if (id === 'query') {
    await expect(page.getByTestId('sc-live')).toHaveAttribute('data-state', 'ok')
    return
  }
  const st = await runIt(page, 'dry')
  const err = st === 'ok' ? '' : await page.locator('.sc-console__body .sc-err').innerText().catch(() => '')
  expect(st, `${id}: ${err}`).toBe('ok')
}

/* ------------------------------------------------------------------ every template */

test.describe('templates: every one runs (dry) on the seeded workspace and with the mail databases', () => {
  for (const id of TEMPLATE_IDS) {
    test(`template ${id}`, async ({ page }) => {
      await openApp(page)
      // seeded workspace: mail templates say what they need, the others fit
      await openGallery(page)
      const card = page.locator(`[data-template="${id}"]`)
      if (MAIL_ONLY.includes(id)) await expect(card).toHaveClass(/is-missing/)
      else await expect(card).not.toHaveClass(/is-missing/)
      await page.keyboard.press('Escape')
      await checkTemplate(page, id)
      // with the mail databases (and a task database) everything fits
      await makeMailDbs(page)
      await makeTasks(page, [['Write offer', 'todo', -2]])
      await openGallery(page)
      await expect(card).not.toHaveClass(/is-missing/)
      await page.keyboard.press('Escape')
      await checkTemplate(page, id)
    })
  }

  test('the gallery has exactly these templates, by category, filterable', async ({ page }) => {
    await openApp(page)
    await openGallery(page)
    const cards = page.locator('.sc-tpl')
    await expect(cards).toHaveCount(TEMPLATE_IDS.length)
    expect(await cards.evaluateAll((els) => els.map((e) => e.getAttribute('data-template')))).toEqual(TEMPLATE_IDS)
    await page.locator('[data-cat="cleanup"]').click()
    await expect(cards).toHaveCount(3)
    await page.locator('[data-cat="all"]').click()
    await page.getByRole('searchbox', { name: 'Filter templates' }).fill('duplicate titles')
    await expect(cards).toHaveCount(1)
    await expect(cards.first()).toContainText('Find duplicate titles')
    await expect(cards.first()).toContainText('READS · TRASH · ASKS YOU', { ignoreCase: true })
    // the preview shows the code for this workspace (a chip for the database it picked)
    await expect(page.getByTestId('sc-gallery-preview').locator('.sc-chip')).toContainText('Projects')
    await page.getByTestId('sc-gallery-use').click()
    await expect(page.locator('.sc-name')).toHaveValue('Find duplicate titles')
    expect(await page.locator('.sc-code__input').inputValue()).toMatch(/db\(@\[Projects\]\(p:\w+\)\)\.group\(lower\(join\(split\(title\), " "\)\)\)/)
  })

  test('⌘K "New script from template…" opens the gallery; German', async ({ page }) => {
    await openApp(page)
    await page.keyboard.press(`${MOD}+k`)
    await page.keyboard.type('New script from template')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('sc-gallery')).toBeVisible()
    await expect(page).toHaveURL(/#\/scripts$/)
    await page.keyboard.press('Escape')
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await page.getByTestId('sc-new-template').click()
    await expect(page.getByTestId('sc-gallery')).toContainText('Mit einer Vorlage beginnen')
    await page.locator('[data-template="review"]').getByTestId('sc-tpl-use').click()
    await expect(page.locator('.sc-name')).toHaveValue('Wochenrückblick')
    const code = await page.locator('.sc-code__input').inputValue()
    expect(code).toContain('# Wochenrückblick → eine Seite mit Datum')
    expect(code).toContain('## Erledigt')
  })
})

/* ------------------------------------------------------------------ real runs */

test.describe('templates: real runs', () => {
  test('overdue → a report page with the overdue entries as a table', async ({ page }) => {
    await openApp(page)
    await makeTasks(page, [
      ['Send offer', 'todo', -3],
      ['Pay invoice', 'doing', -1],
      ['Plan launch', 'todo', 5],
      ['Old and done', 'done', -9],
    ])
    await useTemplate(page, 'overdue')
    expect(await page.locator('.sc-code__input').inputValue()).toContain('db(@[Tasks](p:')
    // it opens the report page when done
    expect(await runIt(page, 'run')).toBe('left')
    await expect(page.locator('#main .pv-title')).toHaveText(/^Overdue — /)
    const report = await wsEval(page, (s) => (Object.values(s.pages) as AnyState[]).find((p) => p.title.startsWith('Overdue — ') && !p.trashed) ?? null)
    expect(report).not.toBeNull()
    const md = JSON.stringify(report!.content)
    expect(md).toContain('Send offer')
    expect(md).toContain('Pay invoice')
    expect(md).not.toContain('Plan launch')
    expect(md).not.toContain('Old and done')
    expect(md).toContain('"type":"table"')
    // the titles link to their entries
    expect(md).toMatch(/"href":"#\/p\/\w+"/)
  })

  test('duplicate titles: listed, the extra copies go to the trash after OK, the oldest stays', async ({ page }) => {
    await openApp(page)
    const { ids } = await makeTasks(page, [
      ['Write offer', 'todo', 1],
      ['Call client', 'todo', 2],
      ['write  offer ', 'todo', 3],
      ['WRITE OFFER', 'done', 4],
      ['Call client', 'todo', 5],
    ])
    await useTemplate(page, 'dupes')
    expect(await runIt(page, 'run', async (dlg) => {
      // the trash of each copy is asked: allow all of them
      const all = dlg.getByRole('button', { name: 'Allow all' })
      if (await all.count()) {
        await all.click()
        return true
      }
      return false
    })).toBe('ok')
    await expect(page.locator('.sc-log .sc-table tbody tr')).toHaveCount(2)
    const trashed = await wsEval(page, (s, ids) => ids.map((id: string) => !!s.pages[id].trashed), ids)
    expect(trashed).toEqual([false, false, true, true, true])
  })

  test('mails that need a reply → tasks with a link; the second run adds none', async ({ page }) => {
    await openApp(page)
    await makeMailDbs(page)
    const { dbId } = await makeTasks(page, [['Existing task', 'todo', 1]])
    await useTemplate(page, 'replies')
    const code = await page.locator('.sc-code__input').inputValue()
    expect(code).toContain('db(@[Mails](p:')
    expect(code).toContain('`Needs reply` = true')
    const tasks = () => wsEval(page, (s, db) => (Object.values(s.pages) as AnyState[]).filter((p) => p.databaseId === db && !p.trashed).map((p) => p.title).sort(), dbId)
    expect(await runIt(page, 'run')).toBe('ok')
    expect(await tasks()).toEqual(['Existing task', 'Reply: Invoice 17', 'Reply: Offer for Q4'])
    const body = await wsEval(page, (s, db) => JSON.stringify((Object.values(s.pages) as AnyState[]).find((p) => p.databaseId === db && p.title === 'Reply: Offer for Q4')!.content), dbId)
    expect(body).toContain('https://mail.google.com/mail/u/0/#all/m1')
    expect(body).toContain('Ada Lovelace')
    expect(await runIt(page, 'run')).toBe('ok')
    expect(await tasks()).toEqual(['Existing task', 'Reply: Invoice 17', 'Reply: Offer for Q4'])
    await expect(page.locator('.sc-summary--run')).toContainText('Nothing changed')
  })
})

/* ------------------------------------------------------------------ the library additions */

test('md_table, md_chart (a real chart block), page.here, a date range moving as a whole', async ({ page }) => {
  await openApp(page)
  const { dbId, ids } = await makeTasks(page, [
    ['Send | offer', 'todo', 1],
    ['Pay invoice', 'done', 2],
  ])
  await wsEval(page, (s, id) => s.setRowProperty(id, 't_due', { start: '2026-03-02', end: '2026-03-04' }), ids[1])
  const ref = `@[Tasks](p:${dbId})`
  const code = [
    `print(md_table(db(${ref}).sort(Due), ["Name", "Status"]))`,
    `print(md_table(db(${ref}).group(Status).select(Status: key, Count: count)))`,
    `print(page.here)`,
    `let t = db(${ref}).where(Name = "Pay invoice").first`,
    `t.set(Due: t.Due + 2d)`,
    `create.page(title: "Chart page", markdown: "Counts\\n\\n" + md_chart(db(${ref}).group(Status), "bar", "Per status"))`,
  ].join('\n')
  await wsEval(page, (s, code) => s.upsertScript({ id: 'scstd', name: 'Std', code, kind: 'script', createdAt: Date.now(), updatedAt: Date.now() }), code)
  await page.evaluate(() => (window.location.hash = '#/scripts/scstd'))
  await expect(page.locator('.sc-code__input')).toBeVisible()
  expect(await runIt(page, 'run')).toBe('ok')
  const log = page.locator('.sc-log')
  await expect(log).toContainText(`| Name | Status |`)
  await expect(log).toContainText(`| [Send \\| offer](#/p/${ids[0]}) | To do |`)
  await expect(log).toContainText('| Status | Count |')
  await expect(log).toContainText('| Done | 1 |')
  await expect(log).toContainText('null')
  // the range keeps its length
  expect(await wsEval(page, (s, id) => s.pages[id].properties.t_due, ids[1])).toEqual({ start: '2026-03-04', end: '2026-03-06' })
  const chart = await wsEval(page, (s) => {
    const p = (Object.values(s.pages) as AnyState[]).find((x) => x.title === 'Chart page')
    return p?.content.content.find((b: AnyState) => b.type === 'chart')?.attrs.spec ?? null
  })
  expect(chart).toMatchObject({ kind: 'bar', title: 'Per status', source: { kind: 'manual', rows: [['', 'Count'], ['To do', 1], ['Done', 1]] } })
})

/* ------------------------------------------------------------------ completion */

async function newScript(page: Page, code = ''): Promise<{ projects: string; ta: import('@playwright/test').Locator }> {
  const projects = await wsEval(page, (s) => (Object.values(s.pages) as AnyState[]).find((p) => p.kind === 'database' && p.title === 'Projects').id)
  const id = await wsEval(
    page,
    (s, code) => {
      const now = Date.now()
      s.upsertScript({ id: 'scac1', name: 'AC', code, kind: 'script', createdAt: now, updatedAt: now })
      return 'scac1'
    },
    code,
  )
  await page.evaluate((id) => (window.location.hash = `#/scripts/${id}`), id)
  const ta = page.locator('.sc-code__input')
  await expect(ta).toBeVisible()
  await ta.click()
  await page.keyboard.press(`${MOD}+End`)
  return { projects, ta }
}

const items = (page: Page) => page.locator('.sc-complete__item .sc-complete__label')

test.describe('completion in the editor', () => {
  test('members after "." fit the value: a database, its rows, a row, a page', async ({ page }) => {
    await openApp(page)
    const { projects } = await newScript(page)
    const ref = `@[Projects](p:${projects})`
    const ta = page.locator('.sc-code__input')
    await ta.fill(`db(${ref})`)
    await ta.press('End')
    await ta.pressSequentially('.')
    await expect(page.locator('.sc-complete')).toBeVisible()
    await expect(items(page)).toContainText(['where', 'sort', 'limit'])
    expect(await items(page).allInnerTexts()).not.toContain('set')
    await ta.pressSequentially('rows.')
    await expect(items(page).first()).toHaveText('count')
    expect(await items(page).allInnerTexts()).toContain('map')
    expect(await items(page).allInnerTexts()).not.toContain('add')
    await ta.fill(`for t in db(${ref}).rows {\n  t.`)
    await ta.press(`${MOD}+End`)
    await ta.press('Control+Space')
    await expect(items(page).first()).toHaveText('Project')
    expect(await items(page).allInnerTexts()).toEqual(expect.arrayContaining(['Status', 'Timeline', 'set', 'markdown']))
    expect(await items(page).allInnerTexts()).not.toContain('where')
    // the active item's doc: a property's type and options
    await ta.pressSequentially('Sta')
    await expect(page.getByTestId('sc-complete-doc')).toContainText('Backlog · In progress · Review · Done')
    await ta.fill('page.current.')
    await ta.press('End')
    await ta.press('Control+Space')
    expect(await items(page).allInnerTexts()).toEqual(expect.arrayContaining(['children', 'append']))
  })

  test('properties inside where / set, option values after `Status = `, Enter takes, Esc closes', async ({ page }) => {
    await openApp(page)
    const { projects, ta } = await newScript(page)
    const ref = `@[Projects](p:${projects})`
    await ta.fill(`db(${ref}).where(`)
    await ta.press('End')
    await ta.pressSequentially('Sta')
    await expect(items(page).first()).toHaveText('Status')
    await page.keyboard.press('Enter')
    await ta.pressSequentially(' = ')
    await expect(items(page)).toHaveText(['"Backlog"', '"In progress"', '"Review"', '"Done"'])
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(ta).toHaveValue(`db(${ref}).where(Status = "Done"`)
    // inside a text being typed: the options that start with it, the whole text replaced
    await ta.pressSequentially(', Status != "In')
    await expect(items(page)).toHaveText(['"In progress"'])
    await page.keyboard.press('Tab')
    await expect(ta).toHaveValue(`db(${ref}).where(Status = "Done", Status != "In progress"`)
    // set( offers `Property: `, then the values
    await ta.fill(`let t = db(${ref}).first\nt.set(Pri`)
    await ta.press(`${MOD}+End`)
    await ta.press('Control+Space')
    await expect(items(page).first()).toHaveText('Priority:')
    await page.keyboard.press('Enter')
    await expect(items(page)).toHaveText(['"High"', '"Medium"', '"Low"'])
    // Esc closes; Enter with the list closed is a new line
    await page.keyboard.press('Escape')
    await expect(page.locator('.sc-complete')).toHaveCount(0)
    await page.keyboard.press('Enter')
    await expect(ta).toHaveValue(`let t = db(${ref}).first\nt.set(Priority: \n`)
  })

  test('@ references: fuzzy, the database first, inserted as a chip', async ({ page }) => {
    await openApp(page)
    const { projects, ta } = await newScript(page)
    await ta.pressSequentially('db(@projcts')
    await expect(page.locator('.sc-complete__item').first()).toContainText('Projects')
    await expect(page.locator('.sc-complete__item').first()).toContainText('DATABASE')
    await page.keyboard.press('Enter')
    await expect(ta).toHaveValue(`db(@[Projects](p:${projects}) `)
    await expect(page.locator('.sc-code .sc-chip')).toHaveCount(1)
  })

  test('snippets: Tab expands, Tab jumps between the places, Esc leaves them', async ({ page }) => {
    await openApp(page)
    const { ta } = await newScript(page)
    await ta.pressSequentially('fo')
    await expect(page.locator('.sc-complete__item').first()).toHaveAttribute('data-kind', 'snip')
    await page.keyboard.press('Tab')
    await expect(ta).toHaveValue('for t in list {\n  \n}')
    await expect(page.getByTestId('sc-stop')).toHaveCount(2)
    await page.keyboard.type('task')
    await page.keyboard.press('Tab')
    await page.keyboard.type('xs')
    await page.keyboard.press('Tab')
    await page.keyboard.type('print(task)')
    await expect(ta).toHaveValue('for task in xs {\n  print(task)\n}')
    // Esc leaves the places: Tab indents again
    await page.keyboard.press(`${MOD}+a`)
    await page.keyboard.press('Delete')
    await ta.pressSequentially('if')
    await expect(page.locator('.sc-complete')).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(ta).toHaveValue('if condition {\n  \n}')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('sc-stop')).toHaveCount(0)
  })

  test('signature help marks the argument; F1 explains the name at the caret', async ({ page }) => {
    await openApp(page)
    const { ta } = await newScript(page)
    await ta.pressSequentially('mail.send(to: "a@b.c", ')
    await expect(page.locator('.sc-complete')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('sc-sig').locator('mark')).toHaveText('subject: "…"')
    await ta.fill('today().year')
    await page.keyboard.press('End')
    await page.keyboard.press('F1')
    await expect(page.getByTestId('sc-doc')).toContainText('The year.')
    await page.keyboard.press('ArrowLeft')
    await expect(page.getByTestId('sc-doc')).toHaveCount(0)
  })

  test('German: the list and its docs in German', async ({ page }) => {
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    const { ta } = await newScript(page)
    await ta.pressSequentially('today().')
    await expect(items(page).first()).toHaveText('year')
    await expect(page.getByTestId('sc-complete-doc')).toContainText('Das Jahr.')
    await page.keyboard.press('Escape')
    await expect(page.locator('.sc-code__hint')).toContainText('Strg+Leertaste')
  })
})

test.describe('completion at phone width', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the list opens and a tap takes an item; no sideways scrolling', async ({ page }) => {
    await openApp(page)
    const { projects, ta } = await newScript(page)
    await ta.fill(`db(@[Projects](p:${projects})).wh`)
    await ta.press('End')
    await ta.press('Control+Space')
    const item = page.locator('.sc-complete__item', { hasText: 'where' }).first()
    await expect(item).toBeVisible()
    const box = (await page.locator('.sc-complete').boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    await item.tap()
    await expect(ta).toHaveValue(`db(@[Projects](p:${projects})).where(`)
    await expect(ta).toBeFocused()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
