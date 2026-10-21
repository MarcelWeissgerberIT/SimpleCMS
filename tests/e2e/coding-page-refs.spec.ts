/**
 * Pages reach Claude Code (features/coding/refs.ts, RefField.tsx, GivePages.tsx) and every page has a permalink
 * (lib/permalink.ts). The worker is played by the test (helpers/fakeWorker.ts, port CODING_E2E_PORT or 48100): the
 * payload the tab hands it is what Claude Code would read. Each page carries a marker text, so the payload shows which
 * pages went along.
 *
 *  - pages linked in a page that goes along go along too (one level deeper), the next level is named, never sent;
 *  - a page picked with @ in the answer — by keyboard — goes along on that very run, before the task's own pages, even
 *    when the task already links 8; "Goes along" shows it while the answer is written;
 *  - "one:" in a rework note, @ in the new-task dialog (the page then holds a page mention);
 *  - "Give the page": a name Claude's question quotes → a key; two pages of that name → both, with their paths; a press
 *    puts the page into the answer and the answer field keeps the focus; nothing is sent by itself;
 *  - the permalink: page ⋯ and the spec plate copy it, ⌘K opens it (also a bare id and the plate's short ID, never
 *    "Create page"), the address bar takes it in capitals or the short form, a page and the AI terminal turn it into
 *    a reference; a link to a block stays one and opens at the block;
 *  - review fixes: a page with many links ahead of the answer's page — "Goes along" is exactly what goes, the answer's
 *    linked page too, Claude gets ≤ 20 names; a title holding addresses brings only its page; a Mails row linked in a
 *    page is kept back (named, given with @ it goes); German at 390 px: the ask box stays inside the panel after "Seite
 *    mitgeben", "Geht mit" is capped with „…“ and a count, a page opens in the peek and the answer survives a trip away.
 */
import type { Locator, Page } from '@playwright/test'
import { test, expect, openApp, wsEval, createPage, gotoPage, editorOf, doc, para, MOD } from './fixtures'
import { WORKER_CAN, type WorkerInfo } from '../../src/app/features/coding/protocol'
import { startFakeWorker, type FakeWorker, type Json } from './helpers/fakeWorker'

const PORT = Number(process.env.CODING_E2E_PORT) || 48100

// one fake worker on one port
test.describe.configure({ mode: 'serial' })

const welcome = (): WorkerInfo => ({ worker: '1.10.0', name: 'refs-box', repos: [{ name: 'website', baseBranch: 'main' }], parallel: 1, busy: [], spentToday: 0, dayLimit: null, claude: { found: true, version: '2.0.0' }, setup: true, mcp: [] })

let fake: FakeWorker | null = null
test.afterEach(async () => {
  await fake?.close()
  fake = null
})

/** Settings → Coding worker: the test's port, switched on, connected. */
async function connect(page: Page) {
  await page.evaluate(() => (window as unknown as { __one: { ui: { getState: () => { openModal: (m: unknown) => void } } } }).__one.ui.getState().openModal({ type: 'settings' }))
  await page.getByRole('tab', { name: /Coding worker|Coding-Worker/ }).click()
  const port = page.getByLabel('Port', { exact: true })
  await port.fill(String(PORT))
  await port.press('Enter')
  await page.getByRole('switch', { name: 'Connect to a coding worker on this computer' }).click()
  await expect(page.getByTestId('coding-conn')).toContainText('refs-box')
  await page.keyboard.press('Escape')
}

async function start(page: Page, errors: { allow: (re: RegExp) => void }, approvals: 'none' | 'all' = 'none') {
  // the link looks for the worker again once the fake is gone
  errors.allow(/WebSocket connection to 'ws:\/\/127\.0\.0\.1/)
  fake = await startFakeWorker(PORT, welcome())
  fake.can = [...WORKER_CAN]
  await openApp(page)
  await page.evaluate((a) => localStorage.setItem('one.coding.approvals', a), approvals)
}

/** "New task" with a goal typed as plain text; the task's id. */
async function newTask(page: Page, title: string, goal: string): Promise<string> {
  await page.evaluate(() => (window.location.hash = '#/coding'))
  await page.getByTestId('coding-new').click()
  await page.getByTestId('coding-new-title').fill(title)
  await page.getByTestId('coding-new-repo').fill('website')
  await page.getByTestId('coding-new-goal').fill(goal)
  await page.getByTestId('coding-create').click()
  await expect(page.getByTestId('coding-panel')).toBeVisible()
  await page.waitForFunction(() => window.location.hash.startsWith('#/p/'))
  return page.evaluate(() => window.location.hash.replace('#/p/', ''))
}

/**
 * Claude asks (the stage handed out last ends with a question); the number of hand-outs before the answer — counted once
 * the question shows: nothing is handed out while a task waits for an answer (the fake may have been handed the stage
 * once more while the tab was still writing the outcome).
 */
async function ask(page: Page, question: string): Promise<number> {
  await fake!.finish(fake!.handed().at(-1)!, { status: 'question', question })
  await expect(page.getByTestId('coding-question')).toHaveText(question, { timeout: 15_000 })
  return fake!.handed().length
}

/** The first hand-out after `n` (the fake counts a stage run again as finished at once: never "the last one"). */
async function handedAfter(n: number): Promise<Json> {
  await expect.poll(() => fake!.handed().length, { timeout: 20_000 }).toBeGreaterThan(n)
  return fake!.handed()[n]!
}

const answerField = (page: Page) => page.getByLabel('Answer to the coding agent’s question')
const mention = (id: string, label: string) => ({ type: 'mention', attrs: { id, label, kind: 'page' } })
/** The titles "Goes along" shows, in order (without the "new" mark). */
const shownTitles = (page: Page) => page.getByTestId('coding-refs').locator('.ctk-refs__page > span:first-of-type').allTextContents()
/** The titles of the pages a hand-out's text carries, in order. */
const sentTitles = (text: string) => [...text.matchAll(/^### (.+) \(page [A-Za-z0-9_-]+\)$/gm)].map((m) => m[1])
const refsRow = (page: Page) => page.getByTestId('coding-refs')
const pickList = (page: Page) => page.getByRole('listbox', { name: 'Pages' })

/** Paste text into a field the way the clipboard does (a paste event with text/plain). */
async function paste(target: Locator, text: string) {
  await target.evaluate((el, text) => {
    const data = new DataTransfer()
    data.setData('text/plain', text)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, text)
}

test('pages linked in a page that goes along go along too; the next level is named, never sent', async ({ page, errors }) => {
  test.setTimeout(120_000)
  await start(page, errors)
  const notes = await createPage(page, { title: 'Mara Lind notes', content: doc(para('MARA-NOTES-BODY')) })
  const contract = await createPage(page, { title: 'Tessera contract', content: doc({ type: 'paragraph', content: [{ type: 'text', text: 'TESSERA-CONTRACT-BODY — see ' }, { type: 'mention', attrs: { id: notes, label: 'Mara Lind notes', kind: 'page' } }] }) })
  const plan = await createPage(page, { title: 'Launch plan', content: doc({ type: 'paragraph', content: [{ type: 'text', text: 'LAUNCHPLAN-BODY — the contract: ' }, { type: 'mention', attrs: { id: contract, label: 'Tessera contract', kind: 'page' } }] }) })
  await connect(page)
  await newTask(page, 'Nordlicht landing', `Build the Nordlicht landing. Source: #/p/${plan}`)
  const first = await handedAfter(0)
  // the task's page, the page linked in it — and the page linked in THAT page, with where it comes from
  expect(first.text).toContain('LAUNCHPLAN-BODY')
  expect(first.text).toContain('TESSERA-CONTRACT-BODY')
  expect(first.text).toContain(`### Tessera contract (page ${contract})\n\n_Linked in “Launch plan”._`)
  // one level deeper is named, never sent — by its id: its title is no part of the version that was checked (Claude reads
  // the title in the contract's text) — and Claude is told how to get it
  expect(first.text).not.toContain('MARA-NOTES-BODY')
  expect(first.text).toMatch(new RegExp(`Not included — One sends at most 8 pages: those the task links and the first ones linked in them: page ${notes}\\. If you need one of them, ask the person`))
  expect(first.text).not.toContain('“Mara Lind notes”')
  // the panel lists both (↳ for the one linked in a page) and names the one that does not go along
  await expect(refsRow(page).locator('.ctk-refs__page')).toHaveText(['Launch plan', 'Tessera contract'])
  await expect(refsRow(page).locator('.ctk-refs__page[data-via]')).toHaveText('Tessera contract')
  await expect(page.getByTestId('coding-refs-left')).toContainText('“Mara Lind notes”')
  // the stage runs (no answer field): how to give it — in the task
  await expect(page.getByTestId('coding-refs-ask')).toHaveText('Mention one with @ in the task to send it.')
})

test('@ in the answer, by keyboard: the page goes along on that very run — first, also when the task links 8 already', async ({ page, errors }) => {
  test.setTimeout(150_000)
  await start(page, errors)
  const eight: string[] = []
  for (let i = 1; i <= 8; i++) eight.push(await createPage(page, { title: `Nordlicht brief ${i}`, content: doc(para(`BRIEF-${i}-BODY`)) }))
  const kit = await createPage(page, { title: 'Kit list', content: doc(para('KIT-LIST-BODY')) })
  await connect(page)
  const task = await newTask(page, 'Nordlicht kit', `Pack the kit. Briefs: ${eight.map((id) => `#/p/${id}`).join(' ')}`)
  const first = await handedAfter(0)
  expect(first.text).toContain('BRIEF-8-BODY')
  expect(first.text).not.toContain('KIT-LIST-BODY')

  const n = await ask(page, 'Which list should I pack from?')
  const field = answerField(page)
  await field.click()
  await page.keyboard.type('Use @Kit l')
  // the editor's page search: the list opens under the field, the first match chosen
  await expect(pickList(page)).toBeVisible()
  await expect(pickList(page).getByRole('option').first()).toContainText('Kit list')
  await expect(field).toHaveAttribute('aria-activedescendant', /.+/)
  // Esc closes the list only — the panel and the text stay, the field keeps the focus
  await page.keyboard.press('Escape')
  await expect(pickList(page)).toHaveCount(0)
  await expect(field).toBeFocused()
  await page.keyboard.type('i')
  await expect(pickList(page)).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(pickList(page)).toHaveCount(0)
  await expect(field).toHaveValue('Use @Kit list ')
  await page.keyboard.type('please.')
  // "Goes along" shows it before it is sent — new, and first
  await expect(refsRow(page).locator('.ctk-refs__page').first()).toContainText('Kit list')
  await expect(refsRow(page).locator('.ctk-refs__page[data-new]')).toContainText('Kit list')
  await expect(page.getByTestId('coding-refs-left')).toContainText('“Nordlicht brief 8”')
  expect(fake!.handed().length).toBe(n)

  await page.keyboard.press(`${MOD}+Enter`)
  const again = await handedAfter(n)
  // the answer holds the page as a One address; its text goes along, ahead of the task's own pages
  expect(again.answers).toEqual([{ q: 'Which list should I pack from?', a: `Use [@Kit list](#/p/${kit}) please.` }])
  expect(again.text).toContain('KIT-LIST-BODY')
  expect(again.text.indexOf('KIT-LIST-BODY')).toBeLessThan(again.text.indexOf('BRIEF-1-BODY'))
  expect(again.text).not.toContain('BRIEF-8-BODY')
  // the note in the page links the page (so a later stage takes it along too)
  const note = await wsEval(page, (s, id) => JSON.stringify(s.pages[id].content), task)
  expect(note).toContain(`"href":"#/p/${kit}"`)
})

test('Backspace takes a picked page out whole; a pasted page address becomes "@Title" too', async ({ page, errors }) => {
  test.setTimeout(120_000)
  await start(page, errors)
  const brief = await createPage(page, { title: 'Nordlicht brief', content: doc(para('NORDLICHT-BRIEF-BODY')) })
  await connect(page)
  await newTask(page, 'Nordlicht header', 'Build the header.')
  await handedAfter(0)
  const n = await ask(page, 'Where is the brief?')
  const field = answerField(page)
  await field.click()
  await page.keyboard.type('@Nordlicht b')
  await page.keyboard.press('Tab')
  await expect(field).toHaveValue('@Nordlicht brief ')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await expect(field).toHaveValue('')
  await expect(refsRow(page).locator('[data-new]')).toHaveCount(0)
  // a pasted permalink: in as a reference
  await paste(field, `http://127.0.0.1:1/SimpleCMS/app/#/p/${brief}`)
  await expect(field).toHaveValue('@Nordlicht brief ')
  await expect(refsRow(page).locator('[data-new]')).toContainText('Nordlicht brief')
  await page.getByRole('button', { name: /^Answer/ }).click()
  const again = await handedAfter(n)
  expect(again.answers[0].a).toBe(`[@Nordlicht brief](#/p/${brief})`)
  expect(again.text).toContain('NORDLICHT-BRIEF-BODY')
})

test('"one:" in a rework note: the same level first, then a search — the page goes along with the rework', async ({ page, errors }) => {
  test.setTimeout(120_000)
  await start(page, errors, 'all')
  const api = await createPage(page, { title: 'Tessera API notes', content: doc(para('REWORK-LINK-BODY')) })
  await connect(page)
  await newTask(page, 'Tessera export', 'Export the Tessera list.')
  const first = await handedAfter(0)
  await fake!.finish(first, { status: 'ok', branch: 'one/y', plan: '1. Export.' })
  await expect(page.getByTestId('coding-rework')).toBeVisible({ timeout: 15_000 })
  // nothing is handed out while the task waits at the gate
  const n = fake!.handed().length
  await page.getByTestId('coding-rework').click()
  const note = page.getByTestId('coding-rework-note')
  await expect(note).toBeFocused()
  await page.keyboard.type('Read one:Tessera API')
  await expect(pickList(page)).toBeVisible()
  // "one:" names its sections (Everywhere: a title search over every page)
  await expect(pickList(page).locator('.menu-section')).toContainText(['Everywhere'])
  await page.keyboard.press('Enter')
  await expect(note).toHaveValue('Read @Tessera API notes ')
  await page.keyboard.type('first.')
  await expect(refsRow(page).locator('[data-new]')).toContainText('Tessera API notes')
  await page.keyboard.press(`${MOD}+Enter`)
  const again = await handedAfter(n)
  expect(again.rework).toBe(`Read [@Tessera API notes](#/p/${api}) first.`)
  expect(again.text).toContain('REWORK-LINK-BODY')
})

test('@ in the new-task dialog: the page is a mention in the task page and goes along', async ({ page, errors }) => {
  test.setTimeout(120_000)
  await start(page, errors)
  const guide = await createPage(page, { title: 'Nordlicht style guide', content: doc(para('NEWTASK-STYLE-BODY')) })
  await connect(page)
  await page.evaluate(() => (window.location.hash = '#/coding'))
  await page.getByTestId('coding-new').click()
  await page.getByTestId('coding-new-title').fill('Nordlicht footer')
  await page.getByTestId('coding-new-repo').fill('website')
  await page.getByTestId('coding-new-goal').click()
  await page.keyboard.type('Follow @Nordlicht sty')
  await expect(pickList(page)).toBeVisible()
  // the list's Esc is its own: the dialog stays open
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.type('l')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('coding-new-goal')).toHaveValue('Follow @Nordlicht style guide ')
  await expect(page.getByTestId('coding-new-refs')).toContainText('Nordlicht style guide')
  await page.getByTestId('coding-create').click()
  await expect(page.getByTestId('coding-panel')).toBeVisible()
  await page.waitForFunction(() => window.location.hash.startsWith('#/p/'))
  const task = await page.evaluate(() => window.location.hash.replace('#/p/', ''))
  const mentions = await wsEval(page, (s, id) => {
    const out: Array<Record<string, unknown>> = []
    const walk = (n: { type?: string; attrs?: Record<string, unknown>; content?: unknown[] }) => {
      if (n.type === 'mention') out.push(n.attrs ?? {})
      for (const c of n.content ?? []) walk(c as typeof n)
    }
    walk(s.pages[id].content)
    return out
  }, task)
  expect(mentions).toEqual([expect.objectContaining({ id: guide, label: 'Nordlicht style guide', kind: 'page' })])
  const first = await handedAfter(0)
  expect(first.text).toContain('NEWTASK-STYLE-BODY')
})

test('"Give the page": names in quotes → a key per page, two pages of one name with their paths; a press fills the answer, never sends', async ({ page, errors }) => {
  test.setTimeout(120_000)
  await start(page, errors)
  const contract = await createPage(page, { title: 'Tessera contract', content: doc(para('GIVE-CONTRACT-BODY')) })
  const projects = await createPage(page, { title: 'Projects' })
  const archive = await createPage(page, { title: 'Archive' })
  const a = await createPage(page, { title: 'Launch checklist', content: doc(para('CHECKLIST-A-BODY')), parentId: projects })
  const b = await createPage(page, { title: 'Launch checklist', content: doc(para('CHECKLIST-B-BODY')), parentId: archive })
  await connect(page)
  await newTask(page, 'Tessera rollout', 'Roll out Tessera.')
  await handedAfter(0)
  const n = await ask(page, 'I cannot read „Tessera contract“ or "launch checklist ", and "Nobody knows" is no page.')
  const give = page.getByTestId('coding-give')
  await expect(give).toBeVisible()
  const chips = give.getByTestId('coding-give-chip')
  await expect(chips).toHaveCount(3)
  await expect(chips.nth(0)).toHaveText('Tessera contract')
  // the ambiguous name: both pages, each with where it lives
  const many = give.locator('.ctk-give__many')
  await expect(many).toContainText('“launch checklist” — 2 pages:')
  await expect(many.getByTestId('coding-give-chip')).toHaveCount(2)
  await expect(many.getByTestId('coding-give-chip').filter({ hasText: 'Projects' })).toContainText('Launch checklist')
  await expect(many.getByTestId('coding-give-chip').filter({ hasText: 'Archive' })).toContainText('Launch checklist')

  // a click: into the answer at its caret; the answer keeps the focus; nothing goes to the worker
  const field = answerField(page)
  await field.click()
  await page.keyboard.type('Here: ')
  await chips.nth(0).click()
  await expect(field).toHaveValue('Here: @Tessera contract ')
  await expect(field).toBeFocused()
  await expect(chips.nth(0)).toBeDisabled()
  await expect(chips.nth(0)).toContainText('In your answer')
  // by keyboard: Tab to the Archive one, Enter — back in the answer, after the first
  await page.keyboard.type('and ')
  await many.getByTestId('coding-give-chip').filter({ hasText: 'Archive' }).focus()
  await page.keyboard.press('Enter')
  await expect(field).toHaveValue('Here: @Tessera contract and @Launch checklist ')
  await expect(field).toBeFocused()
  await page.waitForTimeout(500)
  expect(fake!.handed().length).toBe(n)

  await page.keyboard.press(`${MOD}+Enter`)
  const again = await handedAfter(n)
  expect(again.answers[0].a).toBe(`Here: [@Tessera contract](#/p/${contract}) and [@Launch checklist](#/p/${b})`)
  expect(again.text).toContain('GIVE-CONTRACT-BODY')
  expect(again.text).toContain('CHECKLIST-B-BODY')
  expect(again.text).not.toContain('CHECKLIST-A-BODY')
  void a
})

test('the permalink: ⋯ and the spec plate copy it; ⌘K opens it (also an id and the plate ID, never "Create page"); the address bar takes it in other forms', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openApp(page)
  const id = await createPage(page, { title: 'Launch plan', content: doc(para('Nordlicht launch.')) })
  await gotoPage(page, id)
  const link = await page.evaluate((id) => `${window.location.origin}${window.location.pathname}?w=local#/p/${id}`, id)
  // page ⋯ → Copy permalink: the address on the clipboard and in the toast
  await page.getByRole('button', { name: 'Page options' }).click()
  await page.getByRole('menuitem', { name: 'Copy permalink' }).click()
  await expect(page.locator('.toast').last()).toContainText(`Permalink copied — ${link}`)
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link)
  // the spec plate's key: the same
  await page.evaluate(() => navigator.clipboard.writeText(''))
  await page.getByTestId('spec-permalink').click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(link)

  const count = () => wsEval(page, (s) => Object.keys(s.pages).length)
  const before = await count()
  const palette = async (q: string) => {
    await page.evaluate(() => (window.location.hash = '#/'))
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
    await page.keyboard.press(`${MOD}+k`)
    const pal = page.getByRole('dialog', { name: /Command palette/ })
    await expect(pal).toBeVisible()
    await page.keyboard.insertText(q)
    return pal
  }
  const short = `${id.slice(0, 4).toUpperCase()}·${id.slice(4, 8).toUpperCase()}`
  for (const q of [link, `#/p/${id}`, id, id.toUpperCase(), `ID ${short}`]) {
    const pal = await palette(q)
    // the page it names comes first — chosen — and there is no "Create page" for an address
    await expect(pal.locator('[cmdk-item][aria-selected="true"]')).toContainText('Launch plan')
    await expect(pal.locator('[cmdk-group-heading]').first()).toContainText('Page address')
    await expect(pal.getByText(/^Create page/)).toHaveCount(0)
    await page.keyboard.press('Enter')
    await expect(pal).toHaveCount(0)
    await page.waitForFunction((id) => window.location.hash === `#/p/${id}`, id)
  }
  // an address of a page this device does not have: said, never a new page
  const pal = await palette(`${link.slice(0, -12)}zzzzzzzzzzzz`)
  await expect(pal.getByText('No page with this address on this device')).toBeVisible()
  await expect(pal.getByText(/^Create page/)).toHaveCount(0)
  await page.keyboard.press('Escape')
  expect(await count()).toBe(before)

  // the address bar: the id in capitals, the plate's short form
  for (const form of [id.toUpperCase(), short]) {
    await page.evaluate((f) => (window.location.hash = `#/p/${f}`), form)
    await page.waitForFunction((id) => window.location.hash === `#/p/${id}`, id)
    await expect(page.locator('#main .pv-title')).toHaveText('Launch plan')
  }
})

test('a pasted permalink becomes a page mention in a page, and "@Title" in the AI terminal', async ({ page }) => {
  await openApp(page)
  const id = await createPage(page, { title: 'Tessera contract', content: doc(para('Terms.')) })
  const host = await createPage(page, { title: 'Nordlicht notes', content: doc(para('')) })
  await gotoPage(page, host)
  const link = await page.evaluate((id) => `${window.location.origin}${window.location.pathname}?w=local#/p/${id}`, id)
  const editor = editorOf(page)
  await editor.click()
  await paste(editor, link)
  await expect(editor.locator('.mention--page')).toHaveText('Tessera contract')
  await expect.poll(() => wsEval(page, (s, h) => JSON.stringify(s.pages[h].content), host)).toContain(`"id":"${id}"`)

  // the AI terminal: the prompt gets "@Tessera contract" and the page as a mention chip
  await page.keyboard.press(`${MOD}+j`)
  const prompt = page.getByRole('textbox', { name: 'Task for the agent' })
  await expect(prompt).toBeVisible()
  await paste(prompt, link)
  await expect(prompt).toHaveValue('@Tessera contract ')
  await expect(page.locator('.term-chip[data-kind="mention"]')).toContainText('Tessera contract')
})

test('a page with many links ahead of the answer’s page: "Goes along" is exactly what goes — the answer’s linked page too; Claude gets ≤ 20 names', async ({ page, errors }) => {
  test.setTimeout(240_000)
  await start(page, errors)
  const items = await wsEval(page, (s) => {
    const out: string[] = []
    for (let i = 1; i <= 70; i++) out.push(s.createPage({ title: `Nordlicht item ${i}`, parentId: null }))
    return out
  })
  const hub = await createPage(page, { title: 'Nordlicht index', content: doc({ type: 'paragraph', content: items.flatMap((id, i) => [mention(id, `Nordlicht item ${i + 1}`), { type: 'text', text: ' ' }]) }) })
  const spec = await createPage(page, { title: 'Tessera spec', content: doc(para('TESSERA-SPEC-BODY')) })
  const plan = await createPage(page, { title: 'Launch plan', content: doc({ type: 'paragraph', content: [{ type: 'text', text: 'LAUNCH-PLAN-BODY, the spec: ' }, mention(spec, 'Tessera spec')] }) })
  await connect(page)
  await newTask(page, 'Nordlicht hub', `Use the index: #/p/${hub}`)
  await handedAfter(0)
  const n = await ask(page, 'Which plan?')
  const field = answerField(page)
  await field.click()
  await paste(field, `#/p/${plan}`)
  await expect(field).toHaveValue('@Launch plan ')
  // the answer's page first, the page linked in it, then the index and its first items
  const expected = ['Launch plan', 'Nordlicht index', 'Tessera spec', 'Nordlicht item 1', 'Nordlicht item 2', 'Nordlicht item 3', 'Nordlicht item 4', 'Nordlicht item 5']
  await expect.poll(() => shownTitles(page)).toEqual(expected)
  await expect(refsRow(page).locator('.ctk-refs__page[data-new]')).toContainText(['Launch plan', 'Tessera spec'])
  // what does not go: 5 names, a count, the rest in the tooltip; how to give one — in the answer
  const over = page.getByTestId('coding-refs-over')
  await expect(over).toContainText('Not along: “Nordlicht item 6”, “Nordlicht item 7”, “Nordlicht item 8”, “Nordlicht item 9”, “Nordlicht item 10” + 60 more — at most 8 pages')
  await expect(over).toHaveAttribute('title', /“Nordlicht item 45” …$/)
  await expect(page.getByTestId('coding-refs-ask')).toHaveText('Give one with @ in your answer.')
  // screen readers hear a count, not the row
  await expect(refsRow(page)).not.toHaveAttribute('aria-live', /.+/)
  await expect(refsRow(page).locator('[aria-live="polite"]')).toHaveText('Goes along: 8 · not along: 65')

  await page.keyboard.press(`${MOD}+Enter`)
  const again = await handedAfter(n)
  // exactly what "Goes along" showed, in that order
  expect(sentTitles(again.text)).toEqual(expected)
  expect(again.text).toContain('LAUNCH-PLAN-BODY')
  expect(again.text).toContain('TESSERA-SPEC-BODY')
  // ≤ 20 names: those of the version by title, the rest by id, then a count
  const left = again.text.slice(again.text.indexOf('Not included'))
  expect(left).toContain(`“Nordlicht item 6” (page ${items[5]}), “Nordlicht item 7” (page ${items[6]}), “Nordlicht item 8” (page ${items[7]}), page ${items[8]}, `)
  expect(left).toContain(`page ${items[24]} … and 45 more.`)
  expect(left).not.toContain(items[25])
  expect(left).not.toContain('“Nordlicht item 9”')
  // after the send the same pages go along (the answer is a note in the task now)
  await expect.poll(() => shownTitles(page)).toEqual(expected)
})

test('a page whose title holds One addresses brings only itself — in the answer and in the new-task dialog', async ({ page, errors }) => {
  test.setTimeout(180_000)
  await start(page, errors)
  const notes: string[] = []
  for (let i = 1; i <= 8; i++) notes.push(await createPage(page, { title: `Tessera note ${i}`, content: doc(para(`TESSERA-NOTE-${i}-BODY`)) }))
  const kit = await createPage(page, { title: `Kit list ${notes.map((id) => `#/p/${id}`).join(' ')}`, content: doc(para('KIT-LIST-BODY')) })
  await connect(page)
  // the new-task dialog: the pick is its page only
  await page.evaluate(() => (window.location.hash = '#/coding'))
  await page.getByTestId('coding-new').click()
  const goal = page.getByTestId('coding-new-goal')
  await goal.click()
  await paste(goal, `#/p/${kit}`)
  await expect(goal).toHaveValue(/^@Kit list /)
  await expect(page.getByTestId('coding-new-refs').locator('.ctk-refs__page')).toHaveCount(1)
  await expect(page.getByTestId('coding-new-refs').locator('.ctk-refs__page')).toContainText('Kit list')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await newTask(page, 'Nordlicht kit', 'Pack the kit.')
  await handedAfter(0)
  const n = await ask(page, 'Which list?')
  const field = answerField(page)
  await field.click()
  await paste(field, `#/p/${kit}`)
  await expect(field).toHaveValue(/^@Kit list /)
  await expect.poll(() => shownTitles(page)).toEqual([`Kit list ${notes.map((id) => `#/p/${id}`).join(' ')}`])
  await page.keyboard.press(`${MOD}+Enter`)
  const again = await handedAfter(n)
  expect(again.answers[0].a).toBe(`[@Kit list ${notes.map((id) => `#/p/${id}`).join(' ')}](#/p/${kit})`)
  expect(again.text).toContain('KIT-LIST-BODY')
  for (let i = 1; i <= 8; i++) expect(again.text).not.toContain(`TESSERA-NOTE-${i}-BODY`)
  expect(again.text).not.toContain('Not included')
  // the note in the task links the page — the addresses in its label name nothing
  await expect(refsRow(page).locator('.ctk-refs__page')).toHaveCount(1)
})

test('a Mails row linked in a page stays back — named for Claude; given with @ in the answer it goes', async ({ page, errors }) => {
  test.setTimeout(150_000)
  await start(page, errors)
  const row = await wsEval(page, (s) => {
    const db = s.createDatabase({ title: 'Mails', parentId: null })
    s.updateDatabase(db, { system: 'mails' })
    return s.createRow(db, { title: 'Re: Tessera contract', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'MAIL-BODY-FROM-OUTSIDE' }] }] }, contentOrigin: 'mail' })
  })
  const notes = await createPage(page, { title: 'Mara Lind notes', content: doc({ type: 'paragraph', content: [{ type: 'text', text: 'MARA-NOTES-BODY, the mail: ' }, mention(row, 'Re: Tessera contract')] }) })
  await connect(page)
  await newTask(page, 'Tessera client', `Build it. Notes: #/p/${notes}`)
  const first = await handedAfter(0)
  expect(first.text).toContain('MARA-NOTES-BODY')
  expect(first.text).not.toContain('MAIL-BODY-FROM-OUTSIDE')
  expect(first.text).toContain(`Kept back — linked in a page, but One sends mails, memories and pages of its own databases (pipelines, test cases …) only when the person gives them: “Re: Tessera contract” (page ${row}). If you need one of them, ask the person`)
  await expect.poll(() => shownTitles(page)).toEqual(['Mara Lind notes'])
  await expect(page.getByTestId('coding-refs-kept')).toContainText('Kept back: “Re: Tessera contract” — mails, memories and pages of One’s own databases go along only when you give them.')

  // the person gives it: it goes
  const n = await ask(page, 'May I read the mail?')
  const field = answerField(page)
  await field.click()
  await paste(field, `#/p/${row}`)
  await expect(field).toHaveValue('@Re: Tessera contract ')
  await expect.poll(() => shownTitles(page)).toEqual(['Re: Tessera contract', 'Mara Lind notes'])
  await page.keyboard.press(`${MOD}+Enter`)
  const again = await handedAfter(n)
  expect(again.text).toContain('MAIL-BODY-FROM-OUTSIDE')
})

test('a link to a block stays one: pasted into a page it is no mention, clicked or in ⌘K it opens at the block', async ({ page }) => {
  await openApp(page)
  const id = await createPage(page, { title: 'Launch plan', content: doc(para('Intro.'), { type: 'heading', attrs: { level: 2, id: 'blkanchor1' }, content: [{ type: 'text', text: 'Budget' }] }) })
  const host = await createPage(page, { title: 'Nordlicht notes', content: doc(para('See ')) })
  await gotoPage(page, host)
  const link = await page.evaluate((id) => `${window.location.origin}${window.location.pathname}#/p/${id}?b=blkanchor1`, id)
  const editor = editorOf(page)
  await editor.locator('p').first().click()
  await page.keyboard.press('End')
  await paste(editor, link)
  await expect(editor.locator('.mention--page')).toHaveCount(0)
  const a = editor.locator(`a[href="${link}"]`)
  await expect(a).toHaveCount(1)
  await expect.poll(() => wsEval(page, (s, h) => JSON.stringify(s.pages[h].content), host)).toContain('?b=blkanchor1')
  // a click: here, at the block
  await a.click()
  await page.waitForFunction((id) => window.location.hash === `#/p/${id}?b=blkanchor1`, id)
  // ⌘K: the same
  await page.evaluate(() => (window.location.hash = '#/'))
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  await page.keyboard.press(`${MOD}+k`)
  const pal = page.getByRole('dialog', { name: /Command palette/ })
  await expect(pal).toBeVisible()
  await page.keyboard.insertText(link)
  await expect(pal.locator('[cmdk-item][aria-selected="true"]')).toContainText('Launch plan')
  await page.keyboard.press('Enter')
  await page.waitForFunction((id) => window.location.hash === `#/p/${id}?b=blkanchor1`, id)
})

test.describe('German, phone width', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('„Seite mitgeben“ keeps the ask box inside the panel; „Geht mit“ capped with „…“; a page opens in the peek; the answer survives a trip away', async ({ page, errors }) => {
    test.setTimeout(240_000)
    await start(page, errors)
    await connect(page)
    await page.evaluate(() => (window as unknown as { __one: { workspace: { getState: () => { updateSettings: (p: unknown) => void } } } }).__one.workspace.getState().updateSettings({ language: 'de' }))
    const title = 'Rahmenvertrag ICM Felix Herbstausgabe 2026'
    const projects = await createPage(page, { title: 'Projekte' })
    const archive = await createPage(page, { title: 'Archiv' })
    const contract = await createPage(page, { title, content: doc(para('RAHMENVERTRAG-BODY')), parentId: projects })
    await createPage(page, { title, content: doc(para('ALTER-STAND-BODY')), parentId: archive })
    const chapters: string[] = []
    for (let i = 1; i <= 12; i++) chapters.push(await createPage(page, { title: `Kapitel ${i}` }))
    const cover = await createPage(page, { title: 'Cover Magazin', content: doc({ type: 'paragraph', content: chapters.flatMap((id, i) => [mention(id, `Kapitel ${i + 1}`), { type: 'text', text: ' ' }]) }) })
    const task = await newTask(page, 'Aufgabe für Cover Magazin', `Cover bauen, siehe #/p/${cover}`)
    await handedAfter(0)
    // the stage runs: no answer field — how to give a page is said for the task
    await expect(page.getByTestId('coding-refs-over')).toContainText('Geht nicht mit: „Kapitel 8“, „Kapitel 9“, „Kapitel 10“, „Kapitel 11“, „Kapitel 12“ – höchstens 8 Seiten')
    await expect(page.getByTestId('coding-refs-ask')).toHaveText('Erwähne sie mit @ in der Aufgabe, damit sie mitgeht.')

    const n = await ask(page, `Ich komme an das Dokument „${title}“ nicht heran. Bitte gib mir die Seite mit.`)
    await expect(page.getByTestId('coding-refs-ask')).toHaveText('Gib eine mit @ in deiner Antwort mit.')
    const field = page.getByTestId('coding-answer')
    await field.click()
    await page.keyboard.type('Hier ist der Vertrag, bitte lies Abschnitt 3 genau: ')
    const fits = () =>
      page.evaluate(() => {
        const panel = document.querySelector('[data-testid="coding-panel"]')!.getBoundingClientRect()
        const box = document.querySelector('.ctk-box--ask')!.getBoundingClientRect()
        let scrolled = 0
        for (let el = document.querySelector<HTMLElement>('.ctk-box--ask'); el; el = el.parentElement) scrolled = Math.max(scrolled, el.scrollLeft)
        return { inside: box.left >= panel.left - 0.5 && box.right <= panel.right + 0.5, scrolled, wide: document.documentElement.scrollWidth > window.innerWidth }
      })
    expect(await fits()).toEqual({ inside: true, scrolled: 0, wide: false })
    const chip = page.getByTestId('coding-give-chip').filter({ hasText: 'Projekte' })
    await chip.click()
    await expect(field).toHaveValue(`Hier ist der Vertrag, bitte lies Abschnitt 3 genau: @${title} `)
    await expect(chip).toContainText('In der Antwort')
    expect(await fits()).toEqual({ inside: true, scrolled: 0, wide: false })
    // „Geht mit“: the picked page new and first; the rest capped
    await expect(refsRow(page).locator('.ctk-refs__page[data-new]')).toContainText(title)
    await expect(page.getByTestId('coding-refs-over')).toContainText('Geht nicht mit: „Kapitel 7“, „Kapitel 8“, „Kapitel 9“, „Kapitel 10“, „Kapitel 11“ + 1 weitere – höchstens 8 Seiten')
    await expect(refsRow(page).locator('[aria-live="polite"]')).toHaveText('Geht mit: 8 · geht nicht mit: 6')

    // a click on the new page: it opens beside the task — the task and the answer stay
    await refsRow(page).locator('.ctk-refs__page[data-new]').click()
    const peek = page.locator('.peek')
    await expect(peek).toBeVisible()
    await expect(peek).toContainText('RAHMENVERTRAG-BODY')
    expect(await page.evaluate(() => window.location.hash)).toBe(`#/p/${task}`)
    await expect(field).toHaveValue(`Hier ist der Vertrag, bitte lies Abschnitt 3 genau: @${title} `)
    await page.keyboard.press('Escape')
    await expect(peek).toHaveCount(0)
    // away and back: the answer and its pick are still there
    await page.evaluate((id) => (window.location.hash = `#/p/${id}`), projects)
    await expect(page.getByTestId('coding-panel')).toHaveCount(0)
    await page.goBack()
    await expect(field).toHaveValue(`Hier ist der Vertrag, bitte lies Abschnitt 3 genau: @${title} `)
    await expect(refsRow(page).locator('.ctk-refs__page[data-new]')).toContainText(title)
    await field.focus()
    await page.keyboard.press(`${MOD}+Enter`)
    const again = await handedAfter(n)
    expect(again.answers[0].a).toBe(`Hier ist der Vertrag, bitte lies Abschnitt 3 genau: [@${title}](#/p/${contract})`)
    expect(again.text).toContain('RAHMENVERTRAG-BODY')
    expect(again.text).not.toContain('ALTER-STAND-BODY')
    // the field is empty again (the sent answer is not kept)
    await expect(page.getByTestId('coding-question')).toHaveCount(0)
  })
})
