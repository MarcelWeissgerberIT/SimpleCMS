/**
 * Record types in databases + the FREE BOARD (database/model/recordTypes, views/free): the slash block, lanes
 * (add / rename / reorder / delete with cards), cards of different record types with their own fields, "+"
 * offering the types, moving cards (keyboard drag + Move to), "New record type…", the Type column (filter),
 * the row page's type chip hiding other types' fields, a locked database, 390 px and German.
 */
import type { BrowserContext, Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, gotoPage, editorOf, createPage, doc, para, wsEval, flush } from './fixtures'

// inside wsEval: `s` is the state when the call started — read fresh state after actions with `st()`
declare const st: () => any // eslint-disable-line @typescript-eslint/no-explicit-any

async function boot(page: Page, lang?: 'de') {
  await openApp(page)
  await page.evaluate((lang) => {
    const w = window as unknown as { st: () => unknown; __one: { workspace: { getState: () => { updateSettings: (p: object) => void } } } }
    w.st = () => w.__one.workspace.getState()
    if (lang) w.__one.workspace.getState().updateSettings({ language: lang })
  }, lang)
}

/** Two record types (Lead, Bug) and a free board database holding both, with three cards. */
async function seedBoard(page: Page): Promise<{ dbId: string; acme: string; bug: string; plain: string }> {
  return wsEval(page, (s) => {
    s.upsertRecordType({ id: 'lead', name: 'Lead', color: 'orange', properties: [{ id: 'mail', name: 'Email', type: 'email' }, { id: 'value', name: 'Deal value', type: 'number' }], createdAt: 0, updatedAt: 0 })
    s.upsertRecordType({ id: 'bug', name: 'Bug', color: 'red', properties: [{ id: 'sev', name: 'Severity', type: 'select', options: [{ id: 'p1', name: 'P1', color: 'red' }] }, { id: 'area', name: 'Area', type: 'text' }], createdAt: 0, updatedAt: 0 })
    const lane = { id: 'fbl', name: 'Lane', type: 'select', options: [{ id: 'l1', name: 'Inbox', color: 'gray' }, { id: 'l2', name: 'Doing', color: 'orange' }, { id: 'l3', name: 'Done', color: 'green' }] }
    const dbId = s.createDatabase({
      title: 'Launch board',
      parentId: null,
      properties: [{ id: 'fbt', name: 'Name', type: 'title' }, lane],
      views: [{ id: 'fbv', name: 'Free board', type: 'board', free: true, groupBy: 'fbl', filter: null, sorts: [], visibleProperties: [], openIn: 'peek', hiddenGroups: [] }],
    })
    st().attachRecordType(dbId, 'lead')
    st().attachRecordType(dbId, 'bug')
    const p = (name: string) => st().databases[dbId].properties.find((x: { name: string }) => x.name === name).id
    const acme = st().createRow(dbId, { title: 'ACME', properties: { fbl: 'l1' } })
    st().setRecordType(acme, 'lead')
    st().setRowProperty(acme, p('Email'), 'buy@acme.test')
    const bug = st().createRow(dbId, { title: 'Login loops', properties: { fbl: 'l1' } })
    st().setRecordType(bug, 'bug')
    st().setRowProperty(bug, p('Severity'), 'p1')
    st().setRowProperty(bug, p('Area'), 'Auth')
    const plain = st().createRow(dbId, { title: 'Write post', properties: { fbl: 'l2' } })
    return { dbId, acme, bug, plain }
  })
}

const lane = (page: Page, name: string) => page.locator('.dbb-col', { has: page.locator('.fb-lanehead', { hasText: name }) })
const card = (page: Page, title: string) => page.locator('.dbc', { hasText: title })
const laneOfRow = (page: Page, rowId: string) => wsEval(page, (s, id) => s.pages[id].properties.fbl ?? null, rowId)

test.describe('free board', () => {
  test('slash "/free board" places an inline database with a free board view and its lanes', async ({ page }) => {
    await boot(page)
    const id = await createPage(page, { title: 'Planning', content: doc(para('')) })
    await gotoPage(page, id)
    await editorOf(page).click()
    await page.keyboard.type('/free board')
    await expect(page.locator('.slash__item[aria-selected="true"] .slash__name')).toHaveText('Free board')
    await page.keyboard.press('Enter')
    const block = page.locator('#main .db--inline')
    await expect(block).toBeVisible()
    await expect(block.locator('.fb-lanehead')).toHaveCount(3)
    await expect(block.locator('.fb-lanehead').first()).toContainText('Inbox')
    const db = await wsEval(page, (s, id) => {
      const db = (Object.values(s.databases) as any[]).find((d) => s.pages[d.id]?.parentId === id) // eslint-disable-line @typescript-eslint/no-explicit-any
      const v = db.views[0]
      return { inline: db.inline, free: v.free, type: v.type, lane: db.properties.find((p: { id: string }) => p.id === v.groupBy)?.name }
    }, id)
    expect(db).toEqual({ inline: true, free: true, type: 'board', lane: 'Lane' })
  })

  test('lanes: add, rename, reorder, delete with cards (they move to the lane picked)', async ({ page }) => {
    await boot(page)
    const { dbId, acme, bug } = await seedBoard(page)
    await gotoPage(page, dbId)
    // add
    await page.getByTestId('fb-add-lane').click()
    await page.keyboard.type('Review')
    await page.keyboard.press('Enter')
    await expect(page.locator('.fb-lanehead')).toHaveCount(4)
    await expect(page.locator('.fb-lanehead').nth(3)).toContainText('Review')
    // rename (double-click)
    await page.locator('.fb-lanehead', { hasText: 'Review' }).locator('.fb-lanehead__label').dblclick()
    await page.keyboard.press(`Control+a`)
    await page.keyboard.type('QA')
    await page.keyboard.press('Enter')
    await expect(page.locator('.fb-lanehead').nth(3)).toContainText('QA')
    // reorder: Inbox one to the right
    await page.getByRole('button', { name: 'Lane: Inbox' }).click()
    await page.getByRole('menuitem', { name: 'Move right' }).click()
    await expect(page.locator('.fb-lanehead').nth(0)).toContainText('Doing')
    await expect(page.locator('.fb-lanehead').nth(1)).toContainText('Inbox')
    // delete Inbox (2 cards) → they go to Done
    await page.getByRole('button', { name: 'Lane: Inbox' }).click()
    await page.getByRole('menuitem', { name: 'Delete lane' }).click()
    const dlg = page.getByRole('dialog')
    await expect(dlg).toContainText('2 cards')
    await dlg.getByRole('button', { name: 'Move cards to' }).click()
    await page.getByRole('menuitem', { name: 'Done' }).click()
    await dlg.getByTestId('fb-delete-lane').click()
    await expect(page.locator('.fb-lanehead')).toHaveCount(3)
    expect(await laneOfRow(page, acme)).toBe('l3')
    expect(await laneOfRow(page, bug)).toBe('l3')
    await expect(lane(page, 'Done').locator('.dbc')).toHaveCount(2)
  })

  test('cards show the fields of their own type; "+" offers the types and makes a typed card', async ({ page }) => {
    await boot(page)
    const { dbId } = await seedBoard(page)
    await gotoPage(page, dbId)
    const acme = card(page, 'ACME')
    await expect(acme.locator('.fb-card__type')).toContainText('Lead')
    await expect(acme.locator('.fb-card__fields')).toContainText('buy@acme.test')
    await expect(acme.locator('.fb-card__fields')).not.toContainText('Severity')
    const bug = card(page, 'Login loops')
    await expect(bug.locator('.fb-card__type')).toContainText('Bug')
    await expect(bug.locator('.fb-card__fields')).toContainText('Auth')
    await expect(bug.locator('.fb-card__fields')).not.toContainText('Email')
    await expect(card(page, 'Write post').locator('.fb-card__type')).toHaveCount(0)

    await lane(page, 'Doing').getByTestId('fb-lane-add').click()
    await expect(page.getByRole('menuitem', { name: 'Lead' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Bug' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Plain card' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'New record type…' })).toBeVisible()
    await page.getByRole('menuitem', { name: 'Bug' }).click()
    await page.keyboard.type('Crash on save')
    await page.keyboard.press('Enter')
    await expect(card(page, 'Crash on save').locator('.fb-card__type')).toContainText('Bug')
    const row = await wsEval(page, (s, dbId) => {
      const r = (Object.values(st().pages) as any[]).find((p) => p.databaseId === dbId && p.title === 'Crash on save') // eslint-disable-line @typescript-eslint/no-explicit-any
      return { type: r.recordType, lane: r.properties.fbl }
    }, dbId)
    expect(row).toEqual({ type: 'bug', lane: 'l2' })
  })

  test('"New record type…" from a lane: the type is created, attached and the card carries it', async ({ page }) => {
    await boot(page)
    const { dbId } = await seedBoard(page)
    await gotoPage(page, dbId)
    await lane(page, 'Done').getByTestId('fb-lane-add').click()
    await page.getByRole('menuitem', { name: 'New record type…' }).click()
    const dlg = page.getByRole('dialog')
    await dlg.getByLabel('Name', { exact: true }).fill('Idea')
    await dlg.getByLabel('Field 1').fill('Votes')
    await dlg.getByTestId('rtype-create').click()
    await expect(dlg).toBeHidden()
    await page.keyboard.type('Dark exports')
    await page.keyboard.press('Enter')
    await expect(card(page, 'Dark exports').locator('.fb-card__type')).toContainText('Idea')
    const r = await wsEval(page, (s, dbId) => {
      const rt = (Object.values(st().kit.recordTypes) as any[]).find((x) => x.name === 'Idea') // eslint-disable-line @typescript-eslint/no-explicit-any
      const db = st().databases[dbId]
      return { held: db.recordTypes.includes(rt.id), fields: db.properties.filter((p: { fromType?: { id: string } }) => p.fromType?.id === rt.id).map((p: { name: string }) => p.name) }
    }, dbId)
    expect(r).toEqual({ held: true, fields: ['Votes'] })
  })

  test('cards move between lanes by keyboard drag and by "Move to lane"', async ({ page }) => {
    await boot(page)
    const { dbId, acme, plain } = await seedBoard(page)
    await gotoPage(page, dbId)
    // keyboard: Space lifts, → moves to the next lane, Space drops
    await card(page, 'ACME').focus()
    await page.keyboard.press('Space')
    // the lift lands, then the move, then the drop (dnd-kit's keyboard sensor works frame by frame)
    await expect(card(page, 'ACME').first()).toHaveAttribute('data-dragging', 'true')
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(300)
    await page.keyboard.press('Space')
    await expect.poll(() => laneOfRow(page, acme)).toBe('l2')
    // the card's menu
    await card(page, 'Write post').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Move to lane' }).click()
    await page.getByRole('menuitem', { name: 'Done' }).click()
    await expect.poll(() => laneOfRow(page, plain)).toBe('l3')
    await expect(lane(page, 'Done').locator('.dbc', { hasText: 'Write post' })).toBeVisible()
  })

  test('row page: the type chip; other types\' fields are hidden; changing the type swaps them', async ({ page }) => {
    await boot(page)
    const { acme } = await seedBoard(page)
    await gotoPage(page, acme)
    const props = page.locator('#main .pv-props')
    await expect(props.locator('.rtype-chip')).toContainText('Lead')
    await expect(props.locator('.db-prow__name', { hasText: 'Email' })).toBeVisible()
    await expect(props.locator('.db-prow__name', { hasText: 'Severity' })).toHaveCount(0)
    await props.locator('.rtype-chip').click()
    await page.getByRole('menuitem', { name: 'Bug' }).click()
    await expect(props.locator('.rtype-chip')).toContainText('Bug')
    await expect(props.locator('.db-prow__name', { hasText: 'Severity' })).toBeVisible()
    await expect(props.locator('.db-prow__name', { hasText: 'Email' })).toHaveCount(0)
    // the value stays (hidden, not lost)
    const kept = await wsEval(page, (s, id) => Object.values(st().pages[id].properties).includes('buy@acme.test'), acme)
    expect(kept).toBe(true)
  })

  test('table: the Type column, other types\' cells dim and not editable, filter by type', async ({ page }) => {
    await boot(page)
    const { dbId } = await seedBoard(page)
    await wsEval(page, (s, dbId) => {
      const db = st().databases[dbId]
      st().addView(dbId, { type: 'table', name: 'All', visibleProperties: ['__type__', ...db.properties.filter((p: { type: string }) => p.type !== 'title').map((p: { id: string }) => p.id)] })
    }, dbId)
    await gotoPage(page, dbId)
    await page.getByRole('tab', { name: /All/ }).click()
    const table = page.locator('.dbt')
    await expect(table.locator('[data-hcol="__type__"]')).toContainText('Type')
    const acmeRow = table.locator('.dbt-row', { hasText: 'ACME' })
    await expect(acmeRow.locator('.rtype-tag')).toContainText('Lead')
    const foreign = acmeRow.locator('[data-foreign="true"]').first()
    await expect(foreign).toHaveAttribute('title', 'Not part of Lead')
    await foreign.click()
    await expect(page.locator('.db-pop')).toHaveCount(0)
    // filter by type from the column's menu
    await table.locator('[data-hcol="__type__"] .dbt-hcell__btn').click()
    await page.getByRole('menuitem', { name: 'Filter' }).click()
    const rule = page.locator('.db-frule').first()
    await expect(rule).toBeVisible()
    await wsEval(page, (s, dbId) => {
      const v = st().databases[dbId].views.find((x: { name: string }) => x.name === 'All')
      st().updateView(dbId, v.id, { filter: { id: 'f', op: 'and', items: [{ id: 'r', propertyId: '__type__', operator: 'is', value: 'bug' }] } })
    }, dbId)
    await page.keyboard.press('Escape')
    await expect(table.locator('.dbt-row:not(.dbt-row--head)', { hasText: 'Login loops' })).toBeVisible()
    await expect(table.locator('.dbt-row', { hasText: 'ACME' })).toHaveCount(0)
  })

  test('a locked database: lanes are fixed, cards still move', async ({ page }) => {
    await boot(page)
    const { dbId, acme } = await seedBoard(page)
    await wsEval(page, (s, dbId) => s.updateDatabase(dbId, { locked: true }), dbId)
    await gotoPage(page, dbId)
    await expect(page.getByTestId('fb-add-lane')).toHaveCount(0)
    await page.getByRole('button', { name: 'Lane: Inbox' }).click()
    await expect(page.getByRole('menuitem', { name: 'Rename lane' })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: 'Delete lane' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await lane(page, 'Inbox').getByTestId('fb-lane-add').click()
    await expect(page.getByRole('menuitem', { name: 'New record type…' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await card(page, 'ACME').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Move to lane' }).click()
    await page.getByRole('menuitem', { name: 'Done' }).click()
    await expect.poll(() => laneOfRow(page, acme)).toBe('l3')
  })

  test('390 px: lanes scroll sideways, cards readable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await boot(page)
    const { dbId } = await seedBoard(page)
    await gotoPage(page, dbId)
    const first = card(page, 'ACME')
    await expect(first).toBeVisible()
    const box = await first.boundingBox()
    expect(box!.width).toBeGreaterThan(200)
    expect(box!.x + box!.width).toBeLessThanOrEqual(390)
    const scroll = await page.locator('.dbb').evaluate((el) => el.scrollWidth > el.clientWidth)
    expect(scroll).toBe(true)
    const pageScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
    expect(pageScroll).toBe(true)
  })

  test('German: Freies Board, Spalte, Einfache Karte', async ({ page }) => {
    await boot(page, 'de')
    const { dbId } = await seedBoard(page)
    await gotoPage(page, dbId)
    await page.getByTestId('fb-add-lane').click()
    await expect(page.getByPlaceholder('Name der Spalte')).toBeVisible()
    await page.keyboard.press('Escape')
    await lane(page, 'Inbox').getByTestId('fb-lane-add').click()
    await expect(page.getByRole('menuitem', { name: 'Einfache Karte' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Neuer Datensatz-Typ …' })).toBeVisible()
    await flush(page)
  })

  test('Turn into free board (mocked Claude): preview → apply in one step → Undo removes it again', async ({ page, context }) => {
    const asked: string[] = []
    await mockFreeBoard(context, asked)
    await boot(page)
    // an existing record type: Claude is told about it and reuses it by name
    await wsEval(page, (s) => s.upsertRecordType({ id: 'person', name: 'Person', color: 'blue', properties: [{ id: 'role', name: 'Role', type: 'text' }], createdAt: 0, updatedAt: 0 }))
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    const li = (t: string): JSONContent => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
    const id = await createPage(page, { title: 'Retro', content: doc(para('From the retro:'), { type: 'bulletList', content: [li('Idea: dark mode for exports (12 votes)'), li('Bug: login loops on Safari, P1'), li('Lea — design lead')] }, para('Thanks all.')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p', { hasText: 'From the retro:' }).click()
    await selectRange(page, ed, 'From the retro:', 'Thanks all.')
    const bubble = page.locator('[aria-label="Formatting"]').first()
    await expect(bubble).toBeVisible()
    await bubble.getByRole('button', { name: /^Ask AI$/ }).click()
    const ai = page.locator('.ai-panel')
    await ai.locator('.ai-cmd__input').fill('free board')
    await ai.getByRole('option', { name: /^Turn into free board/ }).click()
    const pv = page.getByTestId('freeboard-preview')
    await expect(pv).toBeVisible()
    await expect(pv.getByTestId('transform-spec')).toContainText('3 lanes · 3 cards · 3 record types')
    await expect(pv.getByTestId('freeboard-type')).toHaveCount(3)
    await expect(pv.getByTestId('freeboard-type').filter({ hasText: 'Person' })).toContainText('Reused')
    // only the selection went out, with the existing types by name; no memory
    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain('Person: Role (text)')
    expect(asked[0]).toContain('login loops')
    expect(asked[0]).not.toContain('<one_memory>')
    await page.keyboard.press('Enter')
    await expect(ai).toHaveCount(0)
    await expect(page.locator('.toast', { hasText: 'Free board — 3 cards in 3 lanes' })).toBeVisible()
    const made = await wsEval(page, (s, id) => {
      const db = (Object.values(st().databases) as any[]).find((d) => st().pages[d.id]?.parentId === id) // eslint-disable-line @typescript-eslint/no-explicit-any
      const rows = (Object.values(st().pages) as any[]).filter((p) => p.databaseId === db.id) // eslint-disable-line @typescript-eslint/no-explicit-any
      const types = st().kit.recordTypes
      return {
        free: db.views[0].free,
        held: db.recordTypes.map((x: string) => types[x].name).sort(),
        cards: rows.map((r) => `${r.title}|${r.recordType ? types[r.recordType].name : '-'}`).sort(),
        origin: rows[0].contentOrigin ?? null,
        dbId: db.id,
      }
    }, id)
    expect(made).toMatchObject({ free: true, held: ['Bug', 'Idea', 'Person'], cards: ['Dark mode for exports|Idea', 'Lea|Person', 'Login loops on Safari|Bug'] })
    // the editor writes the page after its short pause
    await expect.poll(() => wsEval(page, (s, id) => (st().pages[id].content.content as Array<{ type: string }>).map((n) => n.type).slice(0, 3), id)).toEqual(['paragraph', 'databaseBlock', 'paragraph'])
    await expect(page.locator('#main .db--inline .fb-card__type', { hasText: 'Bug' })).toBeVisible()
    // one Undo: text back, board gone, the record types it added gone (the reused one stays)
    await page.locator('.toast', { hasText: 'Free board' }).getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => wsEval(page, (s, dbId) => !!st().pages[dbId], made.dbId)).toBe(false)
    expect(await wsEval(page, () => (Object.values(st().kit.recordTypes) as Array<{ name: string }>).map((x) => x.name).sort())).toEqual(['Person'])
    await expect.poll(() => wsEval(page, (s, id) => (st().pages[id].content.content as Array<{ type: string }>).map((n) => n.type), id)).toContain('bulletList')
  })
})

/** api.anthropic.com → the free board answer (structured output); `asked` collects the prompts. */
async function mockFreeBoard(ctx: BrowserContext, asked: string[]) {
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const body = JSON.parse(req.postData() ?? '{}')
    asked.push(String(body.messages?.[0]?.content ?? '') + JSON.stringify(body.system ?? ''))
    const answer = {
      title: 'Retro',
      lanes: ['Inbox', 'Now', 'Later'],
      types: [
        { name: 'Idea', color: 'green', fields: [{ name: 'Votes', type: 'number' }] },
        { name: 'Bug', color: 'red', fields: [{ name: 'Severity', type: 'select' }] },
        { name: 'person', color: 'blue', fields: [] },
      ],
      cards: [
        { title: 'Dark mode for exports', lane: 'Later', type: 'Idea', values: [{ field: 'Votes', value: '12' }] },
        { title: 'Login loops on Safari', lane: 'Now', type: 'Bug', values: [{ field: 'Severity', value: 'P1' }] },
        { title: 'Lea', lane: 'Inbox', type: 'Person', values: [{ field: 'Role', value: 'Design lead' }] },
      ],
      keep: [1, 3],
      left: [],
    }
    await route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'msg_e2e', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify(answer) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 600, output_tokens: 300 } }),
    })
  })
}

/** Select from the start of `from` to the end of `to` (DOM range — ProseMirror picks it up). */
async function selectRange(page: Page, editor: import('@playwright/test').Locator, from: string, to: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await editor.evaluate(
      (root, [a, b]) => {
        const find = (needle: string) => {
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
          let node: Node | null
          while ((node = walker.nextNode())) {
            const i = (node as Text).data.indexOf(needle)
            if (i >= 0) return { node, i }
          }
          throw new Error(`text not found: ${needle}`)
        }
        const s = find(a)
        const e = find(b)
        const r = document.createRange()
        r.setStart(s.node, s.i)
        r.setEnd(e.node, e.i + b.length)
        const sel = window.getSelection()!
        sel.removeAllRanges()
        sel.addRange(r)
      },
      [from, to] as const,
    )
    await page.waitForTimeout(150)
    const got = await page.evaluate(() => window.getSelection()?.toString() ?? '')
    if (got.startsWith(from) && got.trimEnd().endsWith(to)) return
  }
  throw new Error('selection did not hold')
}
