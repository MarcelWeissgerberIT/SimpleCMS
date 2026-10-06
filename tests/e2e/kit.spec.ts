/**
 * Building blocks (#/kit, features/kit): shared lists (create, paste many lines, reorder by keys, delete an
 * item rows use → replace), "Fill with Claude" (mocked), "Turn into list" from the AI menu, own property
 * types in databases (display, validate refuses, format, options script, value script computes and stays
 * read-only, recomputes after a change, onChange asks before mail), the record type editor (a database
 * holding the type follows), the templates of the script bindings (each runs), 390 px.
 */
import type { BrowserContext, Locator, Page } from '@playwright/test'
import { test, expect, openApp, wsEval, createPage, gotoPage, editorOf, doc, MOD } from './fixtures'

// inside wsEval: `s` is the state when the call started — read fresh state after actions with `st()`
declare const st: () => any // eslint-disable-line @typescript-eslint/no-explicit-any

async function open(page: Page, hash = ''): Promise<void> {
  await openApp(page, hash)
  await page.evaluate(() => {
    const w = window as unknown as { st: () => unknown; __one: { workspace: { getState: () => unknown } } }
    w.st = () => w.__one.workspace.getState()
  })
}

/** api.anthropic.com → one structured JSON answer per request; the request bodies are captured. */
async function mockStructured(ctx: BrowserContext, answer: object): Promise<string[]> {
  const bodies: string[] = []
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    bodies.push(req.postData() ?? '')
    await route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'msg_e2e', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: JSON.stringify(answer) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }),
    })
  })
  return bodies
}

const names = (page: Page, listId: string) => wsEval(page, (_s, id) => (st().kit.lists[id]?.items ?? []).map((o: { name: string }) => o.name), listId)

/** Dispatch a paste of plain text into an element (React reads the native event's clipboardData). */
async function paste(target: Locator, text: string): Promise<void> {
  await target.focus()
  await target.evaluate((el, text) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', text)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, text)
}

/** A database "Ledger" showing title + one property (of an own type when `custom`). */
async function ledger(page: Page, prop: Record<string, unknown>, rows: Array<{ title: string; value?: unknown }>, more: Array<Record<string, unknown>> = []): Promise<{ dbId: string; propId: string; rowIds: string[]; more: string[] }> {
  return wsEval(
    page,
    (s, a) => {
      const dbId = s.createDatabase({ title: 'Ledger', parentId: null })
      const propId = s.addProperty(dbId, a.prop)
      const more = a.more.map((m: Record<string, unknown>) => s.addProperty(dbId, m))
      const d = st().databases[dbId]
      const title = d.properties.find((p: { type: string }) => p.type === 'title').id
      s.updateView(dbId, d.views[0].id, { visibleProperties: [title, propId, ...more] })
      const rowIds = a.rows.map((r: { title: string; value?: unknown }) => s.createRow(dbId, { title: r.title, properties: r.value === undefined ? {} : { [propId]: r.value } }))
      return { dbId, propId, rowIds, more }
    },
    { prop, rows, more },
  )
}

const cell = (page: Page, row: number, col: number) => page.locator(`#main section.db [role="gridcell"][data-cell="${row}:${col}"]`)
const rowValue = (page: Page, rowId: string, propId: string) => wsEval(page, (_s, a) => st().pages[a.rowId]?.properties[a.propId] ?? null, { rowId, propId })

test.describe('building blocks — #/kit', () => {
  test('lists: create, rename, paste many lines, add, reorder with Alt+↓, delete an item rows use → replace', async ({ page }) => {
    await open(page, '#/kit')
    await expect(page.getByTestId('kt-empty')).toBeVisible()
    await page.getByTestId('kt-new').click()
    await expect(page.getByTestId('kt-list-editor')).toBeVisible()
    const name = page.getByTestId('kt-name')
    await name.fill('Federal states')
    await name.press('Enter')
    const listId = await wsEval(page, () => Object.values(st().kit.lists).find((l: any) => l.name === 'Federal states')?.id as string) // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(listId).toBeTruthy()
    await expect(page).toHaveURL(new RegExp(`#/kit/lists/${listId}$`))

    // paste three lines (bullets and numbers are dropped), then type one more
    await paste(page.getByTestId('kt-item-add'), '- Bayern\n2. Berlin\n\nBremen\n')
    await expect.poll(() => names(page, listId)).toEqual(['Bayern', 'Berlin', 'Bremen'])
    await page.getByTestId('kt-item-add').fill('Hamburg')
    await page.getByTestId('kt-item-add').press('Enter')
    await expect.poll(() => names(page, listId)).toEqual(['Bayern', 'Berlin', 'Bremen', 'Hamburg'])
    await expect(page.getByTestId('kt-item-count')).toHaveText('04')

    // Alt+↓ moves the focused item down
    await page.locator('.kt-item__name').first().focus()
    await page.keyboard.press('Alt+ArrowDown')
    await expect.poll(() => names(page, listId)).toEqual(['Berlin', 'Bayern', 'Bremen', 'Hamburg'])

    // a database property bound to the list; one row holds "Berlin"
    const r = await wsEval(
      page,
      (_s, id) => {
        const s = st()
        const dbId = s.createDatabase({ title: 'Branches', parentId: null })
        const list = s.kit.lists[id]
        const propId = s.addProperty(dbId, { type: 'select', name: 'State', listId: id, options: list.items })
        const berlin = list.items.find((o: { name: string }) => o.name === 'Berlin').id
        const rowId = s.createRow(dbId, { title: 'Spree office', properties: { [propId]: berlin } })
        return { propId, rowId, bayern: list.items.find((o: { name: string }) => o.name === 'Bayern').id }
      },
      listId,
    )
    // the list shows where it is used
    await expect(page.locator('.kt-used__link', { hasText: 'Branches' })).toBeVisible()

    // removing "Berlin" asks: used in 1 row → replace with Bayern
    await page.locator('.kt-item', { has: page.locator('input[value="Berlin"]') }).getByTestId('kt-item-remove').click()
    await expect(page.getByTestId('kt-item-confirm')).toContainText('Used in 1 rows')
    await page.getByTestId('kt-item-replace-pick').click()
    await page.getByRole('menuitem', { name: 'Bayern' }).click()
    await page.getByTestId('kt-item-replace').click()
    await expect.poll(() => names(page, listId)).toEqual(['Bayern', 'Bremen', 'Hamburg'])
    expect(await rowValue(page, r.rowId, r.propId)).toBe(r.bayern)
    // the bound property followed
    const opts = await wsEval(page, (_s, a) => (Object.values(st().databases) as any[]).flatMap((d) => d.properties).find((p: { id: string }) => p.id === a.propId).options.map((o: { name: string }) => o.name), r) // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(opts).toEqual(['Bayern', 'Bremen', 'Hamburg'])
  })

  test('Fill with Claude: only the request goes out; proposals are ticked, one unticked, the rest added', async ({ page, context }) => {
    const bodies = await mockStructured(context, { items: [{ name: 'EUR', color: 'blue' }, { name: 'USD', color: 'green' }, { name: 'GBP', color: 'default' }, { name: 'CHF', color: 'red' }] })
    await open(page)
    const id = await wsEval(page, (s) => {
      s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' })
      s.upsertList({ id: 'cur', name: 'Currencies', items: [{ id: 'chf', name: 'CHF', color: 'red' }], createdAt: 1, updatedAt: 1 })
      return 'cur'
    })
    await page.evaluate((id) => (window.location.hash = `#/kit/lists/${id}`), id)
    await expect(page.getByTestId('kt-fill')).toBeVisible()
    await page.getByTestId('kt-fill-prompt').fill('ISO currencies of the G7')
    await page.getByTestId('kt-fill-ask').click()
    const proposals = page.getByTestId('kt-proposals')
    // CHF is already in the list: not proposed again
    await expect(proposals.locator('.kt-proposal')).toHaveCount(3)
    await proposals.locator('.kt-proposal', { hasText: 'GBP' }).click()
    await page.getByTestId('kt-fill-apply').click()
    await expect.poll(() => names(page, 'cur')).toEqual(['CHF', 'EUR', 'USD'])
    expect(bodies).toHaveLength(1)
    const sent = JSON.parse(bodies[0])
    const prompt = String(sent.messages[0].content)
    expect(prompt).toContain('ISO currencies of the G7')
    expect(prompt).not.toContain('<page>')
    expect(JSON.stringify(sent.output_config?.format ?? {})).toContain('"items"')
  })

  test('Turn into list (AI menu): list items of a selection → preview → a shared list', async ({ page }) => {
    await open(page)
    // the AI menu opens on its actions with a key; this one sends nothing
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    const id = await createPage(page, {
      title: 'Cost centres',
      content: doc(
        { type: 'paragraph', content: [{ type: 'text', text: 'Our cost centres:' }] },
        { type: 'bulletList', content: ['4711 Marketing', '4712 Sales', '4713 Support'].map((text) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })) },
      ),
    })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('li', { hasText: '4711 Marketing' }).click()
    await ed.evaluate((root) => {
      const lis = root.querySelectorAll('li')
      const r = document.createRange()
      r.setStart(lis[0].querySelector('p')!.firstChild!, 0)
      const last = lis[lis.length - 1].querySelector('p')!.firstChild as Text
      r.setEnd(last, last.data.length)
      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(r)
    })
    await page.waitForTimeout(250)
    const bubble = page.locator('[aria-label="Formatting"]').first()
    await expect(bubble).toBeVisible()
    await bubble.getByRole('button', { name: /^Ask AI$/ }).click()
    const ai = page.locator('.ai-panel')
    await expect(ai).toBeVisible()
    await ai.locator('#ai-row-more').click()
    await ai.locator('#ai-row-tolist').click()
    await expect(page.getByTestId('kt-tolist-items').locator('.kt-proposal')).toHaveCount(3)
    await page.getByTestId('kt-tolist-name').fill('Cost centres')
    await page.getByTestId('kt-tolist-create').click()
    await expect
      .poll(() => wsEval(page, () => (Object.values(st().kit.lists) as any[]).map((l) => `${l.name}: ${l.items.map((o: { name: string }) => o.name).join(', ')}`))) // eslint-disable-line @typescript-eslint/no-explicit-any
      .toEqual(['Cost centres: 4711 Marketing, 4712 Sales, 4713 Support'])
  })

  test('own type in a database: display, validate refuses (not written), format text; picker offers own types', async ({ page }) => {
    await open(page)
    await wsEval(page, (s) =>
      s.upsertPropType({
        id: 'iban',
        name: 'IBAN',
        base: 'text',
        display: { prefix: '№', style: 'badge', color: 'blue' },
        scripts: {
          validate: 'let answer = true\nif value and len(replace(value, " ", "")) < 15 {\n  answer = "Not a valid IBAN"\n}\nanswer',
          format: 'upper(text(value))',
        },
        createdAt: 1,
        updatedAt: 1,
      }),
    )
    const { dbId, propId, rowIds } = await ledger(page, { type: 'text', name: 'IBAN', custom: 'iban' }, [{ title: 'ACME', value: 'de89370400440532013000' }, { title: 'Empty' }])
    await gotoPage(page, dbId)
    // display (prefix, badge) + the format script's text
    await expect(cell(page, 0, 1).locator('.kt-val--badge')).toContainText('№')
    await expect(cell(page, 0, 1)).toContainText('DE89370400440532013000')

    // too short: refused at the cell, nothing written
    await cell(page, 1, 1).click()
    await page.keyboard.type('DE12')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('kt-refusal')).toContainText('Not a valid IBAN')
    await page.waitForTimeout(300)
    expect(await rowValue(page, rowIds[1], propId)).toBeNull()
    // a valid one is written
    await cell(page, 1, 1).click()
    await page.keyboard.type('DE02120300000000202051')
    await page.keyboard.press('Enter')
    await expect.poll(() => rowValue(page, rowIds[1], propId)).toBe('DE02120300000000202051')

    // the type picker of a new column offers it under "Building blocks"
    await page.locator('#main section.db .dbt-hcell--add button').first().click()
    await expect(page.getByRole('menuitem', { name: /^IBAN/ })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /Bind to a list/ })).toHaveCount(0)
    await page.getByRole('menuitem', { name: /^IBAN/ }).click()
    const added = await wsEval(page, (_s, dbId) => st().databases[dbId].properties.filter((p: { custom?: string }) => p.custom === 'iban').length, dbId)
    expect(added).toBe(2)
  })

  test('value script computes, stays read-only (ƒ) and recomputes after a change; options script feeds the picker', async ({ page }) => {
    await open(page)
    await wsEval(page, (s) => {
      s.upsertPropType({ id: 'light', name: 'Light', base: 'select', scripts: { value: 'let n = row.Score\nlet light = null\nif n != null {\n  light = "Green"\n  if n < 40 { light = "Red" }\n}\nlight' }, createdAt: 1, updatedAt: 1 })
      s.upsertPropType({ id: 'prio', name: 'Prio', base: 'select', scripts: { options: '[{name: "Low", color: "gray"}, {name: "High", color: "red"}]' }, createdAt: 2, updatedAt: 2 })
    })
    const { dbId, propId, rowIds, more } = await ledger(page, { type: 'select', name: 'Light', custom: 'light', options: [] }, [{ title: 'A' }, { title: 'B' }], [{ type: 'number', name: 'Score' }, { type: 'select', name: 'Prio', custom: 'prio', options: [] }])
    await wsEval(page, (_s, a) => {
      st().setRowProperty(a.rowIds[0], a.more[0], 80)
      st().setRowProperty(a.rowIds[1], a.more[0], 20)
    }, { rowIds, more })
    await gotoPage(page, dbId)
    const optionName = (rowId: string) => wsEval(page, (_s, a) => {
      const def = st().databases[a.dbId].properties.find((p: { id: string }) => p.id === a.propId)
      return def.options.find((o: { id: string }) => o.id === st().pages[a.rowId].properties[a.propId])?.name ?? null
    }, { dbId, propId, rowId })
    await expect.poll(() => optionName(rowIds[0])).toBe('Green')
    await expect.poll(() => optionName(rowIds[1])).toBe('Red')
    await expect(cell(page, 0, 1)).toContainText('Green')
    await expect(cell(page, 0, 1).locator('.kt-fx')).toBeVisible()
    await expect(cell(page, 0, 1)).toHaveAttribute('data-readonly', 'true')

    // a change of the row → recomputed
    await wsEval(page, (_s, a) => st().setRowProperty(a.rowIds[1], a.more[0], 95), { rowIds, more })
    await expect.poll(() => optionName(rowIds[1])).toBe('Green')

    // options script: the picker offers Low / High, a pick adds the option to the property
    await cell(page, 0, 3).click()
    const picker = page.locator('.db-picker')
    await expect(picker.locator('.db-opt')).toHaveCount(2)
    await picker.locator('.db-opt', { hasText: 'High' }).click()
    await expect.poll(() => wsEval(page, (_s, a) => {
      const def = st().databases[a.dbId].properties.find((p: { id: string }) => p.id === a.prio)
      return def.options.find((o: { id: string }) => o.id === st().pages[a.row].properties[a.prio])?.name ?? null
    }, { dbId, prio: more[1], row: rowIds[0] })).toBe('High')
  })

  test('onChange runs after a change and asks before mail leaves One', async ({ page }) => {
    await open(page)
    await wsEval(page, (s) => s.upsertPropType({ id: 'stage', name: 'Stage', base: 'text', scripts: { onChange: 'mail.send(to: "team@example.com", subject: "{row.title} changed", body: "{old} → {value}")' }, createdAt: 1, updatedAt: 1 }))
    const { dbId, propId, rowIds } = await ledger(page, { type: 'text', name: 'Stage', custom: 'stage' }, [{ title: 'Deal', value: 'Lead' }])
    await gotoPage(page, dbId)
    await cell(page, 0, 1).click()
    await page.keyboard.press('Enter')
    await page.keyboard.press(`${MOD}+A`)
    await page.keyboard.type('Won')
    await page.keyboard.press('Enter')
    await expect.poll(() => rowValue(page, rowIds[0], propId)).toBe('Won')
    const plan = page.getByTestId('sc-dialog-plan')
    await expect(plan).toBeVisible()
    await expect(plan).toContainText('team@example.com')
    await page.keyboard.press('Escape')
    await expect(plan).toHaveCount(0)
  })

  test('record type editor: properties from standard / own types and lists; saving brings a database holding it in step', async ({ page }) => {
    await open(page)
    const { dbId } = await wsEval(page, (s) => {
      s.upsertList({ id: 'prio', name: 'Priority', items: [{ id: 'a', name: 'A', color: 'red' }], createdAt: 1, updatedAt: 1 })
      s.upsertRecordType({ id: 'bug', name: 'Bug', properties: [{ id: 'sev', name: 'Severity', type: 'select', listId: 'prio' }], createdAt: 1, updatedAt: 1 })
      const dbId = s.createDatabase({ title: 'Tracker', parentId: null })
      st().attachRecordType(dbId, 'bug')
      return { dbId }
    })
    await page.evaluate(() => (window.location.hash = '#/kit/records/bug'))
    const editor = page.getByTestId('kt-record-editor')
    await expect(editor).toBeVisible()
    await expect(editor.locator('.kt-used__link', { hasText: 'Tracker' })).toBeVisible()
    await page.getByTestId('kt-record-add-prop').click()
    await page.getByRole('menuitem', { name: 'Email', exact: true }).click()
    await editor.locator('.kt-rprop__name').last().fill('Reporter')
    await page.getByTestId('kt-record-content').fill('## Steps\n- [ ] reproduce')
    await page.getByTestId('kt-save').click()
    await expect
      .poll(() => wsEval(page, (_s, id) => st().databases[id].properties.filter((p: { fromType?: unknown }) => p.fromType).map((p: { name: string; type: string }) => `${p.name}:${p.type}`), dbId))
      .toEqual(['Severity:select', 'Reporter:email'])
    const content = await wsEval(page, () => JSON.stringify(st().kit.recordTypes.bug.content))
    expect(content).toContain('taskList')
  })

  test('own type editor: base fixed, display preview, binding templates run on a row; 390 px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await open(page, '#/kit/types')
    await page.getByTestId('kt-new').click()
    await page.getByRole('menuitem', { name: 'Text', exact: true }).click()
    const ed = page.getByTestId('kt-type-editor')
    await expect(ed).toBeVisible()
    await expect(page.getByTestId('kt-base')).toContainText('TEXT')
    await page.getByTestId('kt-suffix').fill('kg')
    await expect(page.getByTestId('kt-preview')).toContainText('kg')
    // the index gives way to the editor at phone width
    await expect(page.locator('.kt-index')).toBeHidden()
    // validate template: IBAN — refuses a bad value on a seeded row
    await page.getByTestId('kt-binding-validate').click()
    await page.getByTestId('kt-templates').click()
    await page.getByRole('menuitem', { name: 'IBAN check' }).click()
    await page.getByTestId('kt-test-value').fill('DE00 1234')
    await page.getByTestId('kt-test-run').click()
    await expect(page.getByTestId('kt-test-result')).toContainText('Refused: Not a valid IBAN')
    await page.getByTestId('kt-test-value').fill('DE89 3704 0044 0532 0130 00')
    await page.getByTestId('kt-test-run').click()
    await expect(page.getByTestId('kt-test-result')).toContainText('Accepted')
    // format template
    await page.getByTestId('kt-binding-format').click()
    await page.getByTestId('kt-templates').click()
    await page.getByRole('menuitem', { name: 'Groups of four (IBAN)' }).click()
    await page.getByTestId('kt-test-value').fill('de89370400440532013000')
    await page.getByTestId('kt-test-run').click()
    await expect(page.getByTestId('kt-test-result')).toContainText('DE89 3704 0044 0532 0130 00')
    // save: the draft goes into the store with its scripts
    await page.getByTestId('kt-save').click()
    await expect
      .poll(() => wsEval(page, () => (Object.values(st().kit.propTypes) as any[]).map((t) => `${t.base}:${t.display?.suffix}:${Object.keys(t.scripts ?? {}).sort().join('+')}`))) // eslint-disable-line @typescript-eslint/no-explicit-any
      .toEqual(['text:kg:format+validate'])
  })
})
