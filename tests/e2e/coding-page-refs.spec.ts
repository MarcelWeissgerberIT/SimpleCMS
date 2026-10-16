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
 *    a reference.
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

const answerField = (page: Page) => page.getByLabel('Answer to Claude’s question')
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
  // one level deeper is named (Claude reads the title in the contract's text), never sent — and Claude is told how to get it
  expect(first.text).not.toContain('MARA-NOTES-BODY')
  expect(first.text).toMatch(new RegExp(`Not included — One sends at most 8 pages: .*“Mara Lind notes” \\(page ${notes}\\)\\. If you need one of them, ask the person`))
  // the panel lists both (↳ for the one linked in a page) and names the one that does not go along
  await expect(refsRow(page).locator('.ctk-refs__page')).toHaveText(['Launch plan', 'Tessera contract'])
  await expect(refsRow(page).locator('.ctk-refs__page[data-via]')).toHaveText('Tessera contract')
  await expect(page.getByTestId('coding-refs-left')).toContainText('“Mara Lind notes”')
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
  const link = await page.evaluate((id) => `${window.location.origin}${window.location.pathname}#/p/${id}`, id)
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
  const link = await page.evaluate((id) => `${window.location.origin}${window.location.pathname}#/p/${id}`, id)
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
