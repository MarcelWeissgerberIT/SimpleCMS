/**
 * Dialogs closing (ui/Modal.tsx), app-wide:
 *  - a double-click / double tap on a key that closes a dialog never acts on what lies underneath: the rest of that
 *    gesture (a mouse's second click, a touch tap on the same spot) is swallowed for a moment outside any dialog still
 *    open — single clicks and taps elsewhere are never touched
 *  - focus never ends on the page body: an opener that cannot take focus any more (disabled meanwhile), a route change
 *    right after closing (it takes the restored element), a click on the scrim — focus goes to the main region instead
 *  - at phone width a long header label goes on its own line above the title (cut with "…", the full text as a title),
 *    the title gets the whole width
 * The recipe dialogs use a fictional MCP server (tracker.example.com) and a mocked nothing — no request leaves.
 */
import type { Locator, Page } from '@playwright/test'
import { test, expect, openApp, uiEval, wsEval, flush } from './fixtures'
import { addProfile, trackerProfile } from './helpers/integrations'

type AnyState = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const SERVERS = [
  { id: 'm-tracker', name: 'tracker', url: 'https://tracker.example.com/mcp', token: '', enabled: true, prompt: '', tools: ['list_items', 'get_item', 'search_items', 'whoami', 'create_item', 'update_item', 'add_comment'], checkedAt: Date.now() },
]
const RECIPE = '[data-recipe="tracker:mirror"]'

async function setServers(page: Page, profile: AnyState = {}) {
  await wsEval(page, (s, list) => s.updateSettings({ mcpServers: list }), SERVERS)
  await addProfile(page, trackerProfile({ match: { host: '*.example.com' }, ...profile }))
}

/** #/agents → (New agent →) the mirror recipe: its setup dialog. */
async function openSetup(page: Page): Promise<Locator> {
  await page.evaluate(() => (window.location.hash = '#/agents'))
  await page.locator('.agx').first().waitFor()
  const inline = page.locator(`.agx-start ${RECIPE}`)
  if (await inline.count()) await inline.click()
  else {
    await page.locator('.agx-head .btn--primary').click()
    await page.locator(`.agx-recipe-modal ${RECIPE}`).click()
  }
  const dialog = page.locator('.agx-mir')
  await expect(dialog).toBeVisible()
  return dialog
}

/** A saved agent (the list then shows its card). */
const saveAgent = (page: Page, over: AnyState) =>
  wsEval(
    page,
    (s, a) => {
      const now = Date.now()
      s.upsertAgent({ instructions: 'Report on it.', trigger: { type: 'manual' }, scope: { everything: false, pages: [], databases: [] }, write: 'none', output: null, mcpServers: [], runner: 'browser', model: null, effort: null, maxRunUsd: 0.5, enabled: false, createdAt: now, updatedAt: now, ...a })
    },
    over,
  )

/** A button under `key` (same box), in the app behind the dialog: counts the presses and clicks that reach it. */
async function plantUnder(page: Page, key: Locator): Promise<Locator> {
  const box = (await key.boundingBox())!
  await page.evaluate((r) => {
    document.getElementById('e2e-under')?.remove()
    const b = document.createElement('button')
    b.id = 'e2e-under'
    b.type = 'button'
    b.textContent = 'under'
    Object.assign(b.style, { position: 'fixed', left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px`, zIndex: '1' })
    b.dataset.clicks = '0'
    b.dataset.downs = '0'
    b.addEventListener('mousedown', () => (b.dataset.downs = String(Number(b.dataset.downs) + 1)))
    b.addEventListener('pointerup', () => (b.dataset.ups = String(Number(b.dataset.ups ?? 0) + 1)))
    b.addEventListener('click', () => (b.dataset.clicks = String(Number(b.dataset.clicks) + 1)))
    document.querySelector('#root .app')!.appendChild(b)
  }, box)
  return page.locator('#e2e-under')
}
const counts = (under: Locator) => under.evaluate((b) => ({ downs: Number(b.dataset.downs), clicks: Number(b.dataset.clicks), focused: document.activeElement === b }))

async function openConfirm(page: Page, label = 'Go on') {
  await uiEval(page, (s, l) => s.openModal({ type: 'confirm', title: 'Sure?', body: 'Nothing happens.', confirmLabel: l, onConfirm: () => {} }), label)
  const key = page.getByRole('dialog').getByRole('button', { name: label })
  await expect(key).toBeVisible()
  return key
}

const focusState = (page: Page) =>
  page.evaluate(() => ({ body: document.activeElement === document.body || !document.activeElement, inMain: !!document.activeElement?.closest('#main'), tag: document.activeElement?.tagName ?? null }))

test.describe('Dialogs: a pointer that closes a dialog never acts on what lies underneath', () => {
  test('1440, mouse: the second click of a double-click on a closing key never reaches the app; a single click right after it does', async ({ page }) => {
    await openApp(page, '#/agents')
    let key = await openConfirm(page)
    const under = await plantUnder(page, key)
    await key.dblclick()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.waitForTimeout(150)
    expect(await counts(under)).toEqual({ downs: 0, clicks: 0, focused: false })

    // a single click right after a dialog closed (as fast as a script clicks) is the person's own
    key = await openConfirm(page)
    await key.click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await under.click()
    expect(await counts(under)).toEqual({ downs: 1, clicks: 1, focused: true })
    // and after the moment has passed, a double-click there is the app's again
    await page.waitForTimeout(500)
    await under.dblclick()
    expect(await counts(under)).toMatchObject({ downs: 3, clicks: 3 })
  })

  test('1440, mouse: a double-click on the scrim closes the dialog once — its second click never reaches the app', async ({ page }) => {
    await openApp(page, '#/agents')
    // a key of the app below the dialog, in the scrim's area (nothing of the dialog there), planted before it opens
    const spot = { x: 300, y: 860 }
    await page.evaluate((p) => {
      const b = document.createElement('button')
      b.id = 'e2e-under'
      b.type = 'button'
      Object.assign(b.style, { position: 'fixed', left: `${p.x - 10}px`, top: `${p.y - 10}px`, width: '20px', height: '20px', zIndex: '50' })
      b.dataset.clicks = '0'
      b.dataset.downs = '0'
      b.addEventListener('mousedown', () => (b.dataset.downs = String(Number(b.dataset.downs) + 1)))
      b.addEventListener('click', () => (b.dataset.clicks = String(Number(b.dataset.clicks) + 1)))
      document.querySelector('#root .app')!.appendChild(b)
    }, spot)
    await openConfirm(page)
    await page.mouse.dblclick(spot.x, spot.y)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.waitForTimeout(150)
    const under = page.locator('#e2e-under')
    expect(await page.evaluate((p) => document.elementFromPoint(p.x, p.y)?.id, spot)).toBe('e2e-under')
    expect(await counts(under)).toEqual({ downs: 0, clicks: 0, focused: false })
    // later, a click of its own reaches it
    await page.waitForTimeout(400)
    await under.click()
    expect(await counts(under)).toEqual({ downs: 1, clicks: 1, focused: true })
  })

  test('1440, German: a double-click on “Verwerfen, beide in den Papierkorb” never opens the agent card that lies under it', async ({ page }) => {
    await openApp(page)
    await setServers(page)
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    // saved agents: the list shows cards (a stray click on a card's name opens that agent)
    for (let i = 0; i < 6; i++) await saveAgent(page, { id: `ag-${i}`, name: i === 0 ? 'Wochenbericht für das ganze Team und alle Projekte' : `Agent ${i}`, createdAt: Date.now() + i })
    await flush(page)
    const dialog = await openSetup(page)
    await dialog.getByRole('button', { name: 'Datenbank und Agent anlegen' }).click()
    const editor = page.locator('.agx-editor')
    await expect(editor).toBeVisible()
    await editor.getByRole('button', { name: 'Abbrechen' }).click()
    const trash = page.locator('.agx-discard .btn--danger')
    await expect(trash).toBeVisible()
    const kb = (await trash.boundingBox())!
    const at = { x: kb.x + kb.width / 2, y: kb.y + kb.height / 2 }
    // the list behind the dialogs scrolled so that the first card's name lies right under that key
    const hit = await page.evaluate((at) => {
      const main = document.querySelector<HTMLElement>('#main')!
      const link = document.querySelector<HTMLElement>('.agx-card__name')!
      const r = link.getBoundingClientRect()
      main.scrollTop += r.top + r.height / 2 - at.y
      const s = link.getBoundingClientRect()
      return s.left <= at.x && at.x <= s.right && s.top <= at.y && at.y <= s.bottom
    }, at)
    expect(hit).toBe(true)
    await page.mouse.dblclick(at.x, at.y)
    await expect(editor).toHaveCount(0)
    await page.waitForTimeout(500)
    expect(await page.evaluate(() => window.location.hash)).toBe('#/agents')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // the first click did its job: the database is in the trash
    expect(await wsEval(page, (s) => (Object.values(s.pages) as AnyState[]).filter((p) => p.kind === 'database' && p.title === 'Tracker').map((p) => p.trashed))).toEqual([true])
  })

  test.describe('390 px, touch', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

    test('a double tap on a closing key never reaches the app; a tap elsewhere right after it does', async ({ page }) => {
      await openApp(page, '#/agents')
      let key = await openConfirm(page)
      const under = await plantUnder(page, key)
      const box = (await key.boundingBox())!
      const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      await key.tap()
      await page.touchscreen.tap(at.x, at.y)
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await page.waitForTimeout(150)
      expect(await counts(under)).toEqual({ downs: 0, clicks: 0, focused: false })

      // a tap well away from the closing tap, right after it: the person's own
      key = await openConfirm(page)
      const far = await plantUnder(page, page.locator('.agx-head .btn--primary, .agx-start .agx-recipe').first())
      await key.tap()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await far.tap()
      expect(await counts(far)).toMatchObject({ clicks: 1 })
    })

    test('German: a double tap on “Verwerfen, beide in den Papierkorb” leaves the agents list alone', async ({ page }) => {
      await openApp(page)
      await setServers(page)
      await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
      const dialog = await openSetup(page)
      await dialog.getByRole('button', { name: 'Datenbank und Agent anlegen' }).tap()
      const editor = page.locator('.agx-editor')
      await expect(editor).toBeVisible()
      await editor.getByRole('button', { name: 'Abbrechen' }).tap()
      const trash = page.locator('.agx-discard .btn--danger')
      await expect(trash).toBeVisible()
      const box = (await trash.boundingBox())!
      await trash.tap()
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
      await expect(editor).toHaveCount(0)
      await page.waitForTimeout(500)
      expect(await page.evaluate(() => window.location.hash)).toBe('#/agents')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      expect(await wsEval(page, (s) => (Object.values(s.pages) as AnyState[]).filter((p) => p.kind === 'database' && p.title === 'Tracker').map((p) => p.trashed))).toEqual([true])
    })
  })
})

test.describe('Dialogs: focus never ends on the page body after closing', () => {
  test('an opener disabled while the dialog was open: focus goes to the main region', async ({ page }) => {
    await openApp(page, '#/agents')
    await page.evaluate(() => {
      const b = document.createElement('button')
      b.id = 'e2e-opener'
      b.type = 'button'
      b.textContent = 'opener'
      document.querySelector('#main')!.prepend(b)
      b.focus()
    })
    await openConfirm(page)
    await page.evaluate(() => ((document.getElementById('e2e-opener') as HTMLButtonElement).disabled = true))
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.waitForTimeout(100)
    expect(await focusState(page)).toEqual({ body: false, inMain: true, tag: 'MAIN' })
  })

  test('the setup’s “Open “X”” (closes, then opens the agent): focus lands in the main region of the agent page', async ({ page }) => {
    await openApp(page)
    await setServers(page)
    let dialog = await openSetup(page)
    await dialog.getByRole('button', { name: 'Create database and agent' }).click()
    const editor = page.locator('.agx-editor')
    await editor.getByRole('switch', { name: 'Active' }).click()
    await editor.getByRole('button', { name: 'Create agent', exact: true }).click()
    await expect(page.locator('.agx-dhead')).toBeVisible()
    dialog = await openSetup(page)
    await dialog.getByTestId('agx-mir-exists').getByRole('button', { name: /^Open / }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.agx-dhead')).toBeVisible()
    await page.waitForTimeout(700)
    expect(await focusState(page)).toMatchObject({ body: false, inMain: true })
  })

  test('agent page ⋯ → Delete agent → Delete (back to #/agents): focus lands in the main region', async ({ page }) => {
    await openApp(page)
    await saveAgent(page, { id: 'ag-del', name: 'Digest' })
    await flush(page)
    await page.evaluate(() => (window.location.hash = '#/agents/ag-del'))
    await expect(page.locator('.agx-dhead')).toBeVisible()
    await page.getByRole('button', { name: 'More' }).click()
    await page.getByRole('menuitem', { name: 'Delete agent' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/agents')
    await page.waitForTimeout(700)
    expect(await focusState(page)).toMatchObject({ body: false, inMain: true })
  })

  test('a mouse click on the setup dialog’s scrim: focus goes back to the key that opened it', async ({ page }) => {
    await openApp(page)
    await setServers(page)
    await openSetup(page)
    await page.mouse.click(8, 300)
    await expect(page.locator('.agx-mir')).toHaveCount(0)
    await page.waitForTimeout(300)
    expect(await focusState(page)).toMatchObject({ body: false })
    expect(await page.locator(`.agx-start ${RECIPE}`).evaluate((el) => el === document.activeElement)).toBe(true)
  })
})

/** The header's parts: label above / beside the title, the title's width against the header's inner width. */
const headerOf = (dialog: Locator) =>
  dialog.locator('.modal__header').evaluate((head) => {
    const box = (sel: string) => head.querySelector(sel)!.getBoundingClientRect()
    const cs = getComputedStyle(head)
    const label = head.querySelector<HTMLElement>(':scope > .label')!
    const [l, t, c] = [box(':scope > .label'), box('.modal__title'), box('.modal__close')]
    return {
      stacked: head.hasAttribute('data-stacked'),
      labelAbove: l.bottom <= t.top + 1,
      sameRow: Math.abs(l.top + l.height / 2 - (t.top + t.height / 2)) < 12,
      closeOnLabelRow: c.top < t.top,
      titleFull: t.width >= head.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 1,
      clipped: label.scrollWidth > label.clientWidth + 1,
      inside: l.left >= head.getBoundingClientRect().left && l.right <= head.getBoundingClientRect().right + 0.5,
    }
  })

test.describe('Dialogs: a long header label at phone width', () => {
  test('390 px: the label goes on its own line above the title (cut with “…”, its full text as a title on hover); the title gets the full width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openApp(page)
    await setServers(page, { name: 'Tracker · Handoff-Board des Plattform-Teams' })
    await wsEval(page, (s) => s.updateSettings({ language: 'de' }))
    const dialog = await openSetup(page)
    const h = await headerOf(dialog)
    expect(h).toMatchObject({ stacked: true, labelAbove: true, closeOnLabelRow: true, titleFull: true, clipped: true, inside: true })
    // its full text on hover
    const label = dialog.locator('.modal__header > .label')
    await label.hover()
    await expect(label).toHaveAttribute('title', '§ AG-S · TRACKER · HANDOFF-BOARD DES PLATTFORM-TEAMS')
    await expect(dialog.getByRole('heading', { name: 'Liste in eine Datenbank spiegeln' })).toBeVisible()
    await page.keyboard.press('Escape')

    // a short label stays beside the title, on one row (Import: "§ IO-01")
    await expect(dialog).toHaveCount(0)
    await uiEval(page, (s) => s.openModal({ type: 'import' }))
    const io = page.locator('.modal.io-modal')
    await expect(io).toBeVisible()
    expect(await headerOf(io)).toMatchObject({ stacked: false, sameRow: true, clipped: false })
  })

  test('1440: the same dialog keeps label and title on one row', async ({ page }) => {
    await openApp(page)
    await setServers(page)
    const dialog = await openSetup(page)
    expect(await headerOf(dialog)).toMatchObject({ stacked: false, sameRow: true, clipped: false })
  })
})
