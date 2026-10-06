/**
 * One Script (#/scripts, features/script) end to end: the editor with @ chips that survive renames,
 * the live query tester, the visual query builder's round trip with the code, dry run vs. run (store
 * writes, a version before the change, Undo run), the effects (mail.send → a mailto: draft, claude()
 * against a mocked api.anthropic.com, http.post refused unless ticked), Stop, the team confirmation of
 * someone else's version, German, phone width and the run log after a reload. Never a real network
 * request: window.open is intercepted, Anthropic and the http target are routed.
 */
import type { Page } from '@playwright/test'
import { test, expect, openApp, wsEval, flush, reloadApp, MOD, sse } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** A small task database "Aufgaben": Name · Status (Offen / Erledigt) · Fällig (date) · Priorität (Hoch / Niedrig). */
async function makeTasks(page: Page): Promise<{ dbId: string; ids: string[] }> {
  return wsEval(page, (s) => {
    const dbId = s.createDatabase({
      title: 'Aufgaben',
      parentId: null,
      properties: [
        { id: 'p_name', name: 'Name', type: 'title' },
        { id: 'p_status', name: 'Status', type: 'select', options: [{ id: 'o_open', name: 'Offen', color: 'blue' }, { id: 'o_done', name: 'Erledigt', color: 'green' }] },
        { id: 'p_due', name: 'Fällig', type: 'date' },
        { id: 'p_prio', name: 'Priorität', type: 'select', options: [{ id: 'o_high', name: 'Hoch', color: 'red' }, { id: 'o_low', name: 'Niedrig', color: 'gray' }] },
      ],
    })
    const day = (n: number) => {
      const d = new Date()
      d.setDate(d.getDate() + n)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    const rows: Array<[string, string, number]> = [
      ['Angebot schreiben', 'o_open', 1],
      ['Rechnung prüfen', 'o_open', 10],
      ['Website live', 'o_done', 0],
      ['Kunde anrufen', 'o_open', 2],
    ]
    const ids = rows.map(([title, status, due]) => s.createRow(dbId, { title, properties: { p_status: status, p_due: { start: day(due) }, p_prio: 'o_low' } }))
    return { dbId, ids }
  })
}

/** A saved script (through the store, like another tab or member would). */
async function addScript(page: Page, input: { code: string; kind?: 'script' | 'query'; name?: string }): Promise<string> {
  const id = await wsEval(
    page,
    (s, a) => {
      const id = `sc${Math.random().toString(36).slice(2, 10)}`
      const now = Date.now()
      s.upsertScript({ id, name: a.name ?? 'Test script', code: a.code, kind: a.kind ?? 'script', createdAt: now, updatedAt: now })
      return id
    },
    input,
  )
  return id
}

async function openScript(page: Page, id: string): Promise<void> {
  await page.evaluate((id) => (window.location.hash = `#/scripts/${id}`), id)
  await expect(page.locator('.sc-code__input')).toBeVisible()
}

/** Replace the editor's code (select all + type keeps the textarea's own events). */
async function setCode(page: Page, code: string): Promise<void> {
  const ta = page.locator('.sc-code__input')
  await ta.click()
  await page.keyboard.press(`${MOD}+a`)
  await page.keyboard.press('Delete')
  await ta.fill(code)
}

const prioOf = (page: Page, ids: string[]) => wsEval(page, (s, ids) => ids.map((id: string) => s.pages[id].properties.p_prio), ids)
const ref = (dbId: string) => `@[Aufgaben](p:${dbId})`

/** window.open (the mailto: draft) is recorded instead of leaving the page. */
async function interceptOpen(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __opened: string[] }
    w.__opened = []
    window.open = ((url?: string | URL) => {
      w.__opened.push(String(url))
      return null
    }) as typeof window.open
  })
}
const opened = (page: Page) => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)

test.describe('One Script', () => {
  test('a new script: @ completion inserts a chip, the reference survives a rename, Mod+E evaluates', async ({ page }) => {
    await openApp(page)
    const { dbId } = await makeTasks(page)
    await page.locator('.sb-nav').getByText('Scripts', { exact: true }).click()
    await expect(page.locator('.sc-title')).toHaveText('Scripts')
    await page.getByTestId('sc-new').click()
    await expect(page.locator('.sc-code__input')).toBeVisible()
    const ta = page.locator('.sc-code__input')
    await ta.click()
    await page.keyboard.press(`${MOD}+a`)
    await page.keyboard.press('Delete')
    await ta.pressSequentially('db(@Aufg')
    const complete = page.locator('.sc-complete')
    await expect(complete).toBeVisible()
    await expect(complete.locator('.sc-complete__item').first()).toContainText('Aufgaben')
    await page.keyboard.press('Enter')
    await expect(ta).toHaveValue(`db(${ref(dbId)} `)
    await expect(page.locator('.sc-chip')).toHaveCount(1)
    await expect(page.locator('.sc-chip')).toContainText('Aufgaben')
    await ta.pressSequentially(').count')
    await page.keyboard.press(`${MOD}+e`)
    await expect(page.locator('.sc-console__pre')).toHaveText('= 4')
    // the database gets another name: the chip still points at it
    await wsEval(page, (s, id) => s.updatePage(id, { title: 'Aufgaben (alt)' }), dbId)
    await page.keyboard.press(`${MOD}+e`)
    await expect(page.locator('.sc-console__pre')).toHaveText('= 4')
    // saved as typed
    await flush(page)
    const code = await wsEval(page, (s) => (Object.values(s.scripts) as AnyState[])[0].code)
    expect(code).toBe(`db(${ref(dbId)} ).count`)
  })

  test('⌘K "New script" and the empty list offer a start', async ({ page }) => {
    await openApp(page)
    await page.keyboard.press(`${MOD}+k`)
    await page.keyboard.type('New script')
    await page.keyboard.press('Enter')
    await expect(page.locator('.sc-code__input')).toBeVisible()
    await expect(page).toHaveURL(/#\/scripts\/\w+/)
    const n = await wsEval(page, (s) => Object.keys(s.scripts ?? {}).length)
    expect(n).toBe(1)
  })

  test('query tester: a live table with the right rows and count, "0 results", follows the data', async ({ page }) => {
    await openApp(page)
    const { dbId, ids } = await makeTasks(page)
    const id = await addScript(page, { kind: 'query', code: `db(${ref(dbId)}).where(Status = "Offen")` })
    await openScript(page, id)
    const live = page.getByTestId('sc-live')
    await expect(page.getByTestId('sc-live-count')).toHaveText('3 results')
    await expect(live.locator('tbody tr')).toHaveCount(3)
    await expect(live.locator('tbody')).toContainText('Angebot schreiben')
    await expect(live.locator('tbody')).not.toContainText('Website live')
    // the data changes: the result follows
    await wsEval(page, (s, id) => s.setRowProperty(id, 'p_status', 'o_open'), ids[2])
    await expect(page.getByTestId('sc-live-count')).toHaveText('4 results')
    // nothing matches: said clearly
    await setCode(page, `db(${ref(dbId)}).where(Status = "Gibt es nicht")`)
    await expect(page.getByTestId('sc-live-none')).toHaveText('0 results — no entry matches.')
    // an error shows inline (gutter mark + message at its line)
    await setCode(page, `db(${ref(dbId)}).where(Unbekannt = 1)`)
    await expect(page.locator('.sc-live .sc-err')).toContainText('has no property Unbekannt')
    await expect(page.locator('.sc-code__ln--err')).toHaveText('1')
    // a query never writes
    await setCode(page, `db(${ref(dbId)}).first.set(Status: "Erledigt")`)
    await expect(page.locator('.sc-live .sc-err')).toContainText('This run only reads')
    expect(await wsEval(page, (s, id) => s.pages[id].properties.p_status, ids[0])).toBe('o_open')
  })

  test('query builder: building writes the code, the code drives the builder, other code stays text', async ({ page }) => {
    await openApp(page)
    const { dbId } = await makeTasks(page)
    const id = await addScript(page, { kind: 'query', code: `db(${ref(dbId)})` })
    await openScript(page, id)
    const qb = page.getByTestId('sc-qb')
    const ta = page.locator('.sc-code__input')
    await expect(qb).toBeVisible()
    await expect(page.getByTestId('sc-live-count')).toHaveText('4 results')
    // a condition: Status is Offen
    await qb.getByRole('button', { name: 'Condition' }).click()
    const cond = qb.getByTestId('sc-qb-cond').first()
    await cond.getByLabel('Property').selectOption('Status')
    await cond.getByLabel('Value').selectOption('Offen')
    await expect(ta).toHaveValue(`db(${ref(dbId)}).where(Status = "Offen")`)
    await expect(page.getByTestId('sc-live-count')).toHaveText('3 results')
    // sort by Fällig, newest first, and at most 2
    await qb.getByRole('button', { name: 'Sort key' }).click()
    await qb.getByTestId('sc-qb-sort').getByRole('button', { name: 'Z→A' }).click()
    await qb.locator('#sc-qb-limit').fill('2')
    await qb.locator('#sc-qb-limit').press('Enter')
    await expect(ta).toHaveValue(new RegExp(`\\.where\\(Status = "Offen"\\)[\\s\\S]*\\.sort\\(Fällig desc\\)[\\s\\S]*\\.limit\\(2\\)`))
    await expect(page.getByTestId('sc-live-count')).toHaveText('2 results')
    await expect(page.locator('.sc-live tbody tr').first()).toContainText('Rechnung prüfen')
    // the code changes: the builder follows
    await setCode(page, `db(${ref(dbId)}).where(Status = "Erledigt")`)
    await expect(qb.getByTestId('sc-qb-cond').first().getByLabel('Value')).toHaveValue('Erledigt')
    await expect(page.getByTestId('sc-live-count')).toHaveText('1 result')
    // code the builder can't show: "Edit as text", the text untouched
    const other = `let open = db(${ref(dbId)}).where(Status = "Offen")\nopen.map(t => t.Name)`
    await setCode(page, other)
    await expect(page.getByTestId('sc-qb-unsupported')).toBeVisible()
    await page.getByRole('button', { name: 'Edit as text' }).click()
    await expect(ta).toBeFocused()
    await expect(ta).toHaveValue(other)
  })

  test('dry run lists the writes and the mail and changes nothing; Run asks, writes, keeps a version; Undo run restores', async ({ page, context }) => {
    await interceptOpen(page)
    await openApp(page)
    const { dbId, ids } = await makeTasks(page)
    const code = `let due = db(${ref(dbId)}).where(Status = "Offen", Fällig < today() + 3d)\nfor t in due {\n  t.set(Priorität: "Hoch")\n}\nmail.send(to: "team@example.com", subject: "Hochgestuft", body: "{due.count} Aufgaben")\n`
    const id = await addScript(page, { code, name: 'Hochstufen' })
    await openScript(page, id)
    // dry run
    await page.getByTestId('sc-dry').click()
    const sum = page.locator('.sc-summary--dry')
    await expect(sum).toContainText('This script would')
    await expect(sum).toContainText('change 2 entries in Aufgaben')
    await expect(sum).toContainText('send a mail to team@example.com · Hochgestuft')
    await sum.getByRole('button', { name: /change 2 entries/ }).click()
    await expect(sum.locator('.sc-changes')).toContainText('Angebot schreiben')
    await expect(sum.locator('.sc-changes')).toContainText('Niedrig')
    expect(await prioOf(page, ids)).toEqual(['o_low', 'o_low', 'o_low', 'o_low'])
    expect(await opened(page)).toEqual([])
    // run: the mail is asked first (one list), then everything happens
    await page.getByTestId('sc-run').click()
    const plan = page.getByTestId('sc-dialog-plan')
    await expect(plan).toContainText('Send a mail to team@example.com · Hochgestuft')
    await page.getByRole('button', { name: 'Run (1 of 1)' }).click()
    await expect(page.locator('.sc-summary--run')).toContainText('Changed 2 entries in Aufgaben')
    await expect.poll(() => prioOf(page, ids)).toEqual(['o_high', 'o_low', 'o_low', 'o_high'])
    const mail = (await opened(page))[0]
    expect(mail).toMatch(/^mailto:team@example\.com\?subject=Hochgestuft&body=2%20Aufgaben$/)
    // a version of each changed row was kept before the change
    const versions = await page.evaluate(async (rowId) => {
      const db: IDBDatabase = await new Promise((res, rej) => {
        const q = indexedDB.open('one-history')
        q.onsuccess = () => res(q.result)
        q.onerror = () => rej(q.error)
      })
      return new Promise<AnyState[]>((res) => {
        const r = db.transaction('snapshots').objectStore('snapshots').get(`idx:${rowId}`)
        r.onsuccess = () => res(r.result ?? [])
      })
    }, ids[0])
    expect(versions.length).toBeGreaterThan(0)
    // … as a script version, named after the script
    expect(versions.at(-1)).toMatchObject({ reason: 'script', by: 'Hochstufen' })
    // Undo run (the run log)
    await page.getByRole('tab', { name: 'Run log' }).click()
    const runs = page.getByTestId('sc-runs').locator('.sc-run')
    await expect(runs).toHaveCount(2)
    await expect(runs.first()).toHaveAttribute('data-mode', 'run')
    await runs.first().locator('.sc-run__head').click()
    await runs.first().getByRole('button', { name: 'Undo run' }).click()
    await expect.poll(() => prioOf(page, ids)).toEqual(['o_low', 'o_low', 'o_low', 'o_low'])
    await expect(runs.first()).toContainText('Undone')
    void context
  })

  test('claude() goes through the mocked API, http.post is refused unless ticked, Stop ends a run', async ({ page, context }) => {
    const bodies: string[] = []
    await context.route('https://api.anthropic.com/**', (route) => {
      const req = route.request()
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      if (req.method() === 'GET') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: [], has_more: false }) })
      bodies.push(req.postData() ?? '')
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse('Hallo aus dem Mock') })
    })
    let posted = 0
    await context.route('https://hooks.example.com/**', (route) => {
      posted++
      return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: '{}' })
    })
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    const id = await addScript(page, { code: 'let a = claude("Sag Hallo")\nprint(a)\nlet r = http.post("https://hooks.example.com/in", {x: 1})\nprint(r)\n' })
    await openScript(page, id)
    await page.getByTestId('sc-run').click()
    const plan = page.getByTestId('sc-dialog-plan')
    await expect(plan).toContainText('Ask Claude: Sag Hallo')
    await expect(plan).toContainText('Send data to hooks.example.com/in')
    // the web request is not ticked at first
    await expect(plan.locator('input[type=checkbox]').nth(1)).not.toBeChecked()
    await page.getByRole('button', { name: 'Run (1 of 2)' }).click()
    await expect(page.locator('.sc-log')).toContainText('Hallo aus dem Mock')
    await expect(page.locator('.sc-log')).toContainText('http.post: hooks.example.com/in — refused')
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toContain('Sag Hallo')
    expect(posted).toBe(0)
    // an endless loop: Stop ends it
    await setCode(page, 'let n = 0\nwhile true { n = n + 1 }')
    await page.getByTestId('sc-run').click()
    await page.getByTestId('sc-stop').click()
    await expect(page.getByTestId('sc-console')).toHaveAttribute('data-status', 'stopped')
    await expect(page.getByTestId('sc-run')).toBeVisible()
  })

  test('team workspace: a version this device did not save runs only after it was confirmed', async ({ page }) => {
    await openApp(page)
    const id = await addScript(page, { code: 'notify("eins")\n' })
    // a team workspace (the store's cloud marker; nothing connects)
    await page.evaluate(() => {
      const c = (window as unknown as { __one: { cloud: { useCloud: { setState: (p: object) => void } } } }).__one.cloud.useCloud
      c.setState({ active: { kind: 'cloud', id: 'team-e2e' }, user: { id: 'u-me', email: 'me@example.com', name: 'Me' } })
    })
    await openScript(page, id)
    await page.getByTestId('sc-run').click()
    const trust = page.getByTestId('sc-dialog-trust')
    await expect(trust).toContainText('notify("eins")')
    await page.getByRole('button', { name: 'Run this version' }).click()
    await expect(page.getByTestId('sc-console')).toHaveAttribute('data-status', 'ok')
    // the same version again: no question
    await page.getByTestId('sc-run').click()
    await expect(page.getByTestId('sc-console')).toHaveAttribute('data-status', 'ok')
    await expect(page.getByTestId('sc-dialog-trust')).toHaveCount(0)
    // someone else changes it
    await wsEval(page, (s, id) => s.upsertScript({ ...s.scripts[id], code: 'notify("zwei")\n' }), id)
    await expect(page.locator('.sc-code__input')).toHaveValue('notify("zwei")\n')
    await page.getByTestId('sc-run').click()
    await expect(page.getByTestId('sc-dialog-trust')).toContainText('notify("zwei")')
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByTestId('sc-console')).toHaveAttribute('data-status', 'cancelled')
    // my own edit is mine: it runs without asking
    await setCode(page, 'notify("drei")\n')
    await page.waitForTimeout(700)
    await page.getByTestId('sc-run').click()
    await expect(page.getByTestId('sc-console')).toHaveAttribute('data-status', 'ok')
    await expect(page.getByTestId('sc-dialog-trust')).toHaveCount(0)
  })

  test('German at phone width: the list, an example query, no sideways scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await makeTasks(page)
    await page.evaluate(() => (window.location.hash = '#/scripts'))
    await expect(page.locator('.sc-title')).toHaveText('Skripte')
    await page.locator('[data-example="query"]').click()
    await expect(page.locator('.sc-code__input')).toBeVisible()
    await expect(page.getByTestId('sc-live-count')).toHaveText(/Ergebnis/)
    await expect(page.getByRole('tab', { name: 'Ergebnis' })).toBeVisible()
    await expect(page.getByTestId('sc-qb')).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    // an error in German
    await setCode(page, 'db(@"Gibt es nicht")')
    await expect(page.locator('.sc-live .sc-err')).toContainText('Seite @Gibt es nicht nicht gefunden')
  })

  test('a reload keeps the scripts and the run log', async ({ page }) => {
    await openApp(page)
    const { dbId } = await makeTasks(page)
    const id = await addScript(page, { code: `print(db(${ref(dbId)}).where(Status = "Offen"))\n`, name: 'Bleibt' })
    await openScript(page, id)
    await page.getByTestId('sc-dry').click()
    await expect(page.getByTestId('sc-console')).toHaveAttribute('data-status', 'ok')
    // a printed list of rows is a small table with links
    await expect(page.locator('.sc-log .sc-table tbody tr')).toHaveCount(3)
    await expect(page.locator('.sc-log .sc-table__link').first()).toHaveAttribute('href', /#\/p\//)
    await page.waitForTimeout(300)
    await reloadApp(page)
    await page.evaluate((id) => (window.location.hash = `#/scripts/${id}`), id)
    await expect(page.locator('.sc-name')).toHaveValue('Bleibt')
    await page.getByRole('tab', { name: 'Run log' }).click()
    await expect(page.getByTestId('sc-runs').locator('.sc-run')).toHaveCount(1)
    await expect(page.getByTestId('sc-runs').locator('.sc-run').first()).toHaveAttribute('data-mode', 'dry')
  })
})
