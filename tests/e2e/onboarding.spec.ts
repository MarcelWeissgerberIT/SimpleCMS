/**
 * Getting started (shell/tour, shell/discover) and the tidier AI menu: the guided tour (offered once on a fresh
 * workspace, keyboard only, "Do it for me", no key, a key with a mocked Claude, 390 px, German), "What can One
 * do?" (every card's Try it key opens its place), the AI menu's short top level per selection type with every old
 * action still reachable, the grip menu's Claude group and the grouped ⌘K list. Claude is mocked — nothing
 * reaches api.anthropic.com.
 */
import type { BrowserContext, Locator, Page } from '@playwright/test'
import { test, expect, openApp, reloadApp, gotoPage, createPage, wsEval, editorOf, doc, para, heading, MOD } from './fixtures'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const placard = (page: Page) => page.locator('.tour-placard')
const offer = (page: Page) => page.getByTestId('tour-offer')
const stepLabel = (page: Page) => placard(page).locator('.tour-placard__label')
const panel = (page: Page) => page.locator('.ai-panel')
const rowIds = async (ai: Locator) => (await ai.getByRole('option').evaluateAll((els) => els.map((e) => e.id.replace(/^ai-row-/, '')))) as string[]

/** Never a real request: a failing Claude (the steps without a key must not call it at all). */
async function blockClaude(ctx: BrowserContext) {
  const calls: string[] = []
  await ctx.route('https://api.anthropic.com/**', (route) => {
    calls.push(route.request().url())
    return route.fulfill({ status: 500, body: '{}' })
  })
  return calls
}

/** Claude answers every request with the diagram of the tour page's list (structured JSON, as the transform asks). */
async function mockDiagram(ctx: BrowserContext) {
  const bodies: string[] = []
  await ctx.route('https://api.anthropic.com/**', (route) => {
    const req = route.request()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    bodies.push(req.postData() ?? '')
    const code = 'flowchart TD\n  a["Write the announcement"] --> b["Record a two-minute demo"]\n  b --> c["Ship the release on Friday"]\n  c --> d["Collect feedback"]'
    return route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'msg_e2e', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: JSON.stringify({ diagram: 'flowchart', code, keep: [], left: [] }) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 600, output_tokens: 300 } }),
    })
  })
  return bodies
}

const tourPageId = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('one.tour') ?? '{}').page as string | null)

async function startFromOffer(page: Page) {
  await expect(offer(page)).toBeVisible()
  await offer(page).getByRole('button', { name: 'Start the tour' }).click()
  await expect(placard(page)).toBeVisible()
  await expect(stepLabel(page)).toHaveText('Tour · step 01 / 08')
}

/* ------------------------------------------------------------------ */

test.describe('guided tour', () => {
  test('offered once on a fresh workspace; “Not now” stays dismissed after a reload; ⌘K still starts it', async ({ page, context }) => {
    await blockClaude(context)
    await openApp(page)
    // the Welcome page of the fresh workspace carries the card — other pages do not
    await expect(offer(page)).toBeVisible()
    await expect(offer(page)).toContainText('Take the 3-minute tour')
    await expect(offer(page)).toContainText('Tour · 8 steps')
    const projects = await wsEval(page, (s) => (Object.values(s.pages) as AnyState[]).find((p) => p.title === 'Projects')?.id as string)
    await gotoPage(page, projects)
    await expect(offer(page)).toHaveCount(0)
    await page.goBack()
    await expect(offer(page)).toBeVisible()

    await offer(page).getByRole('button', { name: 'Not now' }).click()
    await expect(offer(page)).toHaveCount(0)
    await reloadApp(page)
    await expect(page.locator('#main .pv-title')).toHaveValue('Welcome to One')
    await expect(offer(page)).toHaveCount(0)

    // still one step away: ⌘K → Start the tour
    await page.keyboard.press(`${MOD}+k`)
    const pal = page.getByRole('dialog', { name: 'Command palette' })
    await expect(pal.getByRole('option', { name: /Start the tour/ })).toBeVisible()
    await page.keyboard.type('start the tour')
    await page.keyboard.press('Enter')
    await expect(placard(page)).toBeVisible()
    await expect(stepLabel(page)).toHaveText('Tour · step 01 / 08')
    await page.keyboard.press('Escape')
    await expect(placard(page)).toHaveCount(0)
    // the offer stays gone after the tour too
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('one.tour') ?? '{}').off)).toBe(true)
  })

  test('keyboard only: → walks every step to the finish card, ← goes back, Esc ends; each step is announced', async ({ page, context }) => {
    const calls = await blockClaude(context)
    await openApp(page)
    await startFromOffer(page)
    await expect(placard(page)).toBeFocused()
    await expect(page.locator('.tour [aria-live="polite"]')).toHaveText('Step 1 of 8: Type / for any block')
    // the practice page opened, and the frame sits on it
    await expect(page.locator('#main .pv-title')).toHaveValue('Tour — try things here')
    await expect(page.locator('.tour-frame')).toBeVisible()
    const titles = ['Type / for any block', 'Select text → AI', 'Ctrl+K — find and run anything', 'One database, many views', 'Ctrl+J — the AI terminal', 'Every version, word by word', 'One Script — bulk changes, safely', 'Help and What’s new']
    for (let i = 0; i < titles.length; i++) {
      await expect(stepLabel(page)).toHaveText(`Tour · step ${String(i + 1).padStart(2, '0')} / 08`)
      await expect(placard(page).locator('#tour-title')).toHaveText(titles[i].replace('Ctrl', process.platform === 'darwin' ? '⌘' : 'Ctrl'))
      await expect(placard(page)).toBeFocused()
      if (i === 3) await expect(page.locator('#main .pv-title')).toHaveValue('Projects')
      if (i === 5) await expect(page.locator('#main .pv-title')).toHaveValue('Welcome to One')
      if (i === 6) await expect(page).toHaveURL(/#\/scripts$/)
      await page.keyboard.press('ArrowRight')
    }
    await expect(placard(page).locator('#tour-title')).toHaveText('That’s the tour')
    await page.keyboard.press('ArrowLeft')
    await expect(stepLabel(page)).toHaveText('Tour · step 08 / 08')
    await page.keyboard.press('ArrowLeft')
    await expect(stepLabel(page)).toHaveText('Tour · step 07 / 08')
    await page.keyboard.press('Escape')
    await expect(placard(page)).toHaveCount(0)
    await expect(page.locator('.tour-frame')).toHaveCount(0)
    expect(calls).toEqual([])
  })

  test('“Do it for me” does each step (no key: the key line, what it would do); the end deletes the Tour page with Undo', async ({ page, context }) => {
    const calls = await blockClaude(context)
    await openApp(page)
    await startFromOffer(page)
    const doIt = placard(page).getByRole('button', { name: 'Do it for me' })
    const next = () => placard(page).getByRole('button', { name: /^(Next|Finish)/ }).click()
    const tourId = (await tourPageId(page))!
    expect(tourId).toBeTruthy()

    // 1 · the slash menu types /todo and inserts a to-do
    await doIt.click()
    await expect(placard(page).getByRole('button', { name: 'Done' })).toBeVisible({ timeout: 10_000 })
    await expect.poll(() => wsEval(page, (s, id) => JSON.stringify(s.pages[id].content), tourId)).toContain('"taskList"')
    await expect(editorOf(page)).toContainText('My first to-do')
    await next()

    // 2 · no key: the key line and what Transform into would do; Do it selects the list (the toolbar's Ask AI shows)
    await expect(placard(page).getByTestId('tour-keyline')).toContainText('add your key in Settings → Claude AI')
    await expect(placard(page).locator('.tour-would')).toBeVisible()
    await doIt.click()
    await expect(page.locator('[aria-label="Formatting"]').getByRole('button', { name: 'Ask AI' })).toBeVisible()
    await expect(panel(page)).toHaveCount(0)
    await next()

    // 3 · ⌘K opens in command mode
    await doIt.click()
    const pal = page.getByRole('dialog', { name: 'Command palette' })
    await expect(pal).toBeVisible()
    await expect(pal.locator('.pal-mode')).toHaveText('RUN')
    await next()
    await expect(pal).toHaveCount(0)

    // 4 · a database: the next board / timeline view
    await expect(page.locator('#main .pv-title')).toHaveValue('Projects')
    const active = () => page.locator('#main .db-tab[data-active="true"]').innerText()
    const before = await active()
    await doIt.click()
    await expect.poll(active).not.toBe(before)
    await next()

    // 5 · the AI terminal opens (no key: the key line)
    await expect(placard(page).getByTestId('tour-keyline')).toBeVisible()
    await doIt.click()
    await expect(page.getByRole('region', { name: 'AI terminal' })).toBeVisible()
    await next()
    await expect(page.getByRole('region', { name: 'AI terminal' })).toHaveCount(0)

    // 6 · the start page's version history
    await doIt.click()
    await expect(page.locator('.hist')).toBeVisible()
    await next()
    await expect(page.locator('.hist')).toHaveCount(0)

    // 7 · a dry run of a script: what would change, nothing written
    const rowsBefore = await wsEval(page, (s) => JSON.stringify((Object.values(s.pages) as AnyState[]).filter((p) => p.databaseId).map((p) => p.properties)))
    await doIt.click()
    await expect(placard(page).getByTestId('tour-note')).toHaveText(/Dry run: \d+ changes? — nothing written/)
    expect(await wsEval(page, (s) => JSON.stringify((Object.values(s.pages) as AnyState[]).filter((p) => p.databaseId).map((p) => p.properties)))).toBe(rowsBefore)
    await next()

    // 8 · Help with What's new
    await doIt.click()
    await expect(page.locator('.help')).toBeVisible()
    await expect(page.getByTestId('help-news')).toBeVisible()
    await next()

    // the finish card: delete the practice page (trash, Undo)
    await expect(placard(page).locator('#tour-title')).toHaveText('That’s the tour')
    await placard(page).getByRole('button', { name: 'Delete the Tour page' }).click()
    await expect(placard(page)).toHaveCount(0)
    await expect.poll(() => wsEval(page, (s, id) => !!s.pages[id]?.trashed, tourId)).toBe(true)
    await page.locator('.toast', { hasText: 'moved to the trash' }).getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => wsEval(page, (s, id) => !!s.pages[id]?.trashed, tourId)).toBe(false)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('one.tour') ?? '{}').done)).toBe(true)
    // finished once: ⌘K's list without a query no longer offers it (typing still finds it)
    await page.keyboard.press(`${MOD}+k`)
    await expect(page.getByRole('dialog', { name: 'Command palette' }).getByRole('option', { name: /What can One do/ })).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Command palette' }).getByRole('option', { name: /Start the tour/ })).toHaveCount(0)
    expect(calls).toEqual([])
  })

  test('with a key: “Do it for me” transforms the list into a diagram for real (mocked) — a preview first', async ({ page, context }) => {
    const bodies = await mockDiagram(context)
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    await startFromOffer(page)
    await placard(page).getByRole('button', { name: /^Next/ }).click()
    await expect(stepLabel(page)).toHaveText('Tour · step 02 / 08')
    await expect(placard(page).getByTestId('tour-keyline')).toHaveCount(0)
    await placard(page).getByRole('button', { name: 'Do it for me' }).click()
    await expect(panel(page)).toBeVisible()
    await expect(page.getByTestId('transform-preview')).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => bodies.length).toBeGreaterThan(0)
    expect(bodies.join('\n')).toContain('Ship the release on Friday')
    // nothing changed yet: the list is still a list
    const id = (await tourPageId(page))!
    expect(await wsEval(page, (s, id) => JSON.stringify(s.pages[id].content), id)).not.toContain('"mermaid"')
  })

  test('390 px: the offer card fits, the placard docks at the bottom, its keys are tappable', async ({ page, context }) => {
    await blockClaude(context)
    await page.setViewportSize({ width: 390, height: 844 })
    await openApp(page)
    await expect(offer(page)).toBeVisible()
    const card = (await offer(page).boundingBox())!
    expect(card.x).toBeGreaterThanOrEqual(0)
    expect(card.x + card.width).toBeLessThanOrEqual(390)
    await startFromOffer(page)
    const box = (await placard(page).boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    expect(844 - (box.y + box.height)).toBeLessThan(40)
    expect((await placard(page).getByRole('button', { name: /^Next/ }).boundingBox())!.height).toBeGreaterThanOrEqual(32)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await placard(page).getByRole('button', { name: /^Next/ }).click()
    await expect(stepLabel(page)).toHaveText('Tour · step 02 / 08')
    await placard(page).getByRole('button', { name: 'End the tour' }).click()
    await expect(placard(page)).toHaveCount(0)
  })

  test('German: the card, the placard and the practice page in German', async ({ page, context }) => {
    await blockClaude(context)
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await expect(offer(page)).toContainText('Die 3-Minuten-Tour')
    await offer(page).getByRole('button', { name: 'Tour starten' }).click()
    await expect(stepLabel(page)).toHaveText('Tour · Schritt 01 / 08')
    await expect(placard(page).locator('#tour-title')).toHaveText('Tippe / für jeden Block')
    await expect(placard(page).getByRole('button', { name: 'Mach’s für mich' })).toBeVisible()
    await expect(page.locator('#main .pv-title')).toHaveValue('Tour — hier ausprobieren')
    await page.keyboard.press('ArrowRight')
    await expect(placard(page).getByTestId('tour-keyline')).toContainText('Einstellungen → Claude KI')
    await page.keyboard.press('Escape')
    await expect(placard(page)).toHaveCount(0)
  })
})

/* ------------------------------------------------------------------ */

test.describe('What can One do?', () => {
  test('six groups, eighteen cards — each Try it opens the real place', async ({ page, context }) => {
    test.setTimeout(120_000)
    await blockClaude(context)
    await openApp(page, '#/discover')
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    await expect(page.getByRole('heading', { level: 1, name: 'What can One do?' })).toBeVisible()
    await expect(page.locator('.disc__group')).toHaveCount(6)
    await expect(page.locator('.disc-card')).toHaveCount(18)
    await expect(page.locator('.disc__head')).toHaveText([/Write/, /Organise/, /Claude/, /Automate/, /Share & team/, /Capture/])
    // every card: a title, what, how, Try it and its article
    for (const c of await page.locator('.disc-card').all()) {
      await expect(c.locator('.disc-card__title')).not.toBeEmpty()
      await expect(c.locator('.disc-card__what')).not.toBeEmpty()
      await expect(c.locator('.disc-card__how')).not.toBeEmpty()
      await expect(c.locator('.disc-card__try')).toBeEnabled()
      await expect(c.locator('.disc-card__help')).toHaveAttribute('data-help-id', /^[a-z-]+$/)
    }
    const dialog = (name: string | RegExp) => page.getByRole('dialog', { name })
    const title = () => page.locator('#main .pv-title')
    const places: Array<[string, () => Promise<void>]> = [
      ['slash', () => expect(page.locator('.slash')).toBeVisible()],
      ['sheet', () => expect(title()).toHaveValue('Budget 2026')],
      ['history', () => expect(page.locator('.hist')).toBeVisible()],
      ['database', () => expect(title()).toHaveValue('Projects')],
      ['palette', () => expect(dialog('Command palette')).toBeVisible()],
      ['commands', () => expect(page.locator('.cmd-menu')).toBeVisible()],
      ['ai-menu', () => expect(panel(page)).toBeVisible()],
      ['transform', () => expect(panel(page).locator('.ai-list__group', { hasText: 'Transform into' })).toBeVisible()],
      ['terminal', () => expect(page.getByRole('region', { name: 'AI terminal' })).toBeVisible()],
      ['scripts', () => expect(page).toHaveURL(/#\/scripts$/)],
      ['agents', () => expect(page).toHaveURL(/#\/agents$/)],
      ['automations', () => expect(dialog(/^Automations/)).toBeVisible()],
      ['share', () => expect(dialog(/^Share/)).toBeVisible()],
      ['settings-sync', () => expect(dialog('Settings').locator('[role="tab"][aria-selected="true"]')).toHaveAttribute('data-tab', 'sync')],
      ['settings-mcp', () => expect(dialog('Settings').locator('[role="tab"][aria-selected="true"]')).toHaveAttribute('data-tab', 'mcp')],
      ['import', () => expect(dialog('Import')).toBeVisible()],
      ['settings-mail', () => expect(dialog('Settings').locator('[role="tab"][aria-selected="true"]')).toHaveAttribute('data-tab', 'mail')],
      ['inbox', () => expect(page).toHaveURL(/#\/inbox$/)],
    ]
    expect(await page.locator('.disc-card__try').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.try))).toEqual(places.map(([k]) => k))
    for (const [key, check] of places) {
      await page.evaluate(() => (window.location.hash = '#/discover'))
      await expect(page.locator('.disc-card')).toHaveCount(18)
      await page.locator(`.disc-card__try[data-try="${key}"]`).click()
      await check()
      // close what it opened
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await page.mouse.click(5, 880)
    }
  })

  test('linked from the sidebar foot, the workspace menu, ⌘K and Help; the help card starts the tour', async ({ page, context }) => {
    await blockClaude(context)
    await openApp(page)
    const h1 = page.getByRole('heading', { level: 1, name: 'What can One do?' })
    await page.locator('.sb-foot .sb-discover').click()
    await expect(h1).toBeVisible()
    await expect(page.locator('.tb-crumb__title')).toHaveText('What can One do?')
    await page.goBack()
    await page.locator('.sb-head__ws').click()
    await page.getByRole('menuitem', { name: 'What can One do?' }).click()
    await expect(h1).toBeVisible()
    await page.goBack()
    await page.keyboard.press(`${MOD}+k`)
    await page.keyboard.type('what can one')
    await page.keyboard.press('Enter')
    await expect(h1).toBeVisible()
    await page.goBack()
    await page.locator('.status').getByRole('button', { name: /Help/ }).click()
    const start = page.getByTestId('help-start')
    await expect(start).toBeVisible()
    await start.getByRole('button', { name: /What can One do/ }).click()
    await expect(h1).toBeVisible()
    await expect(page.locator('.help')).toHaveCount(0)
    await page.locator('.status').getByRole('button', { name: /Help/ }).click()
    await start.getByRole('button', { name: /Take the 3-minute tour/ }).click()
    await expect(placard(page)).toBeVisible()
    await expect(page.locator('.help')).toHaveCount(0)
    await page.keyboard.press('Escape')
    // the Discover page's own key starts the tour too
    await page.evaluate(() => (window.location.hash = '#/discover'))
    await page.getByRole('button', { name: /Take the 3-minute tour/ }).click()
    await expect(placard(page)).toBeVisible()
  })

  test('German and 390 px: the cards stack in one column, nothing scrolls sideways', async ({ page, context }) => {
    await blockClaude(context)
    await page.setViewportSize({ width: 390, height: 844 })
    await openApp(page, '#/discover')
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    await expect(page.getByRole('heading', { level: 1, name: 'Was kann One?' })).toBeVisible()
    await expect(page.locator('.disc__head').first()).toContainText('Schreiben')
    await expect(page.locator('.disc-card__try').first()).toHaveText(/Ausprobieren/)
    const [a, b] = await page.locator('.disc-card').evaluateAll((els) => els.slice(0, 2).map((e) => e.getBoundingClientRect().top))
    expect(b).toBeGreaterThan(a + 40)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  })
})

/* ------------------------------------------------------------------ */

const LIST = (...items: string[]) => ({ type: 'bulletList', content: items.map((t) => ({ type: 'listItem', content: [para(t)] })) })

async function aiPage(page: Page) {
  const id = await createPage(page, {
    title: 'Menu check',
    content: doc(para('Alpha line with some words to rewrite here.'), heading(3, 'Plan'), LIST('One', 'Two', 'Three'), { type: 'image', attrs: { src: 'assets/covers/dunes.webp', alt: 'Dunes' } }, para('Omega line.'), para('')),
  })
  await gotoPage(page, id)
  return id
}

/** Select from → to (document positions of the main editor) and press the toolbar's Ask AI. */
async function askOn(page: Page, range: { from: number; to: number } | 'heading-list' | 'with-image') {
  await editorOf(page).evaluate((dom, range) => {
    const ed = (dom as unknown as { editor: AnyState }).editor
    let r = range as AnyState
    if (typeof range === 'string') {
      const pos: Record<string, number> = {}
      const ends: Record<string, number> = {}
      ed.state.doc.forEach((n: AnyState, p: number) => {
        pos[n.type.name] ??= p
        ends[n.type.name] = p + n.nodeSize
      })
      r = range === 'heading-list' ? { from: pos.heading + 1, to: ends.bulletList - 2 } : { from: pos.bulletList + 3, to: ends.image + 6 }
    }
    ed.chain().focus().setTextSelection(r).run()
  }, range)
  await page.locator('[aria-label="Formatting"], [aria-label="Formatierung"]').first().getByRole('button', { name: /^(Ask AI|KI fragen)$/ }).click()
  await expect(panel(page)).toBeVisible()
  return panel(page)
}

test.describe('AI menu: a short top level', () => {
  test('per selection type — text, several blocks, the cursor, an image in the selection; the prompt comes first', async ({ page, context }) => {
    await blockClaude(context)
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    await aiPage(page)

    // text within a line
    let ai = await askOn(page, { from: 3, to: 20 })
    await expect(ai.locator('.ai-lead')).toHaveText(/Ask in your own words and press\s*↵\s*— or pick an action:/)
    await expect(ai.locator('.ai-cmd__input')).toBeFocused()
    expect(await rowIds(ai)).toEqual(['improve', 'fix', 'shorter', 'translate', 'explain', 'more'])
    await expect(ai.locator('.ai-list__group')).toHaveText(['Edit selection', 'Understand'])
    await page.keyboard.press('Escape')

    // several blocks
    ai = await askOn(page, 'heading-list')
    expect(await rowIds(ai)).toEqual(['improve', 'fix', 'translate', 'transform', 'summarize', 'more'])
    await expect(ai.locator('#ai-row-transform .ai-row__sub')).toBeVisible()
    await expect(ai.locator('#ai-row-more')).toContainText('+13')
    await page.keyboard.press('Escape')

    // the cursor on an empty line (Space)
    await editorOf(page).locator('p').last().click()
    await page.keyboard.press('Space')
    ai = panel(page)
    await expect(ai).toBeVisible()
    expect(await rowIds(ai)).toEqual(['continue', 'outline', 'brainstorm', 'summarize', 'action_items', 'workspace', 'more'])
    await page.keyboard.press('Escape')

    // an image in the selection: its actions first, then the most used for the text
    ai = await askOn(page, 'with-image')
    expect(await rowIds(ai)).toEqual(['img-describe', 'img-read', 'img-table', 'img-ask', 'improve', 'more'])
    await expect(ai.locator('.ai-list__group').first()).toHaveText('Image')
  })

  test('every old action is still reachable: the full tree (top level, More, Translate, Transform into)', async ({ page, context }) => {
    await blockClaude(context)
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    await aiPage(page)
    const walk = async (ai: Locator) => {
      const top = await rowIds(ai)
      await ai.locator('#ai-row-more').click()
      await expect(ai.locator('.ai-chip', { hasText: 'More' })).toBeVisible()
      const more = await rowIds(ai)
      await page.keyboard.press('Backspace')
      await expect(ai.locator('#ai-row-more')).toBeVisible()
      return [...top.filter((x) => x !== 'more'), ...more].sort()
    }

    // several blocks: every action of the old flat list
    let ai = await askOn(page, 'heading-list')
    expect(await walk(ai)).toEqual(['action_items', 'agent', 'explain', 'fix', 'freeboard', 'improve', 'longer', 'reads', 'redo', 'remember', 'remember-example', 'shorter', 'summarize', 'todb', 'tolist', 'topage', 'transform', 'translate'].sort())
    await ai.locator('#ai-row-translate').click()
    await expect(ai.getByRole('option')).toHaveCount(13)
    await page.keyboard.press('Backspace')
    await ai.locator('#ai-row-transform').click()
    await expect(ai.getByRole('option')).toHaveText([/^Auto/, /^Board/, /^Free board/, /^Table/, /^Timeline/, /^Diagram/, /^Chart/, /^Columns/, /^Tabs/, /^Toggles/, /^Cards/])
    await page.keyboard.press('Escape')

    // the cursor
    await editorOf(page).locator('p').last().click()
    await page.keyboard.press('Space')
    ai = panel(page)
    expect(await walk(ai)).toEqual(['action_items', 'agent', 'brainstorm', 'continue', 'outline', 'reads', 'redo', 'summarize', 'workspace'].sort())
    await page.keyboard.press('Escape')

    // text with an image: the image's actions and every text action
    ai = await askOn(page, 'with-image')
    const all = await walk(ai)
    for (const id of ['img-describe', 'img-read', 'img-table', 'img-ask', 'improve', 'fix', 'shorter', 'longer', 'translate', 'redo', 'explain', 'summarize', 'action_items', 'remember', 'remember-example', 'agent', 'reads']) expect(all).toContain(id)

    // typing finds what sits under More (and still offers the own request)
    await ai.locator('.ai-cmd__input').fill('database')
    await expect(ai.getByRole('option', { name: /Turn into database/ })).toBeVisible()
    await expect(ai.getByRole('option', { name: /Ask Claude “database”/ })).toBeVisible()
  })

  test('keys: → opens a submenu, ← and Backspace come back; German labels', async ({ page, context }) => {
    await blockClaude(context)
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key', language: 'de' }))
    await aiPage(page)
    const ai = await askOn(page, 'heading-list')
    await expect(ai.locator('.ai-lead')).toContainText('Frag in eigenen Worten')
    await expect(ai.locator('#ai-row-more')).toContainText('Mehr…')
    // ↑ from the top wraps to the last row: More…
    await page.keyboard.press('ArrowUp')
    await expect(ai.locator('#ai-row-more')).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowRight')
    await expect(ai.locator('.ai-chip', { hasText: 'Mehr' })).toBeVisible()
    await expect(ai.locator('.ai-list__group', { hasText: 'Strukturieren' })).toBeVisible()
    await expect(ai.getByRole('option', { name: /In Datenbank umwandeln/ })).toBeVisible()
    await page.keyboard.press('ArrowLeft')
    await expect(ai.locator('#ai-row-more')).toBeVisible()
    await expect(ai.locator('.ai-chip')).toHaveCount(0)
    // → on Verwandeln in … opens the forms
    await ai.locator('#ai-row-transform').hover()
    await page.keyboard.press('ArrowRight')
    await expect(ai.locator('.ai-list__group', { hasText: 'Verwandeln in' })).toBeVisible()
    await page.keyboard.press('Backspace')
    await expect(ai.locator('#ai-row-more')).toBeVisible()
  })
})

/* ------------------------------------------------------------------ */

test.describe('grip menu and ⌘K', () => {
  test('the block menu groups Claude (with Ask AI); several blocks: Transform into first; ⌘K lists its commands in groups', async ({ page, context }) => {
    await blockClaude(context)
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    await aiPage(page)
    const ed = editorOf(page)
    await ed.locator('p', { hasText: 'Alpha line' }).hover()
    await page.getByRole('button', { name: 'Block menu' }).click()
    const menu = page.getByRole('menu')
    await expect(menu.locator('.menu-section', { hasText: 'Claude' })).toBeVisible()
    const labels = await menu.locator('.menu-item__label').allInnerTexts()
    expect(labels.indexOf('Ask AI')).toBeGreaterThan(labels.indexOf('Colour'))
    expect(labels.indexOf('Redo with instructions…')).toBe(labels.indexOf('Ask AI') + 1)
    expect(labels.slice(labels.indexOf('Duplicate'), labels.indexOf('Duplicate') + 3)).toEqual(['Duplicate', 'Move to', 'Copy link to block'])
    expect(labels[labels.length - 1]).toBe('Delete')
    await menu.getByRole('menuitem', { name: 'Ask AI' }).click()
    await expect(panel(page)).toBeVisible()
    await expect(panel(page).getByTestId('ai-reads')).toContainText('selection')
    await page.keyboard.press('Escape')

    // several selected blocks: the Claude group starts with Transform into
    await ed.locator(':is(h2, h3, h4)', { hasText: 'Plan' }).click()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Shift+ArrowDown')
    await expect(page.getByTestId('selection-count')).toBeVisible()
    await ed.locator(':is(h2, h3, h4)', { hasText: 'Plan' }).click({ button: 'right' })
    const multi = page.locator('[data-popover][role="menu"]').first()
    await expect(multi).toBeVisible()
    const many = await multi.locator('.menu-item__label').allInnerTexts()
    expect(many.slice(many.indexOf('Transform into'), many.indexOf('Transform into') + 3)).toEqual(['Transform into', 'Turn into database…', 'Redo with instructions…'])
    // "Turn into database…": the AI menu opens on More, the action highlighted (Enter runs it)
    await multi.getByRole('menuitem', { name: 'Turn into database…' }).click()
    await expect(panel(page).locator('.ai-chip', { hasText: 'More' })).toBeVisible()
    await expect(panel(page).locator('#ai-row-todb')).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Escape')
    // Esc hands the caret back to the editor — a frame later when the panel had no focus yet (busy machine):
    // wait for it, or the blur below comes first and the hand-back puts ⌘K into the editor (a link)
    await expect(panel(page)).toBeHidden()
    await expect(ed).toBeFocused()

    // ⌘K without a query: commands in groups, no duplicates (from outside the editor: there ⌘K edits a link)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
    await page.keyboard.press(`${MOD}+k`)
    const pal = page.getByRole('dialog', { name: 'Command palette' })
    await expect(pal.locator('.pal-group > span:first-child')).toHaveText(['Recent', 'Create', 'Go to', 'Claude', 'This page', 'Workspace', 'Getting started'])
    const names = await pal.locator('.pal-item__title').allInnerTexts()
    expect(new Set(names).size).toBe(names.length)
    await expect(pal.getByRole('option', { name: /AI terminal/ })).toBeVisible()
    // > lists every command, grouped the same way
    await page.keyboard.type('>')
    await expect(pal.locator('.pal-group > span:first-child').first()).toHaveText('Create')
  })
})
