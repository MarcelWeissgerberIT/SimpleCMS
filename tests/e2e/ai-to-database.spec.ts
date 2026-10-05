/**
 * "Turn into database" in the AI menu: select a structured report → Claude (mocked: one structured-output
 * answer, never api.anthropic.com) → preview in the panel (counts, columns, group by, view) → Convert →
 * an inline board / table with the rows; kept blocks stay as they were; ⌘Z brings the text back in one
 * step. All data here is fictional.
 */
import type { BrowserContext, Locator, Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, gotoPage, createPage, wsEval, editorOf, doc, para, heading, MOD } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/* ------------------------------------------------------------------ */
/* Fictional report                                                    */
/* ------------------------------------------------------------------ */

interface Item {
  ref: string
  type: 'Bug' | 'Ticket' | 'Spike'
  text: string
  status: string
  assignee: string | null
  tags?: string[]
}

const TOPICS: Array<{ name: string; items: Item[] }> = [
  {
    name: 'API v1 and migration',
    items: [
      { ref: '/r/101', type: 'Bug', text: 'v1 result routes registered twice, 500 AmbiguousMatchException', status: 'In Progress', assignee: 'Lea Brandt' },
      { ref: '/r/102', type: 'Ticket', text: 'v1 has no audit area (GxP)', status: 'Open', assignee: 'Tom Weber' },
      { ref: '/r/103', type: 'Spike', text: 'port the detail page to the REST framework', status: 'Todo', assignee: 'Tom Weber' },
    ],
  },
  {
    name: 'Results and calibration',
    items: [
      { ref: '/r/104', type: 'Bug', text: 'NominalConcentration dropped, no calibration curve', status: 'In Progress', assignee: 'Tom Weber', tags: ['waiting-for-qa', 'dor-incomplete'] },
      { ref: '/r/105', type: 'Ticket', text: 'export results as CSV', status: 'Open', assignee: 'Mia Roth' },
      { ref: '/r/106', type: 'Bug', text: 'rounding differs between list and detail', status: 'Todo', assignee: 'Mia Roth' },
    ],
  },
  {
    name: 'Permissions',
    items: [
      { ref: '/r/107', type: 'Ticket', text: 'role editor for lab leads', status: 'Open', assignee: 'Jan Vogel' },
      { ref: '/r/108', type: 'Bug', text: 'viewers can open the export dialog', status: 'In Progress', assignee: 'Jan Vogel', tags: ['security'] },
      { ref: '/r/109', type: 'Spike', text: 'single sign-on for partner labs', status: 'Todo', assignee: 'Lea Brandt' },
    ],
  },
  {
    name: 'Search',
    items: [
      { ref: '/r/110', type: 'Bug', text: 'umlauts break the sample search', status: 'Open', assignee: null },
      { ref: '/r/111', type: 'Ticket', text: 'save search filters per user', status: 'Todo', assignee: 'Mia Roth' },
    ],
  },
  {
    name: 'Performance',
    items: [
      { ref: '/r/112', type: 'Bug', text: 'result list takes 9 s with 5,000 rows', status: 'Open', assignee: null },
      { ref: '/r/113', type: 'Spike', text: 'cache calibration curves', status: 'Todo', assignee: null },
    ],
  },
  {
    name: 'Documentation',
    items: [
      { ref: '/r/114', type: 'Ticket', text: 'describe the v2 import format', status: 'Open', assignee: 'Lea Brandt' },
      { ref: '/r/115', type: 'Ticket', text: 'update the GxP validation guide', status: 'In Progress', assignee: 'Tom Weber', tags: ['waiting-for-qa'] },
      { ref: '/r/116', type: 'Spike', text: 'generate API docs from the routes', status: 'Todo', assignee: 'Jan Vogel' },
    ],
  },
]

const ALL_ITEMS = TOPICS.flatMap((t) => t.items)
const TITLE = 'Project Delta: open high-priority items'
const INTRO = 'Pasted from the knowledge base on Monday.'
const SOURCE = 'Source: knowledge base, projects "Delta Core" and "Delta UI". 16 items, grouped by topic.'
const AFTER = 'Written by the release team.'

const text = (s: string): JSONContent => ({ type: 'text', text: s })
const li = (...content: JSONContent[]): JSONContent => ({ type: 'listItem', content })
const itemLine = (i: Item) => `${i.ref} ${i.type}: ${i.text}. ${i.status} · ${i.assignee ?? 'unassigned'}${i.tags ? ` (Tags: ${i.tags.join(', ')})` : ''}`

function reportDoc(): JSONContent {
  return doc(
    para(INTRO),
    heading(2, TITLE),
    para(SOURCE),
    {
      type: 'orderedList',
      attrs: { start: 1 },
      content: TOPICS.map((t) => li(para(t.name), { type: 'bulletList', content: t.items.map((i) => li({ type: 'paragraph', content: [text(itemLine(i))] })) })),
    },
    heading(3, 'Notes'),
    { type: 'bulletList', content: [li(para('Three items have no assignee: /r/110, /r/112, /r/113.')), li(para('Next review on Friday.'))] },
    para(AFTER),
  )
}

/** The structured answer Claude would give for the report (keep: intro, source line, Notes heading + list). */
function reportAnswer(): object {
  const opt = (list: Array<string | null>) => [...new Set(list.filter((x): x is string => !!x))]
  return {
    title: TITLE,
    columns: [
      { name: 'Topic', type: 'select', options: TOPICS.map((t) => t.name) },
      { name: 'Type', type: 'select', options: ['Bug', 'Ticket', 'Spike'] },
      { name: 'Ref', type: 'text', options: [] },
      { name: 'Status', type: 'select', options: opt(ALL_ITEMS.map((i) => i.status)) },
      { name: 'Assignee', type: 'select', options: opt(ALL_ITEMS.map((i) => i.assignee)) },
      { name: 'Tags', type: 'multi_select', options: opt(ALL_ITEMS.flatMap((i) => i.tags ?? [])) },
    ],
    entries: TOPICS.flatMap((t) =>
      t.items.map((i) => ({
        title: i.text,
        values: [
          { column: 'Topic', value: t.name },
          { column: 'Type', value: i.type },
          { column: 'Ref', value: i.ref },
          { column: 'Status', value: i.status },
          // what a model might still send for "unassigned": the parser treats it as empty
          { column: 'Assignee', value: i.assignee ?? 'unassigned' },
          ...(i.tags ? [{ column: 'Tags', value: i.tags }] : []),
        ],
        body: null,
      })),
    ),
    groupBy: 'Topic',
    // B1 intro, B3 source line, B5 "Notes", B6 the notes list (+ an unknown number, ignored)
    keep: [1, 3, 5, 6, 42],
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

interface Captured {
  body: AnyState
  prompt: string
}

/** api.anthropic.com → one structured-output message per request (non-streaming JSON). */
async function mockClaude(ctx: BrowserContext, answer: () => object = reportAnswer): Promise<Captured[]> {
  const captured: Captured[] = []
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const body = JSON.parse(req.postData() ?? '{}')
    captured.push({ body, prompt: String(body.messages?.[0]?.content ?? '') })
    await route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'msg_e2e', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify(answer()) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 900, output_tokens: 700 } }),
    })
  })
  return captured
}

const setKey = (page: Page, language?: 'de') => wsEval(page, (s, lang) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', ...(lang ? { language: lang } : {}) }), language)
const panel = (page: Page) => page.locator('.ai-panel')
const preview = (page: Page) => page.getByTestId('todb-preview')

/** Select from the start of `from` to the end of `to` (DOM range — ProseMirror picks it up). */
async function selectRange(page: Page, editor: Locator, from: string, to: string): Promise<void> {
  const select = () =>
    editor.evaluate(
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
  for (let attempt = 0; attempt < 5; attempt++) {
    await select()
    await page.waitForTimeout(150)
    const got = await page.evaluate(() => window.getSelection()?.toString() ?? '')
    if (got.startsWith(from) && got.trimEnd().endsWith(to)) return
  }
  throw new Error('selection did not hold')
}

/** Open the AI menu on the current selection (bubble toolbar → Ask AI / KI fragen). */
async function askAI(page: Page, name: RegExp = /^(Ask AI|KI fragen)$/): Promise<Locator> {
  const bubble = page.locator('[aria-label="Formatting"], [aria-label="Formatierung"]').first()
  await expect(bubble).toBeVisible()
  await bubble.getByRole('button', { name }).click()
  await expect(panel(page)).toBeVisible()
  return panel(page)
}

/** A page with the report, the report selected (intro … notes) and the AI menu open. */
async function openOnReport(page: Page, title = 'Delta report'): Promise<{ id: string; ai: Locator }> {
  const id = await createPage(page, { title, content: reportDoc() })
  await gotoPage(page, id)
  const ed = editorOf(page, id)
  await ed.locator('p', { hasText: INTRO }).click()
  await selectRange(page, ed, INTRO, 'Next review on Friday.')
  const ai = await askAI(page)
  return { id, ai }
}

const contentOf = (page: Page, id: string) => wsEval(page, (s, id) => JSON.parse(JSON.stringify(s.pages[id]?.content ?? null)), id)
const topTypes = (page: Page, id: string) => wsEval(page, (s, id) => ((s.pages[id]?.content?.content ?? []) as AnyState[]).map((n) => n.type), id)
const dbOn = (page: Page, id: string) =>
  wsEval(page, (s, id) => {
    const node = ((s.pages[id]?.content?.content ?? []) as AnyState[]).find((n) => n.type === 'databaseBlock')
    const dbId = node?.attrs?.databaseId
    if (!dbId) return null
    const rows = (Object.values(s.pages) as AnyState[]).filter((p) => p.databaseId === dbId).sort((a, b) => a.order - b.order)
    return JSON.parse(JSON.stringify({ id: dbId, page: s.pages[dbId], db: s.databases[dbId], rows }))
  }, id)

/* ------------------------------------------------------------------ */

test.describe('Turn into database (AI menu)', () => {
  test('report → preview (counts, columns, group by) → Enter → board with 6 groups and 16 cards, kept text around it; ⌘Z restores the text in one step', async ({ page, context }) => {
    const reqs = await mockClaude(context)
    await openApp(page)
    await setKey(page)
    const { id, ai } = await openOnReport(page)
    const before = await contentOf(page, id)

    // the action, found by its keyword; Enter runs it
    await ai.locator('.ai-cmd__input').fill('kanban')
    const action = ai.getByRole('option', { name: /Turn into database/ })
    await expect(action).toBeVisible()
    await expect(action).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Enter')

    // preview: spec line, title, columns, group by, Board pressed, 5 sample rows + "+11 more", what stays
    const pv = preview(page)
    await expect(pv).toBeVisible()
    await expect(page.getByTestId('todb-spec')).toHaveText('16 entries · 6 columns · 4 blocks kept')
    await expect(pv.getByLabel('Title')).toHaveValue(TITLE)
    await expect(pv.getByTestId('todb-col').locator('.todb__name')).toHaveText(['Topic', 'Type', 'Ref', 'Status', 'Assignee', 'Tags'])
    await expect(pv.getByTestId('todb-col').first()).toContainText('Select · 6')
    await expect(pv.getByLabel('Group by')).toHaveValue('Topic')
    await expect(pv.getByRole('button', { name: 'Board' })).toHaveAttribute('aria-pressed', 'true')
    await expect(pv.locator('tbody tr')).toHaveCount(5)
    await expect(pv).toContainText('+11 more')
    await expect(page.getByTestId('todb-kept').locator('li')).toHaveText([/Pasted from the knowledge base/, /^¶\s*Source: knowledge base/, /Notes/, /Three items have no assignee/])
    // "unassigned" is no value
    await expect(pv.locator('tbody tr').nth(0)).toContainText('Lea Brandt')
    await expect(ai.getByRole('option', { name: /Convert/ })).toContainText('BOARD')

    // one request: structured output, the numbered blocks, no MCP server
    expect(reqs).toHaveLength(1)
    const req = reqs[0]
    expect(req.body.output_config.format.type).toBe('json_schema')
    expect(req.body.output_config.format.schema.additionalProperties).toBe(false)
    expect(req.body.mcp_servers).toBeUndefined()
    expect(req.body.tools).toBeUndefined()
    expect(req.prompt).toContain(`[B1] ${INTRO}`)
    expect(req.prompt).toContain(`[B2] ## ${TITLE}`)
    expect(req.prompt).toMatch(/\[B4\] 1\. API v1 and migration/)
    expect(req.prompt).toContain('/r/116')
    expect(req.prompt).toMatch(/\[B6\] - Three items have no assignee/)
    expect(req.prompt).not.toContain(AFTER)

    // Enter in the prompt converts (keyboard only)
    await page.keyboard.press('Enter')
    await expect(panel(page)).toHaveCount(0)
    await expect(page.locator('.toast').filter({ hasText: 'Converted to database · 16 entries' })).toBeVisible()

    // the page: intro, the database where the title heading was, then the kept blocks, the rest untouched
    await expect.poll(() => topTypes(page, id)).toEqual(['paragraph', 'databaseBlock', 'paragraph', 'heading', 'bulletList', 'paragraph'])
    const after = await contentOf(page, id)
    expect(after.content[0]).toEqual(before.content[0])
    expect(after.content[2]).toEqual(before.content[2])
    expect(after.content[3]).toEqual(before.content[4])
    expect(after.content[4]).toEqual(before.content[5])
    expect(after.content[5]).toEqual(before.content[6])

    // the database: inline under this page, board first (grouped by Topic), rows in order with converted values
    const got = await dbOn(page, id)
    expect(got).not.toBeNull()
    expect(got.page).toMatchObject({ kind: 'database', parentId: id, title: TITLE })
    expect(got.db.inline).toBe(true)
    const props = Object.fromEntries((got.db.properties as AnyState[]).map((p) => [p.name, p]))
    expect(Object.keys(props)).toEqual(['Name', 'Topic', 'Type', 'Ref', 'Status', 'Assignee', 'Tags'])
    expect(props.Name.type).toBe('title')
    expect(props.Topic.type).toBe('select')
    expect(props.Topic.options.map((o: AnyState) => o.name)).toEqual(TOPICS.map((t) => t.name))
    expect(new Set(props.Topic.options.map((o: AnyState) => o.color)).size).toBe(6)
    expect(props.Ref.type).toBe('text')
    expect(props.Tags.type).toBe('multi_select')
    expect(got.db.views.map((v: AnyState) => v.type)).toEqual(['board', 'table'])
    expect(got.db.views[0].groupBy).toBe(props.Topic.id)
    expect(got.rows.map((r: AnyState) => r.title)).toEqual(ALL_ITEMS.map((i) => i.text))
    const r104 = got.rows[3]
    expect(r104.properties[props.Ref.id]).toBe('/r/104')
    expect(r104.properties[props.Tags.id]).toHaveLength(2)
    const optName = (p: AnyState, v: string) => p.options.find((o: AnyState) => o.id === v)?.name
    expect(optName(props.Topic, r104.properties[props.Topic.id])).toBe('Results and calibration')
    expect(optName(props.Assignee, r104.properties[props.Assignee.id])).toBe('Tom Weber')
    expect(got.rows[9].properties[props.Assignee.id]).toBeUndefined()

    // on the page: a board with 6 groups and 16 cards — every entry has a topic, so no empty "No value" column
    const board = page.locator('#main section.db').first()
    const groups = board.locator('.dbb-col').filter({ has: page.locator('.dbc') })
    await expect(groups).toHaveCount(6)
    await expect(board.locator('.dbb-col')).toHaveCount(6)
    await expect(groups.locator('.dbb-col__head')).toContainText([...TOPICS.map((t) => t.name)])
    await expect(board.locator('.dbb-col .dbc')).toHaveCount(16)

    // ⌘Z: the text is back in one step
    await editorOf(page, id).locator('p', { hasText: AFTER }).click()
    await page.keyboard.press(`${MOD}+z`)
    await expect.poll(() => topTypes(page, id)).toEqual(['paragraph', 'heading', 'paragraph', 'orderedList', 'heading', 'bulletList', 'paragraph'])
    const undone = await contentOf(page, id)
    expect(JSON.stringify(undone.content.map((n: AnyState) => n.content))).toEqual(JSON.stringify(before.content.map((n: AnyState) => n.content)))
    await expect(editorOf(page, id)).toContainText('/r/113 Spike: cache calibration curves')
  })

  test('drop a column and switch to Table → a table first, without the column; the toast Undo takes the text back and removes the database', async ({ page, context }) => {
    await mockClaude(context)
    await openApp(page)
    await setKey(page)
    const { id, ai } = await openOnReport(page, 'Delta table')
    await ai.getByRole('option', { name: /Turn into database/ }).click()
    const pv = preview(page)
    await expect(pv).toBeVisible()

    // Tags off: the spec line and the sample follow; group column off → no grouping, Board unavailable
    await pv.getByRole('switch', { name: 'Keep column “Tags”' }).click()
    await expect(page.getByTestId('todb-spec')).toHaveText('16 entries · 5 columns · 4 blocks kept')
    await expect(pv.locator('thead th')).toHaveText(['Name', 'Topic', 'Type', 'Ref', 'Status', 'Assignee'])
    await pv.getByRole('button', { name: 'Table' }).click()
    await expect(pv.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true')
    await expect(ai.getByRole('option', { name: /Convert/ })).toContainText('TABLE')
    // a new title
    await pv.getByLabel('Title').fill('Delta backlog')
    await ai.getByRole('option', { name: /Convert/ }).click()
    await expect(panel(page)).toHaveCount(0)

    await expect.poll(async () => (await dbOn(page, id))?.page.title).toBe('Delta backlog')
    const got = await dbOn(page, id)
    expect((got.db.properties as AnyState[]).map((p) => p.name)).toEqual(['Name', 'Topic', 'Type', 'Ref', 'Status', 'Assignee'])
    expect(got.db.views.map((v: AnyState) => v.type)).toEqual(['table', 'board'])
    await expect(page.locator('#main section.db').first().locator('.dbb-col')).toHaveCount(0)
    await expect(page.locator('#main section.db').first()).toContainText('port the detail page to the REST framework')

    // the toast's Undo: text back, database gone (not left behind in the sidebar)
    await page.locator('.toast').filter({ hasText: 'Converted to database' }).getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => topTypes(page, id)).toEqual(['paragraph', 'heading', 'paragraph', 'orderedList', 'heading', 'bulletList', 'paragraph'])
    await expect.poll(() => wsEval(page, (s, dbId) => !!s.pages[dbId] || !!s.databases[dbId], got.id)).toBe(false)
  })

  test('no entries in the answer → an error note, nothing changes; Retry asks again', async ({ page, context }) => {
    const reqs = await mockClaude(context, () => ({ title: 'Nothing', columns: [], entries: [], groupBy: null, keep: [1, 2] }))
    await openApp(page)
    await setKey(page)
    const { id, ai } = await openOnReport(page, 'Delta empty')
    const before = await contentOf(page, id)
    const dbCount = await wsEval(page, (s) => Object.keys(s.databases).length)
    await ai.getByRole('option', { name: /Turn into database/ }).click()
    await expect(ai.getByRole('alert')).toContainText('No entries found in the selection')
    await expect(ai.getByRole('alert')).toContainText('ERR · NO_ENTRIES')
    await expect(preview(page)).toHaveCount(0)
    await expect(ai.getByRole('option', { name: /Convert/ })).toHaveCount(0)
    await ai.getByRole('option', { name: /Try again/ }).click()
    await expect.poll(() => reqs.length).toBe(2)
    await expect(ai.getByRole('alert')).toContainText('No entries found')
    await page.keyboard.press('Escape')
    await expect(panel(page)).toHaveCount(0)
    expect(await contentOf(page, id)).toEqual(before)
    expect(await wsEval(page, (s) => Object.keys(s.databases).length)).toBe(dbCount)
  })

  test('a malformed answer → an error note, nothing changes', async ({ page, context }) => {
    await mockClaude(context, () => ({ title: 'Broken' }))
    await openApp(page)
    await setKey(page)
    const { id, ai } = await openOnReport(page, 'Delta broken')
    const before = await contentOf(page, id)
    await ai.getByRole('option', { name: /Turn into database/ }).click()
    await expect(ai.getByRole('alert')).toContainText('could not be read')
    await page.keyboard.press('Escape')
    expect(await contentOf(page, id)).toEqual(before)
  })

  test('not offered for a selection inside one line or inside a table cell; offered across blocks', async ({ page, context }) => {
    await mockClaude(context)
    await openApp(page)
    await setKey(page)
    const cell = (...content: JSONContent[]): JSONContent => ({ type: 'tableCell', content })
    const id = await createPage(page, {
      title: 'Delta cells',
      content: doc(
        para('Alpha beta gamma delta.'),
        para('Second line here.'),
        { type: 'table', content: [{ type: 'tableRow', content: [cell(para('Cell one first'), para('Cell one second')), cell(para('Cell two'))] }] },
      ),
    })
    await gotoPage(page, id)
    const ed = editorOf(page, id)

    // one line
    await ed.locator('p', { hasText: 'Alpha beta' }).click()
    await selectRange(page, ed, 'beta', 'gamma')
    let ai = await askAI(page)
    await expect(ai.getByRole('option', { name: /Improve writing/ })).toBeVisible()
    await expect(ai.getByRole('option', { name: /Turn into database/ })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(panel(page)).toHaveCount(0)

    // two paragraphs inside one table cell
    await ed.locator('p', { hasText: 'Cell one first' }).click()
    await selectRange(page, ed, 'Cell one first', 'Cell one second')
    ai = await askAI(page)
    await expect(ai.getByRole('option', { name: /Improve writing/ })).toBeVisible()
    await expect(ai.getByRole('option', { name: /Turn into database/ })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(panel(page)).toHaveCount(0)

    // two lines of the page: offered
    await ed.locator('p', { hasText: 'Alpha beta' }).click()
    await selectRange(page, ed, 'Alpha', 'Second line here.')
    ai = await askAI(page)
    await expect(ai.getByRole('option', { name: /Turn into database/ })).toBeVisible()
  })

  test('German: action, preview, keys and toast in German', async ({ page, context }) => {
    await mockClaude(context)
    await openApp(page)
    await setKey(page, 'de')
    const id = await createPage(page, { title: 'Delta Bericht', content: reportDoc() })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p', { hasText: INTRO }).click()
    await selectRange(page, ed, INTRO, 'Next review on Friday.')
    const ai = await askAI(page)
    await expect(ai.locator('.ai-list__group', { hasText: 'Strukturieren' })).toBeVisible()
    await ai.getByRole('option', { name: /In Datenbank umwandeln/ }).click()
    const pv = preview(page)
    await expect(page.getByTestId('todb-spec')).toHaveText('16 Einträge · 6 Spalten · 4 Blöcke bleiben')
    await expect(pv.getByLabel('Titel', { exact: true })).toHaveValue(TITLE)
    await expect(pv.getByLabel('Gruppieren nach')).toHaveValue('Topic')
    await expect(pv.getByRole('button', { name: 'Tabelle' })).toBeVisible()
    await expect(pv).toContainText('Bleibt als Text')
    await expect(pv).toContainText('+11 weitere')
    await expect(pv.getByRole('switch', { name: 'Spalte „Tags“ behalten' })).toBeVisible()
    await expect(ai.getByRole('option', { name: /Abbrechen/ })).toBeVisible()
    await ai.getByRole('option', { name: /Umwandeln/ }).click()
    await expect(page.locator('.toast').filter({ hasText: 'In Datenbank umgewandelt · 16 Einträge' })).toBeVisible()
    await expect.poll(async () => (await dbOn(page, id))?.db.views.map((v: AnyState) => v.name)).toEqual(['Board', 'Tabelle'])
  })

  test('390 px: the preview fits (no horizontal overflow), works with the keyboard', async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await mockClaude(context)
    await openApp(page)
    await setKey(page)
    const { id, ai } = await openOnReport(page, 'Delta phone')
    await ai.locator('.ai-cmd__input').fill('database')
    await page.keyboard.press('Enter')
    const pv = preview(page)
    await expect(pv).toBeVisible()
    const box = await ai.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(390)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    expect(await ai.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0)
    expect(await pv.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0)

    // keyboard: Tab into the title, rename, Enter converts
    await pv.getByLabel('Title').focus()
    await page.keyboard.press(`${MOD}+a`)
    await page.keyboard.type('Delta on the phone')
    await page.keyboard.press('Enter')
    await expect(panel(page)).toHaveCount(0)
    await expect.poll(async () => (await dbOn(page, id))?.page.title).toBe('Delta on the phone')
  })
})
