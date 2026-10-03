/**
 * AI autofill for database properties (Claude API mocked — never reaches api.anthropic.com).
 * Seeded Projects database: Priority (select: High / Medium / Low), 8 rows.
 */
import type { BrowserContext, Page } from '@playwright/test'
import { test, expect, openApp, gotoPage, pageIdByTitle, wsEval, uiEval } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

interface Captured {
  body: AnyState
  prompt: string
}

/** Answer for one request: a JSON value, or raw text (to simulate a malformed reply). */
type Reply = { value: unknown } | { raw: string }

/**
 * Route api.anthropic.com: every Messages request is answered with a non-streaming message whose
 * text is `{"value": …}` (structured output). Captures the request bodies.
 */
async function mockAutofill(ctx: BrowserContext, answer: (prompt: string) => Reply, delayMs = 0): Promise<Captured[]> {
  const captured: Captured[] = []
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const body = JSON.parse(req.postData() ?? '{}')
    const prompt = String(body.messages?.[0]?.content ?? '')
    captured.push({ body, prompt })
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
    const reply = answer(prompt)
    const text = 'raw' in reply ? reply.raw : JSON.stringify({ value: reply.value })
    try {
      await route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'msg_e2e', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 420, output_tokens: 12 } }),
      })
    } catch {
      /* the request was aborted (cancel) */
    }
  })
  return captured
}

/** Row title of a prompt ("# <title>" line inside <row>). */
const titleOf = (prompt: string) => prompt.match(/^# (.+)$/m)?.[1] ?? ''

async function openProjects(page: Page): Promise<string> {
  const dbId = await pageIdByTitle(page, 'Projects')
  await gotoPage(page, dbId)
  await page.locator('#main section.db').first().getByRole('tab').filter({ hasText: 'All projects' }).click()
  await expect(page.locator('#main section.db').first()).toHaveAttribute('data-view', 'table')
  return dbId
}

/** Header → property menu → "AI autofill…" → the panel. */
async function openAutofill(page: Page, propName: string) {
  const db = page.locator('#main section.db').first()
  await db.locator('.dbt-hcell__btn', { hasText: propName }).click()
  await page.getByRole('menuitem', { name: /AI autofill/ }).click()
  const dlg = page.getByRole('dialog', { name: `AI autofill · ${propName}` })
  await expect(dlg).toBeVisible()
  return dlg
}

/** Row title → option name of a select property. */
async function selectValues(page: Page, dbId: string, propName: string): Promise<Record<string, string | null>> {
  return wsEval(
    page,
    (s, { dbId, propName }) => {
      const prop = s.databases[dbId].properties.find((p: AnyState) => p.name === propName)
      const out: Record<string, string | null> = {}
      for (const r of Object.values(s.pages) as AnyState[]) {
        if (r.databaseId !== dbId || r.trashed) continue
        const id = r.properties[prop.id]
        out[r.title] = prop.options.find((o: AnyState) => o.id === id)?.name ?? null
      }
      return out
    },
    { dbId, propName },
  )
}

const setKey = (page: Page) => wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))

test.describe('AI autofill (mocked Claude API)', () => {
  test('Categorise a select property → review → accept one, reject one: only the accepted row changes', async ({ page, context }) => {
    const answers: Record<string, string> = {
      'Website relaunch': 'High',
      'Import our Notion workspace': 'Low',
      'n8n lead-routing automation': 'Medium',
      'Q4 content calendar': 'Medium',
      'Customer onboarding video': 'Low',
      'Pricing page experiment': 'Medium',
      'AI support assistant': 'High',
      'Brand refresh': 'Medium',
    }
    const reqs = await mockAutofill(context, (prompt) => ({ value: answers[titleOf(prompt)] ?? null }))
    await openApp(page)
    await setKey(page)
    const dbId = await openProjects(page)
    const before = await selectValues(page, dbId, 'Priority')

    const dlg = await openAutofill(page, 'Priority')
    await expect(dlg.getByRole('radio', { name: /Categorise/ })).toHaveAttribute('aria-checked', 'true')
    // cost estimate before running, labelled as an estimate billed by Anthropic to the user's key
    await expect(dlg.getByRole('definition').filter({ hasText: '$' })).toHaveText(/≈ (< )?\$\d/)
    await expect(dlg).toContainText('Anthropic bills the actual usage to your API key')
    await dlg.getByRole('button', { name: /Fill all rows/ }).click()

    const table = dlg.getByRole('table', { name: 'Proposed values' })
    await expect(table).toBeVisible({ timeout: 20_000 })
    expect(reqs).toHaveLength(8)
    // three rows differ from their current value; the rest are reported as unchanged
    await expect(table.getByRole('row')).toHaveCount(4) // header + 3 proposals
    await expect(dlg.getByText(/5 rows already have the proposed value/)).toBeVisible()

    // the request carries the row context: title, other properties, page content (Markdown), the options
    const req = reqs.find((r) => titleOf(r.prompt) === 'Website relaunch')!
    expect(req.body.model).toBe('claude-opus-5-5')
    expect(req.prompt).toContain('<row>')
    expect(req.prompt).toContain('- Status: In progress')
    expect(req.prompt).toContain('- Owner: Alex')
    expect(req.prompt).toMatch(/Goal:\**\s*ship something people actually use/)
    expect(req.prompt).toContain('Kick-off & scope')
    expect(req.prompt).toMatch(/Field "Priority" \(select\): exactly one of these options: "High", "Medium", "Low"/)
    expect(req.prompt).not.toMatch(/- Priority:/) // the target property itself is not part of the context
    expect(req.body.output_config.format.type).toBe('json_schema')
    expect(req.body.output_config.format.schema.properties.value.anyOf[0].enum).toEqual(['High', 'Medium', 'Low'])

    await dlg.getByRole('button', { name: 'Accept for Import our Notion workspace' }).click()
    await expect(table.getByRole('row', { name: /Import our Notion workspace/ })).toContainText('Applied')
    await dlg.getByRole('button', { name: 'Reject for Brand refresh' }).click()
    await expect(table.getByRole('row', { name: /Brand refresh/ })).toContainText('Rejected')
    await dlg.getByRole('button', { name: 'Discard' }).click()
    await expect(dlg.getByText('Run complete')).toBeVisible()
    await dlg.getByRole('button', { name: 'Done' }).click()
    await expect(dlg).toBeHidden()

    const after = await selectValues(page, dbId, 'Priority')
    for (const [title, value] of Object.entries(before)) expect(after[title], title).toBe(title === 'Import our Notion workspace' ? 'Low' : value)

    // config + fill record persisted on the property; the header carries the AI tag
    const cfg = await wsEval(page, (s, dbId) => JSON.parse(JSON.stringify(s.databases[dbId].properties.find((p: AnyState) => p.name === 'Priority').autofill)), dbId)
    expect(cfg.preset).toBe('categorize')
    const importId = await pageIdByTitle(page, 'Import our Notion workspace')
    expect(Object.keys(cfg.fills)).toEqual([importId])
    await expect(page.locator('#main .dbt-hcell', { hasText: 'Priority' }).locator('.af-tag')).toBeVisible()
  })

  test('Summary on a text property with "Apply without review" fills the cells', async ({ page, context }) => {
    const reqs = await mockAutofill(context, (prompt) => ({ value: `${titleOf(prompt)} — summary.` }))
    await openApp(page)
    await setKey(page)
    const dbId = await openProjects(page)
    await wsEval(page, (s, dbId) => s.addProperty(dbId, { type: 'text', name: 'Summary' }), dbId)

    const dlg = await openAutofill(page, 'Summary')
    await expect(dlg.getByRole('radio', { name: /Summary/ })).toHaveAttribute('aria-checked', 'true')
    const skip = dlg.getByRole('switch', { name: 'Apply without review' })
    await skip.click()
    await expect(skip).toHaveAttribute('aria-checked', 'true')
    await dlg.getByRole('button', { name: /Fill all rows/ }).click()
    await expect(dlg.getByText('Run complete')).toBeVisible({ timeout: 20_000 })
    await expect(dlg.locator('.af-readout dd').first()).toHaveText('8') // written
    expect(reqs).toHaveLength(8)
    expect(reqs[0].prompt).toContain('Summarize the row')
    expect(reqs[0].body.output_config.format.schema.properties.value.anyOf[0]).toEqual({ type: 'string' })
    await dlg.getByRole('button', { name: 'Done' }).click()

    const values = await wsEval(
      page,
      (s, dbId) => {
        const prop = s.databases[dbId].properties.find((p: AnyState) => p.name === 'Summary')
        return (Object.values(s.pages) as AnyState[]).filter((r) => r.databaseId === dbId).map((r) => [r.title, r.properties[prop.id]])
      },
      dbId,
    )
    expect(values).toHaveLength(8)
    for (const [title, v] of values) expect(v).toBe(`${title} — summary.`)
    await expect(page.locator('#main .dbt-row', { hasText: 'Website relaunch' })).toContainText('Website relaunch — summary.')
  })

  test('an invalid model answer becomes a row error and writes nothing', async ({ page, context }) => {
    // seeded priorities, so every other row comes back unchanged
    const current: Record<string, string> = {
      'Website relaunch': 'High',
      'n8n lead-routing automation': 'High',
      'Q4 content calendar': 'Medium',
      'Customer onboarding video': 'Low',
      'AI support assistant': 'High',
    }
    await mockAutofill(context, (prompt) => {
      const title = titleOf(prompt)
      if (title === 'Pricing page experiment') return { value: 'Urgent' } // not an option
      if (title === 'Brand refresh') return { raw: 'Sure! The priority is medium.' } // not JSON
      if (title === 'Import our Notion workspace') return { value: 'Low' }
      return { value: current[title] }
    })
    await openApp(page)
    await setKey(page)
    const dbId = await openProjects(page)
    const before = await selectValues(page, dbId, 'Priority')

    const dlg = await openAutofill(page, 'Priority')
    await dlg.getByRole('button', { name: /Fill all rows/ }).click()
    await expect(dlg.getByRole('table', { name: 'Proposed values' })).toBeVisible({ timeout: 20_000 })
    const failed = dlg.getByRole('region', { name: 'Failed rows' })
    await expect(failed).toContainText('Pricing page experiment')
    await expect(failed).toContainText('“Urgent” is not an option of Priority.')
    await expect(failed).toContainText('Brand refresh')
    await expect(failed).toContainText('not in the expected format')
    // failed rows offer no accept button
    await expect(dlg.getByRole('button', { name: 'Accept for Pricing page experiment' })).toHaveCount(0)
    await dlg.getByRole('button', { name: /Accept all/ }).click()
    await dlg.getByRole('button', { name: 'Done' }).click()

    const after = await selectValues(page, dbId, 'Priority')
    expect(after['Pricing page experiment']).toBe(before['Pricing page experiment'])
    expect(after['Brand refresh']).toBe(before['Brand refresh'])
    expect(after['Import our Notion workspace']).toBe('Low')
    for (const [title, value] of Object.entries(current)) expect(after[title], title).toBe(value)
    // the failed cells show their error state
    await expect(page.locator('#main .af-cell[data-state="error"]')).toHaveCount(2)
  })

  test('without an API key the panel explains it and points to Settings → Claude AI', async ({ page, context }) => {
    const reqs = await mockAutofill(context, () => ({ value: 'High' }))
    await openApp(page)
    await openProjects(page)
    const dlg = await openAutofill(page, 'Priority')
    await expect(dlg).toContainText('Claude is not connected')
    await expect(dlg.getByRole('button', { name: /Fill all rows/ })).toBeDisabled()
    await dlg.getByRole('button', { name: 'Open Settings → Claude AI' }).click()
    await expect(dlg).toBeHidden()
    expect(await uiEval(page, (s) => s.modal)).toMatchObject({ type: 'settings', tab: 'ai' })
    await expect(page.getByRole('dialog').getByRole('tab', { name: /Claude AI/ })).toHaveAttribute('aria-selected', 'true')
    expect(reqs).toHaveLength(0)
  })

  test('"Update automatically" re-fills only a row whose inputs changed, once', async ({ page, context }) => {
    const reqs = await mockAutofill(context, (prompt) => ({ value: `${titleOf(prompt)} — summary.` }))
    await openApp(page)
    await setKey(page)
    const dbId = await openProjects(page)
    const propId = await wsEval(page, (s, dbId) => s.addProperty(dbId, { type: 'text', name: 'Summary', autofill: { preset: 'summary', auto: true, skipReview: false } }), dbId)
    await expect(page.locator('#main .dbt-hcell', { hasText: 'Summary' }).locator('.af-tag')).toHaveAttribute('data-state', 'auto')
    const rowId = await pageIdByTitle(page, 'Brand refresh')
    await wsEval(page, (s, id) => s.updatePage(id, { title: 'Brand refresh 2027' }), rowId)

    await expect.poll(() => reqs.length, { timeout: 15_000 }).toBe(1)
    expect(titleOf(reqs[0].prompt)).toBe('Brand refresh 2027')
    const valueOf = () => wsEval(page, (s, { rowId, propId }) => s.pages[rowId].properties[propId] ?? null, { rowId, propId })
    await expect.poll(valueOf).toBe('Brand refresh 2027 — summary.')
    const fill = await wsEval(page, (s, { dbId, propId, rowId }) => s.databases[dbId].properties.find((p: AnyState) => p.id === propId).autofill.fills[rowId], { dbId, propId, rowId })
    expect(fill.hash).toBeTruthy()
    // writing the result (and editing the AI property itself) never triggers another run
    await wsEval(page, (s, { rowId, propId }) => s.setRowProperty(rowId, propId, 'edited by hand'), { rowId, propId })
    await page.waitForTimeout(6000)
    expect(reqs).toHaveLength(1)
  })

  test('cancel stops further requests', async ({ page, context }) => {
    const reqs = await mockAutofill(context, () => ({ value: 'High' }), 2500)
    await openApp(page)
    await setKey(page)
    const dbId = await openProjects(page)
    const before = await selectValues(page, dbId, 'Priority')
    const dlg = await openAutofill(page, 'Priority')
    await dlg.getByRole('button', { name: /Fill all rows/ }).click()
    await expect(dlg.getByRole('progressbar', { name: 'Progress' })).toBeVisible()
    // three at a time
    await expect.poll(() => reqs.length).toBe(3)
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await expect(dlg.getByText(/Cancelled — 0 of 8 rows/)).toBeVisible()
    await page.waitForTimeout(3500)
    expect(reqs).toHaveLength(3)
    expect(await selectValues(page, dbId, 'Priority')).toEqual(before)
    await expect(page.locator('#main .af-cell[data-state="queued"], #main .af-cell[data-state="running"]')).toHaveCount(0)
  })
})
