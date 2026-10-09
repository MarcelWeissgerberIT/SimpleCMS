/**
 * Toasts (shell/stage/Toasts.tsx, store/ui.ts):
 *  - a double-click / double tap on a toast's key: the first press acts and removes the toast, the rest of the gesture
 *    never acts on what then lies there — a new toast in the old one's place, the app, a dialog — single clicks on toast
 *    keys right after a toast appears always work
 *  - background toasts (agent runs) never sit over a dialog: raised while one is open they wait, and show once the last
 *    one closes (dismissed meanwhile or older than two minutes: never)
 * The mirror recipe uses a fictional MCP server (tracker.example.com); Claude is mocked, nothing leaves the page.
 */
import type { BrowserContext, Locator, Page } from '@playwright/test'
import { test, expect, openApp, uiEval, wsEval, flush, pageIdByTitle } from './fixtures'
import { addProfile, trackerProfile } from './helpers/integrations'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const SERVERS = [
  { id: 'm-tracker', name: 'tracker', url: 'https://tracker.example.com/mcp', token: '', enabled: true, prompt: '', tools: ['list_items', 'get_item', 'search_items', 'whoami', 'create_item', 'update_item', 'add_comment'], checkedAt: Date.now() },
]
const RECIPE = '[data-recipe="tracker:mirror"]'

/** Two toasts in a row: the first one's key raises the second one (in the first one's place). */
const raiseChain = (page: Page) =>
  uiEval(page, (s) => {
    const w = window as unknown as { __runs: string[] }
    w.__runs = []
    s.toast({
      message: 'First toast, key raises the next.',
      action: {
        label: 'Undo',
        run: () => {
          w.__runs.push('first')
          s.toast({ message: 'Second toast, in its place.', action: { label: 'Undo', run: () => w.__runs.push('second') }, timeout: 20_000 })
        },
      },
      timeout: 20_000,
    })
  })
const runs = (page: Page) => page.evaluate(() => (window as unknown as { __runs: string[] }).__runs)

const centre = async (loc: Locator) => {
  const b = (await loc.boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

async function setupMirror(page: Page, lang: 'de' | 'en' = 'de') {
  await wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), SERVERS)
  await addProfile(page, trackerProfile({ match: { host: '*.example.com' } }))
  await wsEval(page, (s, lang) => s.updateSettings({ language: lang }), lang)
  await page.evaluate(() => (window.location.hash = '#/agents'))
  await page.locator('.agx').first().waitFor()
  await page.locator(`.agx-start ${RECIPE}`).click()
  const setup = page.locator('.agx-mir')
  await expect(setup).toBeVisible()
  return setup
}

const trackerTrashed = (page: Page, title = 'Tracker') => wsEval(page, (s, title) => (Object.values(s.pages) as AnyState[]).filter((p) => p.kind === 'database' && p.title === title).map((p) => !!p.trashed), title)
/** A name long enough for both mirror toasts to take their full width. */
const LONG = 'Tracker Handoff-Board des Plattform-Teams'

test.describe('Toasts: a double press acts once', () => {
  test('1440, mouse: a double-click on a toast key that raises a new toast in its place — the new one’s key is never pressed; single clicks right after a toast appears work', async ({ page }) => {
    await openApp(page)
    await raiseChain(page)
    const first = page.locator('.toast').filter({ hasText: 'First toast' })
    await expect(first).toBeVisible()
    const at = await centre(first.getByRole('button', { name: 'Undo' }))
    await page.mouse.dblclick(at.x, at.y)
    const second = page.locator('.toast').filter({ hasText: 'Second toast' })
    await expect(second).toBeVisible()
    await page.waitForTimeout(500)
    expect(await runs(page)).toEqual(['first'])
    // the second toast's key really lies where the first one's was
    const b = (await second.getByRole('button', { name: 'Undo' }).boundingBox())!
    expect(b.x <= at.x && at.x <= b.x + b.width && b.y <= at.y && at.y <= b.y + b.height).toBe(true)
    await second.getByRole('button', { name: 'Close' }).click()
    await expect(second).toHaveCount(0)

    // a script's single clicks, one right after the other: both keys act
    await raiseChain(page)
    await page.locator('.toast').filter({ hasText: 'First toast' }).getByRole('button', { name: 'Undo' }).click()
    await page.locator('.toast').filter({ hasText: 'Second toast' }).getByRole('button', { name: 'Undo' }).click()
    expect(await runs(page)).toEqual(['first', 'second'])
  })

  test('1440, mouse: a double-click on a toast’s key never reaches the app under it', async ({ page }) => {
    await openApp(page)
    await uiEval(page, (s) => s.toast({ message: 'Just one toast.', action: { label: 'Undo', run: () => {} }, timeout: 20_000 }))
    const key = page.locator('.toast').getByRole('button', { name: 'Undo' })
    const at = await centre(key)
    await page.evaluate((at) => {
      const b = document.createElement('button')
      b.id = 'e2e-under'
      b.type = 'button'
      Object.assign(b.style, { position: 'fixed', left: `${at.x - 8}px`, top: `${at.y - 8}px`, width: '16px', height: '16px', zIndex: '50' })
      b.dataset.clicks = '0'
      b.addEventListener('click', () => (b.dataset.clicks = String(Number(b.dataset.clicks) + 1)))
      document.querySelector('#root .app')!.appendChild(b)
    }, at)
    await page.mouse.dblclick(at.x, at.y)
    await expect(page.locator('.toast')).toHaveCount(0)
    await page.waitForTimeout(300)
    expect(await page.evaluate((p) => document.elementFromPoint(p.x, p.y)?.id, at)).toBe('e2e-under')
    expect(await page.locator('#e2e-under').evaluate((b) => Number(b.dataset.clicks))).toBe(0)
  })

  for (const [w, h] of [
    [1440, 900],
    [1280, 720],
  ] as const) {
    test(`${w}×${h}, German: the left-behind mirror toast’s “Rückgängig” double-clicked trashes the mirror once (the new toast’s key in its place is never pressed)`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h })
      await openApp(page)
      const setup = await setupMirror(page)
      // a long name: both toasts take their full width, the new one's key lands where the old one's was
      await setup.getByRole('textbox', { name: /Name/ }).fill(LONG)
      await setup.getByRole('button', { name: 'Datenbank und Agent anlegen' }).click()
      const editor = page.locator('.agx-editor')
      await expect(editor).toBeVisible()
      await page.goBack()
      await expect(editor).toHaveCount(0)
      const left = page.locator('.toast').filter({ hasText: 'nicht gespeichert' })
      await expect(left).toBeVisible()
      await page.waitForTimeout(500)
      const at = await centre(left.getByRole('button', { name: 'Rückgängig' }))
      await page.mouse.dblclick(at.x, at.y)
      const trashed = page.locator('.toast').filter({ hasText: 'liegen im Papierkorb' })
      await expect(trashed).toBeVisible()
      await page.waitForTimeout(600)
      // the new toast's key does lie where the old one's was
      const b = (await trashed.getByRole('button', { name: 'Rückgängig' }).boundingBox())!
      expect(b.x <= at.x && at.x <= b.x + b.width && b.y <= at.y && at.y <= b.y + b.height).toBe(true)
      expect(await trackerTrashed(page, LONG)).toEqual([true])
      await expect(trashed).toBeVisible()
      await expect(page.locator('.modal-scrim')).toHaveCount(0)
    })
  }

  test.describe('390 px, touch', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

    test('German: a double tap on the trash toast’s “Rückgängig” restores the mirror once and opens nothing', async ({ page }) => {
      await openApp(page)
      const setup = await setupMirror(page)
      await setup.getByRole('button', { name: 'Datenbank und Agent anlegen' }).tap()
      const editor = page.locator('.agx-editor')
      await expect(editor).toBeVisible()
      await editor.getByRole('button', { name: 'Abbrechen' }).tap()
      await page.locator('.agx-discard .btn--danger').tap()
      await expect(editor).toHaveCount(0)
      const toast = page.locator('.toast').filter({ hasText: 'liegen im Papierkorb' })
      await expect(toast).toBeVisible()
      expect(await trackerTrashed(page)).toEqual([true])
      await page.waitForTimeout(600)
      const hash = await page.evaluate(() => window.location.hash)
      const at = await centre(toast.getByRole('button', { name: 'Rückgängig' }))
      await page.touchscreen.tap(at.x, at.y)
      await page.waitForTimeout(90)
      await page.touchscreen.tap(at.x, at.y)
      await expect(toast).toHaveCount(0)
      await page.waitForTimeout(600)
      expect(await trackerTrashed(page)).toEqual([false])
      await expect(page.locator('.modal-scrim')).toHaveCount(0)
      expect(await page.evaluate(() => window.location.hash)).toBe(hash)
    })
  })
})

test.describe('Background toasts never sit over a dialog', () => {
  const openConfirm = (page: Page) => uiEval(page, (s) => s.openModal({ type: 'confirm', title: 'Sure?', body: 'Nothing happens.', confirmLabel: 'Go on', onConfirm: () => {} }))
  const raise = (page: Page, message: string) => uiEval(page, (s, message) => s.toast({ message, kind: 'error', action: { label: 'Open', run: () => {} }, background: true }) as string, message)

  test('raised while a dialog is open it waits, and shows when the last one closes; one on screen steps back while a dialog is open; other toasts show at once', async ({ page }) => {
    await openApp(page)
    await openConfirm(page)
    await expect(page.locator('.modal-scrim')).toBeVisible()
    await raise(page, 'Watcher: the run failed')
    await uiEval(page, (s) => s.toast({ message: 'Copied.', kind: 'success' }))
    await expect(page.locator('.toast').filter({ hasText: 'Copied.' })).toBeVisible()
    await page.waitForTimeout(300)
    expect(await page.locator('.toast').filter({ hasText: 'Watcher' }).count()).toBe(0)
    expect(await uiEval(page, (s) => ((s.waitingToasts ?? []) as AnyState[]).map((x) => x.message))).toEqual(['Watcher: the run failed'])
    await page.keyboard.press('Escape')
    await expect(page.locator('.modal-scrim')).toHaveCount(0)
    const shown = page.locator('.toast').filter({ hasText: 'Watcher' })
    await expect(shown).toBeVisible()
    // on screen, then a dialog opens: it steps back until the dialog closes
    await openConfirm(page)
    await expect(page.locator('.modal-scrim')).toBeVisible()
    await expect(shown).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(shown).toBeVisible()
  })

  test('dismissed by id while waiting, or raised more than two minutes before the dialog closes: never shown', async ({ page }) => {
    await openApp(page)
    await openConfirm(page)
    const id = await raise(page, 'Watcher: dismissed')
    await uiEval(page, (s, id) => s.dismissToast(id), id)
    expect(await uiEval(page, (s) => (s.waitingToasts ?? []).length)).toBe(0)
    await raise(page, 'Watcher: too old')
    // the dialog stays open for more than two minutes
    await page.evaluate(() => {
      const now = Date.now
      Date.now = () => now() + 121_000
    })
    await page.keyboard.press('Escape')
    await expect(page.locator('.modal-scrim')).toHaveCount(0)
    await page.waitForTimeout(400)
    expect(await page.locator('.toast').filter({ hasText: 'Watcher' }).count()).toBe(0)
    expect(await uiEval(page, (s) => (s.waitingToasts ?? []).length)).toBe(0)
  })

  /** Claude answers every request with an error (the run fails). */
  async function failingClaude(ctx: BrowserContext) {
    await ctx.route('https://api.anthropic.com/**', async (route) => {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' }
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      if (route.request().method() === 'GET') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ data: [], has_more: false }) })
      return route.fulfill({ status: 400, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'e2e: refused' } }) })
    })
  }

  test('1280×720: an agent run that fails in the background while the agent editor is open — its toast never covers “Create agent”, it shows after the editor closes', async ({ page, context, errors }) => {
    errors.allow(/400|e2e: refused|Failed to load resource/)
    await page.setViewportSize({ width: 1280, height: 720 })
    await failingClaude(context)
    await openApp(page)
    await wsEval(page, (s) => s.updateSettings({ aiApiKey: 'sk-ant-e2e-test-key' }))
    const projects = await pageIdByTitle(page, 'Projects')
    await wsEval(
      page,
      (s, db) => {
        const now = Date.now()
        s.upsertAgent({ id: 'ag-watch', name: 'Project rows watcher', instructions: 'Look at new rows.', trigger: { type: 'row_created', databaseId: db }, scope: { everything: true, pages: [], databases: [] }, write: 'none', output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: true, createdAt: now, updatedAt: now })
      },
      projects,
    )
    await flush(page)
    await page.evaluate(() => (window.location.hash = '#/agents'))
    await page.locator('.agx').first().waitFor()
    await page.locator('.agx-head .btn--primary').click()
    await page.locator('.agx-recipe-modal').getByRole('button', { name: /Blank/ }).click()
    const editor = page.locator('.agx-editor')
    await expect(editor).toBeVisible()
    await editor.getByLabel('Name').fill('Second agent')
    await wsEval(page, (s, db) => s.createRow(db, { title: 'A new row' }), projects)
    await expect.poll(() => uiEval(page, (s) => [...s.toasts, ...(s.waitingToasts ?? [])].map((x: AnyState) => x.message)), { timeout: 30_000 }).toEqual(['Project rows watcher: the run failed'])
    expect(await page.locator('.toast').count()).toBe(0)
    const save = editor.getByRole('button', { name: 'Create agent', exact: true })
    const at = await centre(save)
    expect(await page.evaluate((p) => !!document.elementFromPoint(p.x, p.y)?.closest('.agx-editor'), at)).toBe(true)
    await editor.getByRole('button', { name: 'Cancel' }).click()
    await expect(editor).toHaveCount(0)
    await expect(page.locator('.toast').filter({ hasText: 'Project rows watcher: the run failed' })).toBeVisible()
  })
})
