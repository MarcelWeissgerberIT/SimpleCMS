/**
 * "Transform into …" in the AI menu: a selection of blocks → a form (Auto, Diagram, Chart, Columns, Tabs, Toggles,
 * Cards, Board / Table / Timeline) → Claude (mocked: structured-output answers, never api.anthropic.com) → the preview
 * (the real block: Mermaid drawn, the chart rendered, columns as blocks) → Transform → one step, ⌘Z brings the text
 * back. Also: cached / re-asked form switches, the Mermaid repair round, "keep the original", background runs, the
 * grip menu of selected blocks, German and 390 px. All data here is fictional.
 */
import type { BrowserContext, Locator, Page } from '@playwright/test'
import type { JSONContent } from '@tiptap/core'
import { test, expect, openApp, gotoPage, createPage, wsEval, editorOf, doc, para, heading, sidebarRow, MOD } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/* ------------------------------------------------------------------ */
/* Claude mock: one structured answer per request, by what was asked   */
/* ------------------------------------------------------------------ */

type Kind = 'classify' | 'diagram' | 'chart' | 'columns' | 'tabs' | 'toggles' | 'cards' | 'todb' | 'timeline' | 'other'

interface Captured {
  kind: Kind
  body: AnyState
  system: string
  prompt: string
}

function kindOf(system: string): Kind {
  if (system.includes('You pick the block a passage')) return 'classify'
  if (system.includes('The new block is a Mermaid diagram')) return 'diagram'
  if (system.includes('The new block is a chart')) return 'chart'
  if (system.includes('comparison in columns')) return 'columns'
  if (system.includes('a set of tabs')) return 'tabs'
  if (system.includes('a list of toggles')) return 'toggles'
  if (system.includes('a set of cards')) return 'cards'
  if (system.includes('This database becomes a timeline')) return 'timeline'
  if (system.includes('You turn structured text')) return 'todb'
  return 'other'
}

type Answers = Partial<Record<Kind, object | ((n: number) => object)>>

/** api.anthropic.com → the answer for the kind of request; `gate` holds answers back until released. */
async function mockClaude(ctx: BrowserContext, answers: Answers, opts: { gate?: boolean } = {}) {
  const captured: Captured[] = []
  const counts: Partial<Record<Kind, number>> = {}
  let open = !opts.gate
  const waiting: Array<() => void> = []
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const body = JSON.parse(req.postData() ?? '{}')
    const system = typeof body.system === 'string' ? body.system : JSON.stringify(body.system ?? '')
    const kind = kindOf(system)
    captured.push({ kind, body, system, prompt: String(body.messages?.[0]?.content ?? '') })
    const n = (counts[kind] = (counts[kind] ?? 0) + 1)
    const a = answers[kind]
    const value = typeof a === 'function' ? a(n) : (a ?? {})
    if (!open) await new Promise<void>((r) => waiting.push(r))
    try {
      await route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'msg_e2e', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify(value) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 600, output_tokens: 300 } }),
      })
    } catch {
      /* the page went away */
    }
  })
  return {
    captured,
    of: (kind: Kind) => captured.filter((c) => c.kind === kind),
    waiting: () => waiting.length,
    release: () => {
      open = true
      waiting.splice(0).forEach((r) => r())
    },
  }
}

/* ------------------------------------------------------------------ */
/* Fictional content + answers                                         */
/* ------------------------------------------------------------------ */

const text = (s: string): JSONContent => ({ type: 'text', text: s })
const li = (s: string): JSONContent => ({ type: 'listItem', content: [{ type: 'paragraph', content: [text(s)] }] })
const bullets = (...items: string[]): JSONContent => ({ type: 'bulletList', content: items.map(li) })
const steps = (...items: string[]): JSONContent => ({ type: 'orderedList', attrs: { start: 1 }, content: items.map(li) })

const STEPS = ['Open the box', 'Check the parts against the list', 'If a part is missing, call support', 'Assemble the frame', 'Plug in the power cable']
const stepsDoc = () => doc(para('Setting up the kit:'), steps(...STEPS), para('Allow about 20 minutes.'), para('After the list.'))

const FLOW = [
  'flowchart TD',
  '  s1["Open the box"] --> s2["Check the parts"]',
  '  s2 --> s3{"Part missing?"}',
  '  s3 -->|yes| s4["Call support"]',
  '  s3 -->|no| s5["Assemble the frame"]',
  '  s5 --> s6["Plug in power"]',
].join('\n')
const diagramAnswer = (code = FLOW) => ({ diagram: 'flowchart', code, keep: [1], left: ['Allow about 20 minutes.'] })
const BROKEN = 'flowchart TD\n  s1["Open the box" --> s2[[Check'

const visitorsDoc = () => doc(para('Visitors per quarter:'), bullets('Q1: 1,200 visitors, 80 signups', 'Q2: 1,850 visitors, 95 signups', 'Q3: 2,400 visitors', 'Q4: 3,100 visitors'), para('Source: web analytics.'))
const chartAnswer = () => ({
  title: 'Visitors per quarter',
  kind: 'bar',
  unit: null,
  category: 'Quarter',
  labels: ['Q1', 'Q2', 'Q3', 'Q4'],
  series: [
    { name: 'Visitors', values: [1200, 1850, 2400, 3100] },
    // 120 is not in the text: dropped and listed
    { name: 'Signups', values: [80, 95, null, 120] },
  ],
  keep: [1, 3],
  left: [],
})

const prosConsDoc = () => doc(heading(2, 'Remote work'), para('Pros:'), bullets('No commute', 'Flexible hours'), para('Cons:'), bullets('Fewer chats at the coffee machine', 'Home office costs'), para('Decide by Friday.'))
const sections = (list: Array<[string, string[]]>, style = 'bullet', icon: string | null = null) => ({
  sections: list.map(([title, items]) => ({ title, icon, items: items.map((t) => ({ style, text: t, done: false })) })),
  keep: [],
  left: [],
})
const prosCons = () => sections([['Pros', ['No commute', 'Flexible hours']], ['Cons', ['Fewer chats at the coffee machine', 'Home office costs']]])

const faqDoc = () => doc(para('How long does shipping take? Three to five days.'), para('Can I return an order? Yes, within 30 days.'), para('Do you ship abroad? Only within the EU.'))
const faq = (): Array<[string, string[]]> => [
  ['How long does shipping take?', ['Three to five days.']],
  ['Can I return an order?', ['Yes, within 30 days.']],
  ['Do you ship abroad?', ['Only within the EU.']],
]

const tasksDoc = () => doc(para('Sprint tasks:'), bullets('Fix the login bug — In progress — Lea', 'Write the release notes — Open — Tom', 'Update the pricing page — Open — Mia'))
const tasksAnswer = () => ({
  title: 'Sprint tasks',
  columns: [
    { name: 'Status', type: 'select', options: ['In progress', 'Open'] },
    { name: 'Owner', type: 'select', options: ['Lea', 'Tom', 'Mia'] },
  ],
  entries: [
    { title: 'Fix the login bug', values: [{ column: 'Status', value: 'In progress' }, { column: 'Owner', value: 'Lea' }], body: null },
    { title: 'Write the release notes', values: [{ column: 'Status', value: 'Open' }, { column: 'Owner', value: 'Tom' }], body: null },
    { title: 'Update the pricing page', values: [{ column: 'Status', value: 'Open' }, { column: 'Owner', value: 'Mia' }], body: null },
  ],
  groupBy: 'Status',
  keep: [1],
})

const milestonesDoc = () => doc(para('Milestones:'), bullets('Kick-off on 2026-03-02', 'Beta from 2026-04-01 to 2026-04-30', 'Launch on 2026-05-15'))
const milestonesAnswer = () => ({
  title: 'Milestones',
  columns: [{ name: 'Date', type: 'date', options: [] }],
  entries: [
    { title: 'Kick-off', values: [{ column: 'Date', value: '2026-03-02' }], body: null },
    { title: 'Beta', values: [{ column: 'Date', value: '2026-04-01 → 2026-04-30' }], body: null },
    { title: 'Launch', values: [{ column: 'Date', value: '2026-05-15' }], body: null },
  ],
  groupBy: null,
  keep: [1],
})

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const setKey = (page: Page, language?: 'de') => wsEval(page, (s, lang) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', ...(lang ? { language: lang } : {}) }), language)
const panel = (page: Page) => page.locator('.ai-panel')
const preview = (page: Page) => page.getByTestId('transform-preview')
const toast = (page: Page, s: string | RegExp) => page.locator('.toast').filter({ hasText: s })

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

/** A page with `content`, `from`…`to` selected and the AI menu open on it. */
async function openOn(page: Page, title: string, content: JSONContent, from: string, to: string, menu: RegExp = /^(Ask AI|KI fragen)$/): Promise<{ id: string; ai: Locator }> {
  const id = await createPage(page, { title, content })
  await gotoPage(page, id)
  const ed = editorOf(page, id)
  await ed.locator('p', { hasText: from }).first().click()
  await selectRange(page, ed, from, to)
  const bubble = page.locator('[aria-label="Formatting"], [aria-label="Formatierung"]').first()
  await expect(bubble).toBeVisible()
  await bubble.getByRole('button', { name: menu }).click()
  await expect(panel(page)).toBeVisible()
  return { id, ai: panel(page) }
}

/** "Transform into…" → the form. */
async function transformInto(ai: Locator, form: RegExp, action: RegExp = /^Transform into…/): Promise<void> {
  await ai.getByRole('option', { name: action }).click()
  await ai.getByRole('option', { name: form }).click()
}

const contentOf = (page: Page, id: string) => wsEval(page, (s, id) => JSON.parse(JSON.stringify(s.pages[id]?.content ?? null)), id)
/** Top-level block types (a trailing empty line left out). */
const topTypes = (page: Page, id: string) =>
  wsEval(page, (s, id) => {
    const list = (s.pages[id]?.content?.content ?? []) as AnyState[]
    const last = list[list.length - 1]
    return (last?.type === 'paragraph' && !last.content?.length ? list.slice(0, -1) : list).map((n) => n.type)
  }, id)
const nodesOf = (page: Page, id: string, type: string) => wsEval(page, (s, [id, type]) => ((s.pages[id]?.content?.content ?? []) as AnyState[]).filter((n) => n.type === type), [id, type] as const)
const plainOfNode = (n: AnyState): string => (n.text ?? '') + (n.content ?? []).map(plainOfNode).join('')

/** Put the caret in the page (outside the panel) and undo once. */
async function undo(page: Page, id: string, at: string) {
  await editorOf(page, id).locator('p', { hasText: at }).first().click()
  await page.keyboard.press(`${MOD}+z`)
}

/* ------------------------------------------------------------------ */

test.describe('Transform into (AI menu)', () => {
  test('steps → Diagram: the preview draws the flowchart, says what stays; Enter puts one mermaid block in place; ⌘Z brings the list back', async ({ page, context }) => {
    const claude = await mockClaude(context, { diagram: diagramAnswer() })
    await openApp(page)
    await setKey(page)
    const { id, ai } = await openOn(page, 'Kit setup', stepsDoc(), 'Setting up the kit:', 'Allow about 20 minutes.')
    const before = await contentOf(page, id)

    // the list of forms: Auto first, then what may go here
    await ai.getByRole('option', { name: /^Transform into…/ }).click()
    await expect(ai.locator('.ai-list__group', { hasText: 'Transform into' })).toBeVisible()
    // only the selected blocks go to Claude: the reads line says so
    await expect(ai.getByTestId('ai-reads')).toContainText(/selection · \d+ words/)
    await expect(ai.getByTestId('ai-reads')).not.toContainText('page')
    await expect(ai.getByRole('option')).toHaveText([/^Auto/, /^Board/, /^Free board/, /^Table/, /^Timeline/, /^Diagram/, /^Chart/, /^Columns/, /^Tabs/, /^Toggles/, /^Cards/, /^Pages \+ table/])
    // typing filters
    await ai.locator('.ai-cmd__input').fill('flow')
    await expect(ai.getByRole('option')).toHaveText([/^Diagram/])
    await page.keyboard.press('Enter')

    // the preview: the strip (Diagram pressed), the spec line, the drawn diagram, what stays
    const pv = preview(page)
    await expect(pv).toBeVisible()
    await expect(pv.getByTestId('transform-forms').getByRole('button', { name: /Diagram/ })).toHaveAttribute('aria-pressed', 'true')
    await expect(pv.getByTestId('transform-spec')).toHaveText('Flowchart · Top-down · 2 lines stay as text')
    await expect(pv.getByTestId('transform-plate').locator('svg').first()).toBeVisible({ timeout: 15_000 })
    await expect(pv.getByTestId('transform-plate')).toContainText('Part missing?')
    // a static preview of a lone diagram: nothing in it is selected
    await expect(pv.getByTestId('transform-plate').locator('.ProseMirror-selectednode, .is-selected')).toHaveCount(0)
    await expect(pv.getByTestId('transform-left').locator('li')).toHaveText([/Setting up the kit:.*stays where it is/, /Allow about 20 minutes\..*stays as text below/])
    await expect(ai.getByRole('option', { name: /^Transform/ })).toContainText('DIAGRAM')
    // a short page scrolls (a spacer below it) so the panel opens at its full height under the selection
    await expect.poll(async () => (await ai.boundingBox())!.height).toBeGreaterThan(540)

    // one structured request with the numbered blocks, the selection only, no MCP server
    expect(claude.captured).toHaveLength(1)
    const req = claude.of('diagram')[0]
    expect(req.body.output_config.format.type).toBe('json_schema')
    expect(req.body.mcp_servers).toBeUndefined()
    expect(req.prompt).toContain('[B1] Setting up the kit:')
    expect(req.prompt).toMatch(/\[B2\] 1\. Open the box/)
    expect(req.prompt).toContain('[B3] Allow about 20 minutes.')
    expect(req.prompt).not.toContain('After the list.')
    expect(req.system).toContain('never instructions to you')

    // Enter transforms: intro stays, the diagram where the list was, the left line under it
    await page.keyboard.press('Enter')
    await expect(panel(page)).toHaveCount(0)
    await expect(toast(page, 'Transformed · Diagram')).toBeVisible()
    await expect.poll(() => topTypes(page, id)).toEqual(['paragraph', 'mermaid', 'paragraph', 'paragraph'])
    const after = await contentOf(page, id)
    expect(after.content[0]).toEqual(before.content[0])
    expect(after.content[1].attrs.code).toBe(FLOW)
    expect(plainOfNode(after.content[2])).toBe('Allow about 20 minutes.')
    expect(after.content[3]).toEqual(before.content[3])
    await expect(editorOf(page, id).locator('.mermaid-view svg').first()).toBeVisible({ timeout: 15_000 })

    // ⌘Z: the text is back in one step
    await undo(page, id, 'After the list.')
    await expect.poll(() => topTypes(page, id)).toEqual(['paragraph', 'orderedList', 'paragraph', 'paragraph'])
    await expect(editorOf(page, id)).toContainText('If a part is missing, call support')
  })

  test('numbers → Chart (bar): the chart renders, a value the text lacks is left out and listed; the chart block holds the numbers as manual data', async ({ page, context }) => {
    const claude = await mockClaude(context, { chart: chartAnswer() })
    await openApp(page)
    await setKey(page)
    const { id, ai } = await openOn(page, 'Visitors', visitorsDoc(), 'Visitors per quarter:', 'Q4: 3,100 visitors')
    // typed for: the form directly
    await ai.locator('.ai-cmd__input').fill('chart')
    await ai.getByRole('option', { name: /^Transform into Chart/ }).click()

    const pv = preview(page)
    await expect(pv.getByTestId('transform-spec')).toHaveText('Bar · 4 categories · 2 series · 1 line stays as text')
    await expect(pv.getByTestId('transform-plate').locator('svg').first()).toBeVisible()
    await expect(pv.getByTestId('transform-plate').locator('.ProseMirror-selectednode, .is-selected')).toHaveCount(0)
    await expect(pv.getByTestId('transform-left').locator('li')).toHaveText([/Visitors per quarter:.*stays where it is/, /Q4 · Signups: 120.*not in the text — left out/])
    expect(claude.of('chart')[0].prompt).toContain('Q2: 1,850 visitors, 95 signups')

    // the kind is local: no new request
    await pv.getByTestId('transform-chart-kind').getByRole('button', { name: 'Line' }).click()
    await expect(pv.getByTestId('transform-spec')).toHaveText(/^Line · /)
    expect(claude.captured).toHaveLength(1)

    await ai.getByRole('option', { name: /^Transform/ }).click()
    await expect.poll(() => topTypes(page, id)).toEqual(['paragraph', 'chart', 'paragraph'])
    const [chart] = await nodesOf(page, id, 'chart')
    expect(chart.attrs.spec.kind).toBe('line')
    expect(chart.attrs.spec.source).toEqual({
      kind: 'manual',
      rows: [
        ['Quarter', 'Visitors', 'Signups'],
        ['Q1', 1200, 80],
        ['Q2', 1850, 95],
        ['Q3', 2400, null],
        ['Q4', 3100, null],
      ],
    })
    expect(chart.attrs.spec.title).toBe('Visitors per quarter')
    await expect(editorOf(page, id).locator('.chart-block svg, [data-type="chart"] svg').first()).toBeVisible()
  })

  test('Auto picks the form and says why; → asks another form, ← comes back from the cache without a request', async ({ page, context }) => {
    const claude = await mockClaude(context, {
      classify: { type: 'diagram', reason: 'The text lists steps in order' },
      diagram: diagramAnswer(),
      // no numbers in the steps: nothing grounded → "no numbers"
      chart: { title: null, kind: 'bar', unit: null, category: 'Step', labels: ['Open the box'], series: [{ name: 'Minutes', values: [7] }], keep: [], left: [] },
    })
    await openApp(page)
    await setKey(page)
    const { id, ai } = await openOn(page, 'Kit auto', stepsDoc(), 'Setting up the kit:', 'Allow about 20 minutes.')
    await transformInto(ai, /^Auto/)

    const pv = preview(page)
    await expect(pv.getByTestId('transform-auto')).toHaveText(/Auto picked Diagram.*The text lists steps in order/)
    const forms = pv.getByTestId('transform-forms')
    await expect(forms.getByRole('button', { name: /Diagram/ })).toHaveAttribute('aria-pressed', 'true')
    await expect(forms.getByRole('button', { name: /Diagram/ })).toContainText('Auto')
    await expect(pv.getByTestId('transform-plate').locator('svg').first()).toBeVisible({ timeout: 15_000 })
    // a cheap classification first, then the diagram — the classification lists only the forms that fit
    expect(claude.captured.map((c) => c.kind)).toEqual(['classify', 'diagram'])
    expect(claude.of('classify')[0].body.output_config.format.schema.properties.type.enum).toContain('cards')

    // → the next form is asked anew (here: nothing to chart — an error, nothing changed)
    await ai.locator('.ai-cmd__input').press('ArrowRight')
    await expect(forms.getByRole('button', { name: /Chart/ })).toHaveAttribute('aria-pressed', 'true')
    await expect(pv.getByTestId('transform-error')).toContainText('no numbers to chart')
    expect(claude.captured.map((c) => c.kind)).toEqual(['classify', 'diagram', 'chart'])
    await expect(ai.getByRole('option', { name: /^Transform/ })).toHaveCount(0)

    // ← back to the diagram: from the cache, no request
    await ai.locator('.ai-cmd__input').press('ArrowLeft')
    await expect(forms.getByRole('button', { name: /Diagram/ })).toHaveAttribute('aria-pressed', 'true')
    await expect(pv.getByTestId('transform-plate').locator('svg').first()).toBeVisible({ timeout: 15_000 })
    await expect(pv.getByTestId('transform-error')).toHaveCount(0)
    expect(claude.captured).toHaveLength(3)
    await page.keyboard.press('Enter')
    await expect.poll(() => topTypes(page, id)).toEqual(['paragraph', 'mermaid', 'paragraph', 'paragraph'])
  })

  test('pros / cons → Columns: two columns with headings and lists; the column count is a request option', async ({ page, context }) => {
    const claude = await mockClaude(context, { columns: (n) => (n === 1 ? prosCons() : sections([['Pros', ['No commute']], ['Also pros', ['Flexible hours']], ['Cons', ['Fewer chats at the coffee machine', 'Home office costs']]])) })
    await openApp(page)
    await setKey(page)
    const { id, ai } = await openOn(page, 'Remote', prosConsDoc(), 'Pros:', 'Home office costs')
    await transformInto(ai, /^Columns/)
    const pv = preview(page)
    await expect(pv.getByTestId('transform-spec')).toHaveText('2 columns · nothing left behind')
    await expect(pv.getByTestId('transform-plate').locator('.column')).toHaveCount(2)
    expect(claude.of('columns')[0].system).toContain('2 to 5')

    // 3 columns: asked again ("exactly 3"); Auto again: from the cache
    await pv.getByTestId('transform-columns').getByRole('button', { name: '3' }).click()
    await expect(pv.getByTestId('transform-plate').locator('.column')).toHaveCount(3)
    expect(claude.of('columns')[1].system).toContain('exactly 3')
    await pv.getByTestId('transform-columns').getByRole('button', { name: 'Auto' }).click()
    await expect(pv.getByTestId('transform-plate').locator('.column')).toHaveCount(2)
    expect(claude.of('columns')).toHaveLength(2)

    await ai.getByRole('option', { name: /^Transform/ }).click()
    await expect.poll(() => topTypes(page, id)).toEqual(['heading', 'columns', 'paragraph'])
    const [cols] = await nodesOf(page, id, 'columns')
    expect(cols.content.map((c: AnyState) => c.type)).toEqual(['column', 'column'])
    expect(cols.content[0].content.map((n: AnyState) => n.type)).toEqual(['heading', 'bulletList'])
    expect(plainOfNode(cols.content[0].content[0])).toBe('Pros')
    expect(plainOfNode(cols.content[1].content[1])).toBe('Fewer chats at the coffee machineHome office costs')
  })

  test('Tabs; the strip asks Toggles and Cards, Tabs comes back from the cache → a tabs block with one tab per part', async ({ page, context }) => {
    const claude = await mockClaude(context, {
      tabs: sections([['Shipping', ['Three to five days.', 'Only within the EU.']], ['Returns', ['Yes, within 30 days.']]], 'text'),
      toggles: sections(faq(), 'text'),
      cards: sections(faq(), 'text', '📦'),
    })
    await openApp(page)
    await setKey(page)
    const { id, ai } = await openOn(page, 'FAQ tabs', faqDoc(), 'How long does shipping take?', 'Only within the EU.')
    await transformInto(ai, /^Tabs/)
    const pv = preview(page)
    const forms = pv.getByTestId('transform-forms')
    await expect(pv.getByTestId('transform-spec')).toHaveText('2 tabs · nothing left behind')
    await expect(pv.getByTestId('transform-plate')).toContainText('Shipping')

    await forms.getByRole('button', { name: /Toggles/ }).click()
    await expect(pv.getByTestId('transform-spec')).toHaveText('3 toggles · nothing left behind')
    await forms.getByRole('button', { name: /Cards/ }).click()
    await expect(pv.getByTestId('transform-spec')).toHaveText('3 cards · nothing left behind')
    await expect(pv.getByTestId('transform-plate').locator('.callout')).toHaveCount(3)
    // asked before: an LED on the strip
    await expect(forms.getByRole('button', { name: /Tabs/ })).toHaveAttribute('data-cached')
    await forms.getByRole('button', { name: /Tabs/ }).click()
    await expect(pv.getByTestId('transform-spec')).toHaveText('2 tabs · nothing left behind')
    expect(claude.captured.map((c) => c.kind)).toEqual(['tabs', 'toggles', 'cards'])

    await ai.getByRole('option', { name: /^Transform/ }).click()
    await expect.poll(() => topTypes(page, id)).toEqual(['tabs'])
    const [tabs] = await nodesOf(page, id, 'tabs')
    expect(tabs.content.map((t: AnyState) => [t.type, t.attrs.title])).toEqual([
      ['tab', 'Shipping'],
      ['tab', 'Returns'],
    ])
  })

  test('Toggles + "Keep the original below": the toggles, then the source blocks in a closed toggle under them', async ({ page, context }) => {
    await mockClaude(context, { toggles: sections(faq(), 'text') })
    await openApp(page)
    await setKey(page)
    const { id, ai } = await openOn(page, 'FAQ toggles', faqDoc(), 'How long does shipping take?', 'Only within the EU.')
    await transformInto(ai, /^Toggles/)
    const pv = preview(page)
    await expect(pv.getByTestId('transform-spec')).toHaveText('3 toggles · nothing left behind')
    await pv.getByRole('switch', { name: 'Keep the original below (collapsed)' }).click()
    await expect(pv.getByRole('switch', { name: 'Keep the original below (collapsed)' })).toHaveAttribute('aria-checked', 'true')
    await ai.getByRole('option', { name: /^Transform/ }).click()
    await expect.poll(() => topTypes(page, id)).toEqual(['details', 'details', 'details', 'details'])
    const details = await nodesOf(page, id, 'details')
    expect(details.slice(0, 3).map((d: AnyState) => plainOfNode(d.content[0]))).toEqual(faq().map(([q]) => q))
    expect(plainOfNode(details[0].content[1])).toBe('Three to five days.')
    const original = details[3]
    expect(original.attrs.open).toBe(false)
    expect(plainOfNode(original.content[0])).toBe('Original text')
    expect(original.content[1].content.map((n: AnyState) => plainOfNode(n))).toEqual(['How long does shipping take? Three to five days.', 'Can I return an order? Yes, within 30 days.', 'Do you ship abroad? Only within the EU.'])
  })

  test('Board from this menu = the "Turn into database" machinery: its preview, then an inline board in place', async ({ page, context }) => {
    const claude = await mockClaude(context, { todb: tasksAnswer() })
    await openApp(page)
    await setKey(page)
    const { id, ai } = await openOn(page, 'Sprint', tasksDoc(), 'Sprint tasks:', 'Update the pricing page — Open — Mia')
    await transformInto(ai, /^Board/)
    await expect(page.getByTestId('todb-preview')).toBeVisible()
    await expect(page.getByTestId('todb-spec')).toHaveText('3 entries · 2 columns · 1 block kept')
    await expect(page.getByTestId('todb-preview').getByLabel('Group by')).toHaveValue('Status')
    // the todb request: no MCP server, its own prompt
    expect(claude.of('todb')).toHaveLength(1)
    expect(claude.of('todb')[0].body.mcp_servers).toBeUndefined()
    // Table shares the answer: no new request
    await preview(page).getByTestId('transform-forms').getByRole('button', { name: /^Table/ }).click()
    await expect(ai.getByRole('option', { name: /^Transform/ })).toContainText('TABLE')
    await preview(page).getByTestId('transform-forms').getByRole('button', { name: /^Board/ }).click()
    expect(claude.captured).toHaveLength(1)

    await ai.getByRole('option', { name: /^Transform/ }).click()
    await expect(toast(page, 'Converted to database · 3 entries')).toBeVisible()
    await expect.poll(() => topTypes(page, id)).toEqual(['paragraph', 'databaseBlock'])
    const views = await wsEval(page, (s, id) => {
      const node = (s.pages[id].content.content as AnyState[]).find((n) => n.type === 'databaseBlock')
      return (s.databases[node!.attrs.databaseId].views as AnyState[]).map((v) => v.type)
    }, id)
    expect(views).toEqual(['board', 'table'])
  })

  test('Timeline: dated items → a database that opens on a timeline over its date property', async ({ page, context }) => {
    const claude = await mockClaude(context, { timeline: milestonesAnswer() })
    await openApp(page)
    await setKey(page)
    const { id, ai } = await openOn(page, 'Plan', milestonesDoc(), 'Milestones:', 'Launch on 2026-05-15')
    await transformInto(ai, /^Timeline/)
    await expect(page.getByTestId('todb-preview')).toBeVisible()
    expect(claude.of('timeline')).toHaveLength(1)
    expect(claude.of('timeline')[0].system).toContain('Only dates the text states')
    await ai.getByRole('option', { name: /^Transform/ }).click()
    await expect.poll(() => topTypes(page, id)).toEqual(['paragraph', 'databaseBlock'])
    const db = await wsEval(page, (s, id) => {
      const node = (s.pages[id].content.content as AnyState[]).find((n) => n.type === 'databaseBlock')
      const db = s.databases[node!.attrs.databaseId]
      const date = (db.properties as AnyState[]).find((p) => p.type === 'date')
      const rows = (Object.values(s.pages) as AnyState[]).filter((p) => p.databaseId === db.id).sort((a, b) => a.order - b.order)
      return JSON.parse(JSON.stringify({ views: db.views, date, rows: rows.map((r) => [r.title, r.properties[date.id]]) }))
    }, id)
    expect(db.views[0].type).toBe('timeline')
    expect(db.views[0].dateProperty).toBe(db.date.id)
    expect(db.rows).toEqual([
      ['Kick-off', { start: '2026-03-02', end: null, includeTime: false }],
      ['Beta', { start: '2026-04-01', end: '2026-04-30', includeTime: false }],
      ['Launch', { start: '2026-05-15', end: null, includeTime: false }],
    ])
  })

  test('Mermaid that does not parse: one repair round with the parser error → the repaired diagram', async ({ page, context }) => {
    const claude = await mockClaude(context, { diagram: (n) => diagramAnswer(n === 1 ? BROKEN : FLOW) })
    await openApp(page)
    await setKey(page)
    const { id, ai } = await openOn(page, 'Kit repair', stepsDoc(), 'Setting up the kit:', 'Allow about 20 minutes.')
    await transformInto(ai, /^Diagram/)
    const pv = preview(page)
    await expect(pv.getByTestId('transform-spec')).toHaveText('Flowchart · Top-down · fixed once · 2 lines stay as text')
    const asks = claude.of('diagram')
    expect(asks).toHaveLength(2)
    expect(asks[1].prompt).toContain('did not parse')
    expect(asks[1].prompt).toContain(BROKEN)
    expect(asks[1].prompt).toMatch(/Parser error:\n\S/)
    await ai.getByRole('option', { name: /^Transform/ }).click()
    await expect.poll(async () => (await nodesOf(page, id, 'mermaid'))[0]?.attrs.code).toBe(FLOW)
  })

  test('Mermaid that does not parse twice: a friendly error, nothing changed; Try again asks anew', async ({ page, context }) => {
    const claude = await mockClaude(context, { diagram: (n) => diagramAnswer(n <= 2 ? BROKEN : FLOW) })
    await openApp(page)
    await setKey(page)
    const { id, ai } = await openOn(page, 'Kit broken', stepsDoc(), 'Setting up the kit:', 'Allow about 20 minutes.')
    const before = await contentOf(page, id)
    await transformInto(ai, /^Diagram/)
    const pv = preview(page)
    await expect(pv.getByTestId('transform-error')).toContainText('ERR · DIAGRAM_PARSE')
    await expect(pv.getByTestId('transform-error')).toContainText('Nothing was changed')
    expect(claude.of('diagram')).toHaveLength(2)
    await expect(ai.getByRole('option', { name: /^Transform/ })).toHaveCount(0)
    expect(await contentOf(page, id)).toEqual(before)

    await ai.getByRole('option', { name: /Try again/ }).click()
    await expect(pv.getByTestId('transform-plate').locator('svg').first()).toBeVisible({ timeout: 15_000 })
    expect(claude.of('diagram')).toHaveLength(3)
  })

  test('background: the panel closes and the page changes while Claude works → "AI result ready" → Open → Transform', async ({ page, context }) => {
    const claude = await mockClaude(context, { diagram: diagramAnswer() }, { gate: true })
    await openApp(page)
    await setKey(page)
    const other = await createPage(page, { title: 'Elsewhere', content: doc(para('Nothing to see here.')) })
    const { id, ai } = await openOn(page, 'Kit later', stepsDoc(), 'Setting up the kit:', 'Allow about 20 minutes.')
    await transformInto(ai, /^Diagram/)
    await expect(preview(page).getByTestId('transform-wait')).toHaveText(/Reading 3 blocks → Diagram/)
    await expect.poll(() => claude.waiting()).toBe(1)

    // Esc: the panel goes, the run stays (the page's plate)
    await page.keyboard.press('Escape')
    await expect(panel(page)).toHaveCount(0)
    await expect(page.getByTestId('ai-runs')).toContainText(/Reading/i)
    await gotoPage(page, other)
    claude.release()
    await expect(toast(page, 'AI result ready · Kit later')).toBeVisible()
    await expect(sidebarRow(page, 'Kit later').getByTestId('ai-run-led')).toBeVisible()
    await toast(page, 'AI result ready · Kit later').getByRole('button', { name: 'Open' }).click()
    await expect(page.locator('#main .pv-title')).toHaveValue('Kit later')
    await expect(preview(page).getByTestId('transform-plate').locator('svg').first()).toBeVisible({ timeout: 15_000 })
    await panel(page).getByRole('option', { name: /^Transform/ }).click()
    await expect.poll(() => topTypes(page, id)).toEqual(['paragraph', 'mermaid', 'paragraph', 'paragraph'])
  })

  test('the grip menu of 3 selected blocks: Transform into → Columns runs at once, previewed first', async ({ page, context }) => {
    const claude = await mockClaude(context, { columns: sections([['Before', ['Paper forms']], ['After', ['One shared page']]], 'text') })
    await openApp(page)
    await setKey(page)
    const id = await createPage(page, { title: 'Grip', content: doc(para('Alpha line.'), para('Before: paper forms.'), para('After: one shared page.'), para('Omega line.'), para('Last line.')) })
    await gotoPage(page, id)
    const ed = editorOf(page, id)
    await ed.locator('p', { hasText: 'Alpha line.' }).click()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+ArrowDown')
    await expect(page.getByTestId('selection-count')).toHaveText('3 blocks · Esc')
    await page.mouse.move(5, 450)
    await page.getByTestId('selection-grip').getByRole('button', { name: 'Block menu · 3 blocks' }).click()
    const menu = page.locator('[data-popover][role="menu"]').first()
    await menu.getByRole('menuitem', { name: /^Transform into/ }).click()
    await page.getByRole('menuitem', { name: /^Columns/ }).click()

    const pv = preview(page)
    await expect(pv.getByTestId('transform-spec')).toHaveText('2 columns · nothing left behind')
    expect(claude.of('columns')[0].prompt).toContain('[B1] Alpha line.')
    expect(claude.of('columns')[0].prompt).toContain('[B3] After: one shared page.')
    expect(claude.of('columns')[0].prompt).not.toContain('Omega line.')
    await page.keyboard.press('Enter')
    await expect.poll(() => topTypes(page, id)).toEqual(['columns', 'paragraph', 'paragraph'])
  })

  test('German: menu, forms, preview and toast in German', async ({ page, context }) => {
    await mockClaude(context, { diagram: diagramAnswer() })
    await openApp(page)
    await setKey(page, 'de')
    const { id, ai } = await openOn(page, 'Aufbau', stepsDoc(), 'Setting up the kit:', 'Allow about 20 minutes.')
    await expect(ai.locator('.ai-list__group', { hasText: 'Strukturieren' })).toBeVisible()
    await transformInto(ai, /^Schaubild/, /^Verwandeln in …/)
    const pv = preview(page)
    await expect(pv.getByTestId('transform-spec')).toHaveText('Flussdiagramm · Von oben · 2 Zeilen bleiben als Text')
    await expect(pv.getByTestId('transform-forms').getByRole('button', { name: /Diagramm/ })).toBeVisible()
    await expect(pv).toContainText('Nicht übernommen')
    await expect(pv.getByRole('switch', { name: 'Original darunter behalten (zugeklappt)' })).toBeVisible()
    // direction is local: left to right
    await pv.getByTestId('transform-direction').getByRole('button', { name: 'Von links' }).click()
    await ai.getByRole('option', { name: /^Verwandeln/ }).click()
    await expect(toast(page, 'Verwandelt · Schaubild')).toBeVisible()
    await expect.poll(async () => (await nodesOf(page, id, 'mermaid'))[0]?.attrs.code.split('\n')[0]).toBe('flowchart LR')
  })

  test('390 px: the preview fits the phone, keyboard works', async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await mockClaude(context, { chart: chartAnswer() })
    await openApp(page)
    await setKey(page)
    const { id, ai } = await openOn(page, 'Visitors phone', visitorsDoc(), 'Visitors per quarter:', 'Q4: 3,100 visitors')
    await transformInto(ai, /^Chart/)
    const pv = preview(page)
    await expect(pv.getByTestId('transform-plate').locator('svg').first()).toBeVisible()
    // the strip scrolls on a phone: the form shown stays in sight
    const strip = await pv.getByTestId('transform-forms').boundingBox()
    const chart = await pv.getByTestId('transform-forms').getByRole('button', { name: /Chart/ }).boundingBox()
    expect(chart!.x).toBeGreaterThanOrEqual(strip!.x)
    expect(chart!.x + chart!.width).toBeLessThanOrEqual(strip!.x + strip!.width)
    const box = await ai.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(390)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    expect(await pv.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0)
    await ai.locator('.ai-cmd__input').focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => topTypes(page, id)).toEqual(['paragraph', 'chart', 'paragraph'])
  })
})
